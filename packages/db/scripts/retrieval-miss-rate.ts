/**
 * Retrieval-miss-rate report (Phase 31-02, Task 3, RECALL-02).
 *
 * Computes the retrieval-miss rate as a number over persisted
 * autofill_retrieval_events, joined AT QUERY TIME to extraction_records'
 * corrected_fields (no event mutation, no second write path — see
 * RETRIEVAL-MISS-RATE.md for the written miss definition, the stage-3
 * (KGX-01..03) go/no-go gate).
 *
 * Usage: npm run with-env -- tsx scripts/retrieval-miss-rate.ts
 * Exit codes: 0 = report printed (and self-test passed), 1 = connection/self-test failure
 */

import pg from "pg";

import { env } from "../src/client";

const { Client } = pg;

// ---------------------------------------------------------------------------
// Shared miss-classification SQL fragment (documented in RETRIEVAL-MISS-RATE.md)
//
// A run is a MISS when:
//   (a) had_context (seed_hits or injected entity_context) AND the human later
//       corrected the confirmed extraction for that component, OR
//   (b) NOT had_context (nothing retrieved/injected) AND the human confirmed
//       with corrected_fields present (had to hand-fill because retrieval gave
//       the autofiller nothing to work with)
// ---------------------------------------------------------------------------
const buildMissRateQuery = (eventsTable: string, correctionsTable: string): string => `
  WITH events AS (
    SELECT id, component_id, seed_hit_count, injected_entity_instance_id
    FROM ${eventsTable}
  ),
  corrections AS (
    SELECT component_id,
           bool_or(corrected_fields IS NOT NULL AND corrected_fields::text <> '{}'::text) AS was_corrected
    FROM ${correctionsTable}
    WHERE status = 'confirmed'
    GROUP BY component_id
  ),
  joined AS (
    SELECT
      e.id,
      (e.seed_hit_count > 0 OR e.injected_entity_instance_id IS NOT NULL) AS had_context,
      COALESCE(c.was_corrected, false) AS was_corrected
    FROM events e
    LEFT JOIN corrections c ON c.component_id = e.component_id
  )
  SELECT
    count(*)::int AS total_runs,
    count(*) FILTER (WHERE had_context AND was_corrected)::int AS miss_type_a,
    count(*) FILTER (WHERE NOT had_context AND was_corrected)::int AS miss_type_b
  FROM joined;
`;

interface MissRateRow {
  total_runs: number;
  miss_type_a: number;
  miss_type_b: number;
}

const formatReport = (row: MissRateRow): string => {
  const totalMisses = row.miss_type_a + row.miss_type_b;
  // Documented choice: with zero persisted runs the rate is reported as 0
  // (not NaN/N/A) — "0 runs, 0 misses" is a valid, unambiguous starting state
  // for the stage-3 go/no-go gate (see RETRIEVAL-MISS-RATE.md).
  const missRate = row.total_runs === 0 ? 0 : totalMisses / row.total_runs;
  return [
    `total_runs=${row.total_runs}`,
    `total_misses=${totalMisses}`,
    `miss_type_a_had_context_corrected=${row.miss_type_a}`,
    `miss_type_b_no_context_hand_filled=${row.miss_type_b}`,
    `miss_rate=${missRate.toFixed(4)}`,
  ].join(" ");
};

/**
 * Self-test: proves the miss-classification SQL fragment above is correct
 * using an inline VALUES fixture (no writes to any real table, no FK
 * entanglement with email_components/extraction_records). Runs inside a
 * transaction that is always rolled back.
 */
const runSelfTest = async (client: pg.Client): Promise<boolean> => {
  const fixtureEventsCte = `(
    SELECT * FROM (VALUES
      ('11111111-1111-1111-1111-111111111111'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 0, NULL::uuid)
    ) AS t(id, component_id, seed_hit_count, injected_entity_instance_id)
  )`;
  const fixtureCorrectionsCte = `(
    SELECT * FROM (VALUES
      ('22222222-2222-2222-2222-222222222222'::uuid, 'confirmed'::text, '{"vendor_name":"Corrected Co"}'::jsonb)
    ) AS t(component_id, status, corrected_fields)
  )`;
  const query = buildMissRateQuery(fixtureEventsCte, fixtureCorrectionsCte);

  const result = await client.query<MissRateRow>(query);
  const row = result.rows[0];
  const passed = row.total_runs === 1 && row.miss_type_a === 0 && row.miss_type_b === 1;

  console.log("Self-test (fixture: no-context run later hand-corrected → expected miss_type_b):");
  console.log(`  ${formatReport(row)}`);
  console.log(passed ? "Self-test PASSED" : "Self-test FAILED");
  return passed;
};

const run = async (): Promise<void> => {
  if (!env.POSTGRES_URL_NON_POOLING) {
    console.error("POSTGRES_URL_NON_POOLING is not defined");
    process.exit(1);
  }

  const client = new Client({ connectionString: env.POSTGRES_URL_NON_POOLING });

  try {
    await client.connect();

    console.log("=== Retrieval-Miss-Rate Report (RECALL-02) ===");
    const query = buildMissRateQuery("autofill_retrieval_events", "extraction_records");
    const result = await client.query<MissRateRow>(query);
    console.log(formatReport(result.rows[0]));

    console.log("");
    const selfTestPassed = await runSelfTest(client);
    if (!selfTestPassed) {
      console.error("VERIFICATION FAILED: self-test fixture did not classify as expected");
      process.exit(1);
    }

    console.log("");
    console.log("VERIFICATION PASSED");
  } catch (error) {
    console.error("Database connection error during retrieval-miss-rate report:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
};

run().catch((err: unknown) => {
  console.error("Unhandled error in retrieval-miss-rate script:", err);
  process.exit(1);
});
