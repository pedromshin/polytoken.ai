/**
 * Phase 73 (Living-canvas agent dataflow) — the `canvas_recipes` table (LCAN-07).
 *
 * A wired dataflow on the canvas today is anonymous rows: nodes in
 * `canvas_nodes` / the blob's `nodes[]`, edges in `canvas_edges` / `edges[]`.
 * A **recipe** names that graph — "keep a live rent board" — and records the
 * member key-set so it can (a) render a badge/name grouping its member nodes,
 * (b) be listed/reused, and (c) (LCAN-09, NOT built here) be re-polled by the
 * durable graphile-worker so recompute survives after the tab closes.
 *
 * ## Scope + ownership — per conversation, direct owner anchor
 * A recipe is scoped to ONE conversation's canvas (`conversation_id`, the same
 * per-conversation identity `chat_canvas_layouts` uses and the router lists
 * by). It ALSO carries a DIRECT `user_id` owner anchor (house style, mirrors
 * `spreadsheets.user_id` / `canvases.owner_user_id`) so a single recipe gates
 * through the central `assertCanvasRecipeOwnership` helper (ownership.ts) with a
 * direct read — never an ad-hoc per-call-site user_id filter, never a join. The
 * acting identity is ALWAYS server-verified (`ctx.user.id`), stamped server-side
 * on create; `conversation_id` ownership is re-asserted at the top of every
 * conversation-scoped read (`assertConversationOwnership`).
 *
 * ## Member key-sets — TEXT keys as jsonb, NOT foreign keys
 * `node_keys` / `edge_keys` are `string[]` of the canonical `type:ref` node keys
 * and edge keys the recipe groups. They are jsonb arrays, NOT FKs — mirroring
 * the deliberate no-FK choice in `canvas_edges` (endpoints are node KEYS as
 * TEXT): a recipe must tolerate keys that are healed, not-yet-persisted, or live
 * only in the blob, so a hard FK + cascade would wrongly reject/erase them.
 *
 * ## `source_ref` — stored, NOT YET consumed (LCAN-09 seam)
 * The durable re-poll descriptor the Task-7 graphile-worker will read to re-run
 * the source read on a schedule and bump the published value server-side. It is
 * persisted here as a stored-but-unconsumed column: this phase (Wave C backend)
 * builds ONLY the CRUD substrate; the after-close recompute is the live-only
 * graphile-worker seam (LCAN-09), a named followup — nothing reads this column
 * yet.
 *
 * ## ADDITIVE — never touches the layout
 * A brand-new table. It does NOT touch `chat_canvas_layouts`, `canvas_nodes`, or
 * `canvas_edges` — it references their keys by value only. Its mere existence
 * changes no canvas runtime behavior.
 */

import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { AuthUsers } from "./_auth";
import { ChatConversations } from "./chat-conversations";

// ---------------------------------------------------------------------------
// canvas_recipes — a named, persisted dataflow recipe (Phase 73, LCAN-07)
// ---------------------------------------------------------------------------
export const CanvasRecipes = pgTable(
  "canvas_recipes",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Direct ownership anchor (house style, mirrors spreadsheets.user_id /
    // canvases.owner_user_id). Cascade so a deleted user's recipes go with them.
    userId: uuid("user_id")
      .notNull()
      .references(() => AuthUsers.id, { onDelete: "cascade" }),

    // Scope: the conversation whose canvas this recipe names. Cascade so a
    // deleted conversation removes its recipes (mirrors canvases.conversation_id).
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => ChatConversations.id, { onDelete: "cascade" }),

    name: text("name").notNull().default("Untitled recipe"),

    // string[] of the canonical node keys this recipe groups. TEXT keys as jsonb,
    // NOT FKs (mirrors canvas_edges endpoints — tolerates healed / not-yet-
    // persisted keys).
    nodeKeys: jsonb("node_keys").$type<string[]>().notNull().default([]),

    // string[] of the edge keys this recipe groups. Same no-FK rationale.
    edgeKeys: jsonb("edge_keys").$type<string[]>().notNull().default([]),

    // The durable re-poll descriptor (LCAN-09). Stored but NOT YET consumed —
    // nothing reads it this phase; the after-close recompute worker is a named
    // live-only followup.
    sourceRef: jsonb("source_ref"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // "recipes on this conversation's canvas" list (newest first).
    canvasRecipesConversationIdIdx: index(
      "idx_canvas_recipes_conversation_id",
    ).on(t.conversationId),
    // Ownership lookups + the per-user recipes list.
    canvasRecipesUserIdIdx: index("idx_canvas_recipes_user_id").on(t.userId),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type CanvasRecipeRow = typeof CanvasRecipes.$inferSelect;
export type InsertCanvasRecipe = typeof CanvasRecipes.$inferInsert;
