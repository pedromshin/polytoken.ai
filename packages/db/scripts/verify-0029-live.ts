/**
 * Live-verification script for migration 0029 (Phase 37-01, Task 1).
 *
 * Direct pg query against the live DB proving:
 *   (a) `knowledge_nodes_extracted_only` appears in information_schema.views.
 *   (b) both `match_knowledge_nodes_by_embedding` and `match_knowledge_nodes_by_trgm` appear in
 *       information_schema.routines (routine_type = 'FUNCTION').
 *   (c) THE SEEDED THREE-TIER PROOF: 3 seeded knowledge_nodes rows (EXTRACTED / INFERRED /
 *       AMBIGUOUS) read back through `knowledge_nodes_extracted_only` -- the EXTRACTED row's
 *       title/content come back as the exact seeded strings; the INFERRED and AMBIGUOUS rows'
 *       title AND content are both NULL (belt 1, structural text-nulling, live not unit-mocked).
 *   (d) `match_knowledge_nodes_by_trgm` called live against the seeded rows returns the
 *       EXTRACTED seed row's id and excludes the INFERRED/AMBIGUOUS seed rows' ids (belt 3,
 *       the RPC's explicit tier = 'EXTRACTED' filter, live not unit-mocked).
 *
 * Seeded rows are cleaned up (DELETE by id) in a `finally` block so the script is safely
 * re-runnable and leaves no residue.
 *
 * Usage: npm run with-env -- tsx scripts/verify-0029-live.ts
 * Exit codes: 0 = all assertions passed, 1 = any assertion failed
 */

import { randomUUID } from "node:crypto";

import pg from "pg";

import { env } from "../src/client";

const { Client } = pg;

const VIEW = "knowledge_nodes_extracted_only";
const VECTOR_RPC = "match_knowledge_nodes_by_embedding";
const TRGM_RPC = "match_knowledge_nodes_by_trgm";

// Seeded per migration 0005 -- no importer bootstrap needed (settings.py DEFAULT_IMPORTER_ID).
const DEFAULT_IMPORTER_ID = "00000000-0000-0000-0000-000000000001";

interface SeedRow {
  readonly id: string;
  readonly tier: "EXTRACTED" | "INFERRED" | "AMBIGUOUS";
  readonly title: string;
  readonly content: string;
}

const SEED_ROWS: readonly SeedRow[] = [
  { id: randomUUID(), tier: "EXTRACTED", title: "Extracted Title", content: "Extracted Content" },
  { id: randomUUID(), tier: "INFERRED", title: "Inferred Title", content: "Inferred Content" },
  { id: randomUUID(), tier: "AMBIGUOUS", title: "Ambiguous Title", content: "Ambiguous Content" },
];

const verify = async (): Promise<void> => {
  if (!env.POSTGRES_URL_NON_POOLING) {
    console.error("POSTGRES_URL_NON_POOLING is not defined");
    process.exit(1);
  }

  const client = new Client({ connectionString: env.POSTGRES_URL_NON_POOLING });
  let failed = false;
  let seeded = false;

  try {
    await client.connect();

    // (a) view exists
    const viewResult = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.views WHERE table_name = $1`,
      [VIEW],
    );
    console.log(`View ${VIEW} present: ${viewResult.rows.length > 0}`);
    if (viewResult.rows.length === 0) {
      console.error(`ASSERTION FAILED: view ${VIEW} does not exist`);
      failed = true;
    }

    // (b) both RPCs exist as FUNCTIONs
    const routineResult = await client.query<{ routine_name: string; routine_type: string }>(
      `SELECT routine_name, routine_type FROM information_schema.routines WHERE routine_name = ANY($1)`,
      [[VECTOR_RPC, TRGM_RPC]],
    );
    console.log("Routines:");
    for (const row of routineResult.rows) {
      console.log(`  ${row.routine_name}: ${row.routine_type}`);
    }
    for (const rpcName of [VECTOR_RPC, TRGM_RPC]) {
      const found = routineResult.rows.find((r) => r.routine_name === rpcName);
      if (!found || found.routine_type !== "FUNCTION") {
        console.error(`ASSERTION FAILED: ${rpcName} not found as a FUNCTION`);
        failed = true;
      }
    }

    // (c) seed 3-tier rows, then read back through the view
    for (const row of SEED_ROWS) {
      await client.query(
        `INSERT INTO knowledge_nodes
           (id, importer_id, title, content, scope, scope_ref_id, source, tier, is_active)
         VALUES ($1, $2, $3, $4, 'importer_global', NULL, 'manual', $5, true)`,
        [row.id, DEFAULT_IMPORTER_ID, row.title, row.content, row.tier],
      );
    }
    seeded = true;

    const readBack = await client.query<{ id: string; tier: string; title: string | null; content: string | null }>(
      `SELECT id, tier, title, content FROM knowledge_nodes_extracted_only WHERE id = ANY($1)`,
      [SEED_ROWS.map((r) => r.id)],
    );
    console.log("Read-back rows through the view:");
    for (const row of readBack.rows) {
      console.log(`  id=${row.id} tier=${row.tier} title=${JSON.stringify(row.title)} content=${JSON.stringify(row.content)}`);
    }

    const extractedSeed = SEED_ROWS.find((r) => r.tier === "EXTRACTED");
    const extractedReadBack = readBack.rows.find((r) => r.id === extractedSeed?.id);
    if (!extractedReadBack || extractedReadBack.title !== extractedSeed?.title || extractedReadBack.content !== extractedSeed?.content) {
      console.error(
        `ASSERTION FAILED: EXTRACTED row title/content did not round-trip. Expected title=${extractedSeed?.title} content=${extractedSeed?.content}, got ${JSON.stringify(extractedReadBack)}`,
      );
      failed = true;
    }

    for (const tier of ["INFERRED", "AMBIGUOUS"] as const) {
      const seed = SEED_ROWS.find((r) => r.tier === tier);
      const back = readBack.rows.find((r) => r.id === seed?.id);
      if (!back || back.title !== null || back.content !== null) {
        console.error(`ASSERTION FAILED: ${tier} row title/content must both be NULL through the view, got ${JSON.stringify(back)}`);
        failed = true;
      }
    }

    // (d) match_knowledge_nodes_by_trgm live call — EXTRACTED-only belt 3
    const trgmResult = await client.query<{ id: string }>(
      `SELECT * FROM match_knowledge_nodes_by_trgm($1, $2, $3)`,
      ["Extracted Title", DEFAULT_IMPORTER_ID, 10],
    );
    const trgmIds = new Set(trgmResult.rows.map((r) => r.id));
    console.log(`match_knowledge_nodes_by_trgm returned ids: ${[...trgmIds].join(", ") || "(none)"}`);

    if (!extractedSeed || !trgmIds.has(extractedSeed.id)) {
      console.error(`ASSERTION FAILED: match_knowledge_nodes_by_trgm did not return the EXTRACTED seed row's id`);
      failed = true;
    }
    for (const tier of ["INFERRED", "AMBIGUOUS"] as const) {
      const seed = SEED_ROWS.find((r) => r.tier === tier);
      if (seed && trgmIds.has(seed.id)) {
        console.error(`ASSERTION FAILED: match_knowledge_nodes_by_trgm leaked the ${tier} seed row's id`);
        failed = true;
      }
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
    if (seeded) {
      await client.query(`DELETE FROM knowledge_nodes WHERE id = ANY($1)`, [SEED_ROWS.map((r) => r.id)]);
    }
    await client.end();
  }
};

verify().catch((err: unknown) => {
  console.error("Unhandled error in verify script:", err);
  process.exit(1);
});
