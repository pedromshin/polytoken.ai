/**
 * canvas-selection.test.ts — the PURE general (all-node-type) multi-select +
 * bulk transforms (CI-05): select-all, deselect, the chat-singleton
 * protection, remove-with-edge-cascade, duplicate, and paste.
 */

import { describe, expect, it } from "vitest";
import type { Edge as FlowEdge, Node as FlowNode } from "@xyflow/react";

import {
  deletableSelectedIds,
  deselectAllNodes,
  duplicateSelectedNodes,
  isProtectedNode,
  pasteNodes,
  removeNodesById,
  selectAllNodes,
  selectedNodes,
} from "../canvas-selection";

function n(id: string, overrides: Partial<FlowNode> = {}): FlowNode {
  return {
    id,
    type: "email-thread",
    position: { x: 0, y: 0 },
    data: {},
    ...overrides,
  };
}
const chat = n("chat:c1", { type: "chat", selected: true });

function edge(id: string, source: string, target: string): FlowEdge {
  return { id, source, target };
}

describe("selection queries + protection", () => {
  it("isProtectedNode is true only for the chat singleton", () => {
    expect(isProtectedNode(chat)).toBe(true);
    expect(isProtectedNode(n("a"))).toBe(false);
  });

  it("selectedNodes returns only selected", () => {
    const nodes = [n("a", { selected: true }), n("b"), n("c", { selected: true })];
    expect(selectedNodes(nodes).map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("deletableSelectedIds excludes the protected chat node", () => {
    const nodes = [chat, n("a", { selected: true }), n("b", { selected: true })];
    expect(deletableSelectedIds(nodes)).toEqual(["a", "b"]);
  });
});

describe("selectAllNodes / deselectAllNodes", () => {
  it("selects every node and is a no-op when all already selected", () => {
    const nodes = [n("a"), n("b", { selected: true })];
    const all = selectAllNodes(nodes);
    expect(all.every((x) => x.selected)).toBe(true);
    expect(selectAllNodes(all)).toBe(all); // reference-stable no-op
  });

  it("deselects every node and is a no-op when none selected", () => {
    const nodes = [n("a", { selected: true }), n("b")];
    const none = deselectAllNodes(nodes);
    expect(none.some((x) => x.selected)).toBe(false);
    expect(deselectAllNodes(none)).toBe(none);
  });
});

describe("removeNodesById", () => {
  it("removes the nodes and every edge touching them", () => {
    const nodes = [n("a"), n("b"), n("c")];
    const edges = [edge("e1", "a", "b"), edge("e2", "b", "c")];
    const result = removeNodesById(nodes, edges, ["b"]);
    expect(result.nodes.map((x) => x.id)).toEqual(["a", "c"]);
    expect(result.edges).toHaveLength(0);
    expect(result.removedIds).toEqual(["b"]);
  });

  it("never removes the protected chat node", () => {
    const nodes = [chat, n("a")];
    const result = removeNodesById(nodes, [], ["chat:c1", "a"]);
    expect(result.removedIds).toEqual(["a"]);
    expect(result.nodes.map((x) => x.id)).toContain("chat:c1");
  });

  it("is a reference-stable no-op when nothing qualifies", () => {
    const nodes = [chat];
    const result = removeNodesById(nodes, [], ["chat:c1"]);
    expect(result.nodes).toBe(nodes);
    expect(result.removedIds).toHaveLength(0);
  });
});

describe("duplicateSelectedNodes", () => {
  it("clones selected non-chat nodes with fresh ids + offset, swapping selection", () => {
    let counter = 0;
    const nodes = [chat, n("a", { selected: true }), n("b")];
    const result = duplicateSelectedNodes(nodes, () => `clone-${counter++}`, 40);
    expect(result.addedIds).toEqual(["clone-0"]);
    const clone = result.nodes.find((x) => x.id === "clone-0")!;
    expect(clone.position).toEqual({ x: 40, y: 40 });
    expect(clone.selected).toBe(true);
    // Original 'a' was deselected; clone carries the selection.
    expect(result.nodes.find((x) => x.id === "a")?.selected).toBe(false);
    // Clone's data is a fresh object, not the source ref.
    expect(clone.data).not.toBe(nodes[1]?.data);
  });

  it("never duplicates the protected chat node", () => {
    const nodes = [chat];
    const result = duplicateSelectedNodes(nodes, () => "clone", 40);
    expect(result.addedIds).toHaveLength(0);
    expect(result.nodes).toBe(nodes);
  });
});

describe("pasteNodes", () => {
  it("appends clipboard copies with fresh ids and selects them", () => {
    let counter = 0;
    const current = [n("a", { selected: true })];
    const clipboard = [n("x"), n("y")];
    const result = pasteNodes(current, clipboard, () => `p-${counter++}`, 40);
    expect(result.addedIds).toEqual(["p-0", "p-1"]);
    expect(result.nodes.find((z) => z.id === "a")?.selected).toBe(false);
    expect(result.nodes.filter((z) => z.selected).map((z) => z.id)).toEqual(["p-0", "p-1"]);
  });

  it("skips a protected node in the clipboard", () => {
    const result = pasteNodes([], [chat], () => "p", 40);
    expect(result.addedIds).toHaveLength(0);
  });
});
