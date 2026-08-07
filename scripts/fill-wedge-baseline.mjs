// scripts/fill-wedge-baseline.mjs — WEDG-04: compute the three WEDGE-BASELINE metrics and,
// only under --apply, write the baseline document.
//
// ## The guard that matters most
// It REFUSES to write when the learning loop has not actually run — zero corrections, or zero
// merge cascades. An early read bakes a meaningless zero into the baseline and poisons every
// later delta (the capture rule the WEDGE-BASELINE skeleton opens with). The refusal exits 3
// and names which precondition is missing.
//
// ## The definitions are the shipped router's, not this script's
// M1/M2/M3 mirror `deriveLearningSummary` in packages/api-client/src/router/learning/index.ts.
// That is ENFORCED, not asserted: the script hashes the router's own function source and
// refuses to run if the hash moved (MIRRORED_FINGERPRINT below). If you change the router,
// this script stops until the port here is re-checked and the pin updated.
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
//                     exercising the guard without credentials. A fixture run may NOT write
//                     to the default baseline path, and everything it writes carries a
//                     SYNTHETIC banner.
//
// EXIT CODES: 0 eligible (and written under --apply) · 1 refused for a correctness reason
// (definition drift, existing file without --force) · 2 config/usage refusal · 3 INELIGIBLE
// (the zero-corrections / no-cascade guard) · 4 runtime error.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ConfigError,
  EXIT,
  closeQuietly,
  describeTarget,
  openReadOnly,
  readArgs,
  readOnlyTx,
  resolveDatabaseUrl,
} from './lib/close-kit-db.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const ROUTER_PATH = join(REPO, 'packages/api-client/src/router/learning/index.ts');
const DEFAULT_OUT = join(REPO, '.planning/milestones/WEDGE-BASELINE.md');

// sha256 of the router's own metric functions (see readDefinitionFingerprint). Update ONLY
// together with a re-check of the port below — that is the whole point of the pin.
const MIRRORED_FINGERPRINT = 'e50d827ddff29e97ebd72b4354e7ca59585cdcfdd78f37dd726d96d23a085e3f';

const args = readArgs(process.argv.slice(2));

// ---------------------------------------------------------------------------
// Mirror guard
// ---------------------------------------------------------------------------

/** Raised when the router's definitions moved out from under this script's port. */
class MirrorDriftError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MirrorDriftError';
  }
}

/**
 * Hash the router's metric source: `relabelCount` through the end of `deriveLearningSummary`.
 * Line endings are normalised (a CRLF checkout must not read as drift); nothing else is, so a
 * real edit to the definitions always moves the hash.
 */
function readDefinitionFingerprint() {
  const src = readFileSync(ROUTER_PATH, 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('function relabelCount(');
  const anchor = src.indexOf('export function deriveLearningSummary(');
  const end = anchor === -1 ? -1 : src.indexOf('\n}\n', anchor);
  if (start === -1 || anchor === -1 || end === -1 || start > anchor) {
    throw new ConfigError(
      `cannot locate the metric definitions in ${ROUTER_PATH} — the anchors moved.\n` +
        '  Re-read the router, re-check the port in this script, then update MIRRORED_FINGERPRINT.',
    );
  }
  const slice = src.slice(start, end + 3);
  return createHash('sha256').update(slice).digest('hex');
}

function assertMirrorIntact() {
  const actual = readDefinitionFingerprint();
  if (actual === MIRRORED_FINGERPRINT) return actual;
  throw new MirrorDriftError(
    'the learning-router metric definitions CHANGED — this script no longer provably mirrors them.\n' +
      `  expected ${MIRRORED_FINGERPRINT}\n` +
      `  actual   ${actual}\n` +
      `  Re-read ${ROUTER_PATH}, re-check deriveLearningSummary below, then update MIRRORED_FINGERPRINT.`,
  );
}

// ---------------------------------------------------------------------------
// The port — line-for-line the router's deriveLearningSummary (index.ts:103-165)
// ---------------------------------------------------------------------------

function relabelCount(ids) {
  return Array.isArray(ids) ? ids.length : 0;
}

function deriveLearningSummary(typeCorrections, propagations) {
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
function deriveExtras(propagations) {
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
function readRowsFromFixture(path) {
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
// Eligibility — the guard
// ---------------------------------------------------------------------------

function eligibilityRefusals(summary) {
  const refusals = [];
  if (summary.correctionsMade === 0) {
    refusals.push(
      'ZERO corrections exist (entity_type_corrections + correction_propagations are both empty). ' +
        'Every metric would be a meaningless zero; M3 would be null.',
    );
  }
  if (summary.mergeCascades === 0) {
    refusals.push(
      'the cascade has NEVER run (correction_propagations is empty): WEDG-01 (CASCADE_CORRECTION_ENABLED ' +
        'live + cascade_relabel draining) and WEDG-02 (one genuine merge on real mail) are not done, so ' +
        'M2 is undefined (null, not 0).',
    );
  }
  return refusals;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

const pct = (v) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)} %`);
const num = (v, digits = 1) => (v === null ? 'n/a' : v.toFixed(digits));

function renderDocument({ summary, extras, scope, target, capturedAt, fingerprint, fixture }) {
  const banner = fixture
    ? '> ⛔ **SYNTHETIC — FIXTURE RUN.** These numbers came from a local JSON fixture, NOT from a\n> database. This file is a drill artifact and must never be treated as the baseline.\n\n'
    : '';
  return `# WEDGE-BASELINE — email-intelligence learning-loop, first real values

${banner}> Captured ${capturedAt} by \`scripts/fill-wedge-baseline.mjs\` (WEDG-04).
> Source of truth for the definitions: \`packages/api-client/src/router/learning/index.ts\`
> (\`deriveLearningSummary\`, source sha256 \`${fingerprint}\` — the script refuses to run if it moves).
> Scope: ${scope} · target: \`${target}\`.
>
> CAPTURE RULE (load-bearing): these values are readable only because WEDG-01 (cascade live and
> draining) and WEDG-02 (one genuine merge cascaded on real mail) are DONE. The script refuses to
> write when either is missing — a blank baseline is correct, a zeroed one is poison.

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

let sql = null;
try {
  const fingerprint = assertMirrorIntact();
  const fixture = typeof args.fixture === 'string' ? args.fixture : null;
  const userId = typeof args['user-id'] === 'string' ? args['user-id'] : null;
  const apply = Boolean(args.apply);
  const outPath = resolve(typeof args.out === 'string' ? args.out : DEFAULT_OUT);

  let rows;
  let target;
  if (fixture) {
    rows = readRowsFromFixture(fixture);
    target = `FIXTURE ${fixture}`;
    console.log(`FIXTURE MODE — rows read from ${fixture}; no database was contacted.`);
  } else {
    const { url, from } = resolveDatabaseUrl({
      envFile: typeof args.env === 'string' ? args.env : null,
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
  console.log(`definition fingerprint: ${fingerprint} (matches the shipped router)`);
  console.log(`  M1 corrections made:      ${summary.correctionsMade} (${summary.typeCorrections} type re-labels + ${summary.mergeCascades} cascades)`);
  console.log(`  M2 re-labels per cascade: ${num(summary.relabelsPerCorrection)} (${summary.emailsRelabeled} emails / ${summary.mergeCascades} cascades)`);
  console.log(`  M3 % that stick:          ${pct(summary.stickRate)}`);

  const refusals = eligibilityRefusals(summary);
  if (refusals.length > 0) {
    console.error('\nINELIGIBLE — refusing to write the baseline:');
    for (const reason of refusals) console.error(`  - ${reason}`);
    console.error('\nLeave the baseline BLANK until WEDG-01 and WEDG-02 are done. A blank slot means');
    console.error('"not yet eligible"; a written zero would be read forever as a real first value.');
    process.exitCode = EXIT.INELIGIBLE;
  } else {
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
      process.exitCode = EXIT.OK;
    } else if (fixture && outPath === resolve(DEFAULT_OUT)) {
      console.error(`\nREFUSED: a fixture run may not write the real baseline (${DEFAULT_OUT}).`);
      console.error('Pass --out <scratch path> if you are drilling the write path.');
      process.exitCode = EXIT.REFUSED;
    } else if (existsSync(outPath) && !args.force) {
      console.error(`\nREFUSED: ${outPath} already exists. Re-run with --force to overwrite it.`);
      process.exitCode = EXIT.ASSERTION_FAILED;
    } else {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, document, 'utf8');
      console.log(`\nWROTE ${outPath} (${document.length} bytes)`);
      process.exitCode = EXIT.OK;
    }
  }
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`REFUSED: ${error.message}`);
    process.exitCode = EXIT.REFUSED;
  } else if (error instanceof MirrorDriftError) {
    console.error(`REFUSED: ${error.message}`);
    process.exitCode = EXIT.ASSERTION_FAILED;
  } else {
    console.error(`ERROR: ${String(error.message || error)}`);
    process.exitCode = EXIT.ERROR;
  }
} finally {
  await closeQuietly(sql);
}
