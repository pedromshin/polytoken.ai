// scripts/staging-repair.mjs — repair staging migration drift (2026-08-06 diagnosis).
//
// WHAT: staging is frozen at 0036 (last drizzle row created_at=1784227200000 =
// 2026-07-16T18:40:00Z). Journal entries 0037/0038/0039 carry drizzle-generated
// `when` timestamps EARLIER than 0036's hand-set stamp, so drizzle's migrator
// ("apply only entries whose when > newest created_at") skips them forever and
// then crashes applying 0040_documents, whose FK references chat_source_ledger
// — a table only 0037 creates.
//
// WHAT THIS DOES: applies every journal migration not yet recorded in
// drizzle.__drizzle_migrations (matched by sha256 hash — the exact value the
// drizzle migrator stores), IN JOURNAL ORDER, one transaction per migration,
// and inserts the journal row exactly the way drizzle does:
//   insert into drizzle.__drizzle_migrations ("hash","created_at")
//   values (sha256(fileBytes), journalEntry.when)
// Idempotent: re-running skips anything already recorded; a failed migration
// rolls back atomically and the script aborts so a rerun resumes at the same
// point.
//
// PREREQ HANDLED IN-SCRIPT: staging's graphile_worker schema is ABSENT
// (verified 2026-08-06), and 0053/0054/0061 RAISE EXCEPTION without it. Before
// applying those, this script runs graphile-worker's own idempotent schema
// migrate (same mechanism as apps/worker/src/install-schema.ts, same
// POSTGRES_URL_NON_POOLING role).
//
// USAGE (from repo root):
//   node scripts/staging-repair.mjs           # DRY RUN — prints the plan, writes nothing
//   node scripts/staging-repair.mjs --yes     # APPLY
//
// FINAL GREEN CHECK after --yes succeeds:
//   npm run db:migrate:staging
// (must print "Running migrations..." then complete with 0 pending — that is
// the authoritative confirmation that drizzle's own migrator is green again.)

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS_DIR = join(REPO, 'packages/db/migrations');
const JOURNAL_PATH = join(MIGRATIONS_DIR, 'meta/_journal.json');
const ENV_STAGING = join(REPO, '.env.staging');
const STAGING_REF = 'fyfwkjvbcrmjqjysdyqw'; // staging project ref (required in URL)
const PROD_REF = 'dazyccjijdahxyciptkp'; // prod project ref (hard refusal)

const APPLY = process.argv.includes('--yes');

const require = createRequire(join(REPO, 'package.json'));
const postgres = require('postgres');

// Migrations whose DO-block guard requires the graphile_worker schema.
const NEEDS_GRAPHILE = new Set([
  '0053_graphile_enqueue_wrapper',
  '0054_enqueue_allowlist_morning_board',
  '0061_enqueue_allowlist_cascade_recipe',
]);

const parseEnv = (p) => {
  const out = {};
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_0-9]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
};

const url = parseEnv(ENV_STAGING).POSTGRES_URL_NON_POOLING;
if (!url) {
  console.error('ABORT: POSTGRES_URL_NON_POOLING missing from .env.staging');
  process.exit(1);
}
if (url.includes(PROD_REF)) {
  console.error('ABORT: URL contains the PROD project ref. Refusing to touch prod.');
  process.exit(1);
}
if (!url.includes(STAGING_REF)) {
  console.error(`ABORT: URL does not contain the staging project ref (${STAGING_REF}).`);
  process.exit(1);
}

const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8'));

// Build migration list exactly like drizzle's readMigrationFiles:
// hash = sha256 hex of the raw file bytes; statements split on the literal
// '--> statement-breakpoint' marker (all journal entries have breakpoints:true).
const migrations = journal.entries.map((entry) => {
  const file = readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`)).toString();
  return {
    tag: entry.tag,
    when: entry.when,
    hash: createHash('sha256').update(file).digest('hex'),
    statements: file
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  };
});

const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 20, idle_timeout: 5 });

try {
  const [{ db }] = await sql`select current_database() as db`;
  console.log(`Connected to staging (db=${db}) — mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  const applied = await sql`select hash, created_at from drizzle.__drizzle_migrations`;
  const appliedHashes = new Set(applied.map((r) => r.hash));
  console.log(`drizzle.__drizzle_migrations: ${applied.length} rows recorded`);

  const pending = migrations.filter((m) => !appliedHashes.has(m.hash));
  if (pending.length === 0) {
    console.log('Nothing pending — staging already matches the journal.');
    console.log('Final green check: npm run db:migrate:staging');
    process.exit(0);
  }

  console.log(`\nPending (journal order): ${pending.length} migrations`);
  for (const m of pending) {
    console.log(`  ${m.tag}  when=${m.when} (${new Date(m.when).toISOString()})  statements=${m.statements.length}`);
  }

  const graphileNeeded = pending.some((m) => NEEDS_GRAPHILE.has(m.tag));
  const [gw] = await sql`select 1 as present from pg_namespace where nspname = 'graphile_worker'`;
  const graphilePresent = Boolean(gw);
  if (graphileNeeded) {
    console.log(`\ngraphile_worker schema: ${graphilePresent ? 'PRESENT' : 'ABSENT — will be installed before 0053 (graphile-worker\'s own idempotent migrate)'}`);
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --yes to apply.');
    process.exit(0);
  }

  console.log('');
  let graphileInstalled = graphilePresent;
  for (const m of pending) {
    if (NEEDS_GRAPHILE.has(m.tag) && !graphileInstalled) {
      // Same mechanism as apps/worker/src/install-schema.ts: graphile-worker
      // migrates its own schema, idempotently, over the same URL/role.
      console.log('Installing graphile_worker schema (graphile-worker utils.migrate)...');
      const { makeWorkerUtils } = require('graphile-worker');
      const utils = await makeWorkerUtils({ connectionString: url });
      try {
        await utils.migrate();
      } finally {
        await utils.release();
      }
      graphileInstalled = true;
      console.log('graphile_worker schema installed.');
    }
    const start = Date.now();
    try {
      await sql.begin(async (tx) => {
        for (let i = 0; i < m.statements.length; i += 1) {
          try {
            await tx.unsafe(m.statements[i]);
          } catch (e) {
            throw new Error(`${m.tag} statement ${i + 1}/${m.statements.length} failed: ${String(e.message || e)}`);
          }
        }
        // Journal row — identical shape to drizzle-orm's migrator insert.
        await tx`insert into drizzle.__drizzle_migrations ("hash", "created_at") values (${m.hash}, ${m.when})`;
      });
      console.log(`APPLIED  ${m.tag}  (${m.statements.length} statements, ${Date.now() - start}ms)`);
    } catch (e) {
      console.error(`\nFAILED   ${m.tag} — transaction rolled back, nothing from this migration persisted.`);
      console.error(String(e.message || e));
      console.error('Fix the cause and re-run this script; already-applied migrations will be skipped.');
      process.exit(1);
    }
  }

  // Post-repair verification (read-only).
  const [{ n }] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
  const keyTables = ['chat_source_ledger', 'canvas_recipes', 'code_islands', 'correction_propagations', 'subscriptions'];
  const present = await sql`select table_name from information_schema.tables where table_schema='public' and table_name = any(${keyTables})`;
  const set = new Set(present.map((t) => t.table_name));
  console.log(`\nJournal rows now: ${n} (expected ${migrations.length})`);
  for (const t of keyTables) console.log(`  ${set.has(t) ? 'PRESENT' : 'MISSING'}  ${t}`);

  console.log('\nDone. FINAL GREEN CHECK — run from repo root:');
  console.log('  npm run db:migrate:staging');
  console.log('It must complete green with nothing pending.');
} catch (e) {
  console.error(`ABORT: ${String(e.message || e)}`);
  process.exit(1);
} finally {
  await sql.end({ timeout: 3 }).catch(() => {});
}
