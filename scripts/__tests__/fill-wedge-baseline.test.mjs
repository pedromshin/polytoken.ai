// scripts/__tests__/fill-wedge-baseline.test.mjs — the eligibility guard, the fixture
// write-path refusal, and the two mirror pins.
//
// The three properties this file exists to keep true:
//   1. The guard REFUSES every state in which a headline number would be meaningless — including
//      the one that shipped through the first revision (one cascade, empty fan-out, which
//      published "M2 = 0.0 emails re-pointed per confirmed merge" and "M3 = 100.0 % of 1").
//   2. The guard is not vacuous: a genuinely healthy state PASSES. (A guard that refuses
//      everything protects nothing and would be deleted at the first inconvenience.)
//   3. A fixture run cannot write the real baseline — ON THIS PLATFORM, case variants included.
//   4. M3 is WITHHELD in the ordinary first-capture shape — a loop that ran forward and was never
//      re-corrected — where its 100 % is forced by the arithmetic rather than measured. The test
//      that matters is the REALISTIC one (distinct targets, spread timestamps, every R-rule
//      clear), not the degenerate all-tied one R6 already caught.

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

import { CASE_INSENSITIVE_FS, ConfigError } from '../lib/close-kit-db.mjs';
import {
  ELIGIBILITY,
  MIRRORED_FINGERPRINT,
  MirrorDriftError,
  SELECTION_FINGERPRINT,
  assertMirrorIntact,
  deriveLearningSummary,
  eligibilityRefusals,
  fixtureWriteRefusal,
  readDefinitionFingerprint,
  renderDocument,
  stickRateIsForced,
  supersessionOpportunity,
} from '../fill-wedge-baseline.mjs';
import { affectedEmailsVerdict } from '../collect-wedge-evidence.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const ROUTER = join(REPO, 'packages/api-client/src/router/learning/index.ts');
const at = (iso) => new Date(iso);

const typeRow = (componentId, iso) => ({ componentId, createdAt: at(iso) });
const cascade = (survivor, absorbed, emails, iso) => ({
  survivorEntityInstanceId: survivor,
  absorbedEntityInstanceId: absorbed,
  affectedEmailIds: emails,
  promotedEdgeIds: [],
  createdAt: at(iso),
});

/**
 * A state that legitimately clears every FILE rule R1–R6 — the "guard is not vacuous" control.
 * Note what it is NOT: every target here is distinct, so M3 is forced to 100 % in it. That is the
 * ordinary first-capture shape, and it is exactly the state the M3 gate must withhold in.
 */
const healthyRows = () => ({
  typeCorrections: [typeRow('comp-1', '2026-08-01T10:00:00Z'), typeRow('comp-2', '2026-08-02T10:00:00Z')],
  propagations: [
    cascade('ent-a', 'ent-b', ['e1', 'e2', 'e3'], '2026-08-03T10:00:00Z'),
    cascade('ent-c', 'ent-d', ['e4'], '2026-08-04T10:00:00Z'),
  ],
});

/** healthyRows PLUS a genuine re-correction, so supersession actually has something to fire on. */
const provenRows = () => {
  const rows = healthyRows();
  return {
    typeCorrections: [...rows.typeCorrections, typeRow('comp-1', '2026-08-05T10:00:00Z')],
    propagations: [...rows.propagations],
  };
};

const refusalsFor = (rows) => eligibilityRefusals(deriveLearningSummary(rows.typeCorrections, rows.propagations), rows);
const ruleIds = (rows) => refusalsFor(rows).map((r) => r.slice(0, 2));

// ---------------------------------------------------------------------------
// The guard is not vacuous
// ---------------------------------------------------------------------------

test('a healthy loop state is ELIGIBLE — the guard permits as well as refuses', () => {
  assert.deepEqual(refusalsFor(healthyRows()), []);
});

// ---------------------------------------------------------------------------
// R1–R6
// ---------------------------------------------------------------------------

test('R1 — an entirely empty pair of ledgers is refused', () => {
  const ids = ruleIds({ typeCorrections: [], propagations: [] });
  assert.ok(ids.includes('R1'), `expected R1 among ${ids}`);
});

test('R2 — type corrections but NO cascade is refused (M2 undefined; WEDG-01/02 not done)', () => {
  const rows = {
    typeCorrections: [typeRow('c1', '2026-08-01T00:00:00Z'), typeRow('c2', '2026-08-02T00:00:00Z'), typeRow('c3', '2026-08-03T00:00:00Z')],
    propagations: [],
  };
  assert.ok(ruleIds(rows).includes('R2'));
});

test('R3 — THE REGRESSION: one cascade with an EMPTY fan-out is refused', () => {
  const rows = {
    typeCorrections: [],
    propagations: [cascade('ent-a', 'ent-b', [], '2026-08-01T00:00:00Z')],
  };
  const summary = deriveLearningSummary(rows.typeCorrections, rows.propagations);
  // The exact state that used to publish the milestone headline:
  assert.equal(summary.relabelsPerCorrection, 0, 'M2 would read 0.0 — the "one click compounds" number');
  assert.equal(summary.stickRate, 1, 'M3 would read 100.0 % over n=1');
  const refusals = eligibilityRefusals(summary, rows);
  assert.ok(refusals.length > 0, 'this state must NEVER be eligible');
  assert.ok(refusals.some((r) => r.startsWith('R3')), `expected R3 among:\n${refusals.join('\n')}`);
});

test('R3 also fires when many cascades all have empty fan-outs', () => {
  const rows = {
    typeCorrections: [typeRow('c1', '2026-08-01T00:00:00Z')],
    propagations: [
      cascade('ent-a', 'ent-b', [], '2026-08-02T00:00:00Z'),
      cascade('ent-c', 'ent-d', [], '2026-08-03T00:00:00Z'),
    ],
  };
  assert.ok(ruleIds(rows).includes('R3'));
});

test('R3 agrees with collect-wedge-evidence E3 — the two scripts cannot drift apart', () => {
  const emptyRow = { affected_email_ids: [] };
  const fullRow = { affected_email_ids: ['e1'] };
  assert.equal(affectedEmailsVerdict(emptyRow).ok, false, 'E3 fails an empty fan-out');
  assert.equal(affectedEmailsVerdict(fullRow).ok, true);

  const rowsEmpty = { typeCorrections: [], propagations: [cascade('a', 'b', [], '2026-08-01T00:00:00Z')] };
  assert.equal(
    refusalsFor(rowsEmpty).some((r) => r.startsWith('R3')),
    !affectedEmailsVerdict(emptyRow).ok,
    'the evidence collector hard-fails this state, so the baseline writer must refuse it',
  );
});

test('R4 — cascades but NO type re-label is refused (M1 publishes both legs)', () => {
  const rows = {
    typeCorrections: [],
    propagations: [
      cascade('ent-a', 'ent-b', ['e1', 'e2'], '2026-08-01T00:00:00Z'),
      cascade('ent-c', 'ent-d', ['e3'], '2026-08-02T00:00:00Z'),
      cascade('ent-e', 'ent-f', ['e4'], '2026-08-03T00:00:00Z'),
    ],
  };
  assert.ok(ruleIds(rows).includes('R4'));
});

test('R5 — fewer than the documented minimum corrections is refused (M3 resolution is 1/n)', () => {
  assert.equal(ELIGIBILITY.MIN_CORRECTIONS_FOR_STICK_RATE, 3);
  const rows = {
    typeCorrections: [typeRow('c1', '2026-08-01T00:00:00Z')],
    propagations: [cascade('ent-a', 'ent-b', ['e1'], '2026-08-02T00:00:00Z')],
  };
  const summary = deriveLearningSummary(rows.typeCorrections, rows.propagations);
  assert.equal(summary.correctionsMade, 2);
  assert.equal(summary.stickRate, 1, 'n=2 with nothing superseded can only read 100 %');
  assert.ok(ruleIds(rows).includes('R5'));
});

test('R6 — every row sharing one created_at is refused (supersession cannot discriminate)', () => {
  const stamp = '2026-08-01T00:00:00Z';
  const rows = {
    typeCorrections: [typeRow('c1', stamp), typeRow('c2', stamp)],
    propagations: [cascade('ent-a', 'ent-b', ['e1', 'e2'], stamp), cascade('ent-c', 'ent-d', ['e3'], stamp)],
  };
  const summary = deriveLearningSummary(rows.typeCorrections, rows.propagations);
  assert.equal(summary.stickRate, 1, 'a fully tied table sticks 100 % by construction');
  assert.ok(ruleIds(rows).includes('R6'), 'a seeded/backfilled table must not become the baseline');
});

test('R6 does not fire on a real spread of timestamps', () => {
  assert.equal(ruleIds(healthyRows()).includes('R6'), false);
});

test('eligibilityRefusals works without row detail (R6 simply cannot be evaluated)', () => {
  const rows = healthyRows();
  const summary = deriveLearningSummary(rows.typeCorrections, rows.propagations);
  assert.deepEqual(eligibilityRefusals(summary), []);
});

// ---------------------------------------------------------------------------
// The M3 gate — W12 review HIGH #1. R5/R6 bound M3's RESOLUTION and its all-tied corner;
// NOTHING bounded its DEGENERACY, so "100.0 % of N corrections stick" shipped as the milestone
// headline out of a state that could not produce any other number.
//
// The test that closes it must fire in the REALISTIC capture state. A test that only proves the
// gate in the all-tied state proves nothing new — R6 already refuses that one.
// ---------------------------------------------------------------------------

/**
 * The reviewer's executed reproduction, verbatim as data: the "window shorter than the metric's
 * period" vector — a 12-second drill burst, 3 type corrections on DISTINCT components plus one
 * cascade with real mail, every timestamp distinct. Under W12 this cleared R1–R6 and wrote a
 * 3133-byte document reading "**100.0 %** of 4 corrections stick".
 */
const realisticFirstCapture = () => ({
  typeCorrections: [
    typeRow('comp-a', '2026-08-07T10:00:00Z'),
    typeRow('comp-b', '2026-08-07T10:00:04Z'),
    typeRow('comp-c', '2026-08-07T10:00:08Z'),
  ],
  propagations: [cascade('surv-1', 'abs-1', ['e1', 'e2'], '2026-08-07T10:00:12Z')],
});

const renderFor = (rows, overrides = {}) =>
  renderDocument({
    summary: deriveLearningSummary(rows.typeCorrections, rows.propagations),
    extras: { maxRelabels: 3, avgEdgesPromoted: 0 },
    scope: 'ALL importers in this database',
    target: 'staging · host=example:5432 db=postgres',
    capturedAt: '2026-08-07T00:00:00.000Z',
    fingerprint: { metrics: MIRRORED_FINGERPRINT, selection: SELECTION_FINGERPRINT },
    fixture: false,
    rows,
    ...overrides,
  });

test('THE REGRESSION: the realistic first-capture state clears R1–R6 — so a FILE-level rule could never have caught it', () => {
  const rows = realisticFirstCapture();
  assert.deepEqual(refusalsFor(rows), [], 'precondition: this state is eligible, which is why W12 wrote it');
  const summary = deriveLearningSummary(rows.typeCorrections, rows.propagations);
  assert.equal(summary.correctionsMade, 4);
  assert.equal(summary.stickRate, 1, 'and it published 100.0 % — the number this test exists to un-publish');
});

test('THE FIX: M3 is withheld in the realistic state — the document never prints the forced rate as the headline', () => {
  const document = renderFor(realisticFirstCapture());
  assert.match(document, /## M3 — % of corrections that stick\s*\n\s*\*\*not yet measurable — withheld on purpose\.\*\*/);
  assert.equal(
    /\*\*100\.0 %\*\*/.test(document),
    false,
    'the forced value must not appear as a bold headline anywhere in the document',
  );
  assert.match(document, /FORCED, not measured/);
  assert.match(document, /Do not manufacture one to fill this slot/, 'the gate must not pay anyone to pollute the ledger');
});

test('the withheld section still discloses what the SURFACE will show, so the doc and the product do not contradict', () => {
  const document = renderFor(realisticFirstCapture());
  assert.match(document, /learning\.summary`\s*\n?on the pipeline-health surface will still display `100\.0 %`/);
});

test('the M3 gate is NOT vacuous: a state with a real re-correction publishes the measured rate', () => {
  const rows = provenRows();
  const summary = deriveLearningSummary(rows.typeCorrections, rows.propagations);
  assert.ok(summary.stickRate < 1, 'precondition: comp-1 was re-corrected, so one row does not stick');
  assert.deepEqual(refusalsFor(rows), []);
  const document = renderFor(rows);
  assert.match(document, new RegExp(`\\*\\*${(summary.stickRate * 100).toFixed(1)} %\\*\\* of ${summary.correctionsMade} corrections stick`));
  // The CAPTURE RULE block always DESCRIBES the withholding rule; only the M3 SECTION may apply it.
  const m3Section = document.slice(document.indexOf('## M3 —'));
  assert.equal(m3Section.includes('not yet measurable'), false);
  assert.equal(m3Section.includes('FORCED'), false);
});

test('a cascade whose survivor is LATER absorbed also un-forces M3 (the second supersession leg)', () => {
  const rows = {
    typeCorrections: [typeRow('c1', '2026-08-01T00:00:00Z')],
    propagations: [
      cascade('ent-b', 'ent-c', ['e1'], '2026-08-02T00:00:00Z'),
      cascade('ent-a', 'ent-b', ['e2'], '2026-08-03T00:00:00Z'),
    ],
  };
  const opportunity = supersessionOpportunity(rows);
  assert.equal(opportunity.cascadeLeg, true);
  assert.equal(opportunity.typeLeg, false);
  assert.equal(stickRateIsForced(rows), false);
  assert.match(renderFor(rows), /corrections stick/);
});

test('an EARLIER absorption is not an opportunity — the ported arithmetic requires strictly later', () => {
  const rows = {
    typeCorrections: [],
    propagations: [
      cascade('ent-a', 'ent-b', ['e1'], '2026-08-01T00:00:00Z'),
      cascade('ent-b', 'ent-c', ['e2'], '2026-08-02T00:00:00Z'),
    ],
  };
  assert.equal(supersessionOpportunity(rows).cascadeLeg, false);
  assert.equal(stickRateIsForced(rows), true);
});

test('two rows on the same component at the SAME instant are not an opportunity (ties all stick)', () => {
  const stamp = '2026-08-01T00:00:00Z';
  const rows = { typeCorrections: [typeRow('c1', stamp), typeRow('c1', stamp)], propagations: [] };
  assert.equal(supersessionOpportunity(rows).typeLeg, false);
  assert.equal(stickRateIsForced(rows), true);
});

test('a survivor absorbed at the SAME INSTANT is not an opportunity either — the cascade leg tie', () => {
  // Found by mutating `>` to `>=` in supersessionOpportunity and watching the suite stay GREEN.
  // The ported arithmetic sticks on `absorbedAt <= row.createdAt`, so a tie must NOT count as an
  // opportunity; without this case the strictness of that comparison was untested on the cascade
  // leg — a guard whose only test was the case where it could not fail.
  const stamp = '2026-08-01T00:00:00Z';
  const rows = {
    typeCorrections: [typeRow('c1', '2026-07-01T00:00:00Z'), typeRow('c2', '2026-07-02T00:00:00Z')],
    propagations: [cascade('ent-b', 'ent-c', ['e1'], stamp), cascade('ent-a', 'ent-b', ['e2'], stamp)],
  };
  assert.equal(deriveLearningSummary(rows.typeCorrections, rows.propagations).stickRate, 1, 'the port ties → all stick');
  assert.equal(supersessionOpportunity(rows).cascadeLeg, false);
  assert.equal(stickRateIsForced(rows), true);
  assert.match(renderFor(rows), /not yet measurable/);
});

test('the gate is EXACTLY equivalent to "stickRate === 1" — the docstring claim, asserted not assumed', () => {
  const cases = [
    healthyRows(),
    provenRows(),
    realisticFirstCapture(),
    { typeCorrections: [typeRow('c1', '2026-08-01T00:00:00Z')], propagations: [] },
    { typeCorrections: [typeRow('c1', '2026-08-01T00:00:00Z'), typeRow('c1', '2026-08-02T00:00:00Z')], propagations: [] },
    { typeCorrections: [], propagations: [cascade('a', 'b', ['e1'], '2026-08-01T00:00:00Z')] },
    {
      typeCorrections: [],
      propagations: [cascade('b', 'c', ['e1'], '2026-08-01T00:00:00Z'), cascade('a', 'b', ['e2'], '2026-08-02T00:00:00Z')],
    },
    // Both TIE cases, on both legs — the equivalence must hold at the boundary, not just away
    // from it. Their absence let a `>` → `>=` mutation of the cascade leg pass green.
    {
      typeCorrections: [],
      propagations: [cascade('b', 'c', ['e1'], '2026-08-01T00:00:00Z'), cascade('a', 'b', ['e2'], '2026-08-01T00:00:00Z')],
    },
    { typeCorrections: [typeRow('c1', '2026-08-01T00:00:00Z'), typeRow('c1', '2026-08-01T00:00:00Z')], propagations: [] },
  ];
  for (const rows of cases) {
    const summary = deriveLearningSummary(rows.typeCorrections, rows.propagations);
    assert.equal(
      stickRateIsForced(rows),
      summary.stickRate === 1,
      `forced-detection and the ported arithmetic must agree on ${JSON.stringify(rows)}`,
    );
  }
});

test('withheld is the SAFE default: rows the renderer was not given cannot prove a measurement', () => {
  assert.equal(stickRateIsForced(null), true);
  assert.equal(supersessionOpportunity(null), null);
  const document = renderFor(provenRows(), { rows: null });
  assert.match(document, /not yet measurable/);
  assert.match(document, /the row detail needed to decide was not supplied/);
});

// ---------------------------------------------------------------------------
// M2's leverage claim — same rule block, W12 review HIGH #1 (secondary)
// ---------------------------------------------------------------------------

test('M2 does not call itself "the one click compounds number" when it is ≤ 1.0', () => {
  const rows = { typeCorrections: [typeRow('c1', '2026-08-01T00:00:00Z'), typeRow('c2', '2026-08-02T00:00:00Z')], propagations: [cascade('a', 'b', ['e1'], '2026-08-03T00:00:00Z')] };
  const summary = deriveLearningSummary(rows.typeCorrections, rows.propagations);
  assert.equal(summary.relabelsPerCorrection, 1, 'one cascade, one email — a compounding headline over zero compounding');
  const document = renderFor(rows);
  assert.equal(document.includes('the "one click compounds" number'), false);
  assert.match(document, /\*\*No compounding yet:\*\*/);
});

test('M2 DOES make the leverage claim once there is leverage', () => {
  const document = renderFor(healthyRows());
  assert.match(document, /the "one click compounds" number/);
  assert.equal(document.includes('No compounding yet'), false);
});

// ---------------------------------------------------------------------------
// Fixture write-path refusal — finding #2
// ---------------------------------------------------------------------------

const DEFAULT_OUT = join(REPO, '.planning/milestones/WEDGE-BASELINE.md');
const PLANNING_DIR = join(REPO, '.planning');
const opts = { defaultOut: DEFAULT_OUT, planningDir: PLANNING_DIR };

test('a fixture run may not write the real baseline path', () => {
  assert.notEqual(fixtureWriteRefusal(DEFAULT_OUT, opts), null);
});

test('REGRESSION: a CASE VARIANT of the baseline path is refused on this platform', () => {
  const variant = join(REPO, '.planning/Milestones/wedge-baseline.MD');
  const refusal = fixtureWriteRefusal(variant, opts);
  assert.notEqual(
    refusal,
    null,
    `--out ${variant} must be refused: on a case-folding filesystem it IS the real baseline, ` +
      'and a case-sensitive === let exactly this spelling through',
  );
  if (CASE_INSENSITIVE_FS) assert.match(refusal, /IS that file on this filesystem/);
});

test('a fixture run may not write anywhere inside .planning/', () => {
  assert.notEqual(fixtureWriteRefusal(join(PLANNING_DIR, 'scratch/anything.md'), opts), null);
  assert.notEqual(fixtureWriteRefusal(join(PLANNING_DIR, 'milestones/NOT-THE-BASELINE.md'), opts), null);
});

test('a scratch path outside .planning/ is allowed — the drill still works', () => {
  assert.equal(fixtureWriteRefusal(join(tmpdir(), 'wedge-drill.md'), opts), null);
  assert.equal(fixtureWriteRefusal(join(REPO, '.planning-archive/x.md'), opts), null);
});

// ---------------------------------------------------------------------------
// The two mirror pins — including the row-SELECTION pin that did not exist before
// ---------------------------------------------------------------------------

test('both pins match the shipped router today', () => {
  const actual = assertMirrorIntact(ROUTER);
  assert.equal(actual.metrics, MIRRORED_FINGERPRINT);
  assert.equal(actual.selection, SELECTION_FINGERPRINT);
});

/** Copy the router into a temp file with one substitution applied. */
function mutatedRouter(find, replace) {
  const dir = mkdtempSync(join(tmpdir(), 'wedge-mirror-'));
  const src = readFileSync(ROUTER, 'utf8');
  assert.ok(src.includes(find), `fixture precondition: router must contain ${JSON.stringify(find)}`);
  const path = join(dir, 'index.ts');
  writeFileSync(path, src.replace(find, replace), 'utf8');
  return path;
}

test('a change to the metric ARITHMETIC trips the pin', () => {
  const path = mutatedRouter('const correctionsMade = typeCount + cascadeCount;', 'const correctionsMade = typeCount + cascadeCount + 1;');
  assert.throws(
    () => assertMirrorIntact(path),
    (error) => error instanceof MirrorDriftError && /metric arithmetic/.test(error.message),
  );
});

test('a change to the ROW SELECTION trips the pin (the population, not just the formula)', () => {
  const path = mutatedRouter('.where(eq(Importers.userId, ctx.user.id)),', '.where(eq(Importers.id, ctx.user.id)),');
  assert.throws(
    () => assertMirrorIntact(path),
    (error) => error instanceof MirrorDriftError && /row selection/.test(error.message),
    'a changed tenancy filter changes WHICH rows the surface counts — the arithmetic hash cannot see it',
  );
});

test('a CRLF checkout is not drift', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wedge-crlf-'));
  const path = join(dir, 'index.ts');
  writeFileSync(path, readFileSync(ROUTER, 'utf8').replace(/\n/g, '\r\n'), 'utf8');
  const actual = readDefinitionFingerprint(path);
  assert.equal(actual.metrics, MIRRORED_FINGERPRINT);
  assert.equal(actual.selection, SELECTION_FINGERPRINT);
});

test('a router whose anchors are gone REFUSES rather than hashing nothing', () => {
  const path = mutatedRouter('export function deriveLearningSummary(', 'export function deriveLearningTotals(');
  assert.throws(() => readDefinitionFingerprint(path), ConfigError);
});

// ---------------------------------------------------------------------------
// The port matches the router's own test vectors (packages/api-client/.../learning-summary.test.ts)
// ---------------------------------------------------------------------------

test('port vector: a later correction on the same component supersedes the earlier one', () => {
  const summary = deriveLearningSummary(
    [typeRow('comp-1', '2026-08-01T00:00:00Z'), typeRow('comp-1', '2026-08-02T00:00:00Z'), typeRow('comp-2', '2026-08-01T00:00:00Z')],
    [],
  );
  assert.equal(summary.correctionsMade, 3);
  assert.ok(Math.abs(summary.stickRate - 2 / 3) < 1e-9);
});

test('port vector: a cascade whose survivor is later absorbed is superseded', () => {
  const summary = deriveLearningSummary(
    [],
    [cascade('ent-b', 'ent-c', ['e1', 'e2'], '2026-08-01T00:00:00Z'), cascade('ent-a', 'ent-b', ['e3', 'e4', 'e5'], '2026-08-02T00:00:00Z')],
  );
  assert.equal(summary.mergeCascades, 2);
  assert.equal(summary.emailsRelabeled, 5);
  assert.equal(summary.relabelsPerCorrection, 2.5);
  assert.equal(summary.stickRate, 0.5);
});

test('port vector: an EARLIER absorption does not supersede a later cascade', () => {
  const summary = deriveLearningSummary(
    [],
    [cascade('ent-a', 'ent-b', [], '2026-08-01T00:00:00Z'), cascade('ent-b', 'ent-c', [], '2026-08-02T00:00:00Z')],
  );
  assert.equal(summary.stickRate, 1);
});

test('port vector: a null affected_email_ids counts 0 re-labels (jsonb boundary)', () => {
  const summary = deriveLearningSummary([], [cascade('ent-a', 'ent-b', null, '2026-08-01T00:00:00Z')]);
  assert.equal(summary.emailsRelabeled, 0);
  assert.equal(summary.relabelsPerCorrection, 0);
});

test('port vector: deriveLearningSummary never mutates its inputs', () => {
  const rows = healthyRows();
  const snapshot = JSON.stringify(rows);
  deriveLearningSummary(rows.typeCorrections, rows.propagations);
  assert.equal(JSON.stringify(rows), snapshot);
});

// ---------------------------------------------------------------------------
// The document says what the guard enforces
// ---------------------------------------------------------------------------

test('the rendered document states the eligibility rules and both fingerprints', () => {
  const document = renderFor(provenRows());
  for (const rule of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']) {
    assert.ok(document.includes(rule), `the CAPTURE RULE must name ${rule}`);
  }
  assert.ok(document.includes(MIRRORED_FINGERPRINT));
  assert.ok(document.includes(SELECTION_FINGERPRINT));
  assert.equal(document.includes('SYNTHETIC'), false);
});

test('the CAPTURE RULE no longer implies R5 makes M3 expressive, and names the metric-level gate', () => {
  const document = renderFor(provenRows());
  assert.equal(
    document.includes('below that M3 can only read 0/50/100'),
    false,
    'that phrasing implied M3 can read something else at n≥3; in the ordinary shape it cannot',
  );
  assert.match(document, /RESOLUTION floor only/);
  assert.match(document, /necessary, not sufficient/);
  assert.match(document, /withheld as "not yet measurable"/);
});

test('the document states plainly that an all-importer capture is not comparable to the surface', () => {
  const document = renderFor(provenRows());
  assert.match(document, /surface is ALWAYS scoped to a single owner/);
  assert.match(document, /not\*\* comparable to what any user sees/);
  assert.match(document, /they do not make these two populations the same one/);
});

test('a fixture-mode document always carries the SYNTHETIC banner', () => {
  const document = renderFor(healthyRows(), { target: 'FIXTURE rows.json', fixture: true });
  assert.match(document, /⛔ \*\*SYNTHETIC — FIXTURE RUN\.\*\*/);
});
