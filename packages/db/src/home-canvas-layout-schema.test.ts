/**
 * home-canvas-layout-schema.test.ts — HM-01 schema-shape guard for the `scope`
 * discriminator added to `chat_canvas_layouts` (migration 0046).
 *
 * The migration itself is verified to parse + chain by `drizzle-kit check`
 * (0046). This is the belt-and-suspenders schema-shape unit test the migration
 * workflow calls for when a live DB isn't available: it pins the discriminator
 * columns (`user_id`, `scope`), the newly-NULLABLE `conversation_id`, the
 * partial one-home-board-per-user unique index, and the scope CHECK constraint,
 * so a schema edit that would silently diverge from the migration trips HERE.
 *
 * Lives in packages/db/src/ (NOT src/schema/) so it never confuses
 * drizzle-kit's `schema` glob during `generate`.
 */
import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

import { ChatCanvasLayouts } from "./schema/chat-canvas-layouts";

describe("chat_canvas_layouts scope discriminator (HM-01, 0046)", () => {
  it("is still named 'chat_canvas_layouts' (one table, not a new system)", () => {
    expect(getTableName(ChatCanvasLayouts)).toBe("chat_canvas_layouts");
  });

  it("adds exactly the two discriminator columns (user_id, scope)", () => {
    const cols = getTableColumns(ChatCanvasLayouts);
    expect(Object.keys(cols).sort()).toEqual(
      [
        "conversationId",
        "createdAt",
        "edges",
        "id",
        "nodeRegistryVersion",
        "nodes",
        "scope",
        "sharedState",
        "updatedAt",
        "userId",
        "viewport",
      ].sort(),
    );
  });

  it("makes conversation_id NULLABLE so a home row can omit it", () => {
    const cols = getTableColumns(ChatCanvasLayouts);
    expect(cols.conversationId.name).toBe("conversation_id");
    expect(cols.conversationId.notNull).toBe(false);
  });

  it("carries user_id (home ownership anchor) + scope, both nullable", () => {
    const cols = getTableColumns(ChatCanvasLayouts);
    expect(cols.userId.name).toBe("user_id");
    expect(cols.userId.notNull).toBe(false);
    expect(cols.scope.name).toBe("scope");
    expect(cols.scope.notNull).toBe(false);
    expect(cols.scope.dataType).toBe("string");
  });

  it("declares a PARTIAL unique index for one home board per user", () => {
    const { indexes } = getTableConfig(ChatCanvasLayouts);
    const homeIdx = indexes.find(
      (i) => i.config.name === "idx_chat_canvas_layouts_home_user",
    );
    expect(homeIdx).toBeDefined();
    expect(homeIdx!.config.unique).toBe(true);
    // Partial (WHERE scope = 'home') — never collides with conversation rows.
    expect(homeIdx!.config.where).toBeDefined();
  });

  it("keeps the original one-row-per-conversation unique index", () => {
    const { indexes } = getTableConfig(ChatCanvasLayouts);
    const convIdx = indexes.find(
      (i) => i.config.name === "idx_chat_canvas_layouts_conversation_id",
    );
    expect(convIdx).toBeDefined();
    expect(convIdx!.config.unique).toBe(true);
  });

  it("enforces the EITHER/OR scope discriminator via a CHECK constraint", () => {
    const { checks } = getTableConfig(ChatCanvasLayouts);
    const names = checks.map((c) => c.name);
    expect(names).toContain("chat_canvas_layouts_scope_discriminator");
  });
});
