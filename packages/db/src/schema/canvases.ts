/**
 * Track 3b — Canvas promotion: the `canvases` table (D9/D10).
 *
 * Promotes the per-conversation `chat_canvas_layouts` JSONB blob into a
 * first-class Workspace → Canvas → Node model. A canvas is the greenfield
 * container that owns node/edge rows (canvas-nodes.ts / canvas-edges.ts); this
 * table is the parent every node/edge scopes through.
 *
 * ADDITIVE — this table (and canvas_nodes / canvas_edges) is created alongside,
 * never in place of, `chat_canvas_layouts`. The row model ships behind the
 * `CANVAS_ROW_MODEL` flag (default off), so its mere existence changes no
 * runtime behavior; the blob is demoted, never dropped (see 20-track3-design
 * D10 and the P7–P11 runbook).
 *
 * ## Two kinds (retires the 0046 `scope='home'` bolt-on)
 *
 * A canvas is EITHER conversation-scoped (`kind='conversation'`, one per
 * `conversation_id`) OR the user's pinned home board (`kind='home'`, one per
 * `owner_user_id`, no conversation). The blob expressed this with a nullable FK
 * + a three-way CHECK on ONE overloaded row; here the two identities are two
 * `kind`s of a first-class row with its own owner and workspace. The
 * discriminator CHECK
 * (`(kind='conversation' AND conversation_id IS NOT NULL) OR
 *   (kind='home' AND conversation_id IS NULL)`) and the two partial-unique
 * indexes (`conversation_id WHERE conversation_id IS NOT NULL`,
 * `owner_user_id WHERE kind='home'`) are hand-appended in migration 0052 — the
 * successor to the 0046 discriminator + home-user partial index.
 *
 * ## Shape
 *   - `workspace_id` — the containment edge (→ workspaces, cascade). The backfill
 *     seeds every user an auto-created personal workspace and homes their
 *     canvases in it.
 *   - `owner_user_id` — the direct ownership anchor (→ auth.users, cascade),
 *     house style (mirrors workspaces.owner_user_id / documents.user_id). Cheap
 *     direct scoping for `assertCanvasOwnership`.
 *   - `conversation_id` — NULLABLE (→ chat_conversations, cascade); set only on a
 *     conversation canvas, NULL on a home board.
 *   - `viewport` / `shared_state` / `node_registry_version` — carried over from the
 *     blob row verbatim. `shared_state` also holds the home board's `home.panels`
 *     key (the D-10 cross-panel store), NOT NULL default '{}'.
 *
 * ## Tenancy / RLS (0052, mirrors 0047 caveat)
 * `canvases` mirrors the 0047 `workspaces_member_authenticated` member-visibility
 * policy (owner OR workspace member may read; owner writes) + RESTRICTIVE
 * anon-deny. RLS is DEFENSE-IN-DEPTH ONLY — Drizzle connects as the Postgres
 * superuser and FastAPI as service_role, both bypass RLS; the primary wall is the
 * app boundary (assertCanvasOwnership + the tRPC procedures). The RLS block,
 * partial-unique indexes, and CHECK are hand-appended in 0052 and are
 * UNPROVEN-IN-CONTAINER (no pgvector, no Supabase auth schema here) — Track-2 CI
 * gated before P7 applies them.
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
import { Workspaces } from "./workspaces";

// ---------------------------------------------------------------------------
// canvases — the first-class board (Track 3b, D9)
// ---------------------------------------------------------------------------
export const Canvases = pgTable(
  "canvases",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Containment: a canvas lives in a workspace. Cascade so a deleted workspace
    // removes its canvases (and their nodes/edges cascade in turn).
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => Workspaces.id, { onDelete: "cascade" }),

    // Direct ownership anchor (house style, mirrors workspaces.owner_user_id).
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => AuthUsers.id, { onDelete: "cascade" }),

    // NULLABLE — set on a conversation canvas, NULL on a home board (enforced by
    // the hand-appended kind discriminator CHECK in 0052).
    conversationId: uuid("conversation_id").references(
      () => ChatConversations.id,
      { onDelete: "cascade" },
    ),

    // 'conversation' | 'home' — constrained by the 0052 discriminator CHECK.
    kind: text("kind").notNull(),

    name: text("name").notNull().default("Untitled canvas"),

    // { x, y, zoom } — nullable until the first pan/zoom is persisted.
    viewport: jsonb("viewport"),

    // D-08/D-10 cross-panel store contents (panels.*/shared.*; the home board's
    // `home.panels` key rides here too). Never spec content.
    sharedState: jsonb("shared_state").notNull().default({}),

    // D-04: NODE_TYPE_REGISTRY content-hash active at save time (agent sentinel /
    // home-v1 / the client's live hash). Nullable — an auto-created canvas has
    // none until the first save stamps it.
    nodeRegistryVersion: text("node_registry_version"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // "canvases in this workspace" list.
    canvasesWorkspaceIdIdx: index("idx_canvases_workspace_id").on(
      t.workspaceId,
    ),
    // "canvases I own" lookups + the assertCanvasOwnership resolve path.
    canvasesOwnerUserIdIdx: index("idx_canvases_owner_user_id").on(
      t.ownerUserId,
    ),
    // NOTE: the two partial-unique indexes
    //   unique(conversation_id) WHERE conversation_id IS NOT NULL
    //   unique(owner_user_id)   WHERE kind = 'home'
    // and the kind-discriminator CHECK are hand-appended in migration 0052 (they
    // reference literal predicates / are defense-in-depth alongside the RLS
    // block). They are deliberately NOT declared here so `drizzle-kit generate`
    // emits a clean table-only diff — mirrors the 0047 CHECK convention.
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type CanvasRow = typeof Canvases.$inferSelect;
export type InsertCanvas = typeof Canvases.$inferInsert;
