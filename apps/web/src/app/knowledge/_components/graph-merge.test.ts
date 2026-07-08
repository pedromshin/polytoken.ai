/**
 * graph-merge.test.ts — unit tests for the pure mergeGraph dedupe helper.
 *
 * Test plan:
 *   Test 1: a duplicate-id node is not added twice.
 *   Test 2: a duplicate-id edge is not added twice.
 *   Test 3: new-only nodes/edges are appended.
 *   Test 4: original input arrays are never mutated.
 *   Test 5: merging the same expansion result twice is idempotent.
 */

import { describe, expect, it } from "vitest";

import { mergeGraph } from "./graph-merge";

interface TestNode {
  readonly id: string;
  readonly label: string;
}

interface TestEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
}

describe("mergeGraph", () => {
  const existingNodes: TestNode[] = [
    { id: "n1", label: "Node 1" },
    { id: "n2", label: "Node 2" },
  ];
  const existingEdges: TestEdge[] = [
    { id: "e1", source: "n1", target: "n2" },
  ];

  it("Test 1: a duplicate-id node is not added twice", () => {
    const newNodes: TestNode[] = [
      { id: "n1", label: "Node 1 (duplicate)" },
      { id: "n3", label: "Node 3" },
    ];
    const result = mergeGraph(existingNodes, existingEdges, newNodes, []);

    expect(result.nodes).toHaveLength(3);
    expect(result.nodes.filter((n) => n.id === "n1")).toHaveLength(1);
    // The ORIGINAL entry for n1 is kept (not overwritten by the duplicate).
    expect(result.nodes.find((n) => n.id === "n1")?.label).toBe("Node 1");
  });

  it("Test 2: a duplicate-id edge is not added twice", () => {
    const newEdges: TestEdge[] = [
      { id: "e1", source: "n1", target: "n2" },
      { id: "e2", source: "n2", target: "n3" },
    ];
    const result = mergeGraph(existingNodes, existingEdges, [], newEdges);

    expect(result.edges).toHaveLength(2);
    expect(result.edges.filter((e) => e.id === "e1")).toHaveLength(1);
  });

  it("Test 3: new-only nodes/edges are appended", () => {
    const newNodes: TestNode[] = [{ id: "n3", label: "Node 3" }];
    const newEdges: TestEdge[] = [{ id: "e2", source: "n2", target: "n3" }];
    const result = mergeGraph(existingNodes, existingEdges, newNodes, newEdges);

    expect(result.nodes.map((n) => n.id)).toEqual(["n1", "n2", "n3"]);
    expect(result.edges.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("Test 4: original input arrays are never mutated", () => {
    const newNodes: TestNode[] = [{ id: "n3", label: "Node 3" }];
    const newEdges: TestEdge[] = [{ id: "e2", source: "n2", target: "n3" }];

    mergeGraph(existingNodes, existingEdges, newNodes, newEdges);

    expect(existingNodes).toHaveLength(2);
    expect(existingEdges).toHaveLength(1);
    expect(newNodes).toHaveLength(1);
    expect(newEdges).toHaveLength(1);
  });

  it("Test 5: merging the same expansion result twice is idempotent", () => {
    const newNodes: TestNode[] = [{ id: "n3", label: "Node 3" }];
    const newEdges: TestEdge[] = [{ id: "e2", source: "n2", target: "n3" }];

    const once = mergeGraph(existingNodes, existingEdges, newNodes, newEdges);
    const twice = mergeGraph(once.nodes, once.edges, newNodes, newEdges);

    expect(twice.nodes).toHaveLength(once.nodes.length);
    expect(twice.edges).toHaveLength(once.edges.length);
    expect(twice.nodes.map((n) => n.id)).toEqual(once.nodes.map((n) => n.id));
    expect(twice.edges.map((e) => e.id)).toEqual(once.edges.map((e) => e.id));
  });
});
