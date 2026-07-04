/**
 * canvas.test.ts — DB-free unit tests for the CanvasSnapshotSchema Zod
 * boundary + saveCanvasLayout/getCanvasLayout input schemas (mirrors
 * conversations.test.ts's DB-free pattern: schema parse/reject only, no
 * ctx.db mocking).
 *
 * Test plan:
 *   Test 1: CanvasSnapshotSchema accepts a well-formed snapshot.
 *   Test 2: CanvasSnapshotSchema rejects an edge whose data.sourcePath contains a FORBIDDEN_KEYS segment.
 *   Test 3: CanvasSnapshotSchema rejects an edge whose data.targetKey contains a FORBIDDEN_KEYS segment.
 *   Test 4: CanvasSnapshotSchema rejects a sharedState object with a __proto__/constructor/prototype key at any depth.
 *   Test 5: CanvasSnapshotSchema rejects a node whose data contains a `spec` key (D-05 — no spec content).
 *   Test 6: CanvasSnapshotSchema rejects a node whose data contains a `root` key (D-05 — no spec content).
 *   Test 7: CanvasSnapshotSchema rejects over-cap nodes (> MAX_CANVAS_NODES).
 *   Test 8: CanvasSnapshotSchema rejects over-cap edges (> MAX_CANVAS_EDGES).
 *   Test 9: saveCanvasLayoutInputSchema requires a uuid conversationId + a valid snapshot.
 *   Test 10: getCanvasLayoutInputSchema requires a uuid conversationId.
 *   Test 11: hasForbiddenKeyDeep detects nested __proto__/constructor/prototype keys.
 */

import { describe, expect, it } from "vitest";

import {
  type CanvasSnapshot,
  CanvasSnapshotSchema,
  getCanvasLayoutInputSchema,
  hasForbiddenKeyDeep,
  MAX_CANVAS_EDGES,
  MAX_CANVAS_NODES,
  saveCanvasLayoutInputSchema,
} from "../canvas";

const VALID_CONVERSATION_ID = "00000000-0000-0000-0000-000000000001";
const VALID_MESSAGE_ID = "00000000-0000-0000-0000-000000000002";

function makeValidSnapshot(): CanvasSnapshot {
  return {
    nodes: [
      {
        id: "node-1",
        type: "genui-panel",
        position: { x: 0, y: 0 },
        data: {
          provenance: {
            messageId: VALID_MESSAGE_ID,
            partIndex: 0,
            runId: null,
          },
          turnIndex: 0,
        },
      },
      {
        id: "node-2",
        type: "chat",
        position: { x: 100, y: 100 },
        width: 400,
        height: 300,
        data: { conversationId: VALID_CONVERSATION_ID },
      },
    ],
    edges: [
      {
        id: "edge-1",
        source: "node-1",
        target: "node-2",
        data: { sourcePath: "data.result", targetKey: "input" },
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    sharedState: { "shared.count": 1, "panels.node-1.label": "hello" },
    nodeRegistryVersion: "abc123",
  };
}

describe("CanvasSnapshotSchema", () => {
  it("Test 1: accepts a well-formed snapshot", () => {
    const result = CanvasSnapshotSchema.safeParse(makeValidSnapshot());
    expect(result.success).toBe(true);
  });

  it("Test 2: rejects an edge whose data.sourcePath contains a FORBIDDEN_KEYS segment", () => {
    const snapshot = makeValidSnapshot();
    snapshot.edges = [
      {
        id: "edge-1",
        source: "node-1",
        target: "node-2",
        data: { sourcePath: "__proto__.polluted", targetKey: "input" },
      },
    ];
    expect(CanvasSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it("Test 3: rejects an edge whose data.targetKey contains a FORBIDDEN_KEYS segment", () => {
    const snapshot = makeValidSnapshot();
    snapshot.edges = [
      {
        id: "edge-1",
        source: "node-1",
        target: "node-2",
        data: { sourcePath: "data.result", targetKey: "constructor" },
      },
    ];
    expect(CanvasSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it("Test 4: rejects a sharedState object with a forbidden key at any depth", () => {
    const snapshot = makeValidSnapshot();
    const polluted: Record<string, unknown> = JSON.parse(
      '{"shared":{"nested":{"__proto__":{"polluted":true}}}}',
    );
    snapshot.sharedState = polluted;
    expect(CanvasSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it("Test 5: rejects a node whose data contains a `spec` key (D-05)", () => {
    const snapshot = makeValidSnapshot();
    snapshot.nodes = [
      {
        id: "node-1",
        type: "genui-panel",
        position: { x: 0, y: 0 },
        data: { spec: { type: "card" } },
      },
    ];
    expect(CanvasSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it("Test 6: rejects a node whose data contains a `root` key (D-05)", () => {
    const snapshot = makeValidSnapshot();
    snapshot.nodes = [
      {
        id: "node-1",
        type: "genui-panel",
        position: { x: 0, y: 0 },
        data: { root: { type: "card" } },
      },
    ];
    expect(CanvasSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it("Test 7: rejects over-cap nodes", () => {
    const snapshot = makeValidSnapshot();
    snapshot.nodes = Array.from({ length: MAX_CANVAS_NODES + 1 }, (_, i) => ({
      id: `node-${i}`,
      type: "chat",
      position: { x: i, y: i },
      data: { conversationId: VALID_CONVERSATION_ID },
    }));
    expect(CanvasSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it("Test 8: rejects over-cap edges", () => {
    const snapshot = makeValidSnapshot();
    snapshot.edges = Array.from({ length: MAX_CANVAS_EDGES + 1 }, (_, i) => ({
      id: `edge-${i}`,
      source: "node-1",
      target: "node-2",
      data: { sourcePath: "data.result", targetKey: `input-${i}` },
    }));
    expect(CanvasSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });
});

describe("saveCanvasLayoutInputSchema", () => {
  it("Test 9: requires a uuid conversationId + a valid snapshot", () => {
    expect(
      saveCanvasLayoutInputSchema.safeParse({
        conversationId: VALID_CONVERSATION_ID,
        snapshot: makeValidSnapshot(),
      }).success,
    ).toBe(true);

    expect(
      saveCanvasLayoutInputSchema.safeParse({
        conversationId: "not-a-uuid",
        snapshot: makeValidSnapshot(),
      }).success,
    ).toBe(false);

    expect(
      saveCanvasLayoutInputSchema.safeParse({
        conversationId: VALID_CONVERSATION_ID,
        snapshot: { ...makeValidSnapshot(), nodeRegistryVersion: "" },
      }).success,
    ).toBe(false);
  });
});

describe("getCanvasLayoutInputSchema", () => {
  it("Test 10: requires a uuid conversationId", () => {
    expect(
      getCanvasLayoutInputSchema.safeParse({
        conversationId: VALID_CONVERSATION_ID,
      }).success,
    ).toBe(true);
    expect(
      getCanvasLayoutInputSchema.safeParse({ conversationId: "nope" })
        .success,
    ).toBe(false);
  });
});

describe("hasForbiddenKeyDeep", () => {
  it("Test 11: detects nested __proto__/constructor/prototype keys", () => {
    expect(hasForbiddenKeyDeep({ a: { b: 1 } })).toBe(false);
    expect(
      hasForbiddenKeyDeep(JSON.parse('{"a":{"__proto__":{"x":1}}}')),
    ).toBe(true);
    expect(hasForbiddenKeyDeep({ a: [{ constructor: 1 }] })).toBe(true);
    expect(hasForbiddenKeyDeep({ prototype: 1 })).toBe(true);
    expect(hasForbiddenKeyDeep("plain string")).toBe(false);
    expect(hasForbiddenKeyDeep(null)).toBe(false);
  });
});
