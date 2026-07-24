/**
 * chat/canvas-store-backend.ts — Track 3b B3: the CANVAS_ROW_MODEL flag + the two
 * persistence backends (BlobStore / RowStore) behind the SEVEN unchanged canvas
 * procedures (getCanvasLayout / saveCanvasLayout / getHomeCanvasLayout /
 * saveHomeCanvasLayout / addCanvasNode / connectCanvasNodes / removeCanvasNode).
 *
 * The wire contract — `CanvasSnapshotSchema` and every procedure's input/output
 * shape — is UNCHANGED; only the storage backend is swapped. Web consumers
 * (useCanvasPersistence, ChatCanvas, TranscriptPanelHost, HomeBoard, useSendTo)
 * do NOT change: `read*` returns the SAME ChatCanvasLayoutRow shape in every mode.
 *
 * ## The flag (read at CALL time, not module init — mirrors _listener-config.ts)
 *   CANVAS_ROW_MODEL =
 *     - `off` (default) — BlobStore only. Byte-for-byte today's behavior; the row
 *       tables are never touched. ZERO runtime change.
 *     - `dual_write`   — blob authoritative (written + returned); the row write is
 *       BEST-EFFORT (logged, never breaks the request). Reads come from the blob.
 *     - `read_rows`    — reads come from RowStore (falling back to the blob if the
 *       canvas has not been created/backfilled yet); writes stay DUAL (blob still
 *       authoritative). The whole-row LWW race closes here (agent writes go
 *       per-row via CanvasRepository).
 * The blob is never dropped — only demoted (D10). A `read_rows` flip is gated by
 * the real-browser gates + the shadow-compare parity test (P8→P10).
 *
 * ## BlobStore — extracted BYTE-FOR-BYTE from canvas.ts / home-canvas.ts /
 * canvas-mutations.ts, so `off` (and the authoritative blob write under
 * dual_write/read_rows) is exactly the prior upsert (same conflict target, same
 * inline `scope='home'` targetWhere literal, same `updatedAt: new Date()`).
 *
 * ## RowStore — delegates to `@polytoken/db`'s CanvasRepository (B2), resolving a
 * canvasId from the conversationId (or the home key) and AUTO-CREATING on first
 * write: it finds-or-creates the owner's personal workspace (mirrors
 * workspaces.create's owner-membership seeding) and inserts the canvas row.
 */

import { and, asc, eq, sql } from "drizzle-orm";

import {
  addNode as repoAddNode,
  applySnapshot,
  assembleSnapshot,
  connect as repoConnect,
  removeNode as repoRemoveNode,
  type AddNodeResult,
  type CanvasRepositoryDb,
  type ConnectResult,
  type RemoveNodeResult,
} from "@polytoken/db/canvas-repository";
import {
  Canvases,
  ChatCanvasLayouts,
  Workspaces,
  WorkspaceMembers,
  type CanvasRow,
  type ChatCanvasLayoutRow,
} from "@polytoken/db/schema";

import { CanvasSnapshotSchema, type CanvasSnapshot } from "./canvas-schema";

/** The Drizzle handle every backend function accepts (== the tRPC ctx.db type). */
type CanvasStoreDb = CanvasRepositoryDb;

/**
 * The single `scope` value a home-board blob row carries (0046). Mirrored here as
 * a local literal so this module does not import home-canvas.ts (which imports
 * THIS module — avoids a cycle). MUST match home-canvas.ts's HOME_CANVAS_SCOPE.
 */
const HOME_SCOPE = "home" as const;

// ---------------------------------------------------------------------------
// The flag
// ---------------------------------------------------------------------------

export type CanvasRowMode = "off" | "dual_write" | "read_rows";

/** Read CANVAS_ROW_MODEL at CALL time (not module init) — default `off`; any
 * unrecognized value is treated as `off` (fail-safe to today's behavior). */
export function canvasRowMode(): CanvasRowMode {
  // eslint-disable-next-line no-restricted-properties
  const raw = process.env.CANVAS_ROW_MODEL;
  if (raw === "dual_write" || raw === "read_rows") return raw;
  return "off";
}

// ---------------------------------------------------------------------------
// Structured server-side logger (mirrors models.ts's logError)
// ---------------------------------------------------------------------------

function logError(event: string, detail: unknown): void {
  process.stderr.write(
    JSON.stringify({
      procedure: "chat.canvas-store-backend",
      event,
      detail:
        detail instanceof Error
          ? { message: detail.message, name: detail.name }
          : String(detail),
      ts: new Date().toISOString(),
    }) + "\n",
  );
}

/** Run a RowStore write BEST-EFFORT — an error is logged and swallowed so the
 * authoritative blob write (already done) never fails the request (D10). */
export async function bestEffortRowWrite(
  op: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logError(op, err);
  }
}

// ===========================================================================
// BlobStore — extracted verbatim from the existing procedures
// ===========================================================================

export async function readConversationBlob(
  db: CanvasStoreDb,
  conversationId: string,
): Promise<ChatCanvasLayoutRow | null> {
  const [row] = await db
    .select()
    .from(ChatCanvasLayouts)
    .where(eq(ChatCanvasLayouts.conversationId, conversationId))
    .limit(1);
  return row ?? null;
}

export async function writeConversationBlob(
  db: CanvasStoreDb,
  conversationId: string,
  snapshot: CanvasSnapshot,
): Promise<void> {
  await db
    .insert(ChatCanvasLayouts)
    .values({
      conversationId,
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      viewport: snapshot.viewport ?? null,
      sharedState: snapshot.sharedState,
      nodeRegistryVersion: snapshot.nodeRegistryVersion,
    })
    .onConflictDoUpdate({
      target: ChatCanvasLayouts.conversationId,
      set: {
        nodes: snapshot.nodes,
        edges: snapshot.edges,
        viewport: snapshot.viewport ?? null,
        sharedState: snapshot.sharedState,
        nodeRegistryVersion: snapshot.nodeRegistryVersion,
        updatedAt: new Date(),
      },
    });
}

export async function readHomeBlob(
  db: CanvasStoreDb,
  userId: string,
): Promise<ChatCanvasLayoutRow | null> {
  const [row] = await db
    .select()
    .from(ChatCanvasLayouts)
    .where(
      and(
        eq(ChatCanvasLayouts.userId, userId),
        eq(ChatCanvasLayouts.scope, HOME_SCOPE),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function writeHomeBlob(
  db: CanvasStoreDb,
  userId: string,
  snapshot: CanvasSnapshot,
): Promise<void> {
  await db
    .insert(ChatCanvasLayouts)
    .values({
      conversationId: null,
      userId,
      scope: HOME_SCOPE,
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      viewport: snapshot.viewport ?? null,
      sharedState: snapshot.sharedState,
      nodeRegistryVersion: snapshot.nodeRegistryVersion,
    })
    .onConflictDoUpdate({
      target: ChatCanvasLayouts.userId,
      // Inline literal (not eq(...)): a parameterized partial-index predicate
      // can't be matched to the partial unique index under prepared statements
      // (skeptic finding — preserved verbatim from home-canvas.ts).
      targetWhere: sql`${ChatCanvasLayouts.scope} = 'home'`,
      set: {
        nodes: snapshot.nodes,
        edges: snapshot.edges,
        viewport: snapshot.viewport ?? null,
        sharedState: snapshot.sharedState,
        nodeRegistryVersion: snapshot.nodeRegistryVersion,
        updatedAt: new Date(),
      },
    });
}

// ===========================================================================
// RowStore — canvasId resolution + auto-create, delegating to CanvasRepository
// ===========================================================================

/** Find-or-create the owner's personal workspace (mirrors workspaces.create's
 * owner-membership seeding), so an auto-created canvas has a valid workspace_id.
 *
 * Accepted low-severity race: a user legitimately owns MANY workspaces, so there is no
 * unique constraint on owner_user_id to onConflict against — concurrent FIRST-writes for
 * a brand-new user (before any workspace exists) can create a duplicate 'Personal'
 * workspace. This is benign: the find always returns the OLDEST (createdAt asc), so reads
 * are deterministic and the duplicate is just an extra empty workspace row. A stricter
 * fix would require a workspace-model decision (a dedicated is_personal flag + partial
 * unique index) that is out of scope for the row-model cutover. */
async function ensurePersonalWorkspace(
  db: CanvasStoreDb,
  ownerUserId: string,
): Promise<string> {
  const existing = await db
    .select({ id: Workspaces.id })
    .from(Workspaces)
    .where(eq(Workspaces.ownerUserId, ownerUserId))
    .orderBy(asc(Workspaces.createdAt))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const inserted = await db
    .insert(Workspaces)
    .values({ ownerUserId, name: "Personal" })
    .returning({ id: Workspaces.id });
  const id = inserted[0]?.id;
  if (!id) throw new Error("workspace insert returned no id");

  await db
    .insert(WorkspaceMembers)
    .values({ workspaceId: id, userId: ownerUserId, role: "owner" });
  return id;
}

async function findConversationCanvasId(
  db: CanvasStoreDb,
  conversationId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: Canvases.id })
    .from(Canvases)
    .where(eq(Canvases.conversationId, conversationId))
    .limit(1);
  return row?.id ?? null;
}

async function ensureConversationCanvasId(
  db: CanvasStoreDb,
  conversationId: string,
  ownerUserId: string,
): Promise<string> {
  const existing = await findConversationCanvasId(db, conversationId);
  if (existing) return existing;

  const workspaceId = await ensurePersonalWorkspace(db, ownerUserId);
  // Race-safe first-create: a concurrent create (a parallel agent op, or an agent
  // addNodeRow overlapping the client's best-effort autosave writeConversationRow)
  // would otherwise both pass the `existing` check and the second INSERT would
  // violate the partial unique index idx_canvases_conversation_id — surfacing as an
  // unhandled 500 on the read_rows agent path. onConflictDoNothing + re-select makes
  // the first-write idempotent, mirroring the blob writers' onConflict idiom above.
  const inserted = await db
    .insert(Canvases)
    .values({ workspaceId, ownerUserId, conversationId, kind: "conversation" })
    .onConflictDoNothing({
      target: Canvases.conversationId,
      where: sql`${Canvases.conversationId} is not null`,
    })
    .returning({ id: Canvases.id });
  if (inserted[0]?.id) return inserted[0].id;
  // Conflict (DO NOTHING → empty returning): a concurrent create won the unique index.
  // Re-select the row it committed rather than throwing a 500.
  const id = await findConversationCanvasId(db, conversationId);
  if (!id) throw new Error("canvas insert/select returned no id");
  return id;
}

async function findHomeCanvasId(
  db: CanvasStoreDb,
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: Canvases.id })
    .from(Canvases)
    .where(and(eq(Canvases.ownerUserId, userId), eq(Canvases.kind, HOME_SCOPE)))
    .limit(1);
  return row?.id ?? null;
}

async function ensureHomeCanvasId(
  db: CanvasStoreDb,
  userId: string,
): Promise<string> {
  const existing = await findHomeCanvasId(db, userId);
  if (existing) return existing;

  const workspaceId = await ensurePersonalWorkspace(db, userId);
  // Race-safe first-create (see ensureConversationCanvasId): concurrent home writes
  // would violate the partial unique index idx_canvases_home_owner. onConflictDoNothing
  // + re-select makes it idempotent.
  const inserted = await db
    .insert(Canvases)
    .values({
      workspaceId,
      ownerUserId: userId,
      conversationId: null,
      kind: HOME_SCOPE,
    })
    .onConflictDoNothing({
      target: Canvases.ownerUserId,
      where: sql`${Canvases.kind} = 'home'`,
    })
    .returning({ id: Canvases.id });
  if (inserted[0]?.id) return inserted[0].id;
  const id = await findHomeCanvasId(db, userId);
  if (!id) throw new Error("home canvas insert/select returned no id");
  return id;
}

/** Build the ChatCanvasLayoutRow shape the web consumers expect from a canvas row
 * + its assembled snapshot — so `read_rows` is invisible to React (same shape). */
function buildRow(
  canvas: CanvasRow,
  snap: CanvasSnapshot,
  ids: {
    conversationId: string | null;
    userId: string | null;
    scope: string | null;
  },
): ChatCanvasLayoutRow {
  return {
    id: canvas.id,
    conversationId: ids.conversationId,
    userId: ids.userId,
    scope: ids.scope,
    nodes: snap.nodes,
    edges: snap.edges,
    viewport: snap.viewport ?? null,
    sharedState: snap.sharedState,
    nodeRegistryVersion: snap.nodeRegistryVersion,
    createdAt: canvas.createdAt,
    updatedAt: canvas.updatedAt,
  };
}

/** True when the assembled ROW snapshot is at least as complete as the blob (>= nodes
 * AND >= edges). Under read_rows an agent op (addNodeRow) can mint a canvas that is a
 * strict SUBSET of a richer pre-existing blob before the P9 backfill reconciles it;
 * preferring the blob whenever the row is behind closes that data-loss window. The blob
 * is still dual-written under read_rows, so it is current. Once the backfill brings rows
 * to parity, per-row agent writes keep them >= blob, so the row wins (LWW race closed). */
function rowAtLeastAsRich(
  row: ChatCanvasLayoutRow,
  blob: ChatCanvasLayoutRow,
): boolean {
  const len = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
  return len(row.nodes) >= len(blob.nodes) && len(row.edges) >= len(blob.edges);
}

export async function readConversationRow(
  db: CanvasStoreDb,
  conversationId: string,
): Promise<ChatCanvasLayoutRow | null> {
  const [canvas] = await db
    .select()
    .from(Canvases)
    .where(eq(Canvases.conversationId, conversationId))
    .limit(1);
  if (!canvas) return null;
  const snap = await assembleSnapshot(db, canvas.id);
  if (!snap) return null;
  return buildRow(canvas, snap, {
    conversationId,
    userId: null,
    scope: null,
  });
}

export async function writeConversationRow(
  db: CanvasStoreDb,
  conversationId: string,
  ownerUserId: string,
  snapshot: CanvasSnapshot,
): Promise<void> {
  const canvasId = await ensureConversationCanvasId(
    db,
    conversationId,
    ownerUserId,
  );
  await applySnapshot(db, canvasId, snapshot, CanvasSnapshotSchema.parse);
}

export async function readHomeRow(
  db: CanvasStoreDb,
  userId: string,
): Promise<ChatCanvasLayoutRow | null> {
  const [canvas] = await db
    .select()
    .from(Canvases)
    .where(and(eq(Canvases.ownerUserId, userId), eq(Canvases.kind, HOME_SCOPE)))
    .limit(1);
  if (!canvas) return null;
  const snap = await assembleSnapshot(db, canvas.id);
  if (!snap) return null;
  return buildRow(canvas, snap, {
    conversationId: null,
    userId,
    scope: HOME_SCOPE,
  });
}

export async function writeHomeRow(
  db: CanvasStoreDb,
  userId: string,
  snapshot: CanvasSnapshot,
): Promise<void> {
  const canvasId = await ensureHomeCanvasId(db, userId);
  await applySnapshot(db, canvasId, snapshot, CanvasSnapshotSchema.parse);
}

// RowStore — agent single-op path (delegates to CanvasRepository).

export async function addNodeRow(
  db: CanvasStoreDb,
  conversationId: string,
  ownerUserId: string,
  nodeType: string,
  data: Record<string, unknown>,
  position?: { x: number; y: number },
): Promise<AddNodeResult> {
  const canvasId = await ensureConversationCanvasId(
    db,
    conversationId,
    ownerUserId,
  );
  return repoAddNode(db, canvasId, nodeType, data, position);
}

export async function connectRow(
  db: CanvasStoreDb,
  conversationId: string,
  ownerUserId: string,
  sourceNodeKey: string,
  targetNodeKey: string,
  sourcePath: string,
  targetKey: string,
): Promise<ConnectResult> {
  const canvasId = await ensureConversationCanvasId(
    db,
    conversationId,
    ownerUserId,
  );
  return repoConnect(db, canvasId, sourceNodeKey, targetNodeKey, sourcePath, targetKey);
}

export async function removeNodeRow(
  db: CanvasStoreDb,
  conversationId: string,
  nodeKey: string,
): Promise<RemoveNodeResult> {
  const canvasId = await findConversationCanvasId(db, conversationId);
  if (!canvasId) return { removed: false, node: null, detachedEdges: [] };
  return repoRemoveNode(db, canvasId, nodeKey);
}

// ===========================================================================
// Orchestrators — the 4 layout procedures call these (mode branches here)
// ===========================================================================

export async function readCanvasLayout(
  db: CanvasStoreDb,
  conversationId: string,
): Promise<ChatCanvasLayoutRow | null> {
  if (canvasRowMode() === "read_rows") {
    const [row, blob] = await Promise.all([
      readConversationRow(db, conversationId),
      readConversationBlob(db, conversationId),
    ]);
    // Prefer the row ONLY when it exists and is not BEHIND the blob. A canvas can be a
    // strict subset of the blob (an agent addNode minted a 1-node canvas over an N-node
    // blob) until the P9 backfill reconciles it — in that window the richer blob wins,
    // so read_rows never shows LESS than dual_write did (closes the partial-canvas
    // data-loss window). Keying the fallback on parity, not mere row EXISTENCE.
    if (row && (!blob || rowAtLeastAsRich(row, blob))) return row;
    return blob;
  }
  return readConversationBlob(db, conversationId);
}

export async function writeCanvasLayout(
  db: CanvasStoreDb,
  conversationId: string,
  ownerUserId: string,
  snapshot: CanvasSnapshot,
): Promise<void> {
  // Blob stays authoritative in EVERY non-off mode (D10 — demote, never drop).
  await writeConversationBlob(db, conversationId, snapshot);
  if (canvasRowMode() !== "off") {
    await bestEffortRowWrite("saveCanvasLayout", () =>
      writeConversationRow(db, conversationId, ownerUserId, snapshot),
    );
  }
}

export async function readHomeCanvasLayout(
  db: CanvasStoreDb,
  userId: string,
): Promise<ChatCanvasLayoutRow | null> {
  if (canvasRowMode() === "read_rows") {
    const [row, blob] = await Promise.all([
      readHomeRow(db, userId),
      readHomeBlob(db, userId),
    ]);
    // Parity fallback (see readCanvasLayout): the richer blob wins until the row is
    // backfilled to parity, so a partial home canvas can't shadow a richer blob.
    if (row && (!blob || rowAtLeastAsRich(row, blob))) return row;
    return blob;
  }
  return readHomeBlob(db, userId);
}

export async function writeHomeCanvasLayout(
  db: CanvasStoreDb,
  userId: string,
  snapshot: CanvasSnapshot,
): Promise<void> {
  await writeHomeBlob(db, userId, snapshot);
  if (canvasRowMode() !== "off") {
    await bestEffortRowWrite("saveHomeCanvasLayout", () =>
      writeHomeRow(db, userId, snapshot),
    );
  }
}
