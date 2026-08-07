// scripts/lib/wave1-assertions.test.mjs — `node --test` (npm run test:scripts).
//
// Every test here names the guard it protects. Remove the guard, this file goes
// RED. No database, no network: each case is a fixture row set.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareAllowlist, compareMigrations, findWriteSql, migrationChecks, workerChecks } from './wave1-assertions.mjs';

/** @param {number} when @param {string} tag */
const entry = (tag, when, hash) => ({ tag, when, hash });

const JOURNAL = Object.freeze([
  entry('0058_secret_mesmero', 1000, 'h58'),
  entry('0059_moaning_wrecker', 2000, 'h59'),
  entry('0060_rapid_red_skull', 3000, 'h60'),
  entry('0061_enqueue_allowlist_cascade_recipe', 4000, 'h61'),
]);
const REQUIRED = Object.freeze(JOURNAL.map((m) => m.tag));
const applied = (rows) => rows.map(([hash, created_at]) => ({ hash, created_at: String(created_at) }));
const ALL_RECORDED = applied([
  ['h58', 1000],
  ['h59', 2000],
  ['h60', 3000],
  ['h61', 4000],
]);
/** Every journal hash recorded, but ONE row stamped ahead of the journal top. */
const POISONED = applied([
  ['h58', 1999999999999],
  ['h59', 2000],
  ['h60', 3000],
  ['h61', 4000],
]);

const named = (checks, name) => checks.find((c) => c.name === name);

describe('compareMigrations', () => {
  it('flags a recorded stamp ahead of the journal — the 2026-08-06 freeze condition', () => {
    const v = compareMigrations({ journal: JOURNAL, applied: POISONED, requiredTags: REQUIRED });
    assert.equal(v.highWater, 1999999999999);
    assert.equal(v.journalTop, 4000);
    assert.equal(v.highWaterAhead, true);
  });

  it('does NOT flag a database merely BEHIND the journal', () => {
    const v = compareMigrations({ journal: JOURNAL, applied: applied([['h58', 1000]]), requiredTags: REQUIRED });
    assert.equal(v.highWaterAhead, false);
    assert.deepEqual(v.missing, ['0059_moaning_wrecker', '0060_rapid_red_skull', '0061_enqueue_allowlist_cascade_recipe']);
  });

  it('matches recorded migrations by hash, and fails closed on a tag absent from the journal', () => {
    const v = compareMigrations({ journal: JOURNAL, applied: ALL_RECORDED, requiredTags: [...REQUIRED, '0099_not_in_journal'] });
    assert.deepEqual(
      v.recorded.map((r) => [r.tag, r.ok]),
      [
        ['0058_secret_mesmero', true],
        ['0059_moaning_wrecker', true],
        ['0060_rapid_red_skull', true],
        ['0061_enqueue_allowlist_cascade_recipe', true],
        ['0099_not_in_journal', false],
      ],
    );
  });
});

describe('migrationChecks — the high-water row is asserted on EVERY leg', () => {
  // THE HIGH #1 REGRESSION TEST. Before the fix the prod leg (requireFullJournal
  // false) downgraded this to INFO, so verify-wave1 exited 0 on the known-bad
  // state. Gate the row behind requireFullJournal again and this goes RED.
  it('prod policy (requireFullJournal false) still FAILS a poisoned high-water', () => {
    const { checks } = migrationChecks({ journal: JOURNAL, applied: POISONED, requiredTags: REQUIRED, requireFullJournal: false });
    const row = named(checks, 'recorded high-water not ahead of journal');
    assert.ok(row, 'the high-water row must exist on the prod leg');
    assert.equal(row.ok, false);
    assert.match(row.detail, /would be SKIPPED by drizzle/);
  });

  it('staging policy FAILS the same data identically — both legs agree', () => {
    const prod = migrationChecks({ journal: JOURNAL, applied: POISONED, requiredTags: REQUIRED, requireFullJournal: false });
    const staging = migrationChecks({ journal: JOURNAL, applied: POISONED, requiredTags: REQUIRED, requireFullJournal: true });
    assert.deepEqual(named(prod.checks, 'recorded high-water not ahead of journal'), named(staging.checks, 'recorded high-water not ahead of journal'));
  });

  it('passes the high-water row on a clean database, on both policies', () => {
    for (const requireFullJournal of [true, false]) {
      const { checks } = migrationChecks({ journal: JOURNAL, applied: ALL_RECORDED, requiredTags: REQUIRED, requireFullJournal });
      assert.equal(named(checks, 'recorded high-water not ahead of journal').ok, true);
    }
  });

  it('gates journal COVERAGE only — asserted on staging, INFO on prod', () => {
    const behind = applied([['h58', 1000]]);
    const staging = migrationChecks({ journal: JOURNAL, applied: behind, requiredTags: REQUIRED, requireFullJournal: true });
    assert.equal(named(staging.checks, 'every journal entry recorded').ok, false);
    assert.deepEqual(staging.infos, []);

    const prod = migrationChecks({ journal: JOURNAL, applied: behind, requiredTags: REQUIRED, requireFullJournal: false });
    assert.equal(named(prod.checks, 'every journal entry recorded'), undefined);
    assert.equal(prod.infos.length, 1);
    assert.match(prod.infos[0], /journal coverage: 1\/4 recorded/);
  });

  it('never returns an `ok` that is not a boolean — report.assert only passes on true', () => {
    const { checks } = migrationChecks({ journal: JOURNAL, applied: POISONED, requiredTags: REQUIRED, requireFullJournal: true });
    for (const c of checks) assert.equal(typeof c.ok, 'boolean', `${c.name} must carry a boolean`);
  });
});

describe('workerChecks', () => {
  const expectations = (over = {}) => ({
    tfWorkerRepo: 'nauta-services-email-worker',
    tfImageTags: { production: 'latest', staging: 'staging' },
    workflows: [{ env: 'production', file: 'wf.yml', repository: 'nauta-services-email-worker', tag: 'latest', pushGated: true }],
    ...over,
  });

  it('passes when the workflow agrees with terraform', () => {
    assert.deepEqual(
      workerChecks(expectations()).map((c) => c.ok),
      [true, true, true, true],
    );
  });

  // NOTE #5 REGRESSION: both sides parsing empty used to render `(unset) vs ` as PASS.
  it('FAILS the repository row when BOTH sides parse empty', () => {
    const checks = workerChecks(
      expectations({ tfWorkerRepo: '', workflows: [{ env: 'production', file: 'wf.yml', repository: '', tag: 'latest', pushGated: true }] }),
    );
    assert.equal(named(checks, 'terraform worker ECR repo name resolves').ok, false);
    assert.equal(named(checks, 'production: WORKER_ECR_REPOSITORY matches terraform').ok, false);
  });

  it('FAILS the tag row when terraform has no tag for that env', () => {
    const checks = workerChecks(expectations({ tfImageTags: {}, workflows: [{ env: 'production', file: 'wf.yml', repository: 'nauta-services-email-worker', tag: '', pushGated: true }] }));
    assert.equal(named(checks, 'production: image tag matches terraform locals').ok, false);
  });

  it('FAILS when the ECR push gate is removed', () => {
    const checks = workerChecks(expectations({ workflows: [{ env: 'production', file: 'wf.yml', repository: 'nauta-services-email-worker', tag: 'latest', pushGated: false }] }));
    assert.equal(named(checks, 'production: ECR push gated on WORKER_DEPLOY_ENABLED').ok, false);
  });
});

describe('findWriteSql — the read-only self-audit', () => {
  it('passes a source whose only SQL reads', () => {
    const src = 'const a = sql`select 1 from pg_proc`;\nsql.unsafe(\'show default_transaction_read_only\');';
    const { literals, offenders } = findWriteSql(src);
    assert.equal(literals.length, 2);
    assert.deepEqual(offenders, []);
  });

  it('catches a write smuggled into a tagged template', () => {
    const { offenders } = findWriteSql('await sql`delete from drizzle.__drizzle_migrations`;');
    assert.equal(offenders.length, 1);
  });

  it('catches a write smuggled into sql.unsafe', () => {
    const { offenders } = findWriteSql("await sql.unsafe('truncate table foo');");
    assert.equal(offenders.length, 1);
  });

  it('catches every write keyword it claims to', () => {
    for (const kw of ['insert', 'update', 'delete', 'truncate', 'create', 'drop', 'alter', 'grant', 'revoke', 'merge', 'copy', 'call', 'do']) {
      assert.equal(findWriteSql(`sql\`${kw} something\``).offenders.length, 1, `${kw} must be caught`);
    }
  });

  it("accepts the read-only session statement the verifier really sends (`set` is not a write)", () => {
    assert.deepEqual(findWriteSql("sql.unsafe('set session characteristics as transaction read only')").offenders, []);
  });

  // The DOCUMENTED blind spot, pinned so it stays documented rather than drifting
  // into a false claim. The server-side read-only session is the backstop.
  it('does NOT see SQL assembled at runtime — this limitation is disclosed, not fixed', () => {
    assert.deepEqual(findWriteSql("const q = ['dele','te from t'].join(''); await sql.unsafe(q);").offenders, []);
  });
});

describe('compareAllowlist', () => {
  it('fails closed when the live definition did not parse (live empty)', () => {
    const v = compareAllowlist({ expected: ['a', 'b'], live: [] });
    assert.equal(v.covered, false);
    assert.deepEqual(v.missing, ['a', 'b']);
  });

  it('fails when the live function is missing an identifier the repo declares', () => {
    assert.equal(compareAllowlist({ expected: ['a', 'cascade_relabel'], live: ['a'] }).covered, false);
  });

  it('reports identifiers the repo does not declare as extra, without breaking coverage', () => {
    const v = compareAllowlist({ expected: ['a'], live: ['a', 'surprise'] });
    assert.equal(v.covered, true);
    assert.deepEqual(v.extra, ['surprise']);
  });
});
