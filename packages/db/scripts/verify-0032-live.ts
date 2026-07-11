/**
 * Live-verification script for migration 0032 (Phase 49-04, Task 1).
 *
 * Direct pg query against the live DB proving the user_id backfill
 * completed: zero rows WHERE user_id IS NULL on chat_conversations,
 * chat_cost_ledger, and importers.
 *
 * Usage: npm run with-env -- tsx scripts/verify-0032-live.ts
 * Exit codes: 0 = all assertions passed, 1 = any assertion failed
 */

import pg from "pg";

import { env } from "../src/client";

const { Client } = pg;

const EXPECTED_TABLES = ["chat_conversations", "chat_cost_ledger", "importers"];

const verify = async (): Promise<void> => {
  if (!env.POSTGRES_URL_NON_POOLING) {
    console.error("POSTGRES_URL_NON_POOLING is not defined");
    process.exit(1);
  }

  const client = new Client({ connectionString: env.POSTGRES_URL_NON_POOLING });
  let failed = false;

  try {
    await client.connect();

    for (const table of EXPECTED_TABLES) {
      const result = await client.query<{ null_count: string }>(
        `SELECT count(*)::text AS null_count FROM ${table} WHERE user_id IS NULL`,
      );

      const nullCount = Number(result.rows[0]?.null_count ?? "-1");
      if (nullCount !== 0) {
        console.error(
          `ASSERTION FAILED: ${table} has ${nullCount} rows with user_id IS NULL (expected 0)`,
        );
        failed = true;
        continue;
      }
      console.log(`${table}: 0 NULL user_id rows (backfill complete)`);
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
