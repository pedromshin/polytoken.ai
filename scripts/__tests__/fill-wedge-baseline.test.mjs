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

/** A state that legitimately clears every rule — the "guard is not vacuous" control. */
const healthyRows = () => ({
  typeCorrections: [typeRow('comp-1', '2026-08-01T10:00:00Z'), typeRow('comp-2', '2026-08-02T10:00:00Z')],
  propagations: [
    cascade('ent-a', 'ent-b', ['e1', 'e2', 'e3'], '2026-08-03T10:00:00Z'),
    cascade('ent-c', 'ent-d', ['e4'], '2026-08-04T10:00:00Z'),
  ],
});

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
  const rows = healthyRows();
  const document = renderDocument({
    summary: deriveLearningSummary(rows.typeCorrections, rows.propagations),
    extras: { maxRelabels: 3, avgEdgesPromoted: 0 },
    scope: 'ALL importers in this database',
    target: 'staging · host=example:5432 db=postgres',
    capturedAt: '2026-08-07T00:00:00.000Z',
    fingerprint: { metrics: MIRRORED_FINGERPRINT, selection: SELECTION_FINGERPRINT },
    fixture: false,
  });
  for (const rule of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']) {
    assert.ok(document.includes(rule), `the CAPTURE RULE must name ${rule}`);
  }
  assert.ok(document.includes(MIRRORED_FINGERPRINT));
  assert.ok(document.includes(SELECTION_FINGERPRINT));
  assert.equal(document.includes('SYNTHETIC'), false);
});

test('a fixture-mode document always carries the SYNTHETIC banner', () => {
  const rows = healthyRows();
  const document = renderDocument({
    summary: deriveLearningSummary(rows.typeCorrections, rows.propagations),
    extras: { maxRelabels: 3, avgEdgesPromoted: 0 },
    scope: 'ALL importers in this database',
    target: 'FIXTURE rows.json',
    capturedAt: '2026-08-07T00:00:00.000Z',
    fingerprint: { metrics: MIRRORED_FINGERPRINT, selection: SELECTION_FINGERPRINT },
    fixture: true,
  });
  assert.match(document, /⛔ \*\*SYNTHETIC — FIXTURE RUN\.\*\*/);
});
