/**
 * canvases-schema.test.ts — Track 3b schema-shape guard for the three new tables
 * (canvases / canvas_nodes / canvas_edges) + a migration-0052 presence check.
 *
 * Lives in src/ (NOT src/schema/ — a *.test.ts under src/schema breaks
 * drizzle-kit generate). Pins the public shape (columns, the direct owner
 * anchor, the containment FK, the canonical-key uniqueness) so a schema edit
 * that would silently diverge from migration 0052 trips here (belt-and-suspenders
 * to the `drizzle-kit check` the migration workflow runs).
 *
 * The hand-appended half of 0052 — the two partial-unique indexes, the kind
 * discriminator CHECK, and the nested-EXISTS RLS — is NOT expressible in the
 * Drizzle table shape and CANNOT be applied/verified in this container (no
 * pgvector to replay 0000–0050; no Supabase auth schema for auth.uid()). It is
 * asserted here only as SQL-substring presence, exactly as
 * workspaces-schema.test.ts pins 0047's CHECK/RLS; real apply-from-scratch +
 * tenant-isolation are Track-2-CI gated.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";

import { CanvasEdges } from "./schema/canvas-edges";
import { CanvasNodes } from "./schema/canvas-nodes";
import { Canvases } from "./schema/canvases";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(here, "..", "migrations", "0052_canvas_node_promotion.sql");

describe("canvases table shape (Track 3b)", () => {
  it("is named 'canvases'", () => {
    expect(getTableName(Canvases)).toBe("canvases");
  });

  it("declares exactly the Track 3b columns", () => {
    expect(Object.keys(getTableColumns(Canvases)).sort()).toEqual(
      [
        "conversationId",
        "createdAt",
        "id",
        "kind",
        "name",
        "nodeRegistryVersion",
        "ownerUserId",
        "sharedState",
        "updatedAt",
        "viewport",
        "workspaceId",
      ].sort(),
    );
  });

  it("anchors ownership on a NOT NULL owner_user_id (direct, house style)", () => {
    const cols = getTableColumns(Canvases);
    expect(cols.ownerUserId.name).toBe("owner_user_id");
    expect(cols.ownerUserId.notNull).toBe(true);
  });

  it("contains a NOT NULL workspace_id (the containment edge)", () => {
    const cols = getTableColumns(Canvases);
    expect(cols.workspaceId.name).toBe("workspace_id");
    expect(cols.workspaceId.notNull).toBe(true);
  });

  it("makes conversation_id NULLABLE (home boards have none)", () => {
    const cols = getTableColumns(Canvases);
    expect(cols.conversationId.name).toBe("conversation_id");
    expect(cols.conversationId.notNull).toBe(false);
  });

  it("carries kind + shared_state (NOT NULL) — the two-kind discriminator + D-10 store", () => {
    const cols = getTableColumns(Canvases);
    expect(cols.kind.notNull).toBe(true);
    expect(cols.sharedState.name).toBe("shared_state");
    expect(cols.sharedState.notNull).toBe(true);
  });
});

describe("canvas_nodes table shape (Track 3b)", () => {
  it("is named 'canvas_nodes'", () => {
    expect(getTableName(CanvasNodes)).toBe("canvas_nodes");
  });

  it("declares exactly the Track 3b columns", () => {
    expect(Object.keys(getTableColumns(CanvasNodes)).sort()).toEqual(
      ["canvasId", "data", "height", "id", "nodeKey", "position", "type", "width"].sort(),
    );
  });

  it("keys idempotency on node_key + carries a NOT NULL canvas_id/position", () => {
    const cols = getTableColumns(CanvasNodes);
    expect(cols.nodeKey.name).toBe("node_key");
    expect(cols.nodeKey.notNull).toBe(true);
    expect(cols.canvasId.notNull).toBe(true);
    expect(cols.position.notNull).toBe(true);
    // data defaults to {} NOT NULL; width/height are optional.
    expect(cols.data.notNull).toBe(true);
    expect(cols.width.notNull).toBe(false);
    expect(cols.height.notNull).toBe(false);
  });
});

describe("canvas_edges table shape (Track 3b)", () => {
  it("is named 'canvas_edges'", () => {
    expect(getTableName(CanvasEdges)).toBe("canvas_edges");
  });

  it("declares exactly the Track 3b columns", () => {
    expect(Object.keys(getTableColumns(CanvasEdges)).sort()).toEqual(
      ["canvasId", "createdAt", "data", "edgeKey", "id", "sourceKey", "targetKey"].sort(),
    );
  });

  it("references endpoints as TEXT node keys (NOT FKs) — the D9 heal tolerance", () => {
    const cols = getTableColumns(CanvasEdges);
    expect(cols.sourceKey.name).toBe("source_key");
    expect(cols.targetKey.name).toBe("target_key");
    expect(cols.sourceKey.notNull).toBe(true);
    expect(cols.targetKey.notNull).toBe(true);
    expect(cols.edgeKey.notNull).toBe(true);
  });
});

describe("migration 0052 (Track 3b)", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("creates the three tables", () => {
    expect(sql).toContain('CREATE TABLE "canvases"');
    expect(sql).toContain('CREATE TABLE "canvas_nodes"');
    expect(sql).toContain('CREATE TABLE "canvas_edges"');
  });

  it("does NOT touch chat_canvas_layouts (additive-only)", () => {
    // DDL identifiers are always double-quoted in the generated/hand-appended
    // SQL; the bare name appears only in explanatory comments. A quoted
    // "chat_canvas_layouts" would mean an ALTER/DROP against the blob table.
    expect(sql).not.toContain('"chat_canvas_layouts"');
  });

  it("enforces canonical-key uniqueness on nodes and edges", () => {
    expect(sql).toContain("uq_canvas_nodes_canvas_node_key");
    expect(sql).toContain("uq_canvas_edges_canvas_edge_key");
  });

  it("hand-appends the two partial-unique indexes (conversation + home)", () => {
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "idx_canvases_conversation_id" ON "canvases"',
    );
    expect(sql).toContain('WHERE "canvases"."conversation_id" IS NOT NULL');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "idx_canvases_home_owner" ON "canvases"',
    );
    expect(sql).toContain(`WHERE "canvases"."kind" = 'home'`);
  });

  it("hand-appends the kind-discriminator CHECK", () => {
    expect(sql).toContain("canvases_kind_discriminator");
    expect(sql).toContain(`"canvases"."kind" = 'conversation'`);
  });

  it("enables RLS + owner/member policies on all three tables (mirrors 0047)", () => {
    expect(sql).toContain('ALTER TABLE "canvases" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE "canvas_nodes" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE "canvas_edges" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain("deny_all_canvases_anon");
    expect(sql).toContain("canvases_member_authenticated");
    // Nested-EXISTS through the parent canvas for descendant tables.
    expect(sql).toContain("canvas_nodes_via_canvas_authenticated");
    expect(sql).toContain("canvas_edges_via_canvas_authenticated");
  });

  it("does NOT extend the shared_resource_type enum (canvas share deferred)", () => {
    expect(sql).not.toContain("shared_resource_type");
    expect(sql).not.toContain("'canvas'");
  });
});
