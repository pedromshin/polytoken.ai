/**
 * canvas-repository.ts — the SINGLE row-model write path for Track 3b (D9/D10, B2).
 *
 * One repository both the tRPC procedures and the agent path call, so there is
 * never a second divergent decomposition of a canvas into rows. Drizzle-handle-
 * first (the handle is always the FIRST parameter — callers pass ctx.db or the
 * imported db), exactly like ownership.ts, so it stays test-injectable and
 * framework-agnostic; a fake thenable-chain stub covers it with no real DB.
 *
 * It replaces the whole-row last-write-wins upsert of `chat_canvas_layouts` with
 * per-row operations against `canvases` / `canvas_nodes` / `canvas_edges`:
 *   - assembleSnapshot — rows -> a CanvasSnapshot-shaped object (the client still
 *     synthesizes the default chat node on restore, so assemble just returns the
 *     stored rows; node/edge order is key-sorted for a deterministic result, as
 *     positions are absolute so order is not semantically significant).
 *   - applySnapshot   — parse FIRST (the injected CanvasSnapshotSchema.parse — see
 *     the dependency note below), then diff against current rows in ONE
 *     transaction: upsert every snapshot node/edge (idempotent on the canonical
 *     key), delete the rows the snapshot dropped, and stamp the canvas row's
 *     viewport / shared_state / node_registry_version. Caps become COUNT checks.
 *   - addNode  — one insert, idempotent on (canvas_id, node_key) — the agent
 *     path; closes the whole-row LWW race the blob has.
 *   - connect  — one insert, idempotent on (canvas_id, edge_key).
 *   - removeNode — delete the node AND its edges in ONE transaction (the app-layer
 *     equivalent of the FK cascade deliberately NOT declared on canvas_edges, D9).
 *
 * ## What it preserves (03-doc §6 invariants — verified by the B2 round-trip test)
 *   - All 13 node types + the `unknown-node-type` heal path: `type`/`data` are
 *     plain text/jsonb, so any type string (incl. an unrecognized one) round-trips
 *     with its original type + data intact.
 *   - The two content-carrying types (`source` url/title/excerpt; `directory`
 *     entries preview) migrate their inline `data` payload verbatim.
 *   - viewport, sharedState (incl. the home board's `home.panels` key),
 *     nodeRegistryVersion.
 *   - The canonical `type:ref` node id + the per-object idempotency of the agent
 *     add (canonicalNodeId — mirrored below).
 *
 * ## Dependency note (a deliberate, documented deviation from 20-track3-design B2)
 * The design writes `applySnapshot → CanvasSnapshotSchema.parse FIRST`, assuming
 * the repository can import that schema directly. It cannot: `CanvasSnapshotSchema`
 * lives in `@polytoken/api-client` (which depends on `@polytoken/db`), so importing
 * it here would be a dependency CYCLE — and the schema must stay the client-safe
 * ZERO-dependency module it is (moving it into `@polytoken/db` would pull db's
 * server-only Postgres client into browser bundles, the exact failure its own
 * header documents). So `parse` is INJECTED (B3 passes `CanvasSnapshotSchema.parse`)
 * and still called FIRST — every write-time gate (D-05 no-spec, prototype-
 * pollution, the caps, sharedState size) is preserved, just via dependency
 * inversion instead of a direct import. The COUNT-based caps below are an
 * additional row-model gate (they also hold under an identity parse).
 *
 * canonicalNodeId is MIRRORED from `@polytoken/api-client`'s canvas-mutations.ts
 * for the same reason (no cycle) and MUST stay in lockstep with it and with the
 * web client's use-canvas-persistence helpers — the canonical `type:ref` scheme is
 * one logical source, physically mirrored across the package boundary (the same
 * pattern node-data-schemas.ts and the Python capability registry use).
 */

import { and, asc, eq, notInArray, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "./schema";
import { CanvasEdges } from "./schema/canvas-edges";
import { CanvasNodes } from "./schema/canvas-nodes";
import { Canvases } from "./schema/canvases";

/** The Drizzle handle every repository function accepts as its first parameter. */
export type CanvasRepositoryDb = PostgresJsDatabase<typeof schema>;

// ---------------------------------------------------------------------------
// Caps — MIRROR of @polytoken/api-client canvas-schema.ts (T-23-04). Kept local
// so packages/db does not depend on api-client (see the dependency note above);
// MUST stay in lockstep with the values there.
// ---------------------------------------------------------------------------
export const MAX_CANVAS_NODES = 200;
export const MAX_CANVAS_EDGES = 400;
export const MAX_SHARED_STATE_SERIALIZED_CHARS = 100_000;

/**
 * The node_registry_version stamped when a canvas row carries none yet (an
 * auto-created row before its first real save). Mirrors canvas-mutations.ts's
 * AGENT_CANVAS_REGISTRY_VERSION sentinel; the client's first debounced save
 * replaces it with the live NODE_TYPE_REGISTRY hash.
 */
export const CANVAS_ROW_FALLBACK_REGISTRY_VERSION = "agent-canvas-mutation:v1";

// ---------------------------------------------------------------------------
// Snapshot shape — a structural MIRROR of api-client's CanvasSnapshot
// (z.infer<CanvasSnapshotSchema>). Structurally identical, so a value produced by
// the real schema is assignable to these types and vice-versa.
// ---------------------------------------------------------------------------
export type CanvasSnapshotNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  data: Record<string, unknown>;
};

export type CanvasSnapshotEdge = {
  id: string;
  source: string;
  target: string;
  data: { sourcePath: string; targetKey: string };
};

export type CanvasSnapshot = {
  nodes: CanvasSnapshotNode[];
  edges: CanvasSnapshotEdge[];
  viewport?: { x: number; y: number; zoom: number };
  sharedState: Record<string, unknown>;
  nodeRegistryVersion: string;
};

/** The injected trust boundary — B3 passes `CanvasSnapshotSchema.parse`. */
export type ParseSnapshot = (raw: unknown) => CanvasSnapshot;

/**
 * Thrown by the repository for a row-model precondition failure (cap exceeded, a
 * connect endpoint missing). packages/db must not depend on @trpc/server, so this
 * carries a `code` the api-client boundary (B3) maps to a TRPCError.
 */
export class CanvasRepositoryError extends Error {
  readonly code: "CAP_EXCEEDED" | "ENDPOINT_MISSING";

  constructor(code: "CAP_EXCEEDED" | "ENDPOINT_MISSING", message: string) {
    super(message);
    this.name = "CanvasRepositoryError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Canonical key helpers (mirrors — see the module header)
// ---------------------------------------------------------------------------

/**
 * canonicalNodeId — the `type:ref` id scheme, MIRRORED verbatim from
 * canvas-mutations.ts. A canonical id makes an agent add idempotent per
 * referenced object; ref-less panel types get a random suffix.
 */
export function canonicalNodeId(
  nodeType: string,
  data: Record<string, unknown>,
): string {
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  switch (nodeType) {
    case "chat":
      return `chat:${str(data.conversationId) ?? globalThis.crypto.randomUUID()}`;
    case "genui-panel": {
      const provenance = data.provenance as
        | { messageId?: unknown; partIndex?: unknown }
        | undefined;
      const messageId = str(provenance?.messageId);
      const partIndex =
        typeof provenance?.partIndex === "number" ? provenance.partIndex : null;
      return messageId !== null && partIndex !== null
        ? `genui-panel:${messageId}:${partIndex}`
        : `genui-panel:${globalThis.crypto.randomUUID()}`;
    }
    case "knowledge-preview":
      return `knowledge-preview:${str(data.focusNodeId) ?? globalThis.crypto.randomUUID()}`;
    case "email-thread":
      return `email-thread:${str(data.threadId) ?? globalThis.crypto.randomUUID()}`;
    case "document":
      return `document:${str(data.documentId) ?? globalThis.crypto.randomUUID()}`;
    case "source":
      return `source:${str(data.sourceLedgerId) ?? globalThis.crypto.randomUUID()}`;
    case "spreadsheet":
      return `spreadsheet:${str(data.spreadsheetId) ?? globalThis.crypto.randomUUID()}`;
    default:
      return `${nodeType}:${globalThis.crypto.randomUUID()}`;
  }
}

/**
 * canonicalEdgeKey — a DETERMINISTIC edge key derived from the wiring tuple, so
 * `connect` is idempotent on (canvas_id, edge_key) (the blob path used a random
 * `edge:<uuid>` id + a field-match dedupe; the row model promotes idempotency to
 * a stable key). Full-snapshot edges keep their own client-provided id as the
 * edge_key (applySnapshot writes edge.id verbatim) — this key is used only by the
 * single-edge `connect` path.
 */
export function canonicalEdgeKey(
  sourceNodeKey: string,
  targetNodeKey: string,
  sourcePath: string,
  targetKey: string,
): string {
  return `edge:${sourceNodeKey}->${targetNodeKey}:${sourcePath}=>${targetKey}`;
}

// ---------------------------------------------------------------------------
// Row <-> snapshot mapping
// ---------------------------------------------------------------------------

function toSnapshotNode(row: schema.CanvasNodeRow): CanvasSnapshotNode {
  const node: CanvasSnapshotNode = {
    id: row.nodeKey,
    type: row.type,
    position: row.position as { x: number; y: number },
    data: (row.data as Record<string, unknown>) ?? {},
  };
  if (row.width !== null && row.width !== undefined) node.width = row.width;
  if (row.height !== null && row.height !== undefined) node.height = row.height;
  return node;
}

function toSnapshotEdge(row: schema.CanvasEdgeRow): CanvasSnapshotEdge {
  const data = (row.data as { sourcePath?: unknown; targetKey?: unknown } | null) ?? {};
  return {
    id: row.edgeKey,
    source: row.sourceKey,
    target: row.targetKey,
    data: {
      sourcePath: typeof data.sourcePath === "string" ? data.sourcePath : "",
      targetKey: typeof data.targetKey === "string" ? data.targetKey : "",
    },
  };
}

// ---------------------------------------------------------------------------
// Placement (mirrors canvas-mutations.ts nextAgentPosition)
// ---------------------------------------------------------------------------

function nextAgentPosition(
  nodes: ReadonlyArray<{ position: { x: number; y: number }; height?: number | null }>,
): { x: number; y: number } {
  if (nodes.length === 0) return { x: 0, y: 0 };
  const lowest = nodes.reduce(
    (max, node) => Math.max(max, node.position.y + (node.height ?? 220)),
    Number.NEGATIVE_INFINITY,
  );
  return { x: 80, y: lowest + 60 };
}

// ---------------------------------------------------------------------------
// assembleSnapshot
// ---------------------------------------------------------------------------

/**
 * Load a canvas's nodes + edges as a CanvasSnapshot-shaped object, or `null` if
 * the canvas row does not exist. Node/edge order is key-sorted for a deterministic
 * result (positions are absolute, so order is not semantically significant — this
 * makes the B3 shadow-compare stable).
 */
export async function assembleSnapshot(
  db: CanvasRepositoryDb,
  canvasId: string,
): Promise<CanvasSnapshot | null> {
  const [canvas] = await db
    .select()
    .from(Canvases)
    .where(eq(Canvases.id, canvasId))
    .limit(1);
  if (!canvas) return null;

  const nodeRows = await db
    .select()
    .from(CanvasNodes)
    .where(eq(CanvasNodes.canvasId, canvasId))
    .orderBy(asc(CanvasNodes.nodeKey));

  const edgeRows = await db
    .select()
    .from(CanvasEdges)
    .where(eq(CanvasEdges.canvasId, canvasId))
    .orderBy(asc(CanvasEdges.edgeKey));

  const snapshot: CanvasSnapshot = {
    nodes: nodeRows.map(toSnapshotNode),
    edges: edgeRows.map(toSnapshotEdge),
    sharedState: (canvas.sharedState as Record<string, unknown>) ?? {},
    nodeRegistryVersion:
      canvas.nodeRegistryVersion ?? CANVAS_ROW_FALLBACK_REGISTRY_VERSION,
  };
  if (canvas.viewport !== null && canvas.viewport !== undefined) {
    snapshot.viewport = canvas.viewport as { x: number; y: number; zoom: number };
  }
  return snapshot;
}

// ---------------------------------------------------------------------------
// applySnapshot
// ---------------------------------------------------------------------------

/**
 * Parse the incoming snapshot (the injected trust gate — see the module header),
 * then diff it against the canvas's current rows in ONE transaction: upsert every
 * node/edge (idempotent on the canonical key), delete the rows the snapshot
 * dropped, and stamp the canvas row's viewport / shared_state /
 * node_registry_version. Caps are enforced as COUNT checks BEFORE any write.
 */
export async function applySnapshot(
  db: CanvasRepositoryDb,
  canvasId: string,
  snapshot: unknown,
  parse: ParseSnapshot,
): Promise<void> {
  // Parse FIRST — preserves every write-time gate (D-05 no-spec, prototype-
  // pollution, per-schema caps, sharedState size).
  const parsed = parse(snapshot);

  // Row-model COUNT caps (belt-and-suspenders to the schema's `.max(...)`; also
  // hold under an identity parse).
  if (parsed.nodes.length > MAX_CANVAS_NODES) {
    throw new CanvasRepositoryError(
      "CAP_EXCEEDED",
      `canvas exceeds ${MAX_CANVAS_NODES} nodes`,
    );
  }
  if (parsed.edges.length > MAX_CANVAS_EDGES) {
    throw new CanvasRepositoryError(
      "CAP_EXCEEDED",
      `canvas exceeds ${MAX_CANVAS_EDGES} edges`,
    );
  }
  if (
    JSON.stringify(parsed.sharedState).length > MAX_SHARED_STATE_SERIALIZED_CHARS
  ) {
    throw new CanvasRepositoryError(
      "CAP_EXCEEDED",
      `sharedState exceeds ${MAX_SHARED_STATE_SERIALIZED_CHARS} serialized chars`,
    );
  }

  const keptNodeKeys = parsed.nodes.map((n) => n.id);
  const keptEdgeKeys = parsed.edges.map((e) => e.id);

  await db.transaction(async (tx) => {
    // Delete nodes/edges the snapshot dropped.
    if (keptNodeKeys.length === 0) {
      await tx.delete(CanvasNodes).where(eq(CanvasNodes.canvasId, canvasId));
    } else {
      await tx
        .delete(CanvasNodes)
        .where(
          and(
            eq(CanvasNodes.canvasId, canvasId),
            notInArray(CanvasNodes.nodeKey, keptNodeKeys),
          ),
        );
    }
    if (keptEdgeKeys.length === 0) {
      await tx.delete(CanvasEdges).where(eq(CanvasEdges.canvasId, canvasId));
    } else {
      await tx
        .delete(CanvasEdges)
        .where(
          and(
            eq(CanvasEdges.canvasId, canvasId),
            notInArray(CanvasEdges.edgeKey, keptEdgeKeys),
          ),
        );
    }

    // Upsert every snapshot node (idempotent on (canvas_id, node_key)).
    for (const node of parsed.nodes) {
      await tx
        .insert(CanvasNodes)
        .values({
          canvasId,
          nodeKey: node.id,
          type: node.type,
          position: node.position,
          width: node.width ?? null,
          height: node.height ?? null,
          data: node.data,
        })
        .onConflictDoUpdate({
          target: [CanvasNodes.canvasId, CanvasNodes.nodeKey],
          set: {
            type: node.type,
            position: node.position,
            width: node.width ?? null,
            height: node.height ?? null,
            data: node.data,
          },
        });
    }

    // Upsert every snapshot edge (idempotent on (canvas_id, edge_key)).
    for (const edge of parsed.edges) {
      await tx
        .insert(CanvasEdges)
        .values({
          canvasId,
          edgeKey: edge.id,
          sourceKey: edge.source,
          targetKey: edge.target,
          data: edge.data,
        })
        .onConflictDoUpdate({
          target: [CanvasEdges.canvasId, CanvasEdges.edgeKey],
          set: {
            sourceKey: edge.source,
            targetKey: edge.target,
            data: edge.data,
          },
        });
    }

    // Stamp the canvas row (viewport / shared_state / node_registry_version).
    await tx
      .update(Canvases)
      .set({
        viewport: parsed.viewport ?? null,
        sharedState: parsed.sharedState,
        nodeRegistryVersion: parsed.nodeRegistryVersion,
        updatedAt: new Date(),
      })
      .where(eq(Canvases.id, canvasId));
  });
}

// ---------------------------------------------------------------------------
// addNode (the agent single-add path)
// ---------------------------------------------------------------------------

export type AddNodeResult = {
  nodeKey: string;
  nodeType: string;
  created: boolean;
};

/**
 * Add a single node, idempotent on (canvas_id, node_key): if a node with the
 * canonical key already exists it is returned untouched (created:false); never
 * duplicated, never moved. Enforces MAX_CANVAS_NODES as a COUNT check.
 */
export async function addNode(
  db: CanvasRepositoryDb,
  canvasId: string,
  nodeType: string,
  data: Record<string, unknown>,
  position?: { x: number; y: number },
): Promise<AddNodeResult> {
  const nodeKey = canonicalNodeId(nodeType, data);

  const rows = await db
    .select({
      nodeKey: CanvasNodes.nodeKey,
      type: CanvasNodes.type,
      position: CanvasNodes.position,
      height: CanvasNodes.height,
    })
    .from(CanvasNodes)
    .where(eq(CanvasNodes.canvasId, canvasId));

  const existing = rows.find((r) => r.nodeKey === nodeKey);
  if (existing) {
    return { nodeKey, nodeType: existing.type, created: false };
  }

  if (rows.length >= MAX_CANVAS_NODES) {
    throw new CanvasRepositoryError(
      "CAP_EXCEEDED",
      `canvas is full (${MAX_CANVAS_NODES} nodes)`,
    );
  }

  const pos =
    position ??
    nextAgentPosition(
      rows.map((r) => ({
        position: r.position as { x: number; y: number },
        height: r.height,
      })),
    );

  await db.insert(CanvasNodes).values({
    canvasId,
    nodeKey,
    type: nodeType,
    position: pos,
    data,
  });

  return { nodeKey, nodeType, created: true };
}

// ---------------------------------------------------------------------------
// connect (the agent single-edge path)
// ---------------------------------------------------------------------------

export type ConnectResult = {
  edgeKey: string;
  created: boolean;
};

/**
 * Add a single edge, idempotent on (canvas_id, edge_key). Both endpoints must
 * already exist on the canvas (mirrors the blob path's BAD_REQUEST — an edge to a
 * not-yet-present node comes from RESTORE, not from an interactive connect).
 */
export async function connect(
  db: CanvasRepositoryDb,
  canvasId: string,
  sourceNodeKey: string,
  targetNodeKey: string,
  sourcePath: string,
  targetKey: string,
): Promise<ConnectResult> {
  const nodeRows = await db
    .select({ nodeKey: CanvasNodes.nodeKey })
    .from(CanvasNodes)
    .where(eq(CanvasNodes.canvasId, canvasId));
  const keys = new Set(nodeRows.map((r) => r.nodeKey));
  for (const k of [sourceNodeKey, targetNodeKey]) {
    if (!keys.has(k)) {
      throw new CanvasRepositoryError(
        "ENDPOINT_MISSING",
        `cannot connect: no node with key "${k}" on this canvas`,
      );
    }
  }

  const edgeKey = canonicalEdgeKey(
    sourceNodeKey,
    targetNodeKey,
    sourcePath,
    targetKey,
  );

  const edgeRows = await db
    .select({ edgeKey: CanvasEdges.edgeKey })
    .from(CanvasEdges)
    .where(eq(CanvasEdges.canvasId, canvasId));

  if (edgeRows.some((e) => e.edgeKey === edgeKey)) {
    return { edgeKey, created: false };
  }

  if (edgeRows.length >= MAX_CANVAS_EDGES) {
    throw new CanvasRepositoryError(
      "CAP_EXCEEDED",
      `canvas edge limit reached (${MAX_CANVAS_EDGES})`,
    );
  }

  await db.insert(CanvasEdges).values({
    canvasId,
    edgeKey,
    sourceKey: sourceNodeKey,
    targetKey: targetNodeKey,
    data: { sourcePath, targetKey },
  });

  return { edgeKey, created: true };
}

// ---------------------------------------------------------------------------
// removeNode (node + its edges, one transaction)
// ---------------------------------------------------------------------------

export type RemoveNodeResult = {
  removed: boolean;
  node: CanvasSnapshotNode | null;
  detachedEdges: CanvasSnapshotEdge[];
};

/**
 * Delete a node AND every edge that references its key (source OR target) in ONE
 * transaction — the app-layer equivalent of the FK cascade deliberately NOT
 * declared on canvas_edges (D9). Idempotent no-op if the node is absent. Returns
 * the removed node + detached edges verbatim (the reversible-with-undo payload).
 */
export async function removeNode(
  db: CanvasRepositoryDb,
  canvasId: string,
  nodeKey: string,
): Promise<RemoveNodeResult> {
  return db.transaction(async (tx) => {
    const [node] = await tx
      .select()
      .from(CanvasNodes)
      .where(
        and(eq(CanvasNodes.canvasId, canvasId), eq(CanvasNodes.nodeKey, nodeKey)),
      )
      .limit(1);

    if (!node) {
      return { removed: false, node: null, detachedEdges: [] };
    }

    const edgeMatch = and(
      eq(CanvasEdges.canvasId, canvasId),
      or(eq(CanvasEdges.sourceKey, nodeKey), eq(CanvasEdges.targetKey, nodeKey)),
    );

    const detached = await tx.select().from(CanvasEdges).where(edgeMatch);

    await tx.delete(CanvasEdges).where(edgeMatch);
    await tx
      .delete(CanvasNodes)
      .where(
        and(eq(CanvasNodes.canvasId, canvasId), eq(CanvasNodes.nodeKey, nodeKey)),
      );

    return {
      removed: true,
      node: toSnapshotNode(node),
      detachedEdges: detached.map(toSnapshotEdge),
    };
  });
}
