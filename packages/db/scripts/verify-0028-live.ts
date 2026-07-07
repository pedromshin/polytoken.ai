/**
 * Live-verification script for migration 0028 (Phase 31-02, Task 1).
 *
 * Direct pg query against the live DB (NOT a TS/Drizzle type check — types
 * come from the schema source, not the live DB) proving:
 *   (a) autofill_retrieval_events exists with the expected columns/udt/nullable
 *   (b) relrowsecurity = true (RLS is enabled on the table, T-31-05)
 *
 * Usage: npm run with-env -- tsx scripts/verify-0028-live.ts
 * Exit codes: 0 = all assertions passed, 1 = any assertion failed
 */

import pg from "pg";

import { env } from "../src/client";

const { Client } = pg;

const TABLE = "autofill_retrieval_events";

const EXPECTED_COLUMNS: ReadonlyArray<{ column: string; udt: string; nullable: string }> = [
  { column: "id", udt: "uuid", nullable: "NO" },
  { column: "component_id", udt: "uuid", nullable: "NO" },
  { column: "importer_id", udt: "uuid", nullable: "YES" },
  { column: "entity_type_id", udt: "uuid", nullable: "YES" },
  { column: "seed_hits", udt: "jsonb", nullable: "YES" },
  { column: "seed_hit_count", udt: "int4", nullable: "NO" },
  { column: "injected_entity_instance_id", udt: "uuid", nullable: "YES" },
  { column: "injected_alias_count", udt: "int4", nullable: "NO" },
  { column: "injected_identifier_count", udt: "int4", nullable: "NO" },
  { column: "routing_reason", udt: "text", nullable: "NO" },
  { column: "created_at", udt: "timestamptz", nullable: "NO" },
];

const verify = async (): Promise<void> => {
  if (!env.POSTGRES_URL_NON_POOLING) {
    console.error("POSTGRES_URL_NON_POOLING is not defined");
    process.exit(1);
  }

  const client = new Client({ connectionString: env.POSTGRES_URL_NON_POOLING });
  let failed = false;

  try {
    await client.connect();

    const colResult = await client.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = $1
       ORDER BY column_name`,
      [TABLE],
    );
    console.log("Columns:");
    for (const row of colResult.rows) {
      console.log(
        `  ${row.table_name}.${row.column_name}: type=${row.data_type} udt=${row.udt_name} nullable=${row.is_nullable} default=${row.column_default}`,
      );
    }

    if (colResult.rows.length === 0) {
      console.error(`ASSERTION FAILED: table ${TABLE} does not exist (no columns found)`);
      process.exit(1);
    }

    for (const exp of EXPECTED_COLUMNS) {
      const found = colResult.rows.find((r) => r.column_name === exp.column);
      if (!found) {
        console.error(`ASSERTION FAILED: missing ${TABLE}.${exp.column}`);
        failed = true;
        continue;
      }
      if (found.udt_name !== exp.udt || found.is_nullable !== exp.nullable) {
        console.error(
          `ASSERTION FAILED: ${TABLE}.${exp.column} expected udt=${exp.udt} nullable=${exp.nullable}, got udt=${found.udt_name} nullable=${found.is_nullable}`,
        );
        failed = true;
      }
    }

    const rlsResult = await client.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE relname = $1`,
      [TABLE],
    );
    const rlsEnabled = rlsResult.rows[0]?.relrowsecurity === true;
    console.log(`relrowsecurity for ${TABLE}: ${rlsResult.rows[0]?.relrowsecurity}`);
    if (!rlsEnabled) {
      console.error(`ASSERTION FAILED: relrowsecurity is not true for ${TABLE}`);
      failed = true;
    }

    const policyResult = await client.query<{ policyname: string; roles: string[] }>(
      `SELECT policyname, roles FROM pg_policies WHERE tablename = $1`,
      [TABLE],
    );
    console.log("Policies:");
    for (const row of policyResult.rows) {
      console.log(`  ${row.policyname}: roles=${JSON.stringify(row.roles)}`);
    }
    if (policyResult.rows.length < 2) {
      console.error(`ASSERTION FAILED: expected 2 RESTRICTIVE deny-all policies (anon + authenticated), found ${policyResult.rows.length}`);
      failed = true;
    }

    if (failed) {
      console.error("VERIFICATION FAILED");
      process.exit(1);
    }

    console.log("VERIFICATION PASSED: all assertions confirmed live.");
  } catch (error) {
    console.error("Database connection error during verification:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
};

verify().catch((err: unknown) => {
  console.error("Unhandled error in verify script:", err);
  process.exit(1);
});
