/**
 * canvas.test.ts — the three AI-01 canvas-mutation capabilities as registry data.
 *
 * Pins the safety-load-bearing facts: the id triple, risk/reversibility/cost declared as DATA
 * (INV-4), the node-type allowlist gate (unknown types rejected AT THE SCHEMA — agent output can
 * never write a type the canvas doesn't recognize), per-type dataSchema enforcement, the
 * prototype-pollution and D-05 (no spec/root) guards, the fails-closed store floor (INV-5), and
 * that execute() is a pure delegation to the injected store port (no persistence in substrate).
 */
import { describe, expect, it, vi } from "vitest";

import { createCapabilityRegistry } from "../capability.js";
import {
  CANVAS_CAPABILITIES,
  CANVAS_CONNECT_DEFAULT_SOURCE_PATH,
  CANVAS_CONNECT_DEFAULT_TARGET_KEY,
  CANVAS_NODE_DATA_SCHEMAS,
  CANVAS_NODE_TYPE_IDS,
  canvasAddNodeCapability,
  canvasConnectCapability,
  canvasRemoveNodeCapability,
  canvasAddNodeInputSchema,
  canvasConnectInputSchema,
  canvasRemoveNodeInputSchema,
  failClosedCanvasMutationStore,
  type CanvasExecCtx,
  type CanvasMutationStore,
  type CanvasScope,
} from "../canvas.js";

const CONVERSATION_ID = "00000000-0000-0000-0000-000000000001";
const SOME_UUID = "00000000-0000-0000-0000-000000000002";
const OTHER_UUID = "00000000-0000-0000-0000-000000000003";

/** One canonical VALID node.data fixture per allowlisted type — doubles as schema coverage
 * (every mirrored dataSchema must accept its own canonical shape). The apps/web drift test
 * re-uses the same shapes against NODE_TYPE_REGISTRY to pin mirror parity. */
export const VALID_NODE_DATA_FIXTURES: Record<string, Record<string, unknown>> = {
  chat: { conversationId: CONVERSATION_ID },
  "genui-panel": {
    provenance: { messageId: SOME_UUID, partIndex: 0, runId: null },
    turnIndex: 0,
  },
  "knowledge-preview": { focusNodeId: SOME_UUID, label: "focus" },
  "email-thread": { threadId: SOME_UUID, label: "Renewal thread" },
  document: { documentId: SOME_UUID, label: "Q3 brief" },
  source: {
    sourceLedgerId: SOME_UUID,
    url: "https://example.com/article",
    title: "An article",
    excerpt: "short excerpt",
    tier: "suggested",
  },
  directory: { path: "/home/user/project", label: "project", entries: [{ name: "src", kind: "dir", depth: 0 }] },
  browser: { url: "https://example.com", label: "docs" },
  editor: { filePath: "/home/user/project/readme.md", language: "md" },
  desktop: { sessionId: "sess-1", status: "running", region: "eu-central", shape: "CPX41" },
  "circle-pack": { scope: "mailbox", label: "Mailbox landscape" },
  spreadsheet: { spreadsheetId: SOME_UUID, label: "Invoices" },
  file: { path: ["invoices", "2026"], name: "q3.pdf", label: "Q3 invoice" },
};

describe("canvas capabilities — the AI-01 mutation triple", () => {
  it("declares exactly the three mutation ids", () => {
    expect([...CANVAS_CAPABILITIES].map((c) => c.id).sort()).toEqual([
      "canvas.addNode",
      "canvas.connect",
      "canvas.removeNode",
    ]);
  });

  it("declares risk/reversibility/cost as DATA — all write/free, removeNode explicitly reversible-with-undo (INV-4)", () => {
    expect(canvasAddNodeCapability).toMatchObject({ risk: "write", cost: "free" });
    expect(canvasConnectCapability).toMatchObject({ risk: "write", cost: "free" });
    expect(canvasRemoveNodeCapability).toMatchObject({
      risk: "write",
      cost: "free",
      reversibility: "reversible",
    });
    // add/connect follow the sibling convention: no key declared ⇒ reversible.
    expect(canvasAddNodeCapability.reversibility).toBeUndefined();
    expect(canvasConnectCapability.reversibility).toBeUndefined();
  });

  it("the node-type allowlist mirrors every registered type and each dataSchema accepts its canonical fixture", () => {
    expect([...CANVAS_NODE_TYPE_IDS]).toEqual(Object.keys(VALID_NODE_DATA_FIXTURES).sort());
    for (const [nodeType, data] of Object.entries(VALID_NODE_DATA_FIXTURES)) {
      const schema = CANVAS_NODE_DATA_SCHEMAS[nodeType]!;
      expect(schema.safeParse(data).success, `dataSchema for "${nodeType}"`).toBe(true);
    }
  });

  it("folds into a registry and projects an outward manifest (INV-1)", () => {
    const registry = createCapabilityRegistry<CanvasExecCtx, CanvasScope>(CANVAS_CAPABILITIES);
    expect(registry.get("canvas.addNode")).toBeDefined();
    const listed = registry.list();
    const removeEntry = listed.find((e) => e.id === "canvas.removeNode");
    expect(removeEntry).toMatchObject({ risk: "write", reversibility: "reversible", source: "builtin", trust: "first-party" });
    const addEntry = listed.find((e) => e.id === "canvas.addNode");
    expect(addEntry).not.toHaveProperty("reversibility");
  });
});

describe("canvasAddNodeInputSchema — the fail-safe node-type gate", () => {
  it("accepts a well-formed payload for every allowlisted type", () => {
    for (const [nodeType, data] of Object.entries(VALID_NODE_DATA_FIXTURES)) {
      const result = canvasAddNodeInputSchema.safeParse({
        conversationId: CONVERSATION_ID,
        nodeType,
        data,
      });
      expect(result.success, `addNode input for "${nodeType}"`).toBe(true);
    }
  });

  it("rejects an unknown node type with a message naming the allowlist (agent output is fail-safe by construction)", () => {
    const result = canvasAddNodeInputSchema.safeParse({
      conversationId: CONVERSATION_ID,
      nodeType: "totally-made-up",
      data: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues.map((i) => i.message).join("\n");
      expect(message).toMatch(/unknown node type "totally-made-up"/);
      expect(message).toContain("email-thread");
    }
  });

  it("rejects data that fails the node type's own dataSchema (per-type validation boundary)", () => {
    // email-thread without a threadId uuid
    expect(
      canvasAddNodeInputSchema.safeParse({
        conversationId: CONVERSATION_ID,
        nodeType: "email-thread",
        data: { label: "no ref" },
      }).success,
    ).toBe(false);
    // source with a javascript: url (the T-61-04 write-side gate)
    expect(
      canvasAddNodeInputSchema.safeParse({
        conversationId: CONVERSATION_ID,
        nodeType: "source",
        data: {
          sourceLedgerId: SOME_UUID,
          url: "javascript:alert(1)",
          title: "hostile",
        },
      }).success,
    ).toBe(false);
    // strict(): unrecognized keys rejected
    expect(
      canvasAddNodeInputSchema.safeParse({
        conversationId: CONVERSATION_ID,
        nodeType: "document",
        data: { documentId: SOME_UUID, smuggled: true },
      }).success,
    ).toBe(false);
  });

  it("rejects genui-panel data carrying spec/root keys (D-05 — no spec content in layout rows)", () => {
    expect(
      canvasAddNodeInputSchema.safeParse({
        conversationId: CONVERSATION_ID,
        nodeType: "genui-panel",
        data: { spec: { type: "card" } },
      }).success,
    ).toBe(false);
  });

  it("rejects prototype-pollution keys anywhere in data (FOUND-6)", () => {
    const polluted = JSON.parse('{"conversationId":"00000000-0000-0000-0000-000000000001","nested":{"__proto__":{"x":1}}}') as Record<string, unknown>;
    expect(
      canvasAddNodeInputSchema.safeParse({
        conversationId: CONVERSATION_ID,
        nodeType: "chat",
        data: polluted,
      }).success,
    ).toBe(false);
  });

  it("requires a uuid conversationId and rejects unknown top-level keys", () => {
    expect(
      canvasAddNodeInputSchema.safeParse({
        conversationId: "not-a-uuid",
        nodeType: "chat",
        data: VALID_NODE_DATA_FIXTURES.chat,
      }).success,
    ).toBe(false);
    expect(
      canvasAddNodeInputSchema.safeParse({
        conversationId: CONVERSATION_ID,
        nodeType: "chat",
        data: VALID_NODE_DATA_FIXTURES.chat,
        extra: true,
      }).success,
    ).toBe(false);
  });
});

describe("canvasConnectInputSchema", () => {
  it("a bare connect (no sourcePath/targetKey) is a valid tool call — the executor applies the declared defaults", () => {
    const parsed = canvasConnectInputSchema.parse({
      conversationId: CONVERSATION_ID,
      sourceNodeId: `source:${SOME_UUID}`,
      targetNodeId: `document:${OTHER_UUID}`,
    });
    expect(parsed.sourcePath).toBeUndefined();
    expect(parsed.targetKey).toBeUndefined();
    expect(CANVAS_CONNECT_DEFAULT_SOURCE_PATH).toBe("data");
    expect(CANVAS_CONNECT_DEFAULT_TARGET_KEY).toBe("input");
  });

  it("rejects forbidden dotted-path segments in sourcePath/targetKey (T-23-01)", () => {
    expect(
      canvasConnectInputSchema.safeParse({
        conversationId: CONVERSATION_ID,
        sourceNodeId: "a",
        targetNodeId: "b",
        sourcePath: "__proto__.polluted",
      }).success,
    ).toBe(false);
    expect(
      canvasConnectInputSchema.safeParse({
        conversationId: CONVERSATION_ID,
        sourceNodeId: "a",
        targetNodeId: "b",
        targetKey: "constructor",
      }).success,
    ).toBe(false);
  });
});

describe("canvasRemoveNodeInputSchema", () => {
  it("requires a uuid conversationId + a non-empty nodeId", () => {
    expect(
      canvasRemoveNodeInputSchema.safeParse({
        conversationId: CONVERSATION_ID,
        nodeId: `email-thread:${SOME_UUID}`,
      }).success,
    ).toBe(true);
    expect(
      canvasRemoveNodeInputSchema.safeParse({ conversationId: CONVERSATION_ID, nodeId: "" }).success,
    ).toBe(false);
  });
});

describe("store port (INV-5 + pure delegation)", () => {
  it("the fails-closed store refuses every verb (no store ⇒ nothing mutates)", async () => {
    await expect(
      failClosedCanvasMutationStore.addNode({
        conversationId: CONVERSATION_ID,
        nodeType: "chat",
        data: { conversationId: CONVERSATION_ID },
      }),
    ).rejects.toThrow(/no layout store configured/);
    await expect(
      failClosedCanvasMutationStore.connect({
        conversationId: CONVERSATION_ID,
        sourceNodeId: "a",
        targetNodeId: "b",
        sourcePath: "data",
        targetKey: "input",
      }),
    ).rejects.toThrow(/no layout store configured/);
    await expect(
      failClosedCanvasMutationStore.removeNode({ conversationId: CONVERSATION_ID, nodeId: "a" }),
    ).rejects.toThrow(/no layout store configured/);
  });

  it("execute() is a pure delegation to the injected store port — no persistence in substrate", async () => {
    const store: CanvasMutationStore = {
      addNode: vi.fn(async () => ({ nodeId: "email-thread:x", nodeType: "email-thread", created: true })),
      connect: vi.fn(async () => ({ edgeId: "edge:1", created: true })),
      removeNode: vi.fn(async () => ({ removed: true, node: null, detachedEdges: [] })),
    };
    const ctx: CanvasExecCtx = { store };
    const addInput = {
      conversationId: CONVERSATION_ID,
      nodeType: "email-thread",
      data: { threadId: SOME_UUID },
    };
    expect(await canvasAddNodeCapability.execute(addInput, ctx)).toMatchObject({ created: true });
    expect(store.addNode).toHaveBeenCalledWith(addInput);
    expect(
      await canvasRemoveNodeCapability.execute({ conversationId: CONVERSATION_ID, nodeId: "n" }, ctx),
    ).toMatchObject({ removed: true });
    expect(store.removeNode).toHaveBeenCalledOnce();
  });

  it("scope names the verb + the conversation it mutates", () => {
    expect(
      canvasConnectCapability.scope({
        conversationId: CONVERSATION_ID,
        sourceNodeId: "a",
        targetNodeId: "b",
        sourcePath: "data",
        targetKey: "input",
      }),
    ).toEqual({ action: "canvas.connect", conversationId: CONVERSATION_ID });
  });
});
