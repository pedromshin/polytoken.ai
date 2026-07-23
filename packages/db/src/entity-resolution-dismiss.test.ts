/**
 * entity-resolution-dismiss.test.ts — behavioral regression tests for
 * migration 0043_entity_resolution_dismiss_keying.sql, run against a REAL
 * Postgres engine (PGlite, dev-only wasm build) so the RPC's SQL is actually
 * executed, not just eyeballed.
 *
 * Background (RES-1): migration 0039 added a dismissal NOT EXISTS filter to
 * the BlendedRAG resolution RPCs, but keyed it on component_id = <entity id>.
 * component_id is a NOT NULL FK to email_components.id, so that keying can
 * never match a row — the filter was dead and a human REJECT stayed a no-op
 * at the resolver. Since the RES-1 write fix, RejectMerge flags
 * was_dismissed=true on the promote-written rows' REAL keying
 * (component_id ∈ components of the subject's email, entity_instance_id =
 * candidate). Migration 0043 re-keys the filter to match.
 *
 * Only the pg_trgm arm is executed here — the embedding arm needs
 * halfvec/pgvector which PGlite does not ship, but both functions carry the
 * IDENTICAL dismissal clause (asserted textually in the last test).
 *
 * Test plan:
 *   1. Before dismissal a similar candidate IS returned for the subject.
 *   2. After the RES-1-keyed dismissal write, the candidate is excluded.
 *   3. Symmetric: querying with the DISMISSED candidate as subject excludes
 *      the original subject too (dismissal recorded on one side only).
 *   4. No collateral damage: an unrelated same-email candidate is NOT
 *      excluded in either direction (the was_selected=true occurrence-link
 *      anchor prevents suggestion rows from over-suppressing).
 *   5. NULL subject param keeps pre-0039 behavior (no exclusion).
 *   6. Both RPC bodies contain the same corrected dismissal clause; neither
 *      contains the dead 0039 keying.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION_PATH = join(
  __dirname,
  "../migrations/0043_entity_resolution_dismiss_keying.sql",
);

const IMP = "10000000-0000-0000-0000-000000000001";
const TYPE = "20000000-0000-0000-0000-000000000001";
const SUBJECT = "30000000-0000-0000-0000-00000000000a";
const DISMISSED = "30000000-0000-0000-0000-00000000000b";
const UNRELATED = "30000000-0000-0000-0000-00000000000c";
const EMAIL = "40000000-0000-0000-0000-000000000001";
const COMP_SOURCE = "50000000-0000-0000-0000-000000000001";
const COMP_FIELD = "50000000-0000-0000-0000-000000000002";

let db: PGlite;

async function matchIds(subject: string | null): Promise<string[]> {
  const r = await db.query<{ id: string }>(
    "SELECT id FROM match_entities_by_trgm('acme freight', $1, $2, 10, $3)",
    [IMP, TYPE, subject],
  );
  return r.rows.map((row) => row.id);
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pg_trgm } });
  await db.exec("CREATE EXTENSION IF NOT EXISTS pg_trgm;");

  // Minimal slice of the real schema — only what the trgm RPC + filter touch.
  await db.exec(`
    CREATE TABLE entity_instances (
      id uuid PRIMARY KEY,
      importer_id uuid NOT NULL,
      entity_type_id uuid NOT NULL,
      source text NOT NULL,
      display_name text NOT NULL,
      identifiers jsonb NOT NULL DEFAULT '{}',
      aliases text[] NOT NULL DEFAULT '{}',
      is_active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE email_components (
      id uuid PRIMARY KEY,
      email_id uuid NOT NULL
    );
    CREATE TABLE component_entity_candidate_links (
      id uuid PRIMARY KEY,
      component_id uuid NOT NULL REFERENCES email_components(id),
      entity_instance_id uuid NOT NULL REFERENCES entity_instances(id),
      was_selected boolean NOT NULL DEFAULT false,
      was_dismissed boolean NOT NULL DEFAULT false
    );
  `);

  // Apply ONLY the trgm statement from the real migration file (the embedding
  // arm requires halfvec, unavailable in PGlite).
  const migrationSql = readFileSync(MIGRATION_PATH, "utf8");
  const trgmStatement = migrationSql
    .split("--> statement-breakpoint")
    .find((part) => part.includes("match_entities_by_trgm"));
  if (!trgmStatement) throw new Error("trgm statement missing from 0043");
  await db.exec(trgmStatement);

  // Seed: subject S promoted from COMP_SOURCE in EMAIL; its field child
  // carries the was_selected=true occurrence link (promote's identity
  // assignment); promote wrote duplicate SUGGESTIONS (was_selected=false)
  // for DISMISSED and UNRELATED on the source component.
  await db.exec(`
    INSERT INTO entity_instances (id, importer_id, entity_type_id, source, display_name) VALUES
      ('${SUBJECT}',   '${IMP}', '${TYPE}', 'email_extracted', 'Acme Freight'),
      ('${DISMISSED}', '${IMP}', '${TYPE}', 'email_extracted', 'ACME FREIGHT LTDA'),
      ('${UNRELATED}', '${IMP}', '${TYPE}', 'email_extracted', 'Acme Freight Corp');
    INSERT INTO email_components (id, email_id) VALUES
      ('${COMP_SOURCE}', '${EMAIL}'),
      ('${COMP_FIELD}', '${EMAIL}');
    INSERT INTO component_entity_candidate_links
      (id, component_id, entity_instance_id, was_selected) VALUES
      ('60000000-0000-0000-0000-000000000001', '${COMP_FIELD}', '${SUBJECT}', true),
      ('60000000-0000-0000-0000-000000000002', '${COMP_SOURCE}', '${DISMISSED}', false),
      ('60000000-0000-0000-0000-000000000003', '${COMP_SOURCE}', '${UNRELATED}', false);
  `);
});

afterAll(async () => {
  await db.close();
});

describe("migration 0043 — match_entities_by_trgm dismissal keying", () => {
  it("Test 1: before dismissal, the similar candidate is suggested for the subject", async () => {
    const ids = await matchIds(SUBJECT);
    expect(ids).toContain(DISMISSED);
    expect(ids).toContain(UNRELATED);
  });

  it("Test 2: after the RES-1-keyed dismissal write, the candidate is excluded", async () => {
    // Exactly what dismiss_candidate_link writes since the W0 fix: flag the
    // rows keyed (component ∈ subject's email components, entity = target).
    await db.exec(`
      UPDATE component_entity_candidate_links
      SET was_dismissed = true
      WHERE component_id IN ('${COMP_SOURCE}', '${COMP_FIELD}')
        AND entity_instance_id = '${DISMISSED}';
    `);

    const ids = await matchIds(SUBJECT);
    expect(ids).not.toContain(DISMISSED);
    // Everything else untouched
    expect(ids).toContain(UNRELATED);
    expect(ids).toContain(SUBJECT);
  });

  it("Test 3: symmetric — with the dismissed candidate as SUBJECT, the original subject is excluded", async () => {
    const ids = await matchIds(DISMISSED);
    expect(ids).not.toContain(SUBJECT);
  });

  it("Test 4: an unrelated same-email candidate is never collaterally excluded", async () => {
    // From the dismissed candidate's perspective the unrelated entity's mere
    // SUGGESTION rows in the shared email must not anchor an exclusion —
    // only was_selected=true occurrence links do.
    const fromDismissed = await matchIds(DISMISSED);
    expect(fromDismissed).toContain(UNRELATED);

    const fromUnrelated = await matchIds(UNRELATED);
    expect(fromUnrelated).toContain(SUBJECT);
    expect(fromUnrelated).toContain(DISMISSED);
  });

  it("Test 5: NULL subject keeps backward-compatible behavior (no exclusion)", async () => {
    const ids = await matchIds(null);
    expect(ids).toContain(DISMISSED);
  });

  it("Test 6: both RPC arms share the corrected clause; the dead 0039 keying is gone", () => {
    const migrationSql = readFileSync(MIGRATION_PATH, "utf8");
    const [embeddingPart, trgmPart] = migrationSql.split("--> statement-breakpoint");
    expect(embeddingPart).toContain("match_entities_by_embedding");
    expect(trgmPart).toContain("match_entities_by_trgm");

    for (const part of [embeddingPart, trgmPart]) {
      expect(part).toContain("dl.was_dismissed = true");
      expect(part).toContain("ol.was_selected = true");
      // The impossible 0039 keying (component_id = <entity id>) must not appear.
      expect(part).not.toMatch(/l\.component_id = match_subject_entity_instance_id/);
    }
  });
});
