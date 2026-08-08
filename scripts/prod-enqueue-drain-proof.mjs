// prod-enqueue-drain-proof.mjs — CUT-08 pre-flight: prove the DEPLOYED prod worker
// actually drains before INGEST_ENQUEUE_ENABLED is ever flipped.
//
// Uses the least invasive job available: recompute_canvas_recipe with a random UUID.
// tasks.ts treats a missing recipe row as SUCCESS, so this touches NO domain data --
// it writes exactly one queue row and watches it reach a terminal state.
//
// This is the prod sibling of staging-enqueue-drain-proof.mjs, and it inverts that
// script's guard: this one REFUSES anything that is not the prod ref, so it can never
// be pointed at the wrong database by accident.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const REPO = 'c:/Users/pc/Desktop/nauta.services.email-listener';
const PROD_REF = 'dazyccjijdahxyciptkp';
const require = createRequire(`${REPO}/package.json`);
const postgres = require('postgres');

const env = {};
for (const l of readFileSync(`${REPO}/.env.production`, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const url = env.POSTGRES_URL_NON_POOLING;
if (!url || !url.includes(PROD_REF)) {
  console.log('ABORT: this script is prod-only and the URL is not the prod project.');
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 20, idle_timeout: 5 });
const key = `cut08-proof:${randomUUID()}`;
try {
  await sql`SELECT public.enqueue_job('recompute_canvas_recipe', ${sql.json({ recipe_id: randomUUID() })}::jsonb, 8, ${key})`;
  console.log(`enqueued ${key}`);

  let terminal = null;
  for (let i = 0; i < 40; i++) {
    const rows = await sql`
      SELECT attempts, max_attempts, last_error
      FROM graphile_worker._private_jobs
      WHERE key = ${key}`;
    if (rows.length === 0) { terminal = 'DRAINED'; break; }      // row gone = completed OK
    if (rows[0].last_error) { terminal = `FAILED: ${rows[0].last_error}`; break; }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (terminal === 'DRAINED') {
    console.log('PASS: the deployed prod worker picked the job up and completed it.');
    console.log('      Durable path is live end to end. CUT-08 (enqueue flip) is now safe.');
  } else {
    console.log(`FAIL: ${terminal ?? 'still pending after 20s -- nothing is draining the queue'}`);
    console.log('      DO NOT flip INGEST_ENQUEUE_ENABLED.');
    process.exitCode = 1;
  }
} finally {
  await sql.end({ timeout: 5 });
}
