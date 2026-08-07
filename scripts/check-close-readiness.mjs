// scripts/check-close-readiness.mjs — BURN-06: is vNEXT actually closeable?
//
// Parses the REAL ledger files and refuses to hand-wave. Three groups:
//
//   A. DECISION LEDGER (.planning/milestones/vNEXT-AUDIT-2026-08-06.md §(c)) — the audit's own
//      rule is "`/gsd:complete-milestone` may run only when every row is checked; an
//      ACCEPT-AS-DEBT row without an owner + trigger is an UNCHECKED row". So: 7 rows, each
//      with a disposition, an owner, a trigger — and each in a CLOSE-TERMINAL state. A row that
//      still reads "EXECUTE-…" is a row that says the seam is SCHEDULED, not that it happened;
//      closing on it is exactly the v1.9 rot this audit exists to prevent.
//
//      WHAT "EXECUTED (with evidence)" MEANS HERE, precisely — this is a LEDGER checker, so it
//      cannot know that a seam ran; it can only refuse a row that offers nothing to check. An
//      EXECUTED row must therefore CARRY AN EVIDENCE REFERENCE in its own cells: a commit sha,
//      a repo path, or a URL (hasEvidenceReference). A row reading bare "EXECUTED" now FAILS
//      instead of passing. That is strictly weaker than "the seam demonstrably happened" — a
//      human still has to follow the reference — and the script says so rather than implying
//      more. Nothing here executes, opens, or fetches the referenced artifact.
//   B. CROSS-LEDGER AGREEMENT — ROADMAP.md, ORCHESTRATOR-STATE.md ⭐ CURRENT, STATE.md
//      frontmatter, HANDOFF.json (negative assertion) and the per-seam requirement checkboxes
//      in REQUIREMENTS.md must all agree with the ledger. A ticked checkbox for a seam nobody
//      executed is "ticked-because-closing".
//   C. SAUCE-BACKUP RITUAL — scripts/sauce-backup.ps1 exists, the members ITS OWN `$required`
//      list names exist on this machine, and a PowerShell host is on PATH. Backup failure is a
//      close BLOCKER, so a ritual that cannot run is a close blocker too. This script NEVER
//      executes sauce-backup.ps1 — that ritual tags and pushes.
//
// USAGE (from the repo root):
//   node scripts/check-close-readiness.mjs
//   node scripts/check-close-readiness.mjs --planning <dir>   # e.g. a copy, for drills
//
// EXIT CODES: 0 close-ready · 1 NOT close-ready (every missing item is listed) · 2 usage
// refusal (the planning directory is not there) · 4 unexpected error.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { samePath } from './lib/close-kit-db.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};

const PLANNING = resolve(argOf('planning') ?? join(REPO, '.planning'));
const REPO_ROOT = resolve(argOf('repo') ?? REPO);

const AUDIT = join(PLANNING, 'milestones/vNEXT-AUDIT-2026-08-06.md');
const ROADMAP = join(PLANNING, 'ROADMAP.md');
const STATE = join(PLANNING, 'STATE.md');
const ORCHESTRATOR = join(PLANNING, 'ORCHESTRATOR-STATE.md');
const HANDOFF = join(PLANNING, 'HANDOFF.json');
const CHECKLIST = join(PLANNING, 'PEDRO-CHECKLIST.md');
const REQUIREMENTS = join(PLANNING, 'REQUIREMENTS.md');
const SAUCE = join(REPO_ROOT, 'scripts/sauce-backup.ps1');

// Seam → the vNEXT requirement checkbox that must agree with its disposition. Row 6 (CPF-live)
// has NO vNEXT requirement id: the audit moved it into vLAUNCH as WEDG-02, so there is nothing
// in REQUIREMENTS.md to tick, and this script says so rather than inventing an assertion.
const SEAM_REQUIREMENT = { 1: 'LCAN-05', 2: 'LCAN-09', 3: 'MORN-07', 4: 'BTAP-07', 5: 'MCPX-09', 6: null, 7: 'CPF-06' };
const PLACEHOLDERS = new Set(['', '—', '–', '-', 'tbd', 'todo', '?', 'n/a', 'none']);

const results = [];
const record = (group, id, label, status, detail) => results.push({ group, id, label, status, detail });
const pass = (g, id, l, d) => record(g, id, l, 'PASS', d);
const fail = (g, id, l, d) => record(g, id, l, 'FAIL', d);
const warn = (g, id, l, d) => record(g, id, l, 'WARN', d);

const readIfPresent = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
export const isPlaceholder = (cell) => PLACEHOLDERS.has(cell.trim().toLowerCase());

/**
 * Does this ledger row point at something a human could open? One of:
 *   - a git sha (7–40 hex chars containing at least one digit, so ordinary hex-looking words
 *     like "facade" cannot pass for one),
 *   - a repo path with a directory separator and a file extension, or a `.planning/` reference,
 *   - an http(s) URL.
 * A reference is NOT proof the seam ran — see the header. It is the minimum a row must offer
 * before "EXECUTED" is allowed to mean anything to this script.
 */
export function hasEvidenceReference(rowText) {
  const sha = /\b(?=[0-9a-f]{7,40}\b)[0-9a-f]*\d[0-9a-f]*\b/i;
  const path = /(^|[\s`(])[\w.-]+[\\/][\w./\\-]*\.\w{2,4}\b/;
  const planning = /\.planning[\\/]/;
  const url = /https?:\/\/\S+/;
  return sha.test(rowText) || path.test(rowText) || planning.test(rowText) || url.test(rowText);
}

// ---------------------------------------------------------------------------
// A. Decision Ledger
// ---------------------------------------------------------------------------

/** Rows of the `| # | Seam | Choice ... |` table, as trimmed cell arrays. */
export function parseLedgerRows(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const header = lines.findIndex((l) => /^\|\s*#\s*\|\s*Seam\s*\|/i.test(l));
  if (header === -1) return null;
  const rows = [];
  for (let i = header + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.startsWith('|')) break;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length >= 5 && /^\d+$/.test(cells[0])) rows.push(cells);
  }
  return rows;
}

/**
 * Which close-state a Choice cell expresses. `SCHEDULED` (an "EXECUTE-…" row with no record
 * that it happened) is deliberately NOT terminal — see the header.
 */
export function classifyChoice(cell) {
  if (cell.includes('☐') || isPlaceholder(cell)) return 'NONE';
  const upper = cell.toUpperCase();
  if (upper.includes('BLOCK-CLOSE')) return 'BLOCK_CLOSE';
  if (upper.includes('ACCEPT-AS-DEBT')) return 'ACCEPT';
  if (/EXECUTED|\bDONE\b|PASSED|VERIFIED/.test(upper)) return 'EXECUTED';
  if (upper.includes('EXECUTE')) return 'SCHEDULED';
  return 'UNRECOGNIZED';
}

function checkDecisionLedger(checklistSrc) {
  const src = readIfPresent(AUDIT);
  if (!src) {
    fail('A', 'A0', 'Decision Ledger file present', `${AUDIT} not found`);
    return [];
  }
  const rows = parseLedgerRows(src);
  if (!rows) {
    fail('A', 'A0', 'Decision Ledger table located', 'no `| # | Seam | Choice …` table in the audit');
    return [];
  }
  pass('A', 'A0', 'Decision Ledger table located', `${AUDIT}`);
  record('A', 'A1', 'ledger has all 7 seam rows', rows.length === 7 ? 'PASS' : 'FAIL', `${rows.length} row(s) parsed`);

  const dispositions = [];
  for (const cells of rows) {
    const [num, seam, choice, owner, trigger] = cells;
    const kind = classifyChoice(choice);
    dispositions.push({ num: Number(num), seam, kind, choice, owner, trigger, row: cells.join(' | ') });
    const verdict = classifyLedgerRow({ seam, kind, choice, owner, trigger, cells, checklistSrc });
    record('A', `A2.${num}`, `seam ${num} (${seam.slice(0, 40)})`, verdict.status, verdict.detail);
  }
  const assumed = dispositions.filter((d) => d.row.includes('ASSUMED'));
  if (assumed.length > 0) {
    warn('A', 'A6', 'rows carrying ⚠️ASSUMED', `rows ${assumed.map((d) => d.num).join(', ')} hold the auditor's DEFAULT, not Pedro's decision — his backcheck must confirm or flip them (warning only; it does not change the exit code)`);
  }
  return dispositions;
}

/**
 * The verdict for ONE ledger row — pure, so scripts/__tests__ can drive every branch without a
 * .planning tree. Returns `{ status: 'PASS' | 'FAIL', detail }`; the caller records it.
 */
export function classifyLedgerRow({ seam, kind, choice, owner, trigger, cells, checklistSrc }) {
  const failed = (detail) => ({ status: 'FAIL', detail });
  const passed = (detail) => ({ status: 'PASS', detail });

  if (kind === 'NONE' || kind === 'UNRECOGNIZED') {
    return failed(`no usable disposition — Choice reads "${choice}"`);
  }
  if (isPlaceholder(owner) || isPlaceholder(trigger)) {
    return failed(`disposition ${kind} but owner="${owner}" trigger="${trigger}" — the audit counts an owner-less or trigger-less row as UNCHECKED`);
  }
  if (kind === 'BLOCK_CLOSE') {
    return failed('BLOCK-CLOSE — by its own definition the milestone may not close while this row stands');
  }
  if (kind === 'SCHEDULED') {
    return failed(`Choice "${choice}" only SCHEDULES the seam; at close it must read EXECUTED (with evidence) or ACCEPT-AS-DEBT (owner + trigger + date)`);
  }

  const rowText = cells.join(' ');
  if (kind === 'ACCEPT') {
    const hasDate = /\d{4}-\d{2}-\d{2}/.test(rowText);
    const inChecklist = Boolean(checklistSrc) && seamIdsOf(seam).some((sid) => checklistSrc.includes(sid));
    if (!hasDate) {
      return failed('ACCEPT-AS-DEBT without a YYYY-MM-DD date in the row (BURN-06 requires owner + trigger + date)');
    }
    if (!inChecklist) {
      return failed(`ACCEPT-AS-DEBT but no mention of ${seamIdsOf(seam).join('/')} in PEDRO-CHECKLIST.md — accepted debt must be copied there, not "carried" bare`);
    }
    return passed(`ACCEPT-AS-DEBT · owner ${owner} · trigger ${trigger} · mentioned in PEDRO-CHECKLIST (mention only — a human still reads the entry)`);
  }

  // kind === 'EXECUTED' — the word alone is not checkable; the row must point somewhere.
  if (!hasEvidenceReference(rowText)) {
    return failed(
      'EXECUTED but the row carries NO evidence reference (no commit sha, repo path, or URL). ' +
        'A close satisfiable by typing the word "EXECUTED" into a cell is the rot this gate exists to stop. ' +
        'Add the sha/artifact the seam produced. (This script checks that a reference EXISTS — a human still opens it.)',
    );
  }
  return passed(`${kind} · owner ${owner} · trigger ${trigger} · carries an evidence reference (unverified here — open it)`);
}

/**
 * Requirement ids named inside a seam label — "LCAN-05 DB-row round-trip" → ["LCAN-05"],
 * "CPF-live merge → re-label fan-out" → ["CPF-live"]. Falls back to the whole label so a
 * seam whose name carries no id is still looked up rather than silently skipped.
 */
export function seamIdsOf(seam) {
  return seam.match(/\b[A-Z]{3,5}-[A-Za-z0-9]{2,}\b/g) ?? [seam];
}

// ---------------------------------------------------------------------------
// B. Cross-ledger agreement
// ---------------------------------------------------------------------------

function checkRoadmap() {
  const src = readIfPresent(ROADMAP);
  if (!src) return fail('B', 'B1', 'ROADMAP vNEXT entry closed', `${ROADMAP} not found`);
  const line = src.split(/\r?\n/).find((l) => /^-\s*[^\n]*\*\*vNEXT\b/.test(l));
  if (!line) return fail('B', 'B1', 'ROADMAP vNEXT entry closed', 'no vNEXT milestone bullet found in ROADMAP.md');
  const closed = line.includes('✅') && /\b(SHIPPED|CLOSED)\b/.test(line);
  return record('B', 'B1', 'ROADMAP vNEXT entry closed', closed ? 'PASS' : 'FAIL',
    closed ? line.slice(0, 120) : `still reads: ${line.slice(0, 160)}… — a closed milestone is marked ✅ and SHIPPED/CLOSED, like every prior one`);
}

function checkStateFile() {
  const src = readIfPresent(STATE);
  if (!src) return fail('B', 'B2', 'STATE.md agrees vNEXT is complete', `${STATE} not found`);
  const fm = src.replace(/\r\n/g, '\n').split('---')[1] ?? '';
  const milestone = (fm.match(/^milestone:\s*(.+)$/m) ?? [])[1]?.trim();
  const status = (fm.match(/^status:\s*(.+)$/m) ?? [])[1]?.trim();
  const percent = (fm.match(/^\s*percent:\s*(\d+)/m) ?? [])[1];
  if (milestone && !/vNEXT/i.test(milestone)) {
    return pass('B', 'B2', 'STATE.md agrees vNEXT is complete', `frontmatter has already rotated to "${milestone}" — vNEXT is no longer the tracked milestone`);
  }
  const ok = status === 'complete' && percent === '100';
  return record('B', 'B2', 'STATE.md agrees vNEXT is complete', ok ? 'PASS' : 'FAIL',
    ok ? `status=${status} percent=${percent}` : `status=${status ?? '?'} percent=${percent ?? '?'} — expected status: complete + percent: 100 (or a rotation to the next milestone)`);
}

function checkOrchestratorState() {
  const src = readIfPresent(ORCHESTRATOR);
  if (!src) return fail('B', 'B3', 'ORCHESTRATOR-STATE ⭐ CURRENT records the close', `${ORCHESTRATOR} not found`);
  const text = src.replace(/\r\n/g, '\n');
  const start = text.indexOf('## ⭐ CURRENT');
  if (start === -1) return fail('B', 'B3', 'ORCHESTRATOR-STATE ⭐ CURRENT records the close', 'no "## ⭐ CURRENT" block');
  const rest = text.slice(start + 3);
  const block = text.slice(start, start + 3 + (rest.indexOf('\n## ') === -1 ? rest.length : rest.indexOf('\n## ')));
  const problems = [];
  if (!/vNEXT[^\n]{0,80}CLOSED/i.test(block)) problems.push('no "vNEXT … CLOSED" statement');
  if (/vNEXT[^\n]{0,80}CODE-COMPLETE/i.test(block)) problems.push('still describes vNEXT as CODE-COMPLETE');
  if (!/vLAUNCH/.test(block)) problems.push('does not name vLAUNCH (the active-milestone pointer)');
  return record('B', 'B3', 'ORCHESTRATOR-STATE ⭐ CURRENT records the close', problems.length === 0 ? 'PASS' : 'FAIL',
    problems.length === 0 ? 'CURRENT block states the close and points at vLAUNCH' : problems.join('; '));
}

function checkHandoff() {
  const src = readIfPresent(HANDOFF);
  if (!src) return fail('B', 'B4', 'HANDOFF.json names no in-flight vNEXT work', `${HANDOFF} not found`);
  let data;
  try {
    data = JSON.parse(src);
  } catch (error) {
    return fail('B', 'B4', 'HANDOFF.json names no in-flight vNEXT work', `unparseable JSON: ${String(error.message || error)}`);
  }
  const phase = data.phase === null || data.phase === undefined ? null : String(data.phase);
  const inFlight = phase !== null && /^7[3-7]\b/.test(phase);
  if (inFlight) {
    return fail('B', 'B4', 'HANDOFF.json names no in-flight vNEXT work', `phase=${phase} is a vNEXT phase still marked in flight`);
  }
  const pending = Array.isArray(data.human_actions_pending) ? data.human_actions_pending : [];
  if (pending.length > 0) {
    warn('B', 'B4b', 'HANDOFF.json human_actions_pending', `${pending.length} pending action(s) — reconcile against the ledger before close: ${pending.map((p) => String(p).slice(0, 60)).join(' · ')}`);
  }
  return pass('B', 'B4', 'HANDOFF.json names no in-flight vNEXT work', `phase=${phase ?? 'null'} (stub checkpoint is fine — this is a negative assertion)`);
}

function checkSeamCheckboxes(dispositions) {
  const src = readIfPresent(REQUIREMENTS);
  if (!src) return fail('B', 'B5', 'seam checkboxes agree with their dispositions', `${REQUIREMENTS} not found`);
  const problems = [];
  const notes = [];
  for (const d of dispositions) {
    const reqId = SEAM_REQUIREMENT[d.num];
    if (!reqId) {
      notes.push(`seam ${d.num} has no vNEXT requirement checkbox (moved to vLAUNCH WEDG-02) — nothing to tick`);
      continue;
    }
    const match = src.match(new RegExp(`^- \\[([ xX])\\] \\*\\*${reqId}\\b`, 'm'));
    if (!match) {
      problems.push(`${reqId}: no checkbox line found in REQUIREMENTS.md`);
      continue;
    }
    const ticked = match[1].toLowerCase() === 'x';
    if (d.kind === 'EXECUTED' && !ticked) problems.push(`${reqId}: disposition EXECUTED but the box is unticked`);
    if (d.kind !== 'EXECUTED' && ticked) problems.push(`${reqId}: box is TICKED while the ledger says ${d.kind} — ticked-because-closing`);
  }
  return record('B', 'B5', 'seam checkboxes agree with their dispositions', problems.length === 0 ? 'PASS' : 'FAIL',
    [...problems, ...notes].join('; ') || 'all mapped checkboxes agree');
}

// ---------------------------------------------------------------------------
// C. Sauce-backup ritual (never executed here — it tags and pushes)
// ---------------------------------------------------------------------------

/** Resolve the handful of PowerShell RHS forms sauce-backup.ps1 actually uses. */
export function resolvePsExpression(expr, vars) {
  const text = expr.trim();
  const literal = text.match(/^"([^"]*)"$/);
  if (literal) return literal[1];
  const variable = text.match(/^\$(\w+)$/);
  if (variable) return vars[variable[1]] ?? null;
  const joinEnv = text.match(/^\(?\s*Join-Path\s+\$env:(\w+)\s+"([^"]*)"\s*\)?$/i);
  if (joinEnv) {
    const base = process.env[joinEnv[1]];
    return base ? join(base, joinEnv[2]) : null;
  }
  const joinVar = text.match(/^\(?\s*Join-Path\s+\$(\w+)\s+"([^"]*)"\s*\)?$/i);
  if (joinVar) {
    const base = vars[joinVar[1]];
    return base ? join(base, joinVar[2]) : null;
  }
  return null;
}

/** `$Name = <expr>` assignments preceding the `$required` list, resolved in order. */
function parsePsVariables(lines, untilIndex) {
  const vars = { RepoRoot: REPO_ROOT, PSScriptRoot: join(REPO_ROOT, 'scripts') };
  for (let i = 0; i < untilIndex; i += 1) {
    const m = lines[i].match(/^\$(\w+)\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    const value = resolvePsExpression(m[2], vars);
    if (value !== null) vars[m[1]] = value;
  }
  return vars;
}

function checkSauceBackup() {
  if (!existsSync(SAUCE)) {
    return fail('C', 'C1', 'sauce-backup ritual present', `${SAUCE} not found — the close ritual has no script`);
  }
  pass('C', 'C1', 'sauce-backup ritual present', SAUCE);

  const lines = readFileSync(SAUCE, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const startIdx = lines.findIndex((l) => /^\$required\s*=\s*@\(/.test(l));
  if (startIdx === -1) {
    return fail('C', 'C2', 'sauce-backup required members exist', 'cannot find the `$required = @(` list — parse it by hand before closing');
  }
  const vars = parsePsVariables(lines, startIdx);
  const members = [];
  for (let i = startIdx + 1; i < lines.length && !lines[i].trim().startsWith(')'); i += 1) {
    const entry = lines[i].trim().replace(/,$/, '');
    if (!entry) continue;
    members.push({ expr: entry, path: resolvePsExpression(entry, vars) });
  }
  const unresolved = members.filter((m) => m.path === null);
  const missing = members.filter((m) => m.path !== null && !existsSync(m.path));
  if (members.length === 0) {
    fail('C', 'C2', 'sauce-backup required members exist', 'the `$required` list parsed as empty — refusing to call that a pass');
  } else if (unresolved.length > 0) {
    fail('C', 'C2', 'sauce-backup required members exist', `cannot resolve: ${unresolved.map((m) => m.expr).join(', ')} — check by hand`);
  } else if (missing.length > 0) {
    fail('C', 'C2', 'sauce-backup required members exist', `missing on this machine: ${missing.map((m) => m.path).join(', ')} — the script throws "REQUIRED backup member missing" and blocks the close`);
  } else {
    pass('C', 'C2', 'sauce-backup required members exist', `${members.length} member(s) present: ${members.map((m) => m.path).join(', ')}`);
  }

  const host = findPowerShell();
  return record('C', 'C3', 'a PowerShell host is on PATH', host ? 'PASS' : 'FAIL',
    host ? `${host} (the ritual is NOT run here — it tags and pushes)` : 'neither pwsh nor powershell found on PATH — the .ps1 ritual cannot run');
}

function findPowerShell() {
  const dirs = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':');
  for (const dir of dirs) {
    if (!dir) continue;
    for (const exe of ['pwsh.exe', 'pwsh', 'powershell.exe']) {
      const candidate = join(dir, exe);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  if (!existsSync(PLANNING)) {
    console.error(`REFUSED: planning directory not found: ${PLANNING}`);
    return 2;
  }
  console.log(`close-readiness — planning: ${PLANNING}`);
  console.log(`                  repo:     ${REPO_ROOT}\n`);

  const checklistSrc = readIfPresent(CHECKLIST);
  if (!checklistSrc) warn('A', 'A5', 'PEDRO-CHECKLIST.md readable', `${CHECKLIST} not found — ACCEPT-AS-DEBT rows cannot be cross-checked against it`);
  const dispositions = checkDecisionLedger(checklistSrc);
  checkRoadmap();
  checkStateFile();
  checkOrchestratorState();
  checkHandoff();
  checkSeamCheckboxes(dispositions);
  checkSauceBackup();

  for (const r of results) {
    console.log(`${r.status.padEnd(4)} ${r.group}·${r.id}  ${r.label}`);
    if (r.detail) console.log(`      ${r.detail}`);
  }

  const failures = results.filter((r) => r.status === 'FAIL');
  const warnings = results.filter((r) => r.status === 'WARN');
  console.log(`\n${results.filter((r) => r.status === 'PASS').length} pass · ${failures.length} fail · ${warnings.length} warn`);
  if (failures.length === 0) {
    console.log('\nCLOSE-READY: the ledgers agree and every EXECUTED row points at an artifact.');
    console.log('That is LEDGER agreement, not proof the seams ran — open the referenced evidence before closing.');
    console.log('Next: pwsh scripts/sauce-backup.ps1 → /gsd:audit-milestone → /gsd:complete-milestone.');
    return 0;
  }
  console.log('\nNOT CLOSE-READY — exactly what is missing:');
  for (const f of failures) console.log(`  - [${f.group}·${f.id}] ${f.label}: ${f.detail}`);
  return 1;
}

// Entry-point only, so the pure functions above are importable by scripts/__tests__/.
if (process.argv[1] !== undefined && samePath(process.argv[1], fileURLToPath(import.meta.url))) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`ERROR: ${String(error.stack || error.message || error)}`);
    process.exit(4);
  }
}
