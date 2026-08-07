// scripts/lib/wave1-assertions.mjs — the pure comparisons behind the Wave-1
// verifier's PASS/FAIL rows.
//
// These live here, apart from the CLI, so the FAIL paths can be exercised
// without a database: given a journal + the rows a DB reported, or an expected
// allowlist + a live pg_get_functiondef body, the verdict is a pure function.
// scripts/verify-wave1.mjs only turns these verdicts into report rows.
//
// That testability is USED, not merely claimed: wave1-assertions.test.mjs covers
// every guard here, and each one goes RED when the guard is removed.

/**
 * @typedef {{ tag: string, when: number, hash: string }} JournalMigration
 * @typedef {{ hash: string, created_at: string }} AppliedRow
 * @typedef {{ recorded: { tag: string, ok: boolean, hash: string }[],
 *             missing: string[], highWater: number, journalTop: number,
 *             highWaterAhead: boolean }} MigrationVerdict
 * @typedef {{ missing: string[], extra: string[], covered: boolean }} AllowlistVerdict
 * @typedef {{ name: string, ok: boolean, detail: string }} Check
 */

/**
 * Compares the journal against the rows in drizzle.__drizzle_migrations.
 *
 * `highWaterAhead` is the condition that froze staging on 2026-08-06: drizzle's
 * migrator applies only entries whose `when` is greater than the newest recorded
 * `created_at`, so a recorded stamp ahead of the journal's top silently skips
 * every future migration.
 *
 * @param {{ journal: JournalMigration[], applied: AppliedRow[], requiredTags: readonly string[] }} input
 * @returns {MigrationVerdict}
 */
export const compareMigrations = ({ journal, applied, requiredTags }) => {
  const recordedHashes = new Set(applied.map((r) => r.hash));
  const recorded = requiredTags.map((tag) => {
    const entry = journal.find((m) => m.tag === tag);
    return { tag, ok: Boolean(entry) && recordedHashes.has(entry.hash), hash: entry ? entry.hash : '' };
  });
  const highWater = applied.reduce((max, r) => Math.max(max, Number(r.created_at)), 0);
  const journalTop = journal.reduce((max, m) => Math.max(max, m.when), 0);
  return {
    recorded,
    missing: journal.filter((m) => !recordedHashes.has(m.hash)).map((m) => m.tag),
    highWater,
    journalTop,
    highWaterAhead: highWater > journalTop,
  };
};

/**
 * Turns a migration verdict into the rows one leg asserts, plus the rows it only
 * reports as context.
 *
 * `requireFullJournal` gates EXACTLY ONE row: journal COVERAGE. Prod is not
 * expected to carry every journal entry the way staging is after the 2026-08-06
 * repair, so on prod that becomes an INFO.
 *
 * The high-water row is NOT gated. It is asserted on every leg, because it is
 * environment-independent and never benign: a database merely BEHIND the journal
 * has highWater <= journalTop and passes, while a database AHEAD of it silently
 * skips every future migration — the exact condition that froze staging at 0036.
 * Downgrading it on prod meant the verifier exited 0 on the known-bad state, on
 * the one environment where migrations are hand-triggered.
 *
 * @param {{ journal: JournalMigration[], applied: AppliedRow[],
 *           requiredTags: readonly string[], requireFullJournal: boolean }} input
 * @returns {{ checks: readonly Check[], infos: readonly string[] }}
 */
export const migrationChecks = ({ journal, applied, requiredTags, requireFullJournal }) => {
  const { recorded, missing, highWater, journalTop, highWaterAhead } = compareMigrations({ journal, applied, requiredTags });
  const coverageText = `journal coverage: ${journal.length - missing.length}/${journal.length} recorded${missing.length ? ` (not recorded: ${missing.join(', ')})` : ''}`;
  const checks = [
    ...recorded.map((r) => ({
      name: `${r.tag} recorded`,
      ok: r.ok,
      detail: r.hash ? `sha256 ${r.hash.slice(0, 12)}…` : 'tag absent from journal',
    })),
    {
      name: 'recorded high-water not ahead of journal',
      ok: !highWaterAhead,
      detail: `high-water ${highWater} vs journal top ${journalTop}${highWaterAhead ? ' — the next generated migration would be SKIPPED by drizzle' : ''}`,
    },
  ];
  if (requireFullJournal) {
    checks.push({
      name: 'every journal entry recorded',
      ok: missing.length === 0,
      detail: missing.length === 0 ? `${journal.length}/${journal.length}` : `missing: ${missing.join(', ')}`,
    });
  }
  return Object.freeze({
    checks: Object.freeze(checks.map((c) => Object.freeze(c))),
    infos: Object.freeze(requireFullJournal ? [] : [coverageText]),
  });
};

/**
 * The repo-only worker-image rows.
 *
 * Every row carries a non-empty predicate: when a parse fails AND the workflow
 * key is also absent, both sides are '' and a bare `===` would render a
 * meaningless `(unset) vs ` row as PASS.
 *
 * @param {{ tfWorkerRepo: string, tfImageTags: Record<string, string>,
 *           workflows: { env: string, file: string, repository: string, tag: string, pushGated: boolean }[] }} expectations
 * @returns {readonly Check[]}
 */
export const workerChecks = ({ tfWorkerRepo, tfImageTags, workflows }) => {
  /** @type {Check[]} */
  const checks = [
    { name: 'terraform worker ECR repo name resolves', ok: tfWorkerRepo !== '', detail: tfWorkerRepo || '(unparsed)' },
  ];
  for (const w of workflows) {
    const tfTag = tfImageTags[w.env] ?? '';
    checks.push({
      name: `${w.env}: WORKER_ECR_REPOSITORY matches terraform`,
      ok: w.repository === tfWorkerRepo && tfWorkerRepo !== '',
      detail: `${w.repository || '(unset)'} vs ${tfWorkerRepo || '(unparsed)'}`,
    });
    checks.push({
      name: `${w.env}: image tag matches terraform locals`,
      ok: w.tag === tfTag && tfTag !== '',
      detail: `${w.tag || '(unset)'} vs ${tfTag || '(unparsed)'}`,
    });
    checks.push({ name: `${w.env}: ECR push gated on WORKER_DEPLOY_ENABLED`, ok: w.pushGated === true, detail: w.file });
  }
  return Object.freeze(checks.map((c) => Object.freeze(c)));
};

/**
 * Statement keywords that would make a query a mutation. `do` is included
 * because a DO block can contain anything.
 */
const WRITE_KEYWORDS = /\b(insert|update|delete|truncate|create|drop|alter|grant|revoke|merge|copy|call|do)\b/i;

/**
 * Extracts the SQL a verifier source file sends and returns the ones that write.
 * An empty result is what lets scripts/verify-wave1.mjs claim it is read-only.
 *
 * BOUNDED, by design — it recognises exactly two shapes:
 *   sql`…`                  (postgres.js tagged template, no nested backticks)
 *   sql.unsafe('…')         (single-quoted literal argument)
 * SQL built from variables, or sent from another module, is invisible to it.
 *
 * @param {string} source
 * @returns {{ literals: string[], offenders: string[] }}
 */
export const findWriteSql = (source) => {
  const literals = [
    ...[...source.matchAll(/sql`([^`]*)`/g)].map((m) => m[1]),
    ...[...source.matchAll(/sql\.unsafe\(\s*'([^']*)'/g)].map((m) => m[1]),
  ];
  return { literals, offenders: literals.filter((s) => WRITE_KEYWORDS.test(s)) };
};

/**
 * Compares the identifier allowlist the repo declares against the one the live
 * function carries. `covered` is the Wave-1 gate; `extra` means the live DB is
 * ahead of this checkout, which a human should reconcile before trusting the run.
 * @param {{ expected: readonly string[], live: readonly string[] }} input
 * @returns {AllowlistVerdict}
 */
export const compareAllowlist = ({ expected, live }) => {
  const missing = expected.filter((id) => !live.includes(id));
  return {
    missing,
    extra: live.filter((id) => !expected.includes(id)),
    covered: live.length > 0 && missing.length === 0,
  };
};
