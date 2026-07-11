/**
 * Live-verification script for migration 0034 (Phase 49-04, Task 1).
 *
 * Direct pg query against the live DB proving the owner RLS policies from
 * 0034_rls_user_scoping.sql exist in pg_policies for every user-scoped table.
 *
 * Usage: npm run with-env -- tsx scripts/verify-0034-live.ts
 * Exit codes: 0 = all assertions passed, 1 = any assertion failed
 */

import pg from "pg";

import { env } from "../src/client";

const { Client } = pg;

const EXPECTED_POLICIES = [
  "importers_owner_authenticated",
  "chat_conversations_owner_authenticated",
  "chat_cost_ledger_owner_authenticated",
  "emails_owner_authenticated",
  "email_attachments_owner_authenticated",
  "email_components_owner_authenticated",
  "extraction_records_owner_authenticated",
  "entity_instances_owner_authenticated",
  "sender_profiles_owner_authenticated",
  "knowledge_nodes_owner_authenticated",
  "knowledge_node_edges_owner_authenticated",
  "entity_types_owner_authenticated",
  "entity_type_fields_owner_authenticated",
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

    const result = await client.query<{ policyname: string }>(
      `SELECT policyname FROM pg_policies WHERE schemaname = 'public'`,
    );
    const livePolicies = new Set(result.rows.map((r) => r.policyname));

    for (const policy of EXPECTED_POLICIES) {
      if (!livePolicies.has(policy)) {
        console.error(`ASSERTION FAILED: pg_policies missing '${policy}'`);
        failed = true;
        continue;
      }
      console.log(`policy present: ${policy}`);
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
