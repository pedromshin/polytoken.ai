/**
 * Live-verification script for migration 0033 (Phase 49-04, Task 1).
 *
 * Direct pg query against the live DB proving user_id is NOT NULL
 * (is_nullable = 'NO') on chat_conversations, chat_cost_ledger, importers.
 *
 * Usage: npm run with-env -- tsx scripts/verify-0033-live.ts
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
      const result = await client.query<{ is_nullable: string }>(
        `SELECT is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'user_id'`,
        [table],
      );

      const row = result.rows[0];
      if (!row) {
        console.error(`ASSERTION FAILED: ${table}.user_id column not found`);
        failed = true;
        continue;
      }
      if (row.is_nullable !== "NO") {
        console.error(
          `ASSERTION FAILED: ${table}.user_id is_nullable = '${row.is_nullable}', expected 'NO'`,
        );
        failed = true;
        continue;
      }
      console.log(`${table}.user_id is NOT NULL`);
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
