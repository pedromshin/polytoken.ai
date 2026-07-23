"use client";

/**
 * use-send-to.ts — the shared "Send to chat / Send to canvas" affordance's
 * data seam (FEATURE-CATALOG AI-04). ONE hook, many surfaces: a knowledge
 * node, an email thread, a document — any object with a rail — attaches to a
 * conversation as context (`chat.createContextEdge`, RCNV-04 / Phase 56) or
 * drops onto that conversation's canvas as a node (`chat.addCanvasNode`, the
 * AI-01 server procedure — the OWNED, validated, additive write path; this
 * hook never touches a `chat_canvas_layouts` row directly).
 *
 * ## The typed object ref is the whole contract (INV-1 spirit)
 *
 * `SendableObject` is a small discriminated union over the object KINDS that
 * have a rail today. Each kind declares — via the two pure mappers below —
 * which channel(s) it supports and the EXACT typed payload each channel wants:
 *
 *   - `objectToSourceRef` -> `chat.createContextEdge`'s `sourceRef` (or null
 *     when the kind has no context-edge type: a `document` has a canvas node
 *     but no `chat_context_edges.sourceRef` shape, so it is canvas-only).
 *   - `objectToCanvasNode` -> `chat.addCanvasNode`'s `{ nodeType, data }`,
 *     mirroring the canvas node.data schemas (knowledge-preview / document /
 *     …). Unknown types are impossible here — the union is closed and the
 *     server re-validates against `CANVAS_NODE_DATA_SCHEMAS` regardless.
 *
 * Both mappers are PURE and return the tRPC input types directly (RouterInputs
 * -derived), so a drift between this affordance and either server contract is
 * a compile error, never a runtime surprise. They are exported for DB-free
 * unit testing (the "right procedure, correct typed ref per surface" gate).
 *
 * ## Optimism (mirrors emails/[id]/use-role-mutations.ts)
 *
 * Each write is optimistic against the TARGET conversation's own cache
 * (`chat.listContextEdges` for chat, `chat.getCanvasLayout` for canvas):
 * cancel -> snapshot -> patch -> rollback-on-error + toast -> invalidate on
 * settle. Tenancy is the server's job (both procedures assert conversation
 * ownership BEFORE any write, surfacing a non-owned id as NOT_FOUND); this
 * hook only ever offers the CALLER'S OWN conversations (`listConversations`
 * is user-scoped) and passes one of their ids.
 *
 * "Linkage unavailable" (migration 0037 unapplied) comes back as a
 * discriminated `{ created: false, reason: "linkage_unavailable" }` — an
 * expected, non-exceptional state surfaced as an info toast, never a red error.
 */

import { toast } from "sonner";

import type { RouterInputs, RouterOutputs } from "@polytoken/api-client";

import { api } from "~/trpc/react";

// ---------------------------------------------------------------------------
// The typed object ref — one closed union, N surfaces
// ---------------------------------------------------------------------------

export type SendableObject =
  | { readonly kind: "knowledge_node"; readonly nodeId: string; readonly label?: string }
  | { readonly kind: "document"; readonly documentId: string; readonly label?: string }
  // CH-01/DR-03 — a vault file. Addressed by its TENANT-RELATIVE location
  // (folder path segments + basename), never a userId/key; the server resolves
  // it against ctx.user.id at read time. Supports BOTH channels: canvas (a
  // `file` node) and chat (a `vault_file` context edge, DR-05's "AI reads the
  // attachment" seam).
  | {
      readonly kind: "vault_file";
      readonly path: readonly string[];
      readonly name: string;
      readonly label?: string;
    };

export type SendableKind = SendableObject["kind"];
export type SendChannel = "chat" | "canvas";

// tRPC input types — the mappers below RETURN these so any drift is a compile
// error (the server owns the schema; this affordance must not re-invent it).
type CreateContextEdgeInput = RouterInputs["chat"]["createContextEdge"];
type ContextEdgeSourceRef = CreateContextEdgeInput["sourceRef"];
type AddCanvasNodeInput = RouterInputs["chat"]["addCanvasNode"];
export type CanvasNodeSpec = Pick<AddCanvasNodeInput, "nodeType" | "data">;

/** Canvas node.data label caps (mirror node-data-schemas.ts's per-type max). */
const KNOWLEDGE_PREVIEW_LABEL_MAX = 80;
const DOCUMENT_LABEL_MAX = 120;
const FILE_LABEL_MAX = 120;

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * objectToSourceRef — SendableObject -> `chat.createContextEdge` sourceRef, or
 * null when the kind has no context-edge type (document is canvas-only). PURE.
 */
export function objectToSourceRef(object: SendableObject): ContextEdgeSourceRef | null {
  switch (object.kind) {
    case "knowledge_node":
      return { type: "knowledge_node", nodeId: object.nodeId };
    case "document":
      return null;
    case "vault_file":
      return { type: "vault_file", path: [...object.path], name: object.name };
  }
}

/**
 * objectToCanvasNode — SendableObject -> `chat.addCanvasNode` `{ nodeType,
 * data }`, mirroring the canvas node.data schemas. PURE. Every kind here has a
 * canvas node, so this never returns null today; the signature keeps the null
 * option so a future context-only kind stays expressible.
 */
export function objectToCanvasNode(object: SendableObject): CanvasNodeSpec | null {
  switch (object.kind) {
    case "knowledge_node":
      return {
        nodeType: "knowledge-preview",
        data: {
          focusNodeId: object.nodeId,
          ...(object.label !== undefined
            ? { label: truncate(object.label, KNOWLEDGE_PREVIEW_LABEL_MAX) }
            : {}),
        },
      };
    case "document":
      return {
        nodeType: "document",
        data: {
          documentId: object.documentId,
          ...(object.label !== undefined
            ? { label: truncate(object.label, DOCUMENT_LABEL_MAX) }
            : {}),
        },
      };
    case "vault_file":
      return {
        nodeType: "file",
        data: {
          path: [...object.path],
          name: object.name,
          ...(object.label !== undefined
            ? { label: truncate(object.label, FILE_LABEL_MAX) }
            : {}),
        },
      };
  }
}

/** Whether a kind offers a given channel (drives which menu items render). */
export function supportsChannel(kind: SendableKind, channel: SendChannel): boolean {
  const probe: SendableObject =
    kind === "knowledge_node"
      ? { kind: "knowledge_node", nodeId: "" }
      : kind === "document"
        ? { kind: "document", documentId: "" }
        : { kind: "vault_file", path: [], name: "" };
  return channel === "chat"
    ? objectToSourceRef(probe) !== null
    : objectToCanvasNode(probe) !== null;
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export type ConversationTarget = RouterOutputs["chat"]["listConversations"][number];

type ContextEdgeRow = RouterOutputs["chat"]["listContextEdges"][number];
type CanvasLayoutRow = RouterOutputs["chat"]["getCanvasLayout"];

export interface UseSendToResult {
  /** The caller's own conversations, most-recent-first (the target picker). */
  readonly conversations: readonly ConversationTarget[];
  /** The default target: the most-recently-updated conversation, or null. */
  readonly defaultConversationId: string | null;
  /** Attach `object` as durable chat context on `conversationId`. */
  readonly sendToChat: (object: SendableObject, conversationId: string) => void;
  /** Drop `object` as a node on `conversationId`'s canvas (AI-01 path). */
  readonly sendToCanvas: (object: SendableObject, conversationId: string) => void;
  /** True while any send is in flight (drives aria-busy / disabled). */
  readonly isSending: boolean;
}

/** Optimistic context-edge row — same shape listContextEdges returns, so the
 * (usually unmounted) chat surface would see it immediately if it IS mounted. */
function optimisticEdge(
  targetConversationId: string,
  sourceRef: ContextEdgeSourceRef,
): ContextEdgeRow {
  return {
    id: globalThis.crypto.randomUUID(),
    targetConversationId,
    sourceRef,
    sourceRefKey: `${sourceRef.type}:optimistic`,
    isActive: true,
    createdAt: new Date(),
  } as ContextEdgeRow;
}

export function useSendTo(): UseSendToResult {
  const utils = api.useUtils();
  const conversationsQuery = api.chat.listConversations.useQuery({});
  const conversations = conversationsQuery.data ?? [];
  const defaultConversationId = conversations[0]?.id ?? null;

  // ---- send to chat (optimistic against listContextEdges) ----
  const createContextEdge = api.chat.createContextEdge.useMutation({
    onMutate: async ({ targetConversationId, sourceRef }) => {
      await utils.chat.listContextEdges.cancel({ conversationId: targetConversationId });
      const prev = utils.chat.listContextEdges.getData({
        conversationId: targetConversationId,
      });
      utils.chat.listContextEdges.setData(
        { conversationId: targetConversationId },
        (existing) => [...(existing ?? []), optimisticEdge(targetConversationId, sourceRef)],
      );
      return { prev, targetConversationId };
    },
    onError: (_err, _vars, context) => {
      if (context !== undefined) {
        utils.chat.listContextEdges.setData(
          { conversationId: context.targetConversationId },
          context.prev,
        );
      }
      toast.error("Couldn't add to chat context — nothing was saved.", { duration: 6000 });
    },
    onSuccess: (result) => {
      if (result.created) {
        toast.success("Added to chat context.");
      } else {
        toast.info("Chat context isn't available in this environment yet.");
      }
    },
    onSettled: (_data, _err, { targetConversationId }) => {
      void utils.chat.listContextEdges.invalidate({ conversationId: targetConversationId });
    },
  });

  // ---- send to canvas (optimistic against getCanvasLayout; AI-01 path) ----
  const addCanvasNode = api.chat.addCanvasNode.useMutation({
    onMutate: async ({ conversationId, nodeType, data }) => {
      await utils.chat.getCanvasLayout.cancel({ conversationId });
      const prev = utils.chat.getCanvasLayout.getData({ conversationId });
      // Only patch when a row is already cached — never fabricate a whole
      // layout row (the server is the sole author of a fresh one). The row's
      // `nodes` is jsonb (typed `unknown` at the wire) — narrow it locally.
      if (prev != null) {
        const prevRow = prev as { nodes?: unknown[] } & Record<string, unknown>;
        const node = {
          id: `${nodeType}:optimistic:${globalThis.crypto.randomUUID()}`,
          type: nodeType,
          position: { x: 80, y: 0 },
          data,
        };
        utils.chat.getCanvasLayout.setData({ conversationId }, {
          ...prevRow,
          nodes: [...(prevRow.nodes ?? []), node],
        } as CanvasLayoutRow);
      }
      return { prev, conversationId };
    },
    onError: (_err, _vars, context) => {
      if (context !== undefined) {
        utils.chat.getCanvasLayout.setData(
          { conversationId: context.conversationId },
          context.prev,
        );
      }
      toast.error("Couldn't add to canvas — nothing was saved.", { duration: 6000 });
    },
    onSuccess: (result) => {
      toast.success(result.created ? "Added to canvas." : "Already on this canvas.");
    },
    onSettled: (_data, _err, { conversationId }) => {
      void utils.chat.getCanvasLayout.invalidate({ conversationId });
    },
  });

  function sendToChat(object: SendableObject, conversationId: string): void {
    const sourceRef = objectToSourceRef(object);
    if (sourceRef === null) {
      toast.info("This item can't be added to chat context.");
      return;
    }
    createContextEdge.mutate({ targetConversationId: conversationId, sourceRef });
  }

  function sendToCanvas(object: SendableObject, conversationId: string): void {
    const spec = objectToCanvasNode(object);
    if (spec === null) {
      toast.info("This item can't be added to the canvas.");
      return;
    }
    addCanvasNode.mutate({ conversationId, nodeType: spec.nodeType, data: spec.data });
  }

  return {
    conversations,
    defaultConversationId,
    sendToChat,
    sendToCanvas,
    isSending: createContextEdge.isPending || addCanvasNode.isPending,
  };
}
