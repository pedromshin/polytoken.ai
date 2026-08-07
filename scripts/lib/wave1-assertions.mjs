// scripts/lib/wave1-assertions.mjs — the pure comparisons behind the Wave-1
// verifier's PASS/FAIL rows.
//
// These live here, apart from the CLI, so the FAIL paths can be exercised
// without a database: given a journal + the rows a DB reported, or an expected
// allowlist + a live pg_get_functiondef body, the verdict is a pure function.
// scripts/verify-wave1.mjs only turns these verdicts into report rows.

/**
 * @typedef {{ tag: string, when: number, hash: string }} JournalMigration
 * @typedef {{ hash: string, created_at: string }} AppliedRow
 * @typedef {{ recorded: { tag: string, ok: boolean, hash: string }[],
 *             missing: string[], highWater: number, journalTop: number,
 *             highWaterAhead: boolean }} MigrationVerdict
 * @typedef {{ missing: string[], extra: string[], covered: boolean }} AllowlistVerdict
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
