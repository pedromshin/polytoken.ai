// prod-diagnose-live-bugs.mjs — the two live prod faults found 2026-08-07 evening.
//
//   BUG 1  files.requestUpload -> 500 "Something went wrong reaching your files."
//          ROOT CAUSE (identified): the `user-files` bucket is a MANUAL provisioning
//          step. Phase 66 shipped ZERO tables by design (.planning/phases/66-files-vault/
//          SCHEMA-REQUEST.md) — nothing in migrations, supabase/ or scripts/ creates the
//          bucket, so each environment needs it made by hand. It was never made on prod.
//          --apply creates it to the documented spec.
//
//   BUG 2  billing.createCheckoutSession hangs ("Starting…" forever).
//          The client handlers are correct (onError toasts, isPending clears), so a
//          permanent pending state means the request never returns — a HANG, not an error.
//          Prime suspect: checkout runs inside db.transaction + pg_advisory_xact_lock
//          (packages/billing/src/store.drizzle.ts:126-133). A previous attempt that died
//          mid-transaction, or an idle-in-transaction session, blocks every later click on
//          that user's lock forever. This reports blocked queries + held advisory locks.
//
// READ-ONLY unless --apply. --apply ONLY creates the storage bucket; it never touches the
// database, never kills a session, never writes a row. Killing a stuck backend is left to
// a human because it aborts whatever that transaction was doing.
//
// USAGE (from repo root):
//   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/prod-diagnose-live-bugs.mjs
//   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/prod-diagnose-live-bugs.mjs --apply
//
// Get the key with:  vercel env pull .env.vercel.production --environment production
// (it lives in Vercel, not in .env.production).

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const REPO = 'c:/Users/pc/Desktop/nauta.services.email-listener';
const PROD_REF = 'dazyccjijdahxyciptkp';
const COMPAT = 'uselibpqcompat=true&sslmode=require';
const BUCKET = 'user-files';
const APPLY = process.argv.includes('--apply');

const require = createRequire(`${REPO}/package.json`);
const postgres = require('postgres');

const env = {};
for (const l of readFileSync(`${REPO}/.env.production`, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Za-z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log(`mode: ${APPLY ? 'APPLY (bucket creation only)' : 'READ-ONLY'}\n`);

// ---------------------------------------------------------------- BUG 1: the bucket
console.log('=== BUG 1 — storage bucket ===');
if (!serviceKey) {
  console.log('SKIP: SUPABASE_SERVICE_ROLE_KEY not in env.');
  console.log('      vercel env pull .env.vercel.production --environment production');
} else if (!supabaseUrl || !supabaseUrl.includes(PROD_REF)) {
  console.log('ABORT: NEXT_PUBLIC_SUPABASE_URL is not the prod project.');
} else {
  const headers = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
  const res = await fetch(`${supabaseUrl}/storage/v1/bucket`, { headers });
  if (!res.ok) {
    console.log(`FAIL: bucket list -> HTTP ${res.status}. The service key may be stale.`);
  } else {
    const buckets = await res.json();
    console.log(`buckets: ${buckets.map((b) => b.name).join(', ') || '(none)'}`);
    const found = buckets.find((b) => b.name === BUCKET);
    if (found) {
      console.log(`PASS: '${BUCKET}' exists — public=${found.public}, fileSizeLimit=${found.file_size_limit}`);
      if (found.public) console.log("  ⚠ public=true DEFEATS the vault's entire tenancy argument (SCHEMA-REQUEST.md). Must be false.");
    } else if (!APPLY) {
      console.log(`FAIL: '${BUCKET}' MISSING — this is the requestUpload 500. Re-run with --apply.`);
    } else {
      // Spec is verbatim from .planning/phases/66-files-vault/SCHEMA-REQUEST.md.
      const create = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: BUCKET,
          name: BUCKET,
          public: false,              // never true — see SCHEMA-REQUEST.md
          file_size_limit: 104857600, // 100 MB
          allowed_mime_types: null,   // unrestricted
        }),
      });
      const body = await create.text();
      console.log(create.ok ? `CREATED '${BUCKET}' (private, 100MB limit)` : `FAIL: create -> HTTP ${create.status} ${body.slice(0, 200)}`);
    }
  }
}

// ---------------------------------------------------------------- BUG 2: the hang
console.log('\n=== BUG 2 — blocked queries / stuck advisory locks ===');
const base = env.POSTGRES_URL_NON_POOLING;
if (!base || !base.includes(PROD_REF)) {
  console.log('ABORT: POSTGRES_URL_NON_POOLING missing or not prod.');
} else {
  const url = base.includes('uselibpqcompat') ? base : `${base}${base.includes('?') ? '&' : '?'}${COMPAT}`;
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 20, idle_timeout: 5 });
  try {
    const idle = await sql`
      select pid, state, wait_event_type, wait_event,
             now() - xact_start as xact_age, left(coalesce(query, ''), 120) as q
      from pg_stat_activity
      where datname = current_database()
        and state in ('idle in transaction', 'idle in transaction (aborted)')
      order by xact_start`;
    console.log(`idle-in-transaction sessions: ${idle.length}`);
    for (const r of idle) console.log(`   pid=${r.pid} age=${r.xact_age} state=${r.state} :: ${r.q}`);

    const blocked = await sql`
      select pid, left(coalesce(query, ''), 120) as q,
             pg_blocking_pids(pid) as blocked_by,
             now() - query_start as waiting_for
      from pg_stat_activity
      where cardinality(pg_blocking_pids(pid)) > 0`;
    console.log(`blocked queries: ${blocked.length}`);
    for (const r of blocked) console.log(`   pid=${r.pid} waiting=${r.waiting_for} blocked_by=${r.blocked_by} :: ${r.q}`);

    const adv = await sql`
      select l.pid, l.objid, l.granted, now() - a.xact_start as held_for
      from pg_locks l left join pg_stat_activity a on a.pid = l.pid
      where l.locktype = 'advisory'`;
    console.log(`advisory locks: ${adv.length}`);
    for (const r of adv) console.log(`   pid=${r.pid} objid=${r.objid} granted=${r.granted} held_for=${r.held_for}`);

    if (idle.length === 0 && blocked.length === 0 && adv.length === 0) {
      console.log('\nVERDICT: no stuck lock right now. The hang is NOT a lingering advisory lock —');
      console.log('  look next at the Stripe call itself (a slow/hanging API request inside the');
      console.log('  transaction) or a Vercel function timeout. Re-run WHILE a click is hanging;');
      console.log('  this snapshot only shows the state at the moment it runs.');
    } else {
      console.log('\nVERDICT: contention present. A human decides whether to terminate a backend');
      console.log('  (pg_terminate_backend aborts whatever that transaction was doing).');
    }
  } catch (e) {
    console.log(`DB ERROR: ${String(e && e.message ? e.message : e).slice(0, 200)}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
