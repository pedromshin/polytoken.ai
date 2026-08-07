// scripts/__tests__/close-kit-db.test.mjs — the close kit's SAFETY CONTRACT, under test.
//
// Run: npm run test:close-kit   (node --test, no dependencies — these are plain .mjs modules
// outside every workspace, so there is no vitest project that would pick them up).
//
// Every test here is written so that DELETING the guard it covers turns it RED. That is the
// point: the previous revision of this kit shipped 1317 lines of guards with zero tests, and
// two of those guards turned out not to work — one had never been probed adversarially, the
// other was not enforced on the only platform the repo is driven from.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CASE_INSENSITIVE_FS,
  ConfigError,
  PROD_REF,
  STAGING_REF,
  classifyTarget,
  describeTarget,
  isInside,
  isUuid,
  readArgs,
  resolveDatabaseUrl,
  samePath,
} from '../lib/close-kit-db.mjs';
import {
  MINIMUM_SUITE_FILES,
  declaredTestPaths,
  presentTestFiles,
  suiteFloorProblems,
  usesGlob,
} from './_suite-floor.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

// ---------------------------------------------------------------------------
// The platform claim itself — lesson 3: a claim about "this platform" must be
// checked against this platform, not asserted.
// ---------------------------------------------------------------------------

test('CASE_INSENSITIVE_FS matches how THIS filesystem actually behaves', () => {
  const canonical = join(REPO, 'package.json');
  assert.ok(existsSync(canonical), 'repo root package.json must exist for this probe');
  const mangled = join(REPO, 'PACKAGE.JSON');
  assert.equal(
    existsSync(mangled),
    CASE_INSENSITIVE_FS,
    `existsSync("PACKAGE.JSON") is ${existsSync(mangled)} but CASE_INSENSITIVE_FS is ` +
      `${CASE_INSENSITIVE_FS} on platform ${process.platform} — the constant lies about this machine`,
  );
});

// ---------------------------------------------------------------------------
// samePath / isInside — the fix for the defeated fixture write-path guard
// ---------------------------------------------------------------------------

test('samePath compares the way this filesystem compares', () => {
  const canonical = join(REPO, '.planning/milestones/WEDGE-BASELINE.md');
  const mangled = join(REPO, '.planning/Milestones/wedge-baseline.MD');
  assert.equal(samePath(canonical, canonical), true);
  assert.equal(
    samePath(canonical, mangled),
    CASE_INSENSITIVE_FS,
    'a case variant must compare EQUAL wherever the filesystem resolves both spellings to one file',
  );
  assert.equal(samePath(canonical, join(REPO, '.planning/milestones/OTHER.md')), false);
});

test('samePath normalises separators and trailing slashes, not content', () => {
  assert.equal(samePath(join(REPO, '.planning'), `${join(REPO, '.planning')}${process.platform === 'win32' ? '\\' : '/'}`), true);
  assert.equal(samePath(join(REPO, '.planning'), join(REPO, '.planning-archive')), false);
});

test('isInside catches every path under a directory, and no sibling that merely shares its prefix', () => {
  const planning = join(REPO, '.planning');
  assert.equal(isInside(planning, join(planning, 'milestones/WEDGE-BASELINE.md')), true);
  assert.equal(isInside(planning, planning), true);
  assert.equal(
    isInside(planning, join(REPO, '.planning/Milestones/wedge-baseline.MD')),
    true,
    'a case variant is still inside the tree on a case-folding filesystem',
  );
  assert.equal(isInside(planning, join(REPO, '.planning-archive/x.md')), false, 'prefix sibling must NOT count as inside');
  assert.equal(isInside(planning, join(REPO, 'scratch/x.md')), false);
});

// ---------------------------------------------------------------------------
// readArgs — a malformed flag must REFUSE, never degrade
// ---------------------------------------------------------------------------

const VOCAB = { valueFlags: ['env', 'out', 'fixture', 'user-id'], boolFlags: ['apply', 'force', 'allow-prod'] };

test('readArgs parses the well-formed forms', () => {
  const args = readArgs(['--fixture', 'rows.json', '--out=scratch/base.md', '--apply'], VOCAB);
  assert.equal(args.fixture, 'rows.json');
  assert.equal(args.out, 'scratch/base.md');
  assert.equal(args.apply, true);
  assert.equal(args.force, undefined);
});

test('REGRESSION: `--fixture --apply` REFUSES instead of becoming a live database run', () => {
  assert.throws(
    () => readArgs(['--fixture', '--apply'], VOCAB),
    (error) => error instanceof ConfigError && /--fixture needs a value/.test(error.message),
    'a value flag whose value was typed away must throw, not map to boolean true',
  );
});

test('readArgs refuses a value flag with no following token at all', () => {
  assert.throws(() => readArgs(['--env'], VOCAB), ConfigError);
  assert.throws(() => readArgs(['--env='], VOCAB), ConfigError);
});

test('readArgs refuses an unknown flag rather than dropping it', () => {
  assert.throws(
    () => readArgs(['--fixtur', 'rows.json'], VOCAB),
    (error) => error instanceof ConfigError && /unknown flag "--fixtur"/.test(error.message),
  );
});

test('readArgs refuses a switch handed a value, and a bare positional', () => {
  assert.throws(() => readArgs(['--apply=yes'], VOCAB), ConfigError);
  assert.throws(() => readArgs(['rows.json'], VOCAB), ConfigError);
  assert.throws(() => readArgs(['--'], VOCAB), ConfigError);
});

test('readArgs returns a frozen object (no caller can mutate parsed flags)', () => {
  const args = readArgs(['--apply'], VOCAB);
  assert.equal(Object.isFrozen(args), true);
});

// ---------------------------------------------------------------------------
// resolveDatabaseUrl — the prod refusal
// ---------------------------------------------------------------------------

const prodUrl = `postgresql://postgres.${PROD_REF}:hunter2@aws-1-sa-east-1.pooler.supabase.com:5432/postgres`;
const stagingUrl = `postgresql://postgres.${STAGING_REF}:hunter2@aws-1-sa-east-1.pooler.supabase.com:5432/postgres`;

test('a prod URL is REFUSED without --allow-prod', () => {
  assert.throws(
    () => resolveDatabaseUrl({ envFile: null, allowProd: false, env: { POSTGRES_URL_NON_POOLING: prodUrl } }),
    (error) => error instanceof ConfigError && error.message.includes(PROD_REF),
  );
});

test('a prod URL is allowed only when --allow-prod says so deliberately', () => {
  const { url, from } = resolveDatabaseUrl({ envFile: null, allowProd: true, env: { POSTGRES_URL_NON_POOLING: prodUrl } });
  assert.equal(url, prodUrl);
  assert.equal(from, 'process environment');
});

test('a non-prod URL needs no flag, and a missing URL refuses', () => {
  const { url } = resolveDatabaseUrl({ envFile: null, allowProd: false, env: { POSTGRES_URL: stagingUrl } });
  assert.equal(url, stagingUrl);
  assert.throws(() => resolveDatabaseUrl({ envFile: null, allowProd: false, env: {} }), ConfigError);
});

test('POSTGRES_URL_NON_POOLING wins over POSTGRES_URL (session mode preferred)', () => {
  const { url } = resolveDatabaseUrl({
    envFile: null,
    allowProd: false,
    env: { POSTGRES_URL: 'postgresql://a:b@pooled.example:6543/postgres', POSTGRES_URL_NON_POOLING: stagingUrl },
  });
  assert.equal(url, stagingUrl);
});

test('an unreadable --env file is a CONFIG refusal (exit 2), not a runtime error (exit 4)', () => {
  assert.throws(
    () => resolveDatabaseUrl({ envFile: join(REPO, 'no-such-file.env'), allowProd: false, env: {} }),
    (error) => error instanceof ConfigError && /cannot read the env file/.test(error.message),
    'exit 4 reads as "the tool is broken"; this is "you pointed it at nothing"',
  );
});

// ---------------------------------------------------------------------------
// describeTarget — no secret may reach stdout
// ---------------------------------------------------------------------------

test('describeTarget never echoes the password', () => {
  const described = describeTarget(prodUrl);
  assert.equal(described.includes('hunter2'), false, 'password leaked into the printable target');
  assert.match(described, /^prod · host=aws-1-sa-east-1\.pooler\.supabase\.com:5432 db=postgres ref=/);
});

test('describeTarget withholds details it cannot parse instead of echoing the string', () => {
  const described = describeTarget('not a url but it has hunter2 in it');
  assert.equal(described.includes('hunter2'), false);
  assert.match(described, /details withheld/);
});

test('classifyTarget names prod, staging and everything else', () => {
  assert.deepEqual(classifyTarget(prodUrl), { env: 'prod', ref: PROD_REF });
  assert.deepEqual(classifyTarget(stagingUrl), { env: 'staging', ref: STAGING_REF });
  assert.deepEqual(classifyTarget('postgresql://postgres:postgres@127.0.0.1:54322/postgres'), { env: 'other/local', ref: null });
});

test('isUuid accepts canonical uuids only', () => {
  assert.equal(isUuid('11111111-2222-3333-4444-555555555555'), true);
  assert.equal(isUuid('11111111-2222-3333-4444-55555555555'), false);
  assert.equal(isUuid("'; drop table emails; --"), false);
  assert.equal(isUuid(null), false);
});

// ---------------------------------------------------------------------------
// The gate on the gate — W12 review NOTE #2. `npm run test:close-kit` could not tell
// "68 green" from "no tests found"; a glob that matches nothing exits 0.
// ---------------------------------------------------------------------------

const ALL_FOUR = [
  'check-close-readiness.test.mjs',
  'close-kit-db.test.mjs',
  'collect-wedge-evidence.test.mjs',
  'fill-wedge-baseline.test.mjs',
];
const explicitScript = `node scripts/__tests__/_suite-floor.mjs && node --test ${ALL_FOUR.map((f) => `scripts/__tests__/${f}`).join(' ')}`;

test('THE REGRESSION: a glob-based gate is refused — it exits 0 on zero tests', () => {
  const problems = suiteFloorProblems({ npmScript: 'node --test "scripts/__tests__/*.test.mjs"', present: ALL_FOUR });
  assert.ok(usesGlob('node --test "scripts/__tests__/*.test.mjs"'));
  assert.ok(problems.some((p) => /GLOB/.test(p)), `expected the glob problem among:\n${problems.join('\n')}`);
});

test('a file on disk that the gate never names is refused (it would never run)', () => {
  const problems = suiteFloorProblems({ npmScript: explicitScript, present: [...ALL_FOUR, 'brand-new.test.mjs'] });
  assert.ok(problems.some((p) => p.startsWith('brand-new.test.mjs')), problems.join('\n'));
});

test('a file the gate names but that is GONE is refused — node --test skips it silently', () => {
  const problems = suiteFloorProblems({ npmScript: explicitScript, present: ALL_FOUR.slice(1) });
  assert.ok(problems.some((p) => /is NOT on disk/.test(p)), problems.join('\n'));
});

test('renaming the suite to *.spec.mjs is refused rather than reported as a pass', () => {
  const problems = suiteFloorProblems({ npmScript: explicitScript, present: [] });
  assert.ok(problems.length >= ALL_FOUR.length, problems.join('\n'));
  assert.ok(problems.every((p) => /is NOT on disk/.test(p)));
});

test('dropping below the file floor is refused', () => {
  const two = ALL_FOUR.slice(0, 2);
  const problems = suiteFloorProblems({
    npmScript: `node --test ${two.map((f) => `scripts/__tests__/${f}`).join(' ')}`,
    present: two,
  });
  assert.ok(problems.some((p) => new RegExp(`the floor is ${MINIMUM_SUITE_FILES}`).test(p)), problems.join('\n'));
});

test('a missing script entirely is refused, not treated as "nothing to check"', () => {
  assert.equal(suiteFloorProblems({ npmScript: undefined, present: ALL_FOUR }).length, 1);
  assert.equal(suiteFloorProblems({ npmScript: '', present: ALL_FOUR }).length, 1);
});

test('the guard is not vacuous: TODAY\'S real package.json + real directory are clean', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  const script = pkg.scripts['test:close-kit'];
  const present = presentTestFiles();
  assert.ok(present.length >= MINIMUM_SUITE_FILES, `only ${present.length} test file(s) found`);
  assert.deepEqual(declaredTestPaths(script).length, present.length);
  assert.deepEqual(suiteFloorProblems({ npmScript: script, present }), []);
});

test('the real gate names paths, not a glob — the Node 20 floor cannot expand one', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  assert.equal(usesGlob(pkg.scripts['test:close-kit']), false);
  assert.match(pkg.scripts['test:close-kit'], /^node scripts[/\\]__tests__[/\\]_suite-floor\.mjs &&/, 'the floor must run BEFORE the runner, chained so a failure stops the chain');
});
