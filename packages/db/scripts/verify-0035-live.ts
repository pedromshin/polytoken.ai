/**
 * Live-verification script for migration 0035 (Phase 49-04, Task 1).
 *
 * Direct pg query against the live DB proving the threads + forwarding seam
 * landed: public.threads and public.forwarding_addresses tables exist
 * (to_regclass), emails.thread_id column exists, and the two unique indexes
 * idx_forwarding_addresses_token_unique / idx_forwarding_addresses_user_id_unique
 * exist (pg_indexes).
 *
 * Usage: npm run with-env -- tsx scripts/verify-0035-live.ts
 * Exit codes: 0 = all assertions passed, 1 = any assertion failed
 */

import pg from "pg";

import { env } from "../src/client";

const { Client } = pg;

const EXPECTED_TABLES = ["public.threads", "public.forwarding_addresses"];
const EXPECTED_INDEXES = [
  "idx_forwarding_addresses_token_unique",
  "idx_forwarding_addresses_user_id_unique",
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

    for (const table of EXPECTED_TABLES) {
      const result = await client.query<{ reg: string | null }>(
        `SELECT to_regclass($1)::text AS reg`,
        [table],
      );
      if (!result.rows[0]?.reg) {
        console.error(`ASSERTION FAILED: table ${table} does not exist`);
        failed = true;
        continue;
      }
      console.log(`table exists: ${table}`);
    }

    const threadIdCol = await client.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'emails' AND column_name = 'thread_id'`,
    );
    if (!threadIdCol.rows[0]) {
      console.error("ASSERTION FAILED: emails.thread_id column not found");
      failed = true;
    } else {
      console.log("emails.thread_id column exists");
    }

    const indexResult = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'forwarding_addresses'`,
    );
    const liveIndexes = new Set(indexResult.rows.map((r) => r.indexname));
    for (const index of EXPECTED_INDEXES) {
      if (!liveIndexes.has(index)) {
        console.error(`ASSERTION FAILED: pg_indexes missing '${index}'`);
        failed = true;
        continue;
      }
      console.log(`unique index present: ${index}`);
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
