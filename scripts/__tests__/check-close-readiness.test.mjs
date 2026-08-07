// scripts/__tests__/check-close-readiness.test.mjs — the ledger gate's own rules.
//
// The property that matters: a milestone must not be closeable by TYPING. A row that only
// schedules a seam fails; a row that says "EXECUTED" and points at nothing fails; accepted debt
// without a date, without an owner, or absent from PEDRO-CHECKLIST fails.

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyChoice,
  classifyLedgerRow,
  evidenceReference,
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
  assert.match(v.detail, /UNRESOLVED sha/);
});

test('an EXECUTED row pointing at an artifact that REALLY EXISTS PASSES, and says the path resolved', () => {
  const v = verdict(row('CPF-06 cascade UI', '☑ EXECUTED', 'Pedro', '2026-08-07', 'evidence in scripts/collect-wedge-evidence.mjs'));
  assert.equal(v.status, 'PASS');
  assert.match(v.detail, /evidence RESOLVED/);
});

// ---------------------------------------------------------------------------
// evidenceReference — W12 review NOTE #4. The old check was pure text: it never
// resolved anything, so three of its four accept-cases were satisfiable by fiction.
// ---------------------------------------------------------------------------

test('REGRESSION: a path reference to a file that DOES NOT EXIST is no longer evidence', () => {
  for (const fiction of ['.planning/does-not-exist-anywhere.md', 'scripts/totally-made-up.mjs']) {
    const reference = evidenceReference(`EXECUTED ${fiction}`);
    assert.equal(reference.kind, 'dangling-path', `${fiction} must not read as evidence`);
    const v = verdict(row('LCAN-05', '☑ EXECUTED', 'Pedro', '2026-08-07', fiction));
    assert.equal(v.status, 'FAIL', `${fiction} must FAIL the row`);
    assert.match(v.detail, /does not exist under the repo/);
  }
});

test('REGRESSION: a bare date or ticket number is not a sha', () => {
  assert.equal(evidenceReference('EXECUTED 20260807'), null, 'a compact date used to satisfy the evidence rule');
  assert.equal(evidenceReference('EXECUTED 1234567'), null, 'nor may a ticket number');
  assert.equal(verdict(row('LCAN-05', '☑ EXECUTED', 'Pedro', '2026-08-07', 'closed 20260807')).status, 'FAIL');
});

test('a real repo path resolves; the reference names where it resolved to', () => {
  const reference = evidenceReference('see scripts/collect-wedge-evidence.mjs');
  assert.equal(reference.kind, 'path');
  assert.equal(reference.resolved, true);
  assert.ok(existsSync(reference.at));
});

test('a `.planning/` reference resolves against the planning dir this run was pointed at', () => {
  const reference = evidenceReference('artifact at .planning/ROADMAP.md', {
    repoRoot: REPO,
    planningDir: join(REPO, '.planning'),
  });
  assert.equal(reference.kind, existsSync(join(REPO, '.planning/ROADMAP.md')) ? 'path' : 'dangling-path');
});

test('a reference that ESCAPES both roots is refused even though the file really exists', () => {
  // The first version of this test used a path with no file extension, so the token regex never
  // matched it and the assertion held whether or not the containment guard existed — a guard
  // whose only test was the case where it could not fail. This one names a file that DOES exist
  // (the repo's package.json) but lies outside both declared roots, so it can only pass while
  // the isInside() containment check is present.
  const roots = { repoRoot: join(REPO, 'scripts', '__tests__'), planningDir: join(REPO, 'scripts', '__tests__') };
  assert.ok(existsSync(join(REPO, 'package.json')), 'precondition: the escape target must really exist');
  const reference = evidenceReference('evidence at ../../package.json', roots);
  assert.equal(reference.kind, 'dangling-path', 'a path outside the declared roots must not count as resolved');
});

test('sha and url are accepted but reported as UNRESOLVED, never as confirmed', () => {
  assert.equal(evidenceReference('merged `8263578c`').kind, 'sha');
  assert.equal(evidenceReference('merged `8263578c`').resolved, false);
  assert.equal(evidenceReference('https://example.com/run/42').kind, 'url');
  const v = verdict(row('LCAN-05', '☑ EXECUTED', 'Pedro', '2026-08-07', 'merged `8263578c`'));
  assert.equal(v.status, 'PASS');
  assert.match(v.detail, /UNRESOLVED sha/);
  assert.match(v.detail, /does not run git or fetch URLs/);
});

test('prose still offers nothing', () => {
  assert.equal(evidenceReference('EXECUTED Pedro done at last'), null);
  assert.equal(evidenceReference('a facade of evidence'), null, 'hex-looking words must not pass for a sha');
  assert.equal(evidenceReference('trigger Phase 80 / BURN-05'), null);
});

test('a resolvable path OUTRANKS a stray sha in the same row — the strongest reference wins', () => {
  const reference = evidenceReference('merged 8263578c, artifact scripts/check-close-readiness.mjs');
  assert.equal(reference.kind, 'path');
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

// ---------------------------------------------------------------------------
// The CLI contract — W12 review NOTE #3. `--planing <copy>` used to audit the LIVE ledger while
// the banner told the operator they were drilling a copy.
//
// These run the real script as a process. That is deliberate: the failure being closed is an
// EXIT CODE and a fallback that only exist in the entry point, so a pure-function test cannot
// see them. The script is read-only and contacts nothing.
// ---------------------------------------------------------------------------

const SCRIPT = join(REPO, 'scripts/check-close-readiness.mjs');

/** Run the CLI, returning { code, stdout, stderr } — never throws on a non-zero exit. */
function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: REPO, encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: error.status ?? -1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

test('REGRESSION: a MISTYPED flag refuses (exit 2) instead of silently auditing the real .planning', () => {
  const result = runCli(['--planing', join(REPO, 'nowhere')]);
  assert.equal(result.code, 2, `expected exit 2, got ${result.code}\n${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /unknown flag "--planing"/);
  assert.equal(result.stdout.includes('close-readiness — planning:'), false, 'it must not have started an audit at all');
});

test('a VALUELESS --planning refuses rather than falling back to the real tree', () => {
  const result = runCli(['--planning']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /needs a value/);
  assert.equal(result.stdout.includes('close-readiness — planning:'), false);
});

test('a positional argument refuses too — the reader takes flags only', () => {
  assert.equal(runCli(['some/dir']).code, 2);
});

test('the guard is not vacuous: a VALID --planning pointing at nothing gives the ordinary exit-2 path', () => {
  const result = runCli(['--planning', join(REPO, 'definitely-not-a-planning-dir')]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /planning directory not found/);
  assert.equal(result.stderr.includes('unknown flag'), false, 'this is the directory refusal, not the argv one');
});

test('the default invocation still runs and reports on the real ledger', () => {
  const result = runCli([]);
  assert.equal(result.code, 1, 'vNEXT is not close-ready today; exit 1 is the expected verdict');
  assert.match(result.stdout, /close-readiness — planning:/);
  assert.match(result.stdout, /pass · \d+ fail/);
});
