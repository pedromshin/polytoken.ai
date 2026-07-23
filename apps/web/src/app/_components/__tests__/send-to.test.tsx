/**
 * send-to.test.tsx — the AI-04 universal "Send to chat / Send to canvas"
 * affordance (use-send-to.ts + send-to-menu.tsx). jsdom-only: BEHAVIOUR, not
 * layout — this file claims NO visual verification (CLAUDE.md: jsdom does no
 * layout; the geometry/screenshot gates own the visual claim).
 *
 * Covered:
 *   1. PURE MAPPERS — objectToSourceRef / objectToCanvasNode / supportsChannel
 *      produce the correct typed ref per KIND (knowledge_node -> both rails;
 *      document -> canvas-only, no chat sourceRef).
 *   2. RIGHT PROCEDURE, CORRECT TYPED REF PER SURFACE — sendToChat calls
 *      chat.createContextEdge with the sourceRef; sendToCanvas calls
 *      chat.addCanvasNode with { nodeType, data } — per kind.
 *   3. TENANCY — the target is the caller's OWN most-recent conversation
 *      (listConversations is user-scoped); its id is what the mutation carries.
 *   4. OPTIMISM + ROLLBACK — onMutate cancels + snapshots + patches the target
 *      conversation's cache; onError restores the snapshot (mirrors
 *      emails/[id]/use-role-mutations.ts).
 *
 * `~/trpc/react` and `sonner` are mocked as plain vi.fn()s (mirrors
 * thread-cluster-indicator.test.tsx's `queryResult` convention). Mutation
 * OPTIONS are captured so onMutate/onError can be exercised directly.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- captured mutation options + spies -------------------------------------

interface MutationOptions {
  onMutate?: (vars: Record<string, unknown>) => unknown;
  onError?: (err: unknown, vars: unknown, ctx: unknown) => void;
  onSuccess?: (result: unknown, vars: unknown, ctx: unknown) => void;
  onSettled?: (data: unknown, err: unknown, vars: Record<string, unknown>) => void;
}

let createEdgeOptions: MutationOptions = {};
let addNodeOptions: MutationOptions = {};
const createEdgeMutate = vi.fn();
const addNodeMutate = vi.fn();

let conversationsData: ReadonlyArray<{
  id: string;
  title: string;
  modelId: string;
  updatedAt: string;
}> = [];

// utils cache spies (per query)
const listContextEdges = {
  cancel: vi.fn(async () => undefined),
  getData: vi.fn(() => undefined as unknown),
  setData: vi.fn(),
  invalidate: vi.fn(async () => undefined),
};
const getCanvasLayout = {
  cancel: vi.fn(async () => undefined),
  getData: vi.fn(() => null as unknown),
  setData: vi.fn(),
  invalidate: vi.fn(async () => undefined),
};

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      chat: { listContextEdges, getCanvasLayout },
    }),
    chat: {
      listConversations: {
        useQuery: () => ({ data: conversationsData }),
      },
      createContextEdge: {
        useMutation: (options: MutationOptions) => {
          createEdgeOptions = options;
          return { mutate: createEdgeMutate, isPending: false };
        },
      },
      addCanvasNode: {
        useMutation: (options: MutationOptions) => {
          addNodeOptions = options;
          return { mutate: addNodeMutate, isPending: false };
        },
      },
    },
  },
}));

import {
  objectToCanvasNode,
  objectToSourceRef,
  supportsChannel,
  useSendTo,
  type SendableObject,
} from "../use-send-to";
import { SendToMenu } from "../send-to-menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KNOWLEDGE_NODE_ID = "11111111-1111-1111-1111-111111111111";
const DOCUMENT_ID = "22222222-2222-2222-2222-222222222222";
const CONVERSATION_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CONVERSATION_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const knowledgeObject: SendableObject = {
  kind: "knowledge_node",
  nodeId: KNOWLEDGE_NODE_ID,
  label: "Invoices are due Net 30",
};
const documentObject: SendableObject = {
  kind: "document",
  documentId: DOCUMENT_ID,
  label: "Q3 research report",
};
const fileObject: SendableObject = {
  kind: "vault_file",
  path: ["invoices", "2026"],
  name: "q3.pdf",
  label: "Q3 invoice",
};

// --- a harness exposing the hook's handlers as buttons ---------------------

let containers: HTMLDivElement[] = [];
let roots: Root[] = [];
let hook: ReturnType<typeof useSendTo> | null = null;

function Harness(): React.ReactElement {
  hook = useSendTo();
  return <div />;
}

async function mountHook(): Promise<void> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<Harness />);
  });
}

beforeEach(() => {
  createEdgeOptions = {};
  addNodeOptions = {};
  createEdgeMutate.mockClear();
  addNodeMutate.mockClear();
  listContextEdges.cancel.mockClear();
  listContextEdges.getData.mockReset().mockReturnValue(undefined);
  listContextEdges.setData.mockClear();
  listContextEdges.invalidate.mockClear();
  getCanvasLayout.cancel.mockClear();
  getCanvasLayout.getData.mockReset().mockReturnValue(null);
  getCanvasLayout.setData.mockClear();
  getCanvasLayout.invalidate.mockClear();
  conversationsData = [
    { id: CONVERSATION_A, title: "Latest chat", modelId: "m", updatedAt: "2026-07-23" },
    { id: CONVERSATION_B, title: "Older chat", modelId: "m", updatedAt: "2026-07-20" },
  ];
  hook = null;
});

afterEach(async () => {
  for (const root of roots) {
    await act(async () => {
      root.unmount();
    });
  }
  for (const c of containers) c.remove();
  containers = [];
  roots = [];
});

// ---------------------------------------------------------------------------
// 1. Pure mappers
// ---------------------------------------------------------------------------

describe("pure mappers — correct typed ref per kind", () => {
  it("knowledge_node -> knowledge_node sourceRef AND knowledge-preview node", () => {
    expect(objectToSourceRef(knowledgeObject)).toEqual({
      type: "knowledge_node",
      nodeId: KNOWLEDGE_NODE_ID,
    });
    expect(objectToCanvasNode(knowledgeObject)).toEqual({
      nodeType: "knowledge-preview",
      data: { focusNodeId: KNOWLEDGE_NODE_ID, label: "Invoices are due Net 30" },
    });
  });

  it("document -> canvas-only: a document node, NO chat sourceRef", () => {
    expect(objectToSourceRef(documentObject)).toBeNull();
    expect(objectToCanvasNode(documentObject)).toEqual({
      nodeType: "document",
      data: { documentId: DOCUMENT_ID, label: "Q3 research report" },
    });
  });

  it("vault_file -> BOTH rails: a vault_file sourceRef AND a file node (CH-01/DR-03)", () => {
    expect(objectToSourceRef(fileObject)).toEqual({
      type: "vault_file",
      path: ["invoices", "2026"],
      name: "q3.pdf",
    });
    expect(objectToCanvasNode(fileObject)).toEqual({
      nodeType: "file",
      data: { path: ["invoices", "2026"], name: "q3.pdf", label: "Q3 invoice" },
    });
  });

  it("vault_file at the vault root maps with an empty path and no label", () => {
    expect(
      objectToCanvasNode({ kind: "vault_file", path: [], name: "notes.txt" }),
    ).toEqual({ nodeType: "file", data: { path: [], name: "notes.txt" } });
  });

  it("email_thread -> BOTH rails: an email_thread sourceRef AND an email-thread node", () => {
    const thread = { kind: "email_thread", threadId: "11111111-1111-1111-1111-111111111111", label: "Re: Invoice" } as const;
    expect(objectToSourceRef(thread)).toEqual({
      type: "email_thread",
      threadId: "11111111-1111-1111-1111-111111111111",
    });
    expect(objectToCanvasNode(thread)).toEqual({
      nodeType: "email-thread",
      data: { threadId: "11111111-1111-1111-1111-111111111111", label: "Re: Invoice" },
    });
  });

  it("supportsChannel gates per kind", () => {
    expect(supportsChannel("knowledge_node", "chat")).toBe(true);
    expect(supportsChannel("knowledge_node", "canvas")).toBe(true);
    expect(supportsChannel("document", "chat")).toBe(false);
    expect(supportsChannel("document", "canvas")).toBe(true);
    expect(supportsChannel("vault_file", "chat")).toBe(true);
    expect(supportsChannel("vault_file", "canvas")).toBe(true);
    expect(supportsChannel("email_thread", "chat")).toBe(true);
    expect(supportsChannel("email_thread", "canvas")).toBe(true);
  });

  it("truncates an over-long canvas label to the node.data cap (knowledge = 80)", () => {
    const longLabel = "x".repeat(200);
    const spec = objectToCanvasNode({
      kind: "knowledge_node",
      nodeId: KNOWLEDGE_NODE_ID,
      label: longLabel,
    });
    expect((spec?.data as { label: string }).label).toHaveLength(80);
  });
});

// ---------------------------------------------------------------------------
// 2 + 3. Right procedure, correct typed ref, tenancy
// ---------------------------------------------------------------------------

describe("sendToChat / sendToCanvas — procedure + typed ref + tenancy", () => {
  it("sendToChat calls createContextEdge with the sourceRef and the owned target id", async () => {
    await mountHook();
    act(() => {
      hook!.sendToChat(knowledgeObject, hook!.defaultConversationId!);
    });
    expect(hook!.defaultConversationId).toBe(CONVERSATION_A); // most-recent, user-scoped
    expect(createEdgeMutate).toHaveBeenCalledTimes(1);
    expect(createEdgeMutate).toHaveBeenCalledWith({
      targetConversationId: CONVERSATION_A,
      sourceRef: { type: "knowledge_node", nodeId: KNOWLEDGE_NODE_ID },
    });
    expect(addNodeMutate).not.toHaveBeenCalled();
  });

  it("sendToCanvas calls addCanvasNode with { nodeType, data } — knowledge", async () => {
    await mountHook();
    act(() => {
      hook!.sendToCanvas(knowledgeObject, CONVERSATION_B);
    });
    expect(addNodeMutate).toHaveBeenCalledWith({
      conversationId: CONVERSATION_B,
      nodeType: "knowledge-preview",
      data: { focusNodeId: KNOWLEDGE_NODE_ID, label: "Invoices are due Net 30" },
    });
  });

  it("sendToCanvas carries a document node for the document kind", async () => {
    await mountHook();
    act(() => {
      hook!.sendToCanvas(documentObject, CONVERSATION_A);
    });
    expect(addNodeMutate).toHaveBeenCalledWith({
      conversationId: CONVERSATION_A,
      nodeType: "document",
      data: { documentId: DOCUMENT_ID, label: "Q3 research report" },
    });
  });

  it("sendToChat on a canvas-only kind (document) makes NO createContextEdge call", async () => {
    await mountHook();
    act(() => {
      hook!.sendToChat(documentObject, CONVERSATION_A);
    });
    expect(createEdgeMutate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Optimism + rollback (mirrors use-role-mutations.ts)
// ---------------------------------------------------------------------------

describe("optimistic UI + rollback", () => {
  it("chat onMutate cancels, snapshots, and patches the TARGET conversation cache", async () => {
    await mountHook();
    const prev = [{ id: "edge-existing" }];
    listContextEdges.getData.mockReturnValue(prev);

    const ctx = (await createEdgeOptions.onMutate?.({
      targetConversationId: CONVERSATION_A,
      sourceRef: { type: "knowledge_node", nodeId: KNOWLEDGE_NODE_ID },
    })) as { prev: unknown; targetConversationId: string };

    expect(listContextEdges.cancel).toHaveBeenCalledWith({ conversationId: CONVERSATION_A });
    expect(listContextEdges.getData).toHaveBeenCalledWith({ conversationId: CONVERSATION_A });
    expect(listContextEdges.setData).toHaveBeenCalledTimes(1);
    // The optimistic updater appends one edge to the existing list.
    const updater = listContextEdges.setData.mock.calls[0][1] as (
      p: unknown[],
    ) => unknown[];
    expect(updater(prev)).toHaveLength(2);
    expect(ctx.prev).toBe(prev);
    expect(ctx.targetConversationId).toBe(CONVERSATION_A);
  });

  it("chat onError restores the snapshot for the target conversation", async () => {
    await mountHook();
    const prev = [{ id: "edge-existing" }];
    listContextEdges.setData.mockClear();
    createEdgeOptions.onError?.(new Error("boom"), {}, {
      prev,
      targetConversationId: CONVERSATION_A,
    });
    expect(listContextEdges.setData).toHaveBeenCalledWith(
      { conversationId: CONVERSATION_A },
      prev,
    );
  });

  it("canvas onMutate patches getCanvasLayout only when a row is cached, and onError rolls back", async () => {
    await mountHook();
    const prevRow = { nodes: [{ id: "n1" }], edges: [] };
    getCanvasLayout.getData.mockReturnValue(prevRow);

    const ctx = (await addNodeOptions.onMutate?.({
      conversationId: CONVERSATION_A,
      nodeType: "knowledge-preview",
      data: { focusNodeId: KNOWLEDGE_NODE_ID },
    })) as { prev: unknown; conversationId: string };

    expect(getCanvasLayout.cancel).toHaveBeenCalledWith({ conversationId: CONVERSATION_A });
    expect(getCanvasLayout.setData).toHaveBeenCalledTimes(1);
    const patched = getCanvasLayout.setData.mock.calls[0][1] as { nodes: unknown[] };
    expect(patched.nodes).toHaveLength(2);

    // Rollback restores the exact prior row.
    getCanvasLayout.setData.mockClear();
    addNodeOptions.onError?.(new Error("boom"), {}, ctx);
    expect(getCanvasLayout.setData).toHaveBeenCalledWith(
      { conversationId: CONVERSATION_A },
      prevRow,
    );
  });

  it("canvas onMutate does NOT fabricate a layout row when none is cached", async () => {
    await mountHook();
    getCanvasLayout.getData.mockReturnValue(null);
    await addNodeOptions.onMutate?.({
      conversationId: CONVERSATION_A,
      nodeType: "document",
      data: { documentId: DOCUMENT_ID },
    });
    expect(getCanvasLayout.setData).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. Component composes with the hook on every surface (mount smoke)
// ---------------------------------------------------------------------------

describe("SendToMenu — mounts on any surface", () => {
  async function mountMenu(element: React.ReactElement): Promise<HTMLDivElement> {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(element);
    });
    return container;
  }

  it("renders an icon trigger for a knowledge node (both channels supported)", async () => {
    const container = await mountMenu(
      <SendToMenu object={knowledgeObject} objectName="a rule" />,
    );
    const trigger = container.querySelector("button");
    expect(trigger).not.toBeNull();
    expect(trigger!.getAttribute("aria-label")).toBe("Send a rule to a conversation");
  });

  it("renders for a document (canvas-only kind) — still a valid single-channel menu", async () => {
    const container = await mountMenu(
      <SendToMenu object={documentObject} objectName="a report" />,
    );
    expect(container.querySelector("button")).not.toBeNull();
  });
});
