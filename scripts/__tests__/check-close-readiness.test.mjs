// scripts/__tests__/check-close-readiness.test.mjs — the ledger gate's own rules.
//
// The property that matters: a milestone must not be closeable by TYPING. A row that only
// schedules a seam fails; a row that says "EXECUTED" and points at nothing fails; accepted debt
// without a date, without an owner, or absent from PEDRO-CHECKLIST fails.

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyChoice,
  classifyLedgerRow,
  hasEvidenceReference,
  isPlaceholder,
  parseLedgerRows,
  resolvePsExpression,
  seamIdsOf,
} from '../check-close-readiness.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

/** Build the cell array of one ledger row. */
const row = (seam, choice, owner, trigger, notes = '') => [String(1), seam, choice, owner, trigger, notes];
const verdict = (cells, checklistSrc = 'PEDRO-CHECKLIST mentions LCAN-05 and CPF-06') =>
  classifyLedgerRow({
    seam: cells[1],
    kind: classifyChoice(cells[2]),
    choice: cells[2],
    owner: cells[3],
    trigger: cells[4],
    cells,
    checklistSrc,
  });

// ---------------------------------------------------------------------------
// classifyChoice
// ---------------------------------------------------------------------------

test('classifyChoice separates SCHEDULED from EXECUTED', () => {
  assert.equal(classifyChoice('☑ EXECUTE-IN-vLAUNCH ⚠️ASSUMED'), 'SCHEDULED');
  assert.equal(classifyChoice('☑ EXECUTE-NOW'), 'SCHEDULED');
  assert.equal(classifyChoice('EXECUTED 2026-08-07'), 'EXECUTED');
  assert.equal(classifyChoice('☑ ACCEPT-AS-DEBT'), 'ACCEPT');
  assert.equal(classifyChoice('BLOCK-CLOSE'), 'BLOCK_CLOSE');
  assert.equal(classifyChoice('☐ EXECUTE-NOW'), 'NONE');
  assert.equal(classifyChoice('—'), 'NONE');
  assert.equal(classifyChoice('maybe later'), 'UNRECOGNIZED');
});

test('BLOCK-CLOSE wins over any other word in the cell', () => {
  assert.equal(classifyChoice('EXECUTED but BLOCK-CLOSE until Pedro signs'), 'BLOCK_CLOSE');
});

// ---------------------------------------------------------------------------
// The close-terminal rules
// ---------------------------------------------------------------------------

test('a SCHEDULED row FAILS — "we will do it" is not "we did it"', () => {
  const v = verdict(row('LCAN-05 DB-row round-trip', '☑ EXECUTE-IN-vLAUNCH ⚠️ASSUMED', 'Pedro', 'Phase 80 / BURN-05'));
  assert.equal(v.status, 'FAIL');
  assert.match(v.detail, /only SCHEDULES the seam/);
});

test('REGRESSION: an EXECUTED row carrying NO evidence reference FAILS', () => {
  const v = verdict(row('LCAN-05 DB-row round-trip', '☑ EXECUTED', 'Pedro', 'done'));
  assert.equal(v.status, 'FAIL', 'a close satisfiable by typing the word EXECUTED is the rot this gate exists to stop');
  assert.match(v.detail, /NO evidence reference/);
});

test('an EXECUTED row carrying a commit sha PASSES, and says the reference is unverified', () => {
  const v = verdict(row('Real-browser screenshot pass', '☑ EXECUTED', 'Pedro', '2026-08-07', 'cascade scenario merged `8263578c`'));
  assert.equal(v.status, 'PASS');
  assert.match(v.detail, /unverified here/);
});

test('an EXECUTED row pointing at an artifact path PASSES', () => {
  const v = verdict(row('CPF-06 cascade UI', '☑ EXECUTED', 'Pedro', '2026-08-07', 'evidence in .planning/milestones/WEDGE-BASELINE.md'));
  assert.equal(v.status, 'PASS');
});

test('hasEvidenceReference accepts shas/paths/URLs and rejects prose', () => {
  assert.equal(hasEvidenceReference('merged `8263578c`'), true);
  assert.equal(hasEvidenceReference('see scripts/collect-wedge-evidence.mjs'), true);
  assert.equal(hasEvidenceReference('https://example.com/run/42'), true);
  assert.equal(hasEvidenceReference('EXECUTED Pedro done at last'), false);
  assert.equal(hasEvidenceReference('a facade of evidence'), false, 'hex-looking words must not pass for a sha');
  assert.equal(hasEvidenceReference('trigger Phase 80 / BURN-05'), false);
});

test('an owner-less or trigger-less row FAILS whatever its disposition', () => {
  assert.equal(verdict(row('LCAN-05', '☑ EXECUTED 8263578c', '—', '2026-08-07')).status, 'FAIL');
  assert.equal(verdict(row('LCAN-05', '☑ ACCEPT-AS-DEBT', 'Pedro', 'tbd')).status, 'FAIL');
  assert.equal(isPlaceholder(' TBD '), true);
  assert.equal(isPlaceholder('Pedro'), false);
});

test('BLOCK-CLOSE always FAILS', () => {
  assert.equal(verdict(row('LCAN-05', 'BLOCK-CLOSE', 'Pedro', '2026-08-07')).status, 'FAIL');
});

test('ACCEPT-AS-DEBT needs a date AND a PEDRO-CHECKLIST mention', () => {
  assert.match(verdict(row('LCAN-05 round-trip', '☑ ACCEPT-AS-DEBT', 'Pedro', 'next milestone')).detail, /without a YYYY-MM-DD date/);
  assert.match(
    verdict(row('MORN-07 overnight run', '☑ ACCEPT-AS-DEBT', 'Pedro', '2026-09-01')).detail,
    /no mention of MORN-07 in PEDRO-CHECKLIST/,
  );
  assert.equal(verdict(row('LCAN-05 round-trip', '☑ ACCEPT-AS-DEBT', 'Pedro', '2026-09-01')).status, 'PASS');
});

test('an unusable Choice cell FAILS', () => {
  assert.equal(verdict(row('LCAN-05', '☐ EXECUTE-NOW', 'Pedro', '2026-08-07')).status, 'FAIL');
  assert.equal(verdict(row('LCAN-05', 'we talked about it', 'Pedro', '2026-08-07')).status, 'FAIL');
});

test('seamIdsOf pulls requirement ids out of a seam label, and falls back to the label', () => {
  assert.deepEqual(seamIdsOf('LCAN-05 DB-row round-trip'), ['LCAN-05']);
  assert.deepEqual(seamIdsOf('CPF-live merge → re-label fan-out'), ['CPF-live']);
  assert.deepEqual(seamIdsOf('a seam with no id'), ['a seam with no id']);
});

// ---------------------------------------------------------------------------
// Table parsing
// ---------------------------------------------------------------------------

const TABLE = [
  '| # | Seam | Choice (EXECUTE-NOW / ACCEPT-AS-DEBT / BLOCK-CLOSE) | Owner | Trigger/date | Notes |',
  '|---|------|------|-------|--------------|-------|',
  '| 1 | LCAN-05 round-trip | ☑ EXECUTE-IN-vLAUNCH | Pedro | Phase 80 | runsheet |',
  '| 2 | CPF-06 cascade UI | ☑ EXECUTED | Pedro | 2026-08-07 | merged `8263578c` |',
  '',
  'trailing prose',
].join('\n');

test('parseLedgerRows reads the table and stops at the first non-row line', () => {
  const rows = parseLedgerRows(TABLE);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][1], 'LCAN-05 round-trip');
  assert.equal(rows[1][2], '☑ EXECUTED');
});

test('parseLedgerRows returns null when the table is absent — no silent empty pass', () => {
  assert.equal(parseLedgerRows('# an audit with no ledger table\n\nprose only\n'), null);
});

test('parseLedgerRows survives a CRLF checkout', () => {
  assert.equal(parseLedgerRows(TABLE.replace(/\n/g, '\r\n')).length, 2);
});

test('the REAL vNEXT audit ledger still parses into 7 usable rows', () => {
  const audit = join(REPO, '.planning/milestones/vNEXT-AUDIT-2026-08-06.md');
  assert.ok(existsSync(audit), `${audit} must exist — this gate is written against it`);
  const rows = parseLedgerRows(readFileSync(audit, 'utf8'));
  assert.equal(rows.length, 7, 'the audit defines exactly 7 seams');
  for (const cells of rows) {
    assert.notEqual(classifyChoice(cells[2]), 'UNRECOGNIZED', `row "${cells[1]}" has an unreadable Choice cell`);
  }
});

// ---------------------------------------------------------------------------
// sauce-backup member resolution (group C)
// ---------------------------------------------------------------------------

test('resolvePsExpression handles the forms sauce-backup.ps1 uses, and null for the rest', () => {
  const vars = { RepoRoot: 'C:\\repo', PSScriptRoot: 'C:\\repo\\scripts' };
  assert.equal(resolvePsExpression('"literal"', vars), 'literal');
  assert.equal(resolvePsExpression('$RepoRoot', vars), 'C:\\repo');
  assert.equal(resolvePsExpression('(Join-Path $RepoRoot ".planning")', vars), join('C:\\repo', '.planning'));
  assert.equal(resolvePsExpression('$Undefined', vars), null);
  assert.equal(resolvePsExpression('Get-ChildItem | Out-Null', vars), null);
});
