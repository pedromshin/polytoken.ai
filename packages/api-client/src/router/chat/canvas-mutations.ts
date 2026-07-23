/**
 * chat/canvas-mutations.ts — the server execution path for the canvas.addNode /
 * canvas.connect / canvas.removeNode capability triple (FEATURE-CATALOG AI-01).
 *
 * The capabilities themselves are DECLARED in `@polytoken/capabilities` (canvas.ts — one
 * declaration, many consumers, INV-1); this module is the control-plane BINDING, exactly as
 * `router/desktop/index.ts` binds the desktop.* descriptors:
 *
 *   - Every procedure is `protectedProcedure`; the acting identity is ALWAYS `ctx.user.id`.
 *     Conversation ownership is asserted at the TOP via `assertConversationOwnership` — a
 *     non-owned conversationId surfaces as NOT_FOUND before any read or write (TENA-03).
 *   - The mutation runs through the capability registry, resolved BY ID (INV-2:
 *     `registry.get("canvas.addNode")`), re-parsed against `capability.input` at the boundary,
 *     and executed against the injected Drizzle-backed `CanvasMutationStore`.
 *   - The store persists through the SAME layout-row machinery the UI uses: one
 *     `chat_canvas_layouts` row per conversation, upserted via `onConflictDoUpdate` on
 *     conversationId — canvas.ts's saveCanvasLayout path, verbatim.
 *
 * ## ADDITIVE, NEVER CLOBBERING — the discipline this store enforces
 *
 *   - Existing nodes/edges/viewport/sharedState/nodeRegistryVersion are carried through
 *     BYTE-IDENTICAL on every mutation; only the requested delta is applied.
 *   - An existing row that fails `CanvasSnapshotSchema` validation is REFUSED
 *     (PRECONDITION_FAILED), never overwritten — a tampered/legacy row degrades to an empty
 *     canvas on the READ side (T-23-09) but the server must not destroy it on the WRITE side.
 *   - The MAX_CANVAS_NODES / MAX_CANVAS_EDGES caps (T-23-04) are enforced BEFORE writing.
 *   - Unknown node types never reach a row: the capability input schema rejects them
 *     (BAD_REQUEST), preserving apps/web's `resolveNodeType`-never-throws contract by making it
 *     unreachable from the agent path.
 *
 * ## KNOWN RACE (recorded, not hidden): the UI's debounced saveCanvasLayout is a whole-row
 * last-write-wins upsert. If the user's canvas is MOUNTED while an agent mutates the row, the
 * client's next debounced save can overwrite the agent's delta (the client snapshot predates
 * it). Same-turn tool loops target the conversation being chatted in, whose canvas refetches on
 * mount — the mounted-and-idle window is the residual gap. Closing it needs a client
 * invalidation signal (realtime or post-turn refetch), which is the tool-loop wiring handoff.
 */

import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import {
  CANVAS_CAPABILITIES,
  CANVAS_CONNECT_DEFAULT_SOURCE_PATH,
  CANVAS_CONNECT_DEFAULT_TARGET_KEY,
  createCapabilityRegistry,
  canvasAddNodeInputSchema,
  canvasConnectInputSchema,
  canvasRemoveNodeInputSchema,
  type CanvasAddNodeInput,
  type CanvasAddNodeOutput,
  type CanvasConnectInput,
  type CanvasConnectOutput,
  type CanvasExecCtx,
  type CanvasMutationStore,
  type CanvasRemoveNodeInput,
  type CanvasRemoveNodeOutput,
  type CanvasScope,
} from "@polytoken/capabilities";
import { ChatCanvasLayouts } from "@polytoken/db/schema";
import { assertConversationOwnership, type OwnershipDb } from "@polytoken/db/ownership";

import { protectedProcedure } from "../../trpc";
import { assertOwnedOrNotFound } from "../_ownership";
import {
  CanvasSnapshotSchema,
  MAX_CANVAS_EDGES,
  MAX_CANVAS_NODES,
  type CanvasSnapshot,
} from "./canvas-schema";

/** The canvas-mutation registry, resolved by id (INV-2). Built once at module load. */
const registry = createCapabilityRegistry<CanvasExecCtx, CanvasScope>(CANVAS_CAPABILITIES);

/**
 * The nodeRegistryVersion stamped on a row this server path CREATES (no prior row). D-04's
 * content-hash is computed client-side from the live NODE_TYPE_REGISTRY, which the server cannot
 * import (apps → packages arrow); an honest sentinel is stamped instead. Restore does not gate on
 * this field (resolution is per-node — use-canvas-persistence.ts Pass 1), and the client's first
 * debounced save replaces it with the real hash. Rows that already exist keep their stored
 * version verbatim (additive discipline).
 */
export const AGENT_CANVAS_REGISTRY_VERSION = "agent-canvas-mutation:v1";

// ---------------------------------------------------------------------------
// Drizzle-backed CanvasMutationStore — the layout-row machinery binding
// ---------------------------------------------------------------------------

/** The Drizzle handle the store persists through — the same shape ownership asserts against.
 * Tests inject a thenable-chain fake via the tRPC context's `db: fake as never` idiom. */
type DbHandle = OwnershipDb;

type MutableSnapshot = {
  nodes: CanvasSnapshot["nodes"][number][];
  edges: CanvasSnapshot["edges"][number][];
  viewport: CanvasSnapshot["viewport"] | null;
  sharedState: CanvasSnapshot["sharedState"];
  nodeRegistryVersion: string;
};

/**
 * Load the conversation's layout row as a validated, mutable snapshot — or a fresh empty one if
 * the conversation has never saved a canvas. An existing row that fails validation is REFUSED
 * (never clobbered — see module header).
 */
async function loadSnapshot(db: DbHandle, conversationId: string): Promise<MutableSnapshot> {
  // Same select the getCanvasLayout procedure issues.
  const rows = await db
    .select()
    .from(ChatCanvasLayouts)
    .where(eq(ChatCanvasLayouts.conversationId, conversationId))
    .limit(1);
  const row = rows[0];

  if (row === undefined) {
    return {
      nodes: [],
      edges: [],
      viewport: null,
      sharedState: {},
      nodeRegistryVersion: AGENT_CANVAS_REGISTRY_VERSION,
    };
  }

  const parsed = CanvasSnapshotSchema.safeParse({
    nodes: row.nodes,
    edges: row.edges,
    viewport: row.viewport ?? undefined,
    sharedState: row.sharedState,
    nodeRegistryVersion: row.nodeRegistryVersion,
  });
  if (!parsed.success) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "this conversation's saved canvas layout failed validation — refusing to mutate it " +
        "(an agent mutation must never overwrite a layout it cannot faithfully preserve)",
    });
  }
  return {
    nodes: [...parsed.data.nodes],
    edges: [...parsed.data.edges],
    viewport: parsed.data.viewport ?? null,
    sharedState: parsed.data.sharedState,
    nodeRegistryVersion: parsed.data.nodeRegistryVersion,
  };
}

/** Persist the snapshot through the SAME upsert saveCanvasLayout uses (one row per
 * conversation, onConflictDoUpdate on conversationId). */
async function persistSnapshot(
  db: DbHandle,
  conversationId: string,
  snapshot: MutableSnapshot,
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

/**
 * canonicalNodeId — the same `type:ref` id scheme the web canvas derives
 * (use-canvas-persistence.ts's chatNodeId/genuiPanelNodeId/sourceNodeId helpers), extended to
 * every ref-anchored type. A canonical id makes agent adds IDEMPOTENT per referenced object
 * (adding the same thread twice returns the existing node) and lets the client's own
 * materialization recognize an agent-placed node instead of double-placing it. Types with no
 * natural ref anchor (directory/browser/editor/desktop panels) get a random suffix.
 */
export function canonicalNodeId(nodeType: string, data: Record<string, unknown>): string {
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  switch (nodeType) {
    case "chat":
      return `chat:${str(data.conversationId) ?? globalThis.crypto.randomUUID()}`;
    case "genui-panel": {
      const provenance = data.provenance as { messageId?: unknown; partIndex?: unknown } | undefined;
      const messageId = str(provenance?.messageId);
      const partIndex = typeof provenance?.partIndex === "number" ? provenance.partIndex : null;
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
    default:
      return `${nodeType}:${globalThis.crypto.randomUUID()}`;
  }
}

/**
 * nextAgentPosition — a deterministic, non-overlapping fallback placement: stack below the
 * lowest existing node. Deliberately simple — dagre-quality layout stays client-side
 * (canvas-layout.ts); the user can drag, and a saved position is honored exactly (D-06).
 */
function nextAgentPosition(nodes: readonly CanvasSnapshot["nodes"][number][]): {
  x: number;
  y: number;
} {
  if (nodes.length === 0) return { x: 0, y: 0 };
  const lowest = nodes.reduce(
    (max, node) => Math.max(max, node.position.y + (node.height ?? 220)),
    Number.NEGATIVE_INFINITY,
  );
  return { x: 80, y: lowest + 60 };
}

/** Build the Drizzle-backed store the canvas capabilities execute against. Exported for the
 * (recorded-handoff) chat-stream tool loop to reuse — the binding must stay THE single write
 * path for agent canvas mutation. */
export function createCanvasMutationStore(db: DbHandle): CanvasMutationStore {
  return {
    async addNode(input: CanvasAddNodeInput): Promise<CanvasAddNodeOutput> {
      const snapshot = await loadSnapshot(db, input.conversationId);

      const nodeId = canonicalNodeId(input.nodeType, input.data);
      const existing = snapshot.nodes.find((node) => node.id === nodeId);
      if (existing !== undefined) {
        // Idempotent per referenced object — never duplicate, never move what's there.
        return { nodeId, nodeType: existing.type, created: false };
      }

      if (snapshot.nodes.length >= MAX_CANVAS_NODES) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `canvas is full (${MAX_CANVAS_NODES} nodes) — remove a node before adding another`,
        });
      }

      snapshot.nodes.push({
        id: nodeId,
        type: input.nodeType,
        position: input.position ?? nextAgentPosition(snapshot.nodes),
        data: input.data,
      });
      await persistSnapshot(db, input.conversationId, snapshot);
      return { nodeId, nodeType: input.nodeType, created: true };
    },

    async connect(input: CanvasConnectInput): Promise<CanvasConnectOutput> {
      const snapshot = await loadSnapshot(db, input.conversationId);
      const sourcePath = input.sourcePath ?? CANVAS_CONNECT_DEFAULT_SOURCE_PATH;
      const targetKey = input.targetKey ?? CANVAS_CONNECT_DEFAULT_TARGET_KEY;

      for (const nodeId of [input.sourceNodeId, input.targetNodeId]) {
        if (!snapshot.nodes.some((node) => node.id === nodeId)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `cannot connect: no node with id "${nodeId}" on this conversation's canvas`,
          });
        }
      }

      const duplicate = snapshot.edges.find(
        (edge) =>
          edge.source === input.sourceNodeId &&
          edge.target === input.targetNodeId &&
          edge.data.sourcePath === sourcePath &&
          edge.data.targetKey === targetKey,
      );
      if (duplicate !== undefined) {
        return { edgeId: duplicate.id, created: false };
      }

      if (snapshot.edges.length >= MAX_CANVAS_EDGES) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `canvas edge limit reached (${MAX_CANVAS_EDGES}) — remove an edge before adding another`,
        });
      }

      const edgeId = `edge:${globalThis.crypto.randomUUID()}`;
      snapshot.edges.push({
        id: edgeId,
        source: input.sourceNodeId,
        target: input.targetNodeId,
        data: { sourcePath, targetKey },
      });
      await persistSnapshot(db, input.conversationId, snapshot);
      return { edgeId, created: true };
    },

    async removeNode(input: CanvasRemoveNodeInput): Promise<CanvasRemoveNodeOutput> {
      const snapshot = await loadSnapshot(db, input.conversationId);

      const node = snapshot.nodes.find((candidate) => candidate.id === input.nodeId);
      if (node === undefined) {
        // Idempotent no-op — a retried removal must not blow up the tool loop.
        return { removed: false, node: null, detachedEdges: [] };
      }

      const detachedEdges = snapshot.edges.filter(
        (edge) => edge.source === input.nodeId || edge.target === input.nodeId,
      );
      snapshot.nodes = snapshot.nodes.filter((candidate) => candidate.id !== input.nodeId);
      snapshot.edges = snapshot.edges.filter(
        (edge) => edge.source !== input.nodeId && edge.target !== input.nodeId,
      );
      await persistSnapshot(db, input.conversationId, snapshot);
      // The undo payload: node + detached edges verbatim (reversible-with-undo, stated as data).
      return { removed: true, node, detachedEdges };
    },
  };
}

// ---------------------------------------------------------------------------
// Capability execution — resolve BY ID, re-parse at the boundary (INV-2)
// ---------------------------------------------------------------------------

async function runCanvasCapability(id: string, rawInput: unknown, db: DbHandle): Promise<unknown> {
  const capability = registry.get(id);
  if (!capability) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `${id} unregistered` });
  }
  // Re-parse at the boundary (the registry erases descriptor input types to `never`; the
  // substrate contract is a consumer re-parses via `capability.input` before `execute`).
  const parsed = capability.input.parse(rawInput);
  return capability.execute(parsed as never, { store: createCanvasMutationStore(db) } as never);
}

// ---------------------------------------------------------------------------
// Procedures
// ---------------------------------------------------------------------------

export const chatCanvasMutationProcedures = {
  /** addCanvasNode — the server half of `canvas.addNode`. Ownership FIRST, then the capability. */
  addCanvasNode: protectedProcedure
    .input(canvasAddNodeInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertConversationOwnership(ctx.db, input.conversationId, ctx.user.id),
      );
      return (await runCanvasCapability(
        "canvas.addNode",
        input,
        ctx.db,
      )) as CanvasAddNodeOutput;
    }),

  /** connectCanvasNodes — the server half of `canvas.connect`. */
  connectCanvasNodes: protectedProcedure
    .input(canvasConnectInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertConversationOwnership(ctx.db, input.conversationId, ctx.user.id),
      );
      return (await runCanvasCapability(
        "canvas.connect",
        input,
        ctx.db,
      )) as CanvasConnectOutput;
    }),

  /** removeCanvasNode — the server half of `canvas.removeNode`. */
  removeCanvasNode: protectedProcedure
    .input(canvasRemoveNodeInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertConversationOwnership(ctx.db, input.conversationId, ctx.user.id),
      );
      return (await runCanvasCapability(
        "canvas.removeNode",
        input,
        ctx.db,
      )) as CanvasRemoveNodeOutput;
    }),
};
