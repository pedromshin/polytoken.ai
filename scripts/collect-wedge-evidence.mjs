// scripts/collect-wedge-evidence.mjs — WEDG-02 (CPF-live) evidence collector.
//
// WHAT IT ASSERTS, after a real confirmed merge has cascaded on real mail: the four links of
// the CPF-live evidence chain, against the database, not against terminal output.
//
//   E1  one `correction_propagations` ledger row exists for the (survivor, absorbed) pair
//   E2  that row has the expected shape (job_key `cascade:{S}:{T}`, importer scope, id sets)
//   E3  `affected_email_ids` is NON-EMPTY — the re-label fan-out actually had work to do
//   E4  every id in `promoted_edge_ids` is now an ACTIVE, EXTRACTED `knowledge_node_edges` row
//       whose `promotion->>'mechanism'` is `merge_cascade`
//   E5  no duplicate ledger row for the same cascade (idempotency, see the caveat under E5)
//
// It then prints an evidence block ready to paste into the WEDG-02 artifact.
//
// READ-ONLY: enforced by Postgres, not by this comment — every statement runs inside a
// `set transaction read only` transaction opened by scripts/lib/close-kit-db.mjs. A write
// would raise SQLSTATE 25006 rather than land.
//
// USAGE (from the repo root):
//   node scripts/collect-wedge-evidence.mjs --env .env.production --allow-prod
//   node scripts/collect-wedge-evidence.mjs --env .env.local --survivor <uuid> --absorbed <uuid>
//   node scripts/collect-wedge-evidence.mjs --env .env.production --allow-prod \
//        --job-key cascade:<survivor>:<absorbed> --expect-fingerprint <hex-from-previous-run>
//
//   --survivor/--absorbed   the merge to assert (composes the job key)
//   --job-key               select by job key instead
//   (neither)               select the MOST RECENT cascade row and say so loudly
//   --allow-zero-promotions downgrade E4's "this cascade promoted no edges" to a WARNING
//   --expect-fingerprint    assert this run's fingerprint equals a previous run's (see E5)
//
// EXIT CODES: 0 all links held · 1 a link FAILED · 2 config/usage refusal · 4 runtime error.

import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  ConfigError,
  EXIT,
  closeQuietly,
  describeTarget,
  isUuid,
  openReadOnly,
  readArgs,
  readOnlyTx,
  resolveDatabaseUrl,
} from './lib/close-kit-db.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CASCADE_MECHANISM = 'merge_cascade'; // apps/email-listener/.../cascade_correction.py:44
const EXTRACTED = 'EXTRACTED'; // the tier promote_edge writes (knowledge_graph_repository.py:359)

const args = readArgs(process.argv.slice(2));
const checks = [];
const notes = [];

/** Record one assertion. `ok === null` means "informational only, never gates the exit code". */
const record = (id, label, ok, detail) => {
  checks.push({ id, label, ok, detail });
};

// ---------------------------------------------------------------------------
// Row selection
// ---------------------------------------------------------------------------

async function selectCascade(tx) {
  if (args['job-key']) {
    const rows = await tx`
      select * from correction_propagations where job_key = ${args['job-key']}`;
    return { rows, how: `job_key = ${args['job-key']}` };
  }
  if (args.survivor || args.absorbed) {
    if (!isUuid(args.survivor) || !isUuid(args.absorbed)) {
      throw new ConfigError('--survivor and --absorbed must BOTH be uuids.');
    }
    const rows = await tx`
      select * from correction_propagations
      where survivor_entity_instance_id = ${args.survivor}
        and absorbed_entity_instance_id = ${args.absorbed}
      order by created_at`;
    return { rows, how: `pair (survivor=${args.survivor}, absorbed=${args.absorbed})` };
  }
  const latest = await tx`
    select * from correction_propagations order by created_at desc limit 1`;
  if (latest.length === 0) return { rows: [], how: 'most recent cascade (none exist)' };
  const pair = await tx`
    select * from correction_propagations
    where survivor_entity_instance_id = ${latest[0].survivor_entity_instance_id}
      and absorbed_entity_instance_id = ${latest[0].absorbed_entity_instance_id}
    order by created_at`;
  return { rows: pair, how: `most recent cascade (created_at ${latest[0].created_at.toISOString()})` };
}

// ---------------------------------------------------------------------------
// The five links
// ---------------------------------------------------------------------------

function assertLedgerRow(rows, how) {
  record(
    'E1',
    'exactly one correction_propagations row for this cascade',
    rows.length === 1,
    rows.length === 1
      ? `selected by ${how}`
      : `found ${rows.length} row(s) by ${how} — 0 means the cascade never wrote its ledger (flag dark, or it failed before step 3); >1 means the pair was double-recorded under different job keys`,
  );
  return rows[0] ?? null;
}

function assertRowShape(row) {
  const expectedKey = `cascade:${row.survivor_entity_instance_id}:${row.absorbed_entity_instance_id}`;
  const problems = [];
  if (row.job_key !== expectedKey) problems.push(`job_key is "${row.job_key}", expected "${expectedKey}"`);
  if (!row.importer_id) problems.push('importer_id is null (importer-scoped by schema — a null here is a broken write)');
  if (row.survivor_entity_instance_id === row.absorbed_entity_instance_id) problems.push('survivor == absorbed');
  if (!Array.isArray(row.affected_email_ids)) problems.push('affected_email_ids is not a json array');
  if (!Array.isArray(row.promoted_edge_ids)) problems.push('promoted_edge_ids is not a json array');
  record(
    'E2',
    'ledger row has the expected shape',
    problems.length === 0,
    problems.length === 0
      ? `id=${row.id} importer=${row.importer_id} job_key=${row.job_key} created_at=${row.created_at.toISOString()}`
      : problems.join('; '),
  );
}

function assertAffectedEmails(row) {
  const ids = Array.isArray(row.affected_email_ids) ? row.affected_email_ids : [];
  record(
    'E3',
    'affected_email_ids is non-empty (the fan-out had real mail to re-label)',
    ids.length > 0,
    ids.length > 0
      ? `${ids.length} email id(s) enqueued for re-label`
      : 'empty — the absorbed identity had no past emails, so this cascade proves nothing about the re-label leg; pick a merge whose absorbed identity actually appears on mail',
  );
  return ids;
}

async function assertEdgesFlipped(tx, row) {
  const ids = Array.isArray(row.promoted_edge_ids) ? row.promoted_edge_ids : [];
  const malformed = ids.filter((id) => !isUuid(id));
  if (malformed.length > 0) {
    record('E4', `promoted edges are EXTRACTED with mechanism='${CASCADE_MECHANISM}'`, false,
      `promoted_edge_ids contains ${malformed.length} non-uuid member(s) — refusing to cast`);
    return [];
  }
  if (ids.length === 0) {
    const tolerated = Boolean(args['allow-zero-promotions']);
    record('E4', `promoted edges are EXTRACTED with mechanism='${CASCADE_MECHANISM}'`, tolerated ? null : false,
      'this cascade promoted ZERO edges, so the edge-promotion leg is UNPROVEN here (not necessarily broken — the merge may have had no active INFERRED/AMBIGUOUS suggestion edges). Re-run against a cascade that promoted edges, or pass --allow-zero-promotions to accept this deliberately.');
    return [];
  }
  const edges = await tx`
    select id, tier, is_active,
           promotion->>'mechanism' as mechanism,
           promotion->>'from_tier'  as from_tier,
           promotion->>'promoted_at' as promoted_at
    from knowledge_node_edges
    where id = any(${ids}::uuid[])`;
  const byId = new Map(edges.map((e) => [e.id, e]));
  const bad = [];
  for (const id of ids) {
    const edge = byId.get(id);
    if (!edge) bad.push(`${id}: row missing`);
    else if (edge.tier !== EXTRACTED) bad.push(`${id}: tier=${edge.tier}`);
    else if (edge.is_active !== true) bad.push(`${id}: is_active=false`);
    else if (edge.mechanism !== CASCADE_MECHANISM) bad.push(`${id}: mechanism=${edge.mechanism ?? 'null'}`);
  }
  record('E4', `promoted edges are EXTRACTED with mechanism='${CASCADE_MECHANISM}'`, bad.length === 0,
    bad.length === 0
      ? `${ids.length}/${ids.length} promoted edge(s) verified (from_tier: ${[...new Set(edges.map((e) => e.from_tier ?? '?'))].join(', ')})`
      : bad.join('; '));
  return edges;
}

async function assertNoDuplicate(tx, row, pairRowCount) {
  const [{ n }] = await tx`
    select count(*)::int as n from correction_propagations where job_key = ${row.job_key}`;
  const ok = n === 1 && pairRowCount === 1;
  record('E5', 'no duplicate ledger row for this cascade (idempotency evidence)', ok,
    ok
      ? `1 row for job_key and 1 for the pair. NOTE: the unique index uq_correction_propagations_job_key makes the job_key half structural; the PAIR count is the part this check adds. A true re-run no-op is proven by re-confirming the merge and re-running this script with --expect-fingerprint (below).`
      : `job_key rows=${n}, pair rows=${pairRowCount} — a re-run wrote a second row, so the ON CONFLICT DO NOTHING path did not hold`);
}

// ---------------------------------------------------------------------------
// Informational reads (never gate the exit code)
// ---------------------------------------------------------------------------

async function relabelEffect(tx, row, emailIds) {
  const ids = emailIds.filter(isUuid);
  if (ids.length === 0) return null;
  const [{ n }] = await tx`
    select count(distinct c.email_id)::int as n
    from component_entity_candidate_links l
    join email_components c on c.id = l.component_id
    where l.entity_instance_id = ${row.survivor_entity_instance_id}
      and c.email_id = any(${ids}::uuid[])`;
  return { linked: n, total: ids.length };
}

async function failedRelabelJobs(sql, jobKey) {
  // Own transaction + guarded: a successfully drained graphile job row is DELETED, so a
  // SURVIVING row with this key is failure evidence. Absence of the schema is not a failure.
  try {
    return await readOnlyTx(sql, async (tx) => {
      const [present] = await tx`select 1 as ok from pg_namespace where nspname = 'graphile_worker'`;
      if (!present) return { schema: false, rows: [] };
      const rows = await tx`
        select task_identifier, key, attempts, max_attempts, last_error
        from graphile_worker.jobs
        where key = ${jobKey}`;
      return { schema: true, rows };
    });
  } catch (error) {
    notes.push(`graphile_worker probe skipped: ${String(error.message || error)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * A short digest of everything this cascade touched. Arrays are sorted so row order can never
 * move it; re-running after a re-confirm and getting the SAME digest is what actually proves
 * the re-run was a no-op (the ledger's unique index only proves no second row).
 */
function fingerprintOf(row, edges) {
  const payload = {
    job_key: row.job_key,
    importer_id: row.importer_id,
    promoted_edge_ids: [...(row.promoted_edge_ids ?? [])].sort(),
    affected_email_ids: [...(row.affected_email_ids ?? [])].sort(),
    edges: edges
      .map((e) => `${e.id}|${e.tier}|${e.is_active}|${e.mechanism ?? ''}`)
      .sort(),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

function printReport({ target, how, row, edges, effect, jobs, fingerprint }) {
  const gating = checks.filter((c) => c.ok !== null);
  const failed = gating.filter((c) => !c.ok);
  console.log(`\nWEDG-02 / CPF-live evidence — target: ${target}`);
  console.log(`selection: ${how}\n`);
  for (const c of checks) {
    const mark = c.ok === null ? 'WARN' : c.ok ? 'PASS' : 'FAIL';
    console.log(`${mark}  ${c.id}  ${c.label}`);
    console.log(`      ${c.detail}`);
  }
  for (const note of notes) console.log(`note: ${note}`);

  if (!row) {
    console.log('\nNo ledger row selected — nothing further to report.');
    return failed.length;
  }

  console.log('\n--- PASTE-READY EVIDENCE BLOCK -------------------------------------------');
  console.log(`### WEDG-02 — CPF-live evidence (${new Date().toISOString()})`);
  console.log('');
  console.log(`- target: \`${target}\``);
  console.log(`- cascade: \`${row.job_key}\``);
  console.log(`- ledger row: \`${row.id}\` · importer \`${row.importer_id}\` · created_at \`${row.created_at.toISOString()}\``);
  console.log(`- promoted edges: ${(row.promoted_edge_ids ?? []).length} · verified EXTRACTED/${CASCADE_MECHANISM}: ${edges.filter((e) => e.tier === EXTRACTED && e.mechanism === CASCADE_MECHANISM).length}`);
  console.log(`- affected emails: ${(row.affected_email_ids ?? []).length}`);
  if (effect) console.log(`- emails whose components now link the SURVIVOR: ${effect.linked}/${effect.total} (informational — reprocess supersedes only its own pending set)`);
  if (jobs && jobs.schema) {
    console.log(`- surviving \`cascade_relabel\` job rows for this key: ${jobs.rows.length}${jobs.rows.length === 0 ? ' (drained successfully — graphile deletes completed jobs)' : ' — FAILURE EVIDENCE, read last_error'}`);
    for (const j of jobs.rows) console.log(`  - ${j.task_identifier} attempts=${j.attempts}/${j.max_attempts} last_error=${String(j.last_error ?? '').slice(0, 200)}`);
  } else if (jobs && !jobs.schema) {
    console.log('- graphile_worker schema absent on this database (job-row evidence unavailable)');
  }
  console.log(`- fingerprint: \`${fingerprint}\``);
  console.log(`- verdict: ${failed.length === 0 ? 'CHAIN COMPLETE' : `INCOMPLETE — ${failed.map((c) => c.id).join(', ')} failed`}`);
  console.log('');
  console.log('Idempotency re-run: re-confirm the same merge, then');
  console.log(`\`node scripts/collect-wedge-evidence.mjs --job-key ${row.job_key} --expect-fingerprint ${fingerprint}\``);
  console.log('--------------------------------------------------------------------------');
  return failed.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let sql = null;
try {
  const { url, from } = resolveDatabaseUrl({
    envFile: typeof args.env === 'string' ? args.env : null,
    allowProd: Boolean(args['allow-prod']),
  });
  const target = describeTarget(url);
  console.log(`credentials from: ${from}`);
  sql = await openReadOnly(REPO, url);

  const result = await readOnlyTx(sql, async (tx) => {
    const { rows, how } = await selectCascade(tx);
    const row = assertLedgerRow(rows, how);
    if (!row) return { how, row: null, edges: [], effect: null };
    assertRowShape(row);
    const emailIds = assertAffectedEmails(row);
    const edges = await assertEdgesFlipped(tx, row);
    await assertNoDuplicate(tx, row, rows.length);
    const effect = await relabelEffect(tx, row, emailIds);
    return { how, row, edges, effect };
  });

  const jobs = result.row ? await failedRelabelJobs(sql, result.row.job_key) : null;
  const fingerprint = result.row ? fingerprintOf(result.row, result.edges) : null;

  if (typeof args['expect-fingerprint'] === 'string') {
    record('E6', 'fingerprint matches the previous run (re-run was a no-op)',
      fingerprint === args['expect-fingerprint'],
      fingerprint === args['expect-fingerprint']
        ? `unchanged: ${fingerprint}`
        : `expected ${args['expect-fingerprint']}, got ${fingerprint} — the re-run CHANGED the cascade's footprint`);
  }

  const failures = printReport({ target, ...result, jobs, fingerprint });
  // process.exitCode (not process.exit) so the `finally` below actually closes the pool —
  // process.exit would terminate before it runs.
  process.exitCode = failures === 0 ? EXIT.OK : EXIT.ASSERTION_FAILED;
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`REFUSED: ${error.message}`);
    process.exitCode = EXIT.REFUSED;
  } else {
    console.error(`ERROR: ${String(error.message || error)}`);
    process.exitCode = EXIT.ERROR;
  }
} finally {
  await closeQuietly(sql);
}
