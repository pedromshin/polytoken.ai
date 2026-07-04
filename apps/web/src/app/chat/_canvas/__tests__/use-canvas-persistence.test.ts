/**
 * use-canvas-persistence.test.ts — DB-free unit tests for the pure restore/
 * reconcile/snapshot helpers (CANVAS-02, CANVAS-03, D-05/D-06, T-23-09).
 *
 * Test plan:
 *   1. reconcileNodesFromHistory: a saved node keeps its EXACT saved position.
 *   2. reconcileNodesFromHistory: a genui_spec part with no saved node gets a
 *      fresh offset-cascade-placed position (isNew: true), clear of every
 *      already-placed rect.
 *   3. reconcileNodesFromHistory: a saved node whose type is unknown to the
 *      CURRENT registry degrades to "unknown-node-type" but keeps its saved
 *      position (never throws, never drops the node).
 *   4. reconcileNodesFromHistory: an arbitrary/legacy type (simulating a
 *      node_registry_version drift) never throws.
 *   5. withDefaultChatNode: synthesizes the default chat node when absent;
 *      leaves an existing one untouched.
 *   6. buildSnapshot: output validates against CanvasSnapshotSchema, carries
 *      nodeRegistryVersion === NODE_REGISTRY_VERSION, and contains no spec
 *      content; a degraded node's ORIGINAL type/data round-trips (heal-ready).
 */

import { describe, expect, it } from "vitest";
import type { Edge as FlowEdge, Node as FlowNode } from "@xyflow/react";

import { CanvasSnapshotSchema } from "@nauta/api-client/chat-canvas";

import type { ChatHistoryRow } from "../../_hooks/use-conversation-controller";
import { NODE_REGISTRY_VERSION } from "../node-registry-version";
import {
  buildSnapshot,
  chatNodeId,
  genuiPanelNodeId,
  reconcileNodesFromHistory,
  withDefaultChatNode,
  type PersistedCanvasNode,
} from "../use-canvas-persistence";

const CONVERSATION_ID = "00000000-0000-0000-0000-0000000000c1";
const MESSAGE_ID = "00000000-0000-0000-0000-0000000000a1";
const NEW_MESSAGE_ID = "00000000-0000-0000-0000-0000000000a2";

function historyRow(overrides: Partial<ChatHistoryRow> & Pick<ChatHistoryRow, "id" | "turnIndex">): ChatHistoryRow {
  return {
    role: "assistant",
    status: "completed",
    siblingGroupId: null,
    version: 1,
    isActive: true,
    parts: null,
    ...overrides,
  };
}

describe("reconcileNodesFromHistory", () => {
  it("preserves a saved node's EXACT position", () => {
    const savedNodes: PersistedCanvasNode[] = [
      {
        id: genuiPanelNodeId(MESSAGE_ID, 0),
        type: "genui-panel",
        position: { x: 123, y: 456 },
        data: { provenance: { messageId: MESSAGE_ID, partIndex: 0, runId: null }, turnIndex: 0 },
      },
    ];
    const historyRows: ChatHistoryRow[] = [
      historyRow({
        id: MESSAGE_ID,
        turnIndex: 0,
        parts: [{ type: "genui_spec", spec: { v: 1 } }],
      }),
    ];

    const reconciled = reconcileNodesFromHistory(savedNodes, historyRows);

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]!.position).toEqual({ x: 123, y: 456 });
    expect(reconciled[0]!.type).toBe("genui-panel");
    expect(reconciled[0]!.isNew).toBe(false);
  });

  it("places a genui_spec part with no saved node via offset-cascade, clear of existing rects", () => {
    const savedNodes: PersistedCanvasNode[] = [
      {
        id: genuiPanelNodeId(MESSAGE_ID, 0),
        type: "genui-panel",
        position: { x: 0, y: 0 },
        data: { provenance: { messageId: MESSAGE_ID, partIndex: 0, runId: null }, turnIndex: 0 },
      },
    ];
    const historyRows: ChatHistoryRow[] = [
      historyRow({
        id: MESSAGE_ID,
        turnIndex: 0,
        parts: [{ type: "genui_spec", spec: { v: 1 } }],
      }),
      historyRow({
        id: NEW_MESSAGE_ID,
        turnIndex: 1,
        parts: [{ type: "genui_spec", spec: { v: 1 } }],
      }),
    ];

    const reconciled = reconcileNodesFromHistory(savedNodes, historyRows);

    expect(reconciled).toHaveLength(2);
    const newNode = reconciled.find((n) => n.id === genuiPanelNodeId(NEW_MESSAGE_ID, 0));
    expect(newNode).toBeDefined();
    expect(newNode!.isNew).toBe(true);
    // Must not land exactly on top of the existing (0,0)-anchored 320x240 rect.
    const overlapsExisting =
      newNode!.position.x < 320 &&
      newNode!.position.x + 320 > 0 &&
      newNode!.position.y < 240 &&
      newNode!.position.y + 240 > 0;
    expect(overlapsExisting).toBe(false);
  });

  it("degrades a saved node whose type is unknown to the registry, keeping its saved position", () => {
    const savedNodes: PersistedCanvasNode[] = [
      {
        id: "agent:legacy-1",
        type: "agent",
        position: { x: 77, y: 88 },
        data: { someField: "legacy" },
      },
    ];

    const reconciled = reconcileNodesFromHistory(savedNodes, []);

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]!.type).toBe("unknown-node-type");
    expect(reconciled[0]!.position).toEqual({ x: 77, y: 88 });
    expect(reconciled[0]!.data.nodeType).toBe("agent");
    expect(reconciled[0]!.data.someField).toBe("legacy");
  });

  it("never throws when a saved node's type reflects a stale/mismatched node_registry_version", () => {
    const savedNodes: PersistedCanvasNode[] = [
      {
        id: "run:stale-1",
        type: "run", // a hypothetical future/removed registry entry
        position: { x: 0, y: 0 },
        data: {},
      },
    ];

    expect(() => reconcileNodesFromHistory(savedNodes, [])).not.toThrow();
    const reconciled = reconcileNodesFromHistory(savedNodes, []);
    expect(reconciled[0]!.type).toBe("unknown-node-type");
  });

  it("returns an empty array for no saved nodes and no history", () => {
    expect(reconcileNodesFromHistory([], [])).toEqual([]);
  });

  it("skips genui_spec parts on inactive (non-displayed) sibling rows", () => {
    const historyRows: ChatHistoryRow[] = [
      historyRow({
        id: MESSAGE_ID,
        turnIndex: 0,
        isActive: false,
        parts: [{ type: "genui_spec", spec: { v: 1 } }],
      }),
    ];

    expect(reconcileNodesFromHistory([], historyRows)).toEqual([]);
  });
});

describe("withDefaultChatNode", () => {
  it("synthesizes a centered default chat node when none is present", () => {
    const result = withDefaultChatNode([], CONVERSATION_ID);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(chatNodeId(CONVERSATION_ID));
    expect(result[0]!.type).toBe("chat");
    expect(result[0]!.position).toEqual({ x: 0, y: 0 });
  });

  it("leaves an existing chat node untouched (no duplicate)", () => {
    const existing = [
      {
        id: chatNodeId(CONVERSATION_ID),
        type: "chat",
        position: { x: 500, y: 500 },
        data: { conversationId: CONVERSATION_ID },
        isNew: false,
      },
    ];
    const result = withDefaultChatNode(existing, CONVERSATION_ID);
    expect(result).toHaveLength(1);
    expect(result[0]!.position).toEqual({ x: 500, y: 500 });
  });
});

describe("buildSnapshot", () => {
  function makeFlowNodes(): FlowNode[] {
    return [
      {
        id: chatNodeId(CONVERSATION_ID),
        type: "chat",
        position: { x: 0, y: 0 },
        data: { conversationId: CONVERSATION_ID },
      },
      {
        id: genuiPanelNodeId(MESSAGE_ID, 0),
        type: "genui-panel",
        position: { x: 400, y: 0 },
        data: {
          provenance: { messageId: MESSAGE_ID, partIndex: 0, runId: null },
          turnIndex: 0,
        },
      },
    ];
  }

  it("produces a CanvasSnapshotSchema-valid object stamped with NODE_REGISTRY_VERSION", () => {
    const snapshot = buildSnapshot(makeFlowNodes(), [], { x: 10, y: 20, zoom: 1 });

    const parsed = CanvasSnapshotSchema.safeParse(snapshot);
    expect(parsed.success).toBe(true);
    expect(snapshot.nodeRegistryVersion).toBe(NODE_REGISTRY_VERSION);
    expect(snapshot.viewport).toEqual({ x: 10, y: 20, zoom: 1 });
  });

  it("contains no spec content anywhere in node.data", () => {
    const snapshot = buildSnapshot(makeFlowNodes(), [], null);
    for (const node of snapshot.nodes) {
      expect("spec" in node.data).toBe(false);
      expect("root" in node.data).toBe(false);
    }
  });

  it("omits viewport entirely when null (nullable-until-first-pan/zoom semantics)", () => {
    const snapshot = buildSnapshot(makeFlowNodes(), [], null);
    expect(snapshot.viewport).toBeUndefined();
  });

  it("reconstructs a degraded node's ORIGINAL type/data (heal-ready), stripping the synthetic nodeType marker", () => {
    const degradedNode: FlowNode = {
      id: "agent:legacy-1",
      type: "unknown-node-type",
      position: { x: 5, y: 5 },
      data: { nodeType: "agent", someField: "legacy" },
    };

    const snapshot = buildSnapshot([degradedNode], [], null);

    expect(snapshot.nodes).toHaveLength(1);
    expect(snapshot.nodes[0]!.type).toBe("agent");
    expect(snapshot.nodes[0]!.data).toEqual({ someField: "legacy" });
  });

  it("carries edge data through with sourcePath/targetKey defaulting to empty string when absent", () => {
    const edges: FlowEdge[] = [
      { id: "e1", source: "a", target: "b", data: { sourcePath: "panels.a.value", targetKey: "input" } },
    ];
    const snapshot = buildSnapshot([], edges, null);
    expect(snapshot.edges).toEqual([
      { id: "e1", source: "a", target: "b", data: { sourcePath: "panels.a.value", targetKey: "input" } },
    ]);
  });
});
