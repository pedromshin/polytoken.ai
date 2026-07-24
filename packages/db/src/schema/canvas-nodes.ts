/**
 * Track 3b — Canvas promotion: the `canvas_nodes` table (D9).
 *
 * A first-class row per canvas node — the relational successor to an element of
 * the `chat_canvas_layouts.nodes` JSONB array. Moving to per-node rows closes
 * the whole-row last-write-wins race the blob has (20-track3-design D9,
 * 03-doc §2.3): an agent add is now a single-row upsert, not a read-modify-write
 * of the entire board.
 *
 * ## Node identity — the canonical `type:ref` key
 * `node_key` is the canonical id the client and agent already agree on
 * (`chat:<convId>`, `genui-panel:<msg>:<part>`, `source:<ledgerId>`, …). It is
 * UNIQUE per canvas (`unique(canvas_id, node_key)`) — idempotency promoted from
 * an app convention (canonicalNodeId) to a DB invariant, so an agent adding the
 * same referenced object twice can never duplicate a node.
 *
 * ## `data` — ref-only, with two deliberate exceptions
 * `data` carries only provenance/identity refs for 11 of the 13 node types; the
 * two content-carrying types (`source` — url/title/excerpt; `directory` —
 * entries preview) migrate their inline display payload here verbatim. It NEVER
 * carries genui spec content (D-05) — that invariant is enforced at the WRITE
 * boundary by `CanvasSnapshotSchema` (applied in CanvasRepository), not by this
 * column. An unrecognized `type` (the `unknown-node-type` heal path) round-trips
 * with its original type/data intact — the column is plain text/jsonb, so any
 * type string survives.
 *
 * ## Tenancy / RLS (0052)
 * No denormalized `workspace_id` — the row scopes through its parent canvas via a
 * nested-EXISTS RLS policy (hand-appended in 0052). Defense-in-depth only (the
 * app bypasses RLS as superuser/service_role). UNPROVEN-IN-CONTAINER — Track-2 CI
 * gated. Cascade-delete of a node's edges is done at the app layer
 * (CanvasRepository.removeNode), deliberately NOT via FK cascade (edges reference
 * node KEYS as text, not FKs — D9).
 */

import {
  index,
  jsonb,
  pgTable,
  real,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { Canvases } from "./canvases";

// ---------------------------------------------------------------------------
// canvas_nodes — a first-class node row (Track 3b, D9)
// ---------------------------------------------------------------------------
export const CanvasNodes = pgTable(
  "canvas_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    canvasId: uuid("canvas_id")
      .notNull()
      .references(() => Canvases.id, { onDelete: "cascade" }),

    // Canonical `type:ref` id — the idempotency key (unique per canvas below).
    nodeKey: text("node_key").notNull(),

    // One of the 13 registered node types, or `unknown-node-type` (heal path).
    type: text("type").notNull(),

    // { x, y } — every node has a placed position (D-06 exact-restore).
    position: jsonb("position").notNull(),

    // Optional persisted size.
    width: real("width"),
    height: real("height"),

    // Ref-only for 11 types; `source`/`directory` carry inline payload. Never
    // genui spec (enforced at the write boundary by CanvasSnapshotSchema).
    data: jsonb("data").notNull().default({}),
  },
  (t) => ({
    // Idempotency as a DB invariant — one node per canonical key per canvas.
    canvasNodesKeyUnique: unique("uq_canvas_nodes_canvas_node_key").on(
      t.canvasId,
      t.nodeKey,
    ),
    // "load this canvas's nodes".
    canvasNodesCanvasIdIdx: index("idx_canvas_nodes_canvas_id").on(t.canvasId),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type CanvasNodeRow = typeof CanvasNodes.$inferSelect;
export type InsertCanvasNode = typeof CanvasNodes.$inferInsert;
