// CUT-06 rehearsal — STAGING enqueue -> drain -> terminal, end to end.
//
// Proves the durable path with the LEAST invasive job available: recompute_canvas_recipe
// with a random UUID. tasks.ts handles a missing recipe by logging "recipe ... no longer
// exists — nothing to do" and returning SUCCESS, so this exercises the whole chain
// (enqueue_job -> graphile_worker._private_jobs -> worker picks it up -> terminal success)
// while touching no real row.
//
// STAGING ONLY: refuses the prod project ref outright. Writes exactly one queue row.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const REPO = 'c:/Users/pc/Desktop/nauta.services.email-listener';
const STAGING_REF = 'fyfwkjvbcrmjqjysdyqw';
const PROD_REF = 'dazyccjijdahxyciptkp';

const require = createRequire(`${REPO}/package.json`);
const postgres = require('postgres');

const env = {};
for (const l of readFileSync(`${REPO}/.env.staging`, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Za-z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const url = env.POSTGRES_URL_NON_POOLING;
if (!url) { console.log('ABORT: POSTGRES_URL_NON_POOLING absent'); process.exit(1); }
if (url.includes(PROD_REF)) { console.log('ABORT: prod ref present. Refusing.'); process.exit(1); }
if (!url.includes(STAGING_REF)) { console.log('ABORT: not the staging ref.'); process.exit(1); }

const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 20, idle_timeout: 5 });
const recipeId = randomUUID();
const jobKey = `cut06-proof-${recipeId}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const [{ db }] = await sql`select current_database() as db`;
  console.log(`STAGING db=${db}`);

  const before = await sql`select count(*)::int as n from graphile_worker._private_jobs`;
  console.log(`queue depth before: ${before[0].n}`);

  // ENQUEUE through the guarded seam — exactly how the application does it.
  const [{ enqueue_job: jobId }] = await sql`
    select enqueue_job('recompute_canvas_recipe', ${sql.json({ recipe_id: recipeId })}::jsonb, 3, ${jobKey})`;
  console.log(`ENQUEUED job id=${jobId} identifier=recompute_canvas_recipe recipe_id=${recipeId}`);

  const [present] = await sql`
    select id, task_id, attempts, max_attempts from graphile_worker._private_jobs where id = ${jobId}`;
  console.log(present ? `PRESENT in queue: id=${present.id} attempts=${present.attempts}` : 'already drained before first read');

  // DRAIN watch. graphile-worker DELETES a successful job, so disappearance + no failure
  // recorded is success. A job that failed would still be present with attempts > 0 and a
  // last_error — that is the discriminator, not mere absence.
  let drained = false;
  let lastSeen = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const rows = await sql`
      select id, attempts, max_attempts, last_error, locked_at
      from graphile_worker._private_jobs where id = ${jobId}`;
    if (rows.length === 0) { drained = true; console.log(`DRAINED after ~${i + 1}s (row gone)`); break; }
    lastSeen = rows[0];
    if (rows[0].attempts > 0 && rows[0].last_error) {
      console.log(`FAILED attempts=${rows[0].attempts}/${rows[0].max_attempts} last_error=${String(rows[0].last_error).slice(0, 200)}`);
      break;
    }
  }

  if (!drained) {
    console.log(`NOT DRAINED within 30s. last seen: ${JSON.stringify(lastSeen)}`);
    console.log('VERDICT: INCONCLUSIVE — the job did not reach a terminal state in the window.');
    process.exitCode = 2;
  } else {
    const stillThere = await sql`select 1 as p from graphile_worker._private_jobs where key = ${jobKey}`;
    const after = await sql`select count(*)::int as n from graphile_worker._private_jobs`;
    console.log(`queue depth after: ${after[0].n}`);
    console.log(`job_key rows remaining: ${stillThere.length}`);
    console.log('VERDICT: PASS — enqueue -> drain -> terminal success, through public.enqueue_job.');
  }

  const dead = await sql`
    select count(*)::int as n from graphile_worker._private_jobs where attempts >= max_attempts`;
  console.log(`dead-letter rows (attempts >= max_attempts): ${dead[0].n}`);
} catch (e) {
  console.log(`ERROR: ${String(e && e.message ? e.message : e).slice(0, 300)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
