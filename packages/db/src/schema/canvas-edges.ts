/**
 * Track 3b — Canvas promotion: the `canvas_edges` table (D9).
 *
 * A first-class row per canvas edge — the relational successor to an element of
 * the `chat_canvas_layouts.edges` JSONB array. An edge wires a source node's
 * dotted store path to a target node's store key
 * (`data = { sourcePath, targetKey }`, resolved through the canvas-store grammar).
 *
 * ## Endpoints are node KEYS as TEXT — NOT foreign keys (D9)
 * `source_key` / `target_key` reference `canvas_nodes.node_key` values, but are
 * plain TEXT columns with NO FK. This is deliberate: a hard FK + ON DELETE
 * CASCADE would REJECT valid edges to nodes that are not yet persisted
 * (lazily-materialized genui-panel nodes, the client-synthesized default chat
 * node) and would break heal-on-restore for unknown-type nodes (03-doc §3.3,
 * §6.3). Edge cleanup on node removal is therefore an app-layer transactional
 * delete (CanvasRepository.removeNode: `DELETE canvas_edges WHERE source_key=? OR
 * target_key=?`), the equivalent of the rejected FK cascade.
 *
 * `edge_key` is UNIQUE per canvas (`unique(canvas_id, edge_key)`) — idempotent
 * connect promoted to a DB invariant, mirroring canvas_nodes' node_key.
 *
 * ## Tenancy / RLS (0052)
 * Scopes through its parent canvas via a nested-EXISTS RLS policy (hand-appended
 * in 0052), same idiom as canvas_nodes. Defense-in-depth only; the app bypasses
 * RLS. UNPROVEN-IN-CONTAINER — Track-2 CI gated.
 */

import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { Canvases } from "./canvases";

// ---------------------------------------------------------------------------
// canvas_edges — a first-class edge row (Track 3b, D9)
// ---------------------------------------------------------------------------
export const CanvasEdges = pgTable(
  "canvas_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    canvasId: uuid("canvas_id")
      .notNull()
      .references(() => Canvases.id, { onDelete: "cascade" }),

    // The edge's own idempotency key (unique per canvas below).
    edgeKey: text("edge_key").notNull(),

    // Endpoint node keys — TEXT, NOT FKs (see module header). They reference
    // canvas_nodes.node_key values but must tolerate not-yet-persisted / healed
    // node keys, so no FK is declared.
    sourceKey: text("source_key").notNull(),
    targetKey: text("target_key").notNull(),

    // { sourcePath, targetKey } — the dotted-path wiring payload.
    data: jsonb("data"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Idempotency as a DB invariant — one edge per canonical key per canvas.
    canvasEdgesKeyUnique: unique("uq_canvas_edges_canvas_edge_key").on(
      t.canvasId,
      t.edgeKey,
    ),
    // "load this canvas's edges".
    canvasEdgesCanvasIdIdx: index("idx_canvas_edges_canvas_id").on(t.canvasId),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type CanvasEdgeRow = typeof CanvasEdges.$inferSelect;
export type InsertCanvasEdge = typeof CanvasEdges.$inferInsert;
