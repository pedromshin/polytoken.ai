// scripts/fill-wedge-baseline.mjs — WEDG-04: compute the three WEDGE-BASELINE metrics and,
// only under --apply, write the baseline document.
//
// ## The guard that matters most
// It REFUSES to write unless the learning loop has run ENOUGH for the three headline numbers to
// mean something. "Enough" is not a vibe — it is the six numbered rules in ELIGIBILITY below,
// each naming the metric it protects and the threshold it enforces. An early read bakes a
// meaningless number into the baseline and poisons every later delta (the capture rule the
// WEDGE-BASELINE skeleton opens with). The refusal exits 3 and names every rule that failed.
//
// The first version of this guard only refused on "zero corrections" and "zero cascades", which
// let the worst case through: ONE cascade whose `affected_email_ids` is EMPTY published
// `M2 = 0.0 emails re-pointed per confirmed merge` — the "one click compounds" headline — and
// `M3 = 100.0 % of 1 corrections stick`, under prose asserting WEDG-01/02 were DONE. The sibling
// collect-wedge-evidence.mjs treats that identical state as a hard FAIL (E3). The two now agree.
//
// ## The definitions are the shipped router's, not this script's
// M1/M2/M3 mirror `deriveLearningSummary` in packages/api-client/src/router/learning/index.ts.
// That is ENFORCED, not asserted: the script hashes TWO slices of the router's own source and
// refuses to run if either moved.
//
//   MIRRORED_FINGERPRINT   the arithmetic — `relabelCount` through `deriveLearningSummary`
//   SELECTION_FINGERPRINT  the POPULATION — the `summary` procedure's select/innerJoin/where
//
// The second pin exists because the first one is not enough: this script hand-ports the router's
// tenancy join in readRowsFromDb, so a future change to the join, the WHERE, a soft-delete
// filter or a date window would change what the surface shows while the arithmetic hash — and
// this script's numbers — stayed put. Both slices are pinned, so both stop the script.
//
//   M1 corrections made      = typeCorrections + mergeCascades (row counts of the two ledgers)
//   M2 re-labels per cascade = Σ|affected_email_ids| / mergeCascades, null when no cascade
//   M3 % that stick          = sticking / correctionsMade, by SUPERSESSION (a type correction
//                              sticks iff no strictly-later correction re-corrects the same
//                              component; a cascade sticks iff its survivor was never itself
//                              absorbed by a strictly-later cascade)
//
// NOTE on M3: the 0c-uat-pack skeleton drafted M3 as "not re-corrected within N=14 days". The
// SHIPPED definition is unwindowed supersession — no arbitrary N. This script follows the
// shipped router (the number a human will see on the surface) and records the divergence in
// the document it writes.
//
// READ-ONLY against the database (server-enforced; see scripts/lib/close-kit-db.mjs). The only
// thing it can write is the baseline document, only under --apply.
//
// USAGE (from the repo root):
//   node scripts/fill-wedge-baseline.mjs --env .env.production --allow-prod
//   node scripts/fill-wedge-baseline.mjs --env .env.production --allow-prod --user-id <uuid>
//   node scripts/fill-wedge-baseline.mjs --env .env.production --allow-prod --apply
//   node scripts/fill-wedge-baseline.mjs --fixture path/to/rows.json     # guard drill, no DB
//
//   --user-id <uuid>  scope to one owner exactly as the router does (importers.user_id);
//                     omitted = every importer in the database, labelled as such
//   --apply           write the document (default: print it, write nothing)
//   --out <path>      target document (default .planning/milestones/WEDGE-BASELINE.md)
//   --force           allow --apply to overwrite an existing document
//   --fixture <path>  compute from a local JSON row dump instead of the database, for
//                     exercising the guard without credentials.
//
// WHAT A FIXTURE RUN MAY WRITE — the exact, enforced rule (it was previously overstated):
//   a fixture run's --out may not be the real baseline path AND may not be anywhere inside the
//   repo's `.planning/` tree. Both comparisons run through samePath/isInside, which case-fold on
//   win32 and darwin — so on THIS repo's platform (Windows/NTFS)
//   `--out .planning/Milestones/wedge-baseline.MD` is refused, not written. It used to be
//   written: the old check was a case-sensitive `===` against a case-insensitive filesystem, so
//   the guard the header advertised did not exist on the only platform this repo is driven from.
//   Everything a fixture run does write carries a SYNTHETIC banner.
//
// EXIT CODES: 0 eligible (and written under --apply) · 1 refused for a correctness reason
// (definition drift, existing file without --force) · 2 config/usage refusal · 3 INELIGIBLE
// (the not-enough-signal guard) · 4 runtime error.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ConfigError,
  EXIT,
  closeQuietly,
  describeTarget,
  isInside,
  openReadOnly,
  readArgs,
  readOnlyTx,
  resolveDatabaseUrl,
  samePath,
} from './lib/close-kit-db.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const ROUTER_PATH = join(REPO, 'packages/api-client/src/router/learning/index.ts');
const PLANNING_DIR = join(REPO, '.planning');
const DEFAULT_OUT = join(REPO, '.planning/milestones/WEDGE-BASELINE.md');

/** The flag vocabulary — anything else is a refusal, not a silently dropped token. */
const VALUE_FLAGS = ['env', 'out', 'fixture', 'user-id'];
const BOOL_FLAGS = ['apply', 'force', 'allow-prod'];

// sha256 of the router's own metric functions and of its row-selection block (see
// readDefinitionFingerprint). Update ONLY together with a re-check of the port below — that is
// the whole point of the pins.
export const MIRRORED_FINGERPRINT = 'e50d827ddff29e97ebd72b4354e7ca59585cdcfdd78f37dd726d96d23a085e3f';
export const SELECTION_FINGERPRINT = '66de0499cd67f27094d300ff55ce38ec19409f7194d919f314dfd85960cd4c98';

// ---------------------------------------------------------------------------
// Mirror guard
// ---------------------------------------------------------------------------

/** Raised when the router's definitions moved out from under this script's port. */
export class MirrorDriftError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MirrorDriftError';
  }
}

/**
 * Hash the two router slices this script mirrors:
 *   metrics   — `relabelCount` through the end of `deriveLearningSummary` (the arithmetic)
 *   selection — the `summary` procedure body (the tenancy join and WHERE: the POPULATION)
 * Line endings are normalised (a CRLF checkout must not read as drift); nothing else is, so a
 * real edit to either slice always moves its hash.
 */
export function readDefinitionFingerprint(routerPath = ROUTER_PATH) {
  const src = readFileSync(routerPath, 'utf8').replace(/\r\n/g, '\n');
  const digest = (slice) => createHash('sha256').update(slice).digest('hex');

  const start = src.indexOf('function relabelCount(');
  const anchor = src.indexOf('export function deriveLearningSummary(');
  const end = anchor === -1 ? -1 : src.indexOf('\n}\n', anchor);
  const selStart = src.indexOf('summary: protectedProcedure.query(');
  const selEnd = selStart === -1 ? -1 : src.indexOf('\n});', selStart);
  if (start === -1 || anchor === -1 || end === -1 || start > anchor || selStart === -1 || selEnd === -1) {
    throw new ConfigError(
      `cannot locate the metric definitions or the row-selection block in ${routerPath} — the anchors moved.\n` +
        '  Re-read the router, re-check the port in this script, then update both fingerprints.',
    );
  }
  return Object.freeze({
    metrics: digest(src.slice(start, end + 3)),
    selection: digest(src.slice(selStart, selEnd + 4)),
  });
}

export function assertMirrorIntact(routerPath = ROUTER_PATH) {
  const actual = readDefinitionFingerprint(routerPath);
  const drifted = [
    actual.metrics === MIRRORED_FINGERPRINT
      ? null
      : `  metric arithmetic: expected ${MIRRORED_FINGERPRINT}\n                     actual   ${actual.metrics}`,
    actual.selection === SELECTION_FINGERPRINT
      ? null
      : `  row selection:     expected ${SELECTION_FINGERPRINT}\n                     actual   ${actual.selection}`,
  ].filter((line) => line !== null);
  if (drifted.length === 0) return actual;
  throw new MirrorDriftError(
    'the learning-router source CHANGED — this script no longer provably mirrors it.\n' +
      `${drifted.join('\n')}\n` +
      `  Re-read ${routerPath}, re-check the port below (arithmetic AND the tenancy join in\n` +
      '  readRowsFromDb), then update the fingerprint(s).',
  );
}

// ---------------------------------------------------------------------------
// The port — line-for-line the router's deriveLearningSummary (index.ts:103-165)
// ---------------------------------------------------------------------------

function relabelCount(ids) {
  return Array.isArray(ids) ? ids.length : 0;
}

export function deriveLearningSummary(typeCorrections, propagations) {
  const typeCount = typeCorrections.length;
  const cascadeCount = propagations.length;
  const correctionsMade = typeCount + cascadeCount;

  const emailsRelabeled = propagations.reduce((sum, row) => sum + relabelCount(row.affectedEmailIds), 0);

  const latestByComponent = new Map();
  for (const row of typeCorrections) {
    const at = row.createdAt.getTime();
    const prev = latestByComponent.get(row.componentId);
    latestByComponent.set(row.componentId, prev === undefined ? at : Math.max(prev, at));
  }
  const stickingTypeCorrections = typeCorrections.filter((row) => {
    const latest = latestByComponent.get(row.componentId);
    return latest === undefined || row.createdAt.getTime() >= latest;
  }).length;

  const latestAbsorbedAt = new Map();
  for (const row of propagations) {
    const at = row.createdAt.getTime();
    const prev = latestAbsorbedAt.get(row.absorbedEntityInstanceId);
    latestAbsorbedAt.set(row.absorbedEntityInstanceId, prev === undefined ? at : Math.max(prev, at));
  }
  const stickingCascades = propagations.filter((row) => {
    const absorbedAt = latestAbsorbedAt.get(row.survivorEntityInstanceId);
    return absorbedAt === undefined || absorbedAt <= row.createdAt.getTime();
  }).length;

  return {
    correctionsMade,
    typeCorrections: typeCount,
    mergeCascades: cascadeCount,
    emailsRelabeled,
    relabelsPerCorrection: cascadeCount === 0 ? null : emailsRelabeled / cascadeCount,
    stickRate: correctionsMade === 0 ? null : (stickingTypeCorrections + stickingCascades) / correctionsMade,
  };
}

/** Skeleton-only extras (max re-labels, avg edges promoted) — no router definition exists. */
export function deriveExtras(propagations) {
  if (propagations.length === 0) return { maxRelabels: 0, avgEdgesPromoted: 0 };
  const counts = propagations.map((row) => relabelCount(row.affectedEmailIds));
  const edges = propagations.map((row) => relabelCount(row.promotedEdgeIds));
  return {
    maxRelabels: Math.max(...counts),
    avgEdgesPromoted: edges.reduce((a, b) => a + b, 0) / propagations.length,
  };
}

// ---------------------------------------------------------------------------
// Row sources
// ---------------------------------------------------------------------------

const toRowDate = (value) => (value instanceof Date ? value : new Date(value));

async function readRowsFromDb(sql, userId) {
  return readOnlyTx(sql, async (tx) => {
    // The router's tenancy: join importer_id → importers, filter importers.user_id. With no
    // --user-id the join still runs (rows without a live importer are excluded either way),
    // but the scope is every importer — the output labels which of the two applies.
    // SELECTION_FINGERPRINT pins the router side of this port.
    const typeRows = userId
      ? await tx`select c.component_id, c.created_at from entity_type_corrections c
                 join importers i on i.id = c.importer_id where i.user_id = ${userId}`
      : await tx`select c.component_id, c.created_at from entity_type_corrections c
                 join importers i on i.id = c.importer_id`;
    const propRows = userId
      ? await tx`select p.survivor_entity_instance_id, p.absorbed_entity_instance_id,
                        p.affected_email_ids, p.promoted_edge_ids, p.created_at
                 from correction_propagations p
                 join importers i on i.id = p.importer_id where i.user_id = ${userId}`
      : await tx`select p.survivor_entity_instance_id, p.absorbed_entity_instance_id,
                        p.affected_email_ids, p.promoted_edge_ids, p.created_at
                 from correction_propagations p
                 join importers i on i.id = p.importer_id`;
    return {
      typeCorrections: typeRows.map((r) => ({ componentId: r.component_id, createdAt: toRowDate(r.created_at) })),
      propagations: propRows.map((r) => ({
        survivorEntityInstanceId: r.survivor_entity_instance_id,
        absorbedEntityInstanceId: r.absorbed_entity_instance_id,
        affectedEmailIds: r.affected_email_ids,
        promotedEdgeIds: r.promoted_edge_ids,
        createdAt: toRowDate(r.created_at),
      })),
    };
  });
}

/** Fixture shape: { typeCorrections: [{componentId, createdAt}], propagations: [...] }. */
export function readRowsFromFixture(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const typeCorrections = (raw.typeCorrections ?? []).map((r) => ({
    componentId: r.componentId,
    createdAt: toRowDate(r.createdAt),
  }));
  const propagations = (raw.propagations ?? []).map((r) => ({
    survivorEntityInstanceId: r.survivorEntityInstanceId,
    absorbedEntityInstanceId: r.absorbedEntityInstanceId,
    affectedEmailIds: r.affectedEmailIds ?? [],
    promotedEdgeIds: r.promotedEdgeIds ?? [],
    createdAt: toRowDate(r.createdAt),
  }));
  return { typeCorrections, propagations };
}

// ---------------------------------------------------------------------------
// Eligibility — the guard. WHAT "ENOUGH" MEANS, exactly.
// ---------------------------------------------------------------------------

/**
 * The thresholds, in one place, each attached to the metric it protects. They are deliberately
 * LOW: this is not a statistical-power test, it is a floor below which the published number is
 * arithmetically incapable of carrying information.
 */
export const ELIGIBILITY = Object.freeze({
  /** M1's first term and M3's type-correction leg. */
  MIN_TYPE_CORRECTIONS: 1,
  /** M2's denominator, and WEDG-01/02's evidence that the cascade ran at all. */
  MIN_CASCADES: 1,
  /** M2's numerator — the re-label fan-out must have had real mail to re-point. */
  MIN_EMAILS_RELABELED: 1,
  /**
   * M3's denominator. M3's resolution is 1/n: at n=1 the only possible reading is 100 % (nothing
   * can supersede a lone correction), at n=2 only 0/50/100. n=3 is the first denominator that can
   * express a rate rather than a coin flip, so it is the floor.
   */
  MIN_CORRECTIONS_FOR_STICK_RATE: 3,
});

/**
 * Every state in which the three headline numbers would be meaningless, as numbered rules.
 * Returns [] when the baseline may be written. Pure — the caller decides what to do with it.
 *
 * The rules are ordered by how badly each poisons the artifact, and each explains what to do.
 */
export function eligibilityRefusals(summary, rows = null) {
  const refusals = [];

  if (summary.correctionsMade === 0) {
    refusals.push(
      'R1 · M1/M2/M3 — ZERO corrections exist (entity_type_corrections + correction_propagations ' +
        'are both empty). Every metric would be a meaningless zero; M3 would be null.',
    );
  }
  if (summary.mergeCascades < ELIGIBILITY.MIN_CASCADES) {
    refusals.push(
      `R2 · M2 — the cascade has NEVER run (correction_propagations holds ${summary.mergeCascades} row(s), ` +
        `need ≥ ${ELIGIBILITY.MIN_CASCADES}): WEDG-01 (CASCADE_CORRECTION_ENABLED live + cascade_relabel ` +
        'draining) and WEDG-02 (one genuine merge on real mail) are not done, so M2 is undefined (null, not 0).',
    );
  }
  if (summary.mergeCascades > 0 && summary.emailsRelabeled < ELIGIBILITY.MIN_EMAILS_RELABELED) {
    refusals.push(
      `R3 · M2 — the cascade fan-out is EMPTY (Σ|affected_email_ids| = ${summary.emailsRelabeled} across ` +
        `${summary.mergeCascades} cascade(s), need ≥ ${ELIGIBILITY.MIN_EMAILS_RELABELED}). M2 would publish ` +
        '"0.0 emails re-pointed per confirmed merge" as the "one click compounds" headline while the ' +
        're-label leg is entirely UNPROVEN. collect-wedge-evidence.mjs fails this same state at E3; the ' +
        'two scripts agree. Cascade a merge whose absorbed identity actually appears on mail.',
    );
  }
  if (summary.typeCorrections < ELIGIBILITY.MIN_TYPE_CORRECTIONS) {
    refusals.push(
      `R4 · M1/M3 — no type re-label exists (entity_type_corrections holds ${summary.typeCorrections} row(s), ` +
        `need ≥ ${ELIGIBILITY.MIN_TYPE_CORRECTIONS}). M1 is published as "N type re-labels + M cascades" and ` +
        'M3 as a rate over BOTH ledgers; with this leg empty the document describes a loop that only ' +
        'half-ran. Make one genuine type correction, or change the document to stop claiming both legs.',
    );
  }
  if (summary.correctionsMade > 0 && summary.correctionsMade < ELIGIBILITY.MIN_CORRECTIONS_FOR_STICK_RATE) {
    refusals.push(
      `R5 · M3 — only ${summary.correctionsMade} correction(s) exist (need ≥ ` +
        `${ELIGIBILITY.MIN_CORRECTIONS_FOR_STICK_RATE}). M3's resolution is 1/n: at n=1 it can ONLY read ` +
        '100.0 % because nothing can supersede a lone correction, at n=2 only 0/50/100. Publishing that as ' +
        '"% of corrections that stick" states a fact about the arithmetic, not about the product.',
    );
  }
  const degenerate = degenerateTimestamps(rows);
  if (degenerate !== null) {
    refusals.push(
      `R6 · M3 — all ${degenerate.count} correction rows carry the SAME created_at (${degenerate.at}). ` +
        'Supersession is the only mechanism M3 has, and it compares timestamps: with every row tied, ' +
        'ties do not supersede and the rate is 100 % by construction. This is the signature of a seeded ' +
        'or backfilled table, not of a loop that ran.',
    );
  }
  return refusals;
}

/**
 * Do ALL correction rows share one timestamp? (null when rows were not supplied, or when there
 * are fewer than two — a single row cannot be "degenerate", R5 already covers it.)
 */
function degenerateTimestamps(rows) {
  if (rows === null) return null;
  const times = [...rows.typeCorrections, ...rows.propagations].map((r) => r.createdAt.getTime());
  if (times.length < 2) return null;
  const first = times[0];
  if (!times.every((t) => t === first)) return null;
  return { count: times.length, at: new Date(first).toISOString() };
}

/**
 * May a FIXTURE run write to `outPath`? Returns the refusal text, or null when it may.
 *
 * Two layers, both filesystem-accurate (samePath/isInside case-fold on win32 and darwin):
 * the real baseline file itself, and the whole `.planning/` tree around it. The second layer is
 * what makes the first one hard to route around — every near-miss spelling of the baseline path
 * still lands inside `.planning/`.
 */
export function fixtureWriteRefusal(outPath, { defaultOut = DEFAULT_OUT, planningDir = PLANNING_DIR } = {}) {
  if (samePath(outPath, defaultOut)) {
    return (
      `a fixture run may not write the real baseline (${defaultOut}).\n` +
      `  --out resolved to ${resolve(outPath)}, which IS that file on this filesystem.\n` +
      '  Pass --out <scratch path outside .planning/> if you are drilling the write path.'
    );
  }
  if (isInside(planningDir, outPath)) {
    return (
      `a fixture run may not write anywhere inside ${planningDir}.\n` +
      `  --out resolved to ${resolve(outPath)}.\n` +
      '  Synthetic numbers do not belong in the tracked planning tree; use a scratch path.'
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

const pct = (v) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)} %`);
const num = (v, digits = 1) => (v === null ? 'n/a' : v.toFixed(digits));

export function renderDocument({ summary, extras, scope, target, capturedAt, fingerprint, fixture }) {
  const banner = fixture
    ? '> ⛔ **SYNTHETIC — FIXTURE RUN.** These numbers came from a local JSON fixture, NOT from a\n> database. This file is a drill artifact and must never be treated as the baseline.\n\n'
    : '';
  return `# WEDGE-BASELINE — email-intelligence learning-loop, first real values

${banner}> Captured ${capturedAt} by \`scripts/fill-wedge-baseline.mjs\` (WEDG-04).
> Source of truth for the definitions: \`packages/api-client/src/router/learning/index.ts\`
> (\`deriveLearningSummary\` arithmetic sha256 \`${fingerprint.metrics}\`; \`summary\` row-selection
> sha256 \`${fingerprint.selection}\` — the script refuses to run if either moves).
> Scope: ${scope} · target: \`${target}\`.
>
> CAPTURE RULE (load-bearing): these values are readable only because the loop actually ran. The
> script refuses to write unless ALL of the following hold — a blank baseline is correct, a
> zeroed or single-row one is poison:
>   R1 at least one correction exists · R2 ≥ ${ELIGIBILITY.MIN_CASCADES} merge cascade (WEDG-01 + WEDG-02 done)
>   R3 ≥ ${ELIGIBILITY.MIN_EMAILS_RELABELED} email actually re-labelled by a cascade (M2's numerator is not 0)
>   R4 ≥ ${ELIGIBILITY.MIN_TYPE_CORRECTIONS} type re-label (M1's other leg is not empty)
>   R5 ≥ ${ELIGIBILITY.MIN_CORRECTIONS_FOR_STICK_RATE} corrections total (below that M3 can only read 0/50/100)
>   R6 the correction rows do not all share one timestamp (M3's supersession must be able to discriminate)

## M1 — Corrections made

**${summary.correctionsMade}** = ${summary.typeCorrections} type re-labels (\`entity_type_corrections\`) + ${summary.mergeCascades} confirmed cascades (\`correction_propagations\`).

One cascade row per merge — \`job_key\` \`cascade:{survivor}:{absorbed}\` is UNIQUE, so a redelivered
cascade is never double-counted.

## M2 — Re-labels per cascade (propagation leverage)

**${num(summary.relabelsPerCorrection)}** emails re-pointed per confirmed merge
(${summary.emailsRelabeled} emails across ${summary.mergeCascades} cascades — the "one click compounds" number).

Skeleton-only extras, with no definition in the router: max ${extras.maxRelabels} re-labels in a single
cascade; ${num(extras.avgEdgesPromoted)} edges promoted per cascade on average.

## M3 — % of corrections that stick

**${pct(summary.stickRate)}** of ${summary.correctionsMade} corrections stick.

Definition (the SHIPPED one): supersession, unwindowed. A type correction sticks iff no strictly-later
correction targets the same \`component_id\`; a cascade sticks iff its survivor was never itself absorbed
by a strictly-later cascade. **Divergence on record:** the 0c-uat-pack skeleton drafted M3 as "not
re-corrected within N=14 days". The router shipped the unwindowed rule instead (no arbitrary N, and
strictly stricter), and this file follows what the surface actually shows.

## Surfaced on

The pipeline-health node/panel via \`learning.summary\` (WEDG-03) — one existing surface, no new page.

## Deliberately NOT built this milestone (the Track-6 boundary)

- Entity resolution across domains (suggest-only stance stands)
- JIT structured-note retrieval (BlendedRAG + RRF k=60)
- Circular treemap on the node model
- Reprocess-to-date (idempotent, via the now-live worker)

## Feeds

The next milestone's Track-6 opener — this file is its intake artifact.
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(argv) {
  let sql = null;
  try {
    const args = readArgs(argv, { valueFlags: VALUE_FLAGS, boolFlags: BOOL_FLAGS });
    const fingerprint = assertMirrorIntact();
    const fixture = args.fixture ?? null;
    const userId = args['user-id'] ?? null;
    const apply = Boolean(args.apply);
    const outPath = resolve(args.out ?? DEFAULT_OUT);

    let rows;
    let target;
    if (fixture) {
      rows = readRowsFromFixture(fixture);
      target = `FIXTURE ${fixture}`;
      console.log(`FIXTURE MODE — rows read from ${fixture}; no database was contacted.`);
    } else {
      const { url, from } = resolveDatabaseUrl({
        envFile: args.env ?? null,
        allowProd: Boolean(args['allow-prod']),
      });
      target = describeTarget(url);
      console.log(`credentials from: ${from}`);
      sql = await openReadOnly(REPO, url);
      rows = await readRowsFromDb(sql, userId);
    }

    const summary = deriveLearningSummary(rows.typeCorrections, rows.propagations);
    const extras = deriveExtras(rows.propagations);
    const scope = userId ? `owner ${userId} (importers.user_id, exactly as the router scopes)` : 'ALL importers in this database';

    console.log(`\nWEDGE-BASELINE metrics — ${scope} · target: ${target}`);
    console.log(`definitions pinned: arithmetic ${fingerprint.metrics}`);
    console.log(`                    selection  ${fingerprint.selection}`);
    console.log(`  M1 corrections made:      ${summary.correctionsMade} (${summary.typeCorrections} type re-labels + ${summary.mergeCascades} cascades)`);
    console.log(`  M2 re-labels per cascade: ${num(summary.relabelsPerCorrection)} (${summary.emailsRelabeled} emails / ${summary.mergeCascades} cascades)`);
    console.log(`  M3 % that stick:          ${pct(summary.stickRate)}`);

    const refusals = eligibilityRefusals(summary, rows);
    if (refusals.length > 0) {
      console.error('\nINELIGIBLE — refusing to write the baseline. These numbers cannot carry information yet:');
      for (const reason of refusals) console.error(`  - ${reason}`);
      console.error('\nLeave the baseline BLANK until every rule above passes. A blank slot means "not yet');
      console.error('eligible"; a written zero (or a 100 % over n=1) would be read forever as a real first value.');
      return EXIT.INELIGIBLE;
    }

    const document = renderDocument({
      summary,
      extras,
      scope,
      target,
      capturedAt: new Date().toISOString(),
      fingerprint,
      fixture: Boolean(fixture),
    });
    if (!apply) {
      console.log('\n--- DOCUMENT (not written; re-run with --apply) --------------------------');
      console.log(document);
      console.log('--------------------------------------------------------------------------');
      return EXIT.OK;
    }
    const fixtureRefusal = fixture ? fixtureWriteRefusal(outPath) : null;
    if (fixtureRefusal !== null) {
      console.error(`\nREFUSED: ${fixtureRefusal}`);
      return EXIT.REFUSED;
    }
    if (existsSync(outPath) && !args.force) {
      console.error(`\nREFUSED: ${outPath} already exists. Re-run with --force to overwrite it.`);
      return EXIT.ASSERTION_FAILED;
    }
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, document, 'utf8');
    console.log(`\nWROTE ${outPath} (${document.length} bytes)`);
    return EXIT.OK;
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`REFUSED: ${error.message}`);
      return EXIT.REFUSED;
    }
    if (error instanceof MirrorDriftError) {
      console.error(`REFUSED: ${error.message}`);
      return EXIT.ASSERTION_FAILED;
    }
    console.error(`ERROR: ${String(error.message || error)}`);
    return EXIT.ERROR;
  } finally {
    await closeQuietly(sql);
  }
}

// Run only when invoked as the entry point, so the pure functions above are importable by
// scripts/__tests__/. samePath (not ===) because argv[1]'s spelling need not match this URL's
// on a case-insensitive filesystem.
if (process.argv[1] !== undefined && samePath(process.argv[1], fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
