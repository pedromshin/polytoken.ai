// scripts/verify-wave1.mjs — VERIFY-ONLY post-Batch-A gate for vLAUNCH Wave 1.
//
// WHAT IT ANSWERS: "did Batch A actually land?" — per environment:
//   · migration 0061 recorded in drizzle.__drizzle_migrations (by sha256 hash)
//   · 0058-0060 recorded, and their objects really exist in the live schema
//   · graphile_worker schema installed
//   · public.enqueue_job exists, is SECURITY DEFINER, and its identifier
//     allowlist matches the set the repo's 0061 migration declares
//   · STAGING only: the journal high-water repair held (every journal entry
//     recorded, and the recorded high-water is not ahead of the journal — the
//     exact condition whose violation froze staging at 0036 on 2026-08-06)
// Plus a credential-free WORKER IMAGE section that checks the repo's own ECR
// expectations and PRINTS the aws CLI command for a human. It never calls aws.
//
// SAFETY — each line names the code that enforces it. Read the caveats; they are
// the boundary of what is actually checked.
//   1. The prod leg only connects when `--prod` was passed AND guardUrl() found
//      the prod project ref in the resolved URL. The staging leg refuses (exit 3)
//      if its URL carries the prod ref. Same guard shape as scripts/staging-repair.mjs.
//      Caveat: the guard matches on the project ref SUBSTRING, so it constrains
//      which Supabase project is reached, not which role or database within it.
//   2. openReadOnly() sets `default_transaction_read_only=on` as a startup
//      parameter, issues `SET SESSION CHARACTERISTICS ... READ ONLY`, then reads
//      the setting back and THROWS unless it is `on` — so a leg that cannot prove
//      a read-only session runs no further query. Caveat: this stops ordinary
//      writes; it would not stop a deliberately read-write transaction or a
//      SECURITY DEFINER function that writes. This script opens neither.
//   3. auditOwnSql() re-reads this file, extracts the SQL it sends, and FAILs if
//      any contains a write keyword — so the "read-only" property is checked, not
//      asserted in prose. Caveat: findWriteSql() recognises two call shapes only
//      (a postgres.js tagged template, and sql.unsafe with a single-quoted literal
//      argument), in THIS file only. SQL assembled from variables, or sent from
//      another module, would not be seen.
//   4. Credentials are read only from the env files the repo already uses or from
//      process.env, never written anywhere. maskUrl() hides user+password wherever
//      a connection string is printed, and makeRedactor() strips the password and
//      the full URL out of driver error text before it is reported. The masked
//      form deliberately KEEPS the host, so the project ref stays visible.
//
// USAGE (from repo root):
//   node scripts/verify-wave1.mjs                 # worker section + STAGING leg
//   node scripts/verify-wave1.mjs --prod          # worker section + PROD leg
//   node scripts/verify-wave1.mjs --staging --prod
//   node scripts/verify-wave1.mjs --help
//
// CREDENTIALS (first match wins per leg; nothing is ever written to disk):
//   staging : $STAGING_POSTGRES_URL_NON_POOLING  else .env.staging    POSTGRES_URL_NON_POOLING
//   prod    : $PROD_POSTGRES_URL_NON_POOLING     else .env.production POSTGRES_URL_NON_POOLING
//   Use the SESSION-mode (:5432) URL — the pooler needs
//   `?uselibpqcompat=true&sslmode=require` (see deploy-migrate-prod.yml).
//
// EXIT CODES (the contract):
//   0 every requested assertion passed
//   1 at least one assertion FAILED — Wave 1 must not start
//   2 a requested leg could not be evaluated (no credentials / no deps / connect
//     failure) — a human must look
//   3 safety refusal (a connection string pointed at the wrong project)

import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareAllowlist, compareMigrations, findWriteSql } from './lib/wave1-assertions.mjs';
import { createReport } from './lib/wave1-report.mjs';
import {
  OBJECT_CHECKS,
  REQUIRED_MIGRATION_TAGS,
  parseEnqueueAllowlist,
  readExpectedAllowlist,
  readJournalMigrations,
  readWorkerImageExpectations,
  workerImageCommands,
} from './lib/wave1-expectations.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const STAGING_REF = 'fyfwkjvbcrmjqjysdyqw';
const PROD_REF = 'dazyccjijdahxyciptkp';
const EXIT = Object.freeze({ OK: 0, FAILED: 1, UNEVALUATED: 2, REFUSED: 3 });

/** Per-leg credential resolution + project-ref guard. */
const LEGS = Object.freeze({
  staging: Object.freeze({
    scope: 'STAGING',
    envFile: '.env.staging',
    envVar: 'STAGING_POSTGRES_URL_NON_POOLING',
    requiredRef: STAGING_REF,
    forbiddenRef: PROD_REF,
  }),
  prod: Object.freeze({
    scope: 'PROD',
    envFile: '.env.production',
    envVar: 'PROD_POSTGRES_URL_NON_POOLING',
    requiredRef: PROD_REF,
    forbiddenRef: STAGING_REF,
  }),
});

const argv = process.argv.slice(2);
const wants = (flag) => argv.includes(flag);

const printUsage = () => {
  const header = readFileSync(fileURLToPath(import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('//'))
    .map((l) => l.replace(/^\/\/ ?/, ''))
    .join('\n');
  console.log(header);
};

/** @param {string} path @returns {Record<string, string>} */
const parseEnvFile = (path) => {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_0-9]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
};

/** Hides user + password; keeps the host so the project ref stays visible. */
const maskUrl = (url) => {
  try {
    const u = new URL(url);
    return `${u.protocol}//***:***@${u.host}${u.pathname}`;
  } catch {
    return '<unparseable connection string>';
  }
};

/**
 * Builds an error-to-text function that strips this leg's password and full
 * connection string out of whatever the driver put in the message. Every place
 * this script prints driver error text goes through it.
 * @param {string} url @returns {(e: unknown) => string}
 */
const makeRedactor = (url) => {
  const secrets = (() => {
    try {
      const raw = new URL(url).password;
      // Both forms: the driver may report the percent-encoded or decoded password.
      return [raw, decodeURIComponent(raw)].filter((s) => s.length > 0);
    } catch {
      return [];
    }
  })();
  return (e) => {
    const text = String((e && /** @type {Error} */ (e).message) || e);
    return [url, ...secrets].reduce((acc, secret) => acc.split(secret).join(secret === url ? maskUrl(url) : '***'), text);
  };
};

/**
 * @param {{ envFile: string, envVar: string }} leg
 * @returns {{ url: string, source: string } | { url: null, source: string }}
 */
const resolveConnection = (leg) => {
  const fromEnv = process.env[leg.envVar];
  if (fromEnv) return { url: fromEnv, source: `$${leg.envVar}` };
  const path = join(REPO, leg.envFile);
  if (!existsSync(path)) return { url: null, source: `${leg.envFile} (not present) and $${leg.envVar} (unset)` };
  const url = parseEnvFile(path).POSTGRES_URL_NON_POOLING;
  if (!url) return { url: null, source: `${leg.envFile} (POSTGRES_URL_NON_POOLING missing)` };
  return { url, source: leg.envFile };
};

/** @returns {string | null} refusal reason, or null when the URL is safe for this leg */
const guardUrl = (leg, url) => {
  if (url.includes(leg.forbiddenRef)) return `connection string contains the ${leg.forbiddenRef === PROD_REF ? 'PROD' : 'STAGING'} project ref — refusing`;
  if (!url.includes(leg.requiredRef)) return `connection string does not contain the expected project ref (${leg.requiredRef}) — refusing`;
  return null;
};

// ---------------------------------------------------------------- self-audit

/**
 * Asserts that none of the SQL this file sends writes. Enforcement, not
 * narration — see findWriteSql() for exactly what it can and cannot see.
 * @param {ReturnType<typeof createReport>} report
 */
const auditOwnSql = (report) => {
  const { literals, offenders } = findWriteSql(readFileSync(fileURLToPath(import.meta.url), 'utf8'));
  report.assert(
    'SELF',
    'no write statement in the SQL this script sends',
    offenders.length === 0,
    offenders.length === 0 ? `${literals.length} SQL literals scanned, all read-only` : `offending: ${offenders.join(' | ')}`,
  );
};

// ------------------------------------------------------------- worker image

/** @param {ReturnType<typeof createReport>} report */
const checkWorkerImage = (report) => {
  const expectations = readWorkerImageExpectations(REPO);
  report.assert('WORKER', 'terraform worker ECR repo name resolves', expectations.tfWorkerRepo.length > 0, expectations.tfWorkerRepo);
  for (const w of expectations.workflows) {
    report.assert('WORKER', `${w.env}: WORKER_ECR_REPOSITORY matches terraform`, w.repository === expectations.tfWorkerRepo, `${w.repository || '(unset)'} vs ${expectations.tfWorkerRepo}`);
    const tfTag = expectations.tfImageTags[w.env] ?? '';
    report.assert('WORKER', `${w.env}: image tag matches terraform locals`, w.tag === tfTag && tfTag !== '', `${w.tag || '(unset)'} vs ${tfTag || '(unparsed)'}`);
    report.assert('WORKER', `${w.env}: ECR push gated on WORKER_DEPLOY_ENABLED`, w.pushGated, w.file);
  }
  report.info('WORKER', 'the image itself is NOT checked here — this script never calls aws. Run:');
  for (const cmd of workerImageCommands(expectations)) report.info('WORKER', `  ${cmd}`);
  report.info('WORKER', '  (a "ImageNotFoundException" means CI has not pushed the worker image yet — flip the');
  report.info('WORKER', '   WORKER_DEPLOY_ENABLED repo variable to true and re-run the deploy workflow.)');
};

// --------------------------------------------------------------- DB queries

/** Opens a connection that the SERVER refuses to let write. Throws on failure. */
const openReadOnly = async (postgres, url) => {
  const sql = postgres(url, {
    prepare: false,
    max: 1,
    connect_timeout: 20,
    idle_timeout: 5,
    connection: { application_name: 'verify-wave1', default_transaction_read_only: 'on' },
  });
  await sql.unsafe('set session characteristics as transaction read only');
  const [row] = await sql`show default_transaction_read_only`;
  const mode = String(Object.values(row)[0]);
  if (mode !== 'on') {
    await sql.end({ timeout: 3 }).catch(() => {});
    throw new Error(`refusing to continue: session is not read-only (default_transaction_read_only=${mode})`);
  }
  return sql;
};

/**
 * @returns {Promise<{ hash: string, created_at: string }[] | null>} null when the
 * drizzle bookkeeping table is unreadable (already reported as a FAIL).
 */
const fetchAppliedMigrations = async (sql, report, scope, safe) => {
  try {
    const rows = await sql`select hash, created_at::text as created_at from drizzle.__drizzle_migrations`;
    report.assert(scope, 'drizzle.__drizzle_migrations readable', true, `${rows.length} rows recorded`);
    return rows;
  } catch (e) {
    report.assert(scope, 'drizzle.__drizzle_migrations readable', false, safe(e));
    return null;
  }
};

const verifyMigrations = (report, scope, journal, applied, requireFullJournal) => {
  const verdict = compareMigrations({ journal, applied, requiredTags: REQUIRED_MIGRATION_TAGS });
  for (const r of verdict.recorded) {
    report.assert(scope, `${r.tag} recorded`, r.ok, r.hash ? `sha256 ${r.hash.slice(0, 12)}…` : 'tag absent from journal');
  }
  const { missing, highWater, journalTop, highWaterAhead } = verdict;
  if (requireFullJournal) {
    report.assert(scope, 'every journal entry recorded', missing.length === 0, missing.length === 0 ? `${journal.length}/${journal.length}` : `missing: ${missing.join(', ')}`);
    report.assert(
      scope,
      'recorded high-water not ahead of journal',
      !highWaterAhead,
      `high-water ${highWater} vs journal top ${journalTop}${highWaterAhead ? ' — the next generated migration would be SKIPPED by drizzle' : ''}`,
    );
  } else {
    report.info(scope, `journal coverage: ${journal.length - missing.length}/${journal.length} recorded${missing.length ? ` (not recorded: ${missing.join(', ')})` : ''}`);
    report.info(scope, `recorded high-water ${highWater}; journal top ${journalTop}`);
  }
};

const verifyObjects = async (sql, report, scope) => {
  const tables = OBJECT_CHECKS.filter((c) => c.kind === 'table');
  const columns = OBJECT_CHECKS.filter((c) => c.kind === 'column');
  const foundTables = new Set(
    (await sql`select table_name from information_schema.tables where table_schema = 'public' and table_name = any(${tables.map((c) => c.table)})`).map((r) => r.table_name),
  );
  for (const c of tables) report.assert(scope, `${c.migration}: public.${c.table} exists`, foundTables.has(c.table), '');
  for (const c of columns) {
    const rows = await sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${c.table} and column_name = ${c.column}`;
    report.assert(scope, `${c.migration}: public.${c.table}.${c.column} exists`, rows.length === 1, '');
  }
};

const verifyGraphileSchema = async (sql, report, scope) => {
  const rows = await sql`select 1 as present from pg_namespace where nspname = 'graphile_worker'`;
  report.assert(scope, 'graphile_worker schema present', rows.length === 1, rows.length === 1 ? '' : 'install it FIRST — 0061 raises without it');
};

const ENQUEUE_SIGNATURE = 'enqueue_job(text,jsonb,integer,text)';

const verifyEnqueueJob = async (sql, report, scope, expected) => {
  const rows = await sql`
    select p.oid::regprocedure::text as signature,
           p.prosecdef                as security_definer,
           pg_get_functiondef(p.oid)  as definition,
           has_function_privilege('public', p.oid, 'EXECUTE') as public_execute,
           (select exists (select 1 from pg_roles where rolname = 'service_role')) as service_role_exists,
           case when exists (select 1 from pg_roles where rolname = 'service_role')
                then has_function_privilege('service_role', p.oid, 'EXECUTE') end as service_role_execute
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enqueue_job'`;

  const fn = rows.find((r) => r.signature.replace(/\s/g, '').endsWith(ENQUEUE_SIGNATURE));
  report.assert(scope, `public.${ENQUEUE_SIGNATURE} exists`, Boolean(fn), rows.length ? `overloads: ${rows.map((r) => r.signature).join(', ')}` : 'no public.enqueue_job at all');
  if (!fn) return;

  report.assert(scope, 'enqueue_job is SECURITY DEFINER', fn.security_definer === true, '');
  const live = parseEnqueueAllowlist(fn.definition);
  const { missing, extra, covered } = compareAllowlist({ expected, live });
  report.assert(scope, 'allowlist covers the repo 0061 set', covered, missing.length ? `missing: ${missing.join(', ')}` : `${live.length} identifiers: ${live.join(', ')}`);
  report.assert(scope, 'allowlist has no identifiers the repo does not declare', extra.length === 0, extra.length ? `extra: ${extra.join(', ')} — the live DB is ahead of this checkout; pull and re-run` : '');
  report.assert(scope, 'enqueue_job not EXECUTE-able by PUBLIC', fn.public_execute === false, fn.public_execute ? '0061 REVOKEs it from public — that revoke did not stick' : '');
  if (fn.service_role_exists) report.assert(scope, 'enqueue_job EXECUTE granted to service_role', fn.service_role_execute === true, '');
  else report.skip(scope, 'enqueue_job EXECUTE granted to service_role', 'no service_role role on this database');
};

// ------------------------------------------------------------------- legs

/**
 * Runs one environment's leg.
 * @returns {Promise<'evaluated'|'unevaluated'|'refused'>}
 */
const runLeg = async (postgres, legKey, report, journal, expectedAllowlist) => {
  const leg = LEGS[legKey];
  const { scope } = leg;
  const { url, source } = resolveConnection(leg);
  if (!url) {
    report.skip(scope, 'connection', `no connection string — checked ${source}`);
    return 'unevaluated';
  }
  const refusal = guardUrl(leg, url);
  if (refusal) {
    report.assert(scope, 'connection string targets the expected project', false, `${refusal} (${maskUrl(url)})`);
    return 'refused';
  }

  const safe = makeRedactor(url);
  let sql;
  try {
    sql = await openReadOnly(postgres, url);
  } catch (e) {
    report.skip(scope, 'connection', `${maskUrl(url)} from ${source}: ${safe(e)}`);
    return 'unevaluated';
  }

  try {
    const [{ db }] = await sql`select current_database() as db`;
    report.assert(scope, 'read-only session established', true, `db=${db} via ${maskUrl(url)} (${source})`);
    const applied = await fetchAppliedMigrations(sql, report, scope, safe);
    if (applied) verifyMigrations(report, scope, journal, applied, legKey === 'staging');
    await verifyObjects(sql, report, scope);
    await verifyGraphileSchema(sql, report, scope);
    await verifyEnqueueJob(sql, report, scope, expectedAllowlist);
    return 'evaluated';
  } catch (e) {
    report.skip(scope, 'leg aborted', safe(e));
    return 'unevaluated';
  } finally {
    await sql.end({ timeout: 3 }).catch(() => {});
  }
};

/** Loads `postgres` lazily so a credential-free run still reports cleanly. */
const loadPostgres = (report) => {
  try {
    return createRequire(join(REPO, 'package.json'))('postgres');
  } catch (e) {
    report.skip('DB', 'driver', `cannot load the 'postgres' driver (${String(e.code || e.message || e)}) — run \`npm ci\` at the repo root`);
    return null;
  }
};

const main = async () => {
  if (wants('--help') || wants('-h')) {
    printUsage();
    return EXIT.OK;
  }

  const runProd = wants('--prod');
  const runStaging = wants('--staging') || !runProd;
  const report = createReport();

  console.log(`verify-wave1 — legs: ${[runStaging && 'staging', runProd && 'prod'].filter(Boolean).join(' + ') || 'none'} + worker (repo-only)\n`);
  auditOwnSql(report);
  checkWorkerImage(report);

  /** @type {string[]} */
  const outcomes = [];
  if (runStaging || runProd) {
    const journal = readJournalMigrations(REPO);
    const expectedAllowlist = readExpectedAllowlist(REPO);
    report.info('REPO', `journal: ${journal.length} migrations; 0061 allowlist: ${expectedAllowlist.length} identifiers`);
    const postgres = loadPostgres(report);
    if (!postgres) outcomes.push('unevaluated');
    else {
      if (runStaging) outcomes.push(await runLeg(postgres, 'staging', report, journal, expectedAllowlist));
      if (runProd) outcomes.push(await runLeg(postgres, 'prod', report, journal, expectedAllowlist));
    }
  }
  if (!runProd) report.info('PROD', 'leg not requested — pass --prod (and a prod-ref connection string) to check production');

  const { pass, fail, skip } = report.counts();
  console.log(`\n${report.render()}\n`);
  console.log(`PASS ${pass}   FAIL ${fail}   SKIP ${skip}`);

  if (outcomes.includes('refused')) return EXIT.REFUSED;
  if (report.hasFailure()) return EXIT.FAILED;
  if (outcomes.includes('unevaluated')) return EXIT.UNEVALUATED;
  return EXIT.OK;
};

const code = await main().catch((e) => {
  console.error(`ABORT: ${String(e.stack || e.message || e)}`);
  return EXIT.UNEVALUATED;
});
console.log(`exit ${code}`);
process.exit(code);
