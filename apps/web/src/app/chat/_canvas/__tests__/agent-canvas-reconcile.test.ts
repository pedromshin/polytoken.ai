/**
 * agent-canvas-reconcile.test.ts — Phase 73 Wave A (the agent-authored canvas
 * wedge). Covers the pure reconcile seams that turn a `canvas_add_node` /
 * `canvas_connect` message part into a materialized node / data-edge:
 *
 *   - reconcileNodesFromHistory materializes a `canvas_add_node` part as a node
 *     with the `agent:{handle}` id, its real registry type, and the model data
 *     (LCAN-01); an unknown `nodeType` degrades to the inert placeholder rather
 *     than throwing (CANVAS-03 parity).
 *   - Materialization is idempotent: once the node is saved, the same part on
 *     the post-turn refetch is a no-op (no duplicate) (LCAN-01).
 *   - collectAgentEdges resolves a `canvas_connect` part to exactly one
 *     persisted-edge shape ONLY when both endpoints are present, dedupes on the
 *     server verb's `(source,target,sourcePath,targetKey)` key, rejects
 *     self-loops and forbidden-segment paths, and carries a neutral payload
 *     (no tier hue — LCAN-06 is a render concern, the payload stays data-only).
 */

import { describe, expect, it } from "vitest";
import type { Node as FlowNode } from "@xyflow/react";

import type { ChatHistoryRow } from "../../_hooks/use-conversation-controller";
import type { MessagePart } from "../../_hooks/use-chat-stream";
import {
  agentEdgeId,
  agentNodeId,
  collectAgentEdges,
  reconcileNodesFromHistory,
  type PersistedCanvasNode,
} from "../use-canvas-persistence";
import {
  agentCodeIslandNodeId,
  buildAgentCodeIslandNode,
  collectAgentCodeIslandPlans,
} from "../agent-code-island-reconcile";
import { publishedNodePath } from "../canvas-publish";

const MSG_1 = "00000000-0000-0000-0000-0000000000b1";
const MSG_2 = "00000000-0000-0000-0000-0000000000b2";

function historyRow(
  overrides: Partial<ChatHistoryRow> & Pick<ChatHistoryRow, "id" | "turnIndex">,
): ChatHistoryRow {
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

describe("reconcileNodesFromHistory — canvas_add_node parts (LCAN-01)", () => {
  it("materializes an agent node with the agent:{handle} id, real type, and data", () => {
    const rows: ChatHistoryRow[] = [
      historyRow({
        id: MSG_1,
        turnIndex: 0,
        parts: [
          {
            type: "canvas_add_node",
            handle: "sheet",
            nodeType: "spreadsheet",
            data: { spreadsheetId: "sheet-42" },
          },
        ],
      }),
    ];

    const reconciled = reconcileNodesFromHistory([], rows);

    expect(reconciled).toHaveLength(1);
    const node = reconciled[0]!;
    expect(node.id).toBe(agentNodeId("sheet"));
    expect(node.id).toBe("agent:sheet");
    expect(node.type).toBe("spreadsheet");
    expect(node.data).toEqual({ spreadsheetId: "sheet-42" });
    expect(node.isNew).toBe(true);
  });

  it("degrades an unknown nodeType to the placeholder, keeping the original type marker", () => {
    const rows: ChatHistoryRow[] = [
      historyRow({
        id: MSG_1,
        turnIndex: 0,
        parts: [
          {
            type: "canvas_add_node",
            handle: "mystery",
            nodeType: "not-a-real-node-type",
            data: { a: 1 },
          },
        ],
      }),
    ];

    const reconciled = reconcileNodesFromHistory([], rows);

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]!.type).toBe("unknown-node-type");
    // original type preserved for a future registry heal + placeholder copy
    expect(reconciled[0]!.data).toMatchObject({ nodeType: "not-a-real-node-type" });
  });

  it("is idempotent: a saved agent node is NOT re-placed by its still-present part", () => {
    const saved: PersistedCanvasNode[] = [
      {
        id: agentNodeId("sheet"),
        type: "spreadsheet",
        position: { x: 500, y: 600 },
        data: { spreadsheetId: "sheet-42" },
      },
    ];
    const rows: ChatHistoryRow[] = [
      historyRow({
        id: MSG_1,
        turnIndex: 0,
        parts: [
          {
            type: "canvas_add_node",
            handle: "sheet",
            nodeType: "spreadsheet",
            data: { spreadsheetId: "sheet-42" },
          },
        ],
      }),
    ];

    const reconciled = reconcileNodesFromHistory(saved, rows);

    // exactly one node, restored at its EXACT saved position (Pass 1), never
    // a second copy from Pass 2b
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]!.position).toEqual({ x: 500, y: 600 });
    expect(reconciled[0]!.isNew).toBe(false);
  });

  it("honors a finite explicit model position", () => {
    const rows: ChatHistoryRow[] = [
      historyRow({
        id: MSG_1,
        turnIndex: 0,
        parts: [
          {
            type: "canvas_add_node",
            handle: "tile",
            nodeType: "brief",
            data: {},
            position: { x: 900, y: 120 },
          },
        ],
      }),
    ];

    const reconciled = reconcileNodesFromHistory([], rows);

    expect(reconciled).toHaveLength(1);
    // lone node, nothing to cascade around → explicit position honored exactly
    expect(reconciled[0]!.position).toEqual({ x: 900, y: 120 });
  });

  it("ignores a part with an empty handle or nodeType", () => {
    const rows: ChatHistoryRow[] = [
      historyRow({
        id: MSG_1,
        turnIndex: 0,
        parts: [
          { type: "canvas_add_node", handle: "", nodeType: "brief", data: {} },
          { type: "canvas_add_node", handle: "ok", nodeType: "", data: {} },
        ],
      }),
    ];
    expect(reconcileNodesFromHistory([], rows)).toEqual([]);
  });

  it("skips parts from an INACTIVE row (a non-displayed sibling)", () => {
    const rows: ChatHistoryRow[] = [
      historyRow({
        id: MSG_1,
        turnIndex: 0,
        isActive: false,
        parts: [{ type: "canvas_add_node", handle: "sheet", nodeType: "brief", data: {} }],
      }),
    ];
    expect(reconcileNodesFromHistory([], rows)).toEqual([]);
  });
});

describe("collectAgentEdges — canvas_connect parts (LCAN-01/06)", () => {
  const present = new Set([agentNodeId("sheet"), agentNodeId("tile")]);

  function connectRow(part: Record<string, unknown>): ChatHistoryRow {
    return historyRow({ id: MSG_2, turnIndex: 1, parts: [part as never] });
  }

  it("resolves a connect part to exactly one edge with the deterministic dedup id", () => {
    const edges = collectAgentEdges(
      [
        connectRow({
          type: "canvas_connect",
          sourceHandle: "sheet",
          targetHandle: "tile",
          sourcePath: "total",
          targetKey: "input",
        }),
      ],
      present,
    );

    expect(edges).toHaveLength(1);
    const edge = edges[0]!;
    expect(edge.source).toBe(agentNodeId("sheet"));
    expect(edge.target).toBe(agentNodeId("tile"));
    // the model's friendly "total" is rewritten to the physical published path
    // so the resolution engine carries the source node's published value (LCAN-04)
    const physical = `shared.published.${agentNodeId("sheet")}.total`;
    expect(edge.data).toEqual({ sourcePath: physical, targetKey: "input" });
    expect(edge.id).toBe(
      agentEdgeId(agentNodeId("sheet"), agentNodeId("tile"), physical, "input"),
    );
  });

  it("leaves an already-rooted shared./panels. sourcePath as an absolute reference", () => {
    const edges = collectAgentEdges(
      [
        connectRow({
          type: "canvas_connect",
          sourceHandle: "sheet",
          targetHandle: "tile",
          sourcePath: "shared.someGlobal",
          targetKey: "input",
        }),
      ],
      present,
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]!.data.sourcePath).toBe("shared.someGlobal");
  });

  it("does NOT emit an edge when an endpoint node is absent (server-verb parity)", () => {
    const edges = collectAgentEdges(
      [
        connectRow({
          type: "canvas_connect",
          sourceHandle: "sheet",
          targetHandle: "ghost",
          sourcePath: "total",
          targetKey: "input",
        }),
      ],
      present,
    );
    expect(edges).toEqual([]);
  });

  it("dedupes the same wire (post-turn refetch is a no-op)", () => {
    const part = {
      type: "canvas_connect",
      sourceHandle: "sheet",
      targetHandle: "tile",
      sourcePath: "total",
      targetKey: "input",
    };
    const edges = collectAgentEdges(
      [connectRow(part), connectRow(part)],
      present,
    );
    expect(edges).toHaveLength(1);
  });

  it("rejects a self-loop", () => {
    const edges = collectAgentEdges(
      [
        connectRow({
          type: "canvas_connect",
          sourceHandle: "sheet",
          targetHandle: "sheet",
          sourcePath: "total",
          targetKey: "input",
        }),
      ],
      present,
    );
    expect(edges).toEqual([]);
  });

  it("rejects a forbidden prototype-pollution path segment", () => {
    const edges = collectAgentEdges(
      [
        connectRow({
          type: "canvas_connect",
          sourceHandle: "sheet",
          targetHandle: "tile",
          sourcePath: "__proto__.polluted",
          targetKey: "input",
        }),
      ],
      present,
    );
    expect(edges).toEqual([]);
  });

  it("rejects an empty sourcePath/targetKey", () => {
    const edges = collectAgentEdges(
      [
        connectRow({
          type: "canvas_connect",
          sourceHandle: "sheet",
          targetHandle: "tile",
          sourcePath: "",
          targetKey: "input",
        }),
      ],
      present,
    );
    expect(edges).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 76-05 / BTAP-07 — agent-authored code-island reconcile.
// ---------------------------------------------------------------------------
describe("collectAgentCodeIslandPlans — canvas_code_island parts (BTAP-07)", () => {
  const MSG_3 = "00000000-0000-0000-0000-0000000000c3";
  const SRC_A = "spreadsheet:aaaa";
  const SRC_B = "spreadsheet:bbbb";

  function flowNode(id: string, type: string): FlowNode {
    return { id, type, position: { x: 0, y: 0 }, data: {} };
  }

  /** Two published spreadsheet sources on the canvas + their live projections. */
  const sourceNodes: FlowNode[] = [
    flowNode(SRC_A, "spreadsheet"),
    flowNode(SRC_B, "spreadsheet"),
  ];
  const values: Record<string, unknown> = {
    shared: {
      published: {
        [SRC_A]: { label: "Invoices", rowCount: 3, rows: [{ amount: 10 }] },
        [SRC_B]: { label: "Bank", rowCount: 5, rows: [{ amount: 10 }] },
      },
    },
  };

  const islandPart: MessagePart = {
    type: "canvas_code_island",
    intent: "reconcile invoices against the bank rows",
    inputs: { invoices: { kind: "table" }, bank: { kind: "table" } },
    inputBindings: {
      invoices: { sourceNodeKey: SRC_A, sourcePath: publishedNodePath(SRC_A) },
      bank: { sourceNodeKey: SRC_B, sourcePath: publishedNodePath(SRC_B) },
    },
    selectedNodeKeys: [SRC_A, SRC_B],
  };

  function islandRow(part: MessagePart = islandPart): ChatHistoryRow {
    return historyRow({ id: MSG_3, turnIndex: 2, parts: [part] });
  }

  it("plans exactly one code-island node + one data-edge per published source", () => {
    const plans = collectAgentCodeIslandPlans([islandRow()], sourceNodes, values);

    expect(plans).toHaveLength(1);
    const plan = plans[0]!;
    // deterministic node id from the part's provenance (idempotency anchor)
    expect(plan.nodeId).toBe(agentCodeIslandNodeId(MSG_3, 0));
    expect(plan.nodeId).toBe(`agent-island:${MSG_3}:0`);
    // the agent's own intent wins
    expect(plan.intent).toBe("reconcile invoices against the bank rows");
    // re-grounded: two present, published sources → two sources, two edges
    expect(plan.sources).toHaveLength(2);
    expect(plan.edges).toHaveLength(2);
    // exactly one edge per SOURCE, all pointing at the single island node
    expect(new Set(plan.edges.map((e) => e.target))).toEqual(new Set([plan.nodeId]));
    expect(plan.edges.map((e) => e.source).sort()).toEqual([SRC_A, SRC_B].sort());
    // the payload carries the PHYSICAL published path (usePanelData resolves it)
    for (const edge of plan.edges) {
      expect(edge.data.sourcePath.startsWith("shared.published.")).toBe(true);
      expect(edge.data.targetKey.length).toBeGreaterThan(0);
    }
  });

  it("materializes a ref-only code-island node carrying only the islandId", () => {
    const plan = collectAgentCodeIslandPlans([islandRow()], sourceNodes, values)[0]!;
    const node = buildAgentCodeIslandNode(plan, "island-uuid-1", { x: 120, y: 340 });

    expect(node.id).toBe(plan.nodeId);
    expect(node.type).toBe("code-island");
    expect(node.position).toEqual({ x: 120, y: 340 });
    expect(node.data).toEqual({ islandId: "island-uuid-1" });
  });

  it("is idempotent: once the island node is present, the part re-plans to nothing", () => {
    const plan = collectAgentCodeIslandPlans([islandRow()], sourceNodes, values)[0]!;
    const islandNode = buildAgentCodeIslandNode(plan, "island-uuid-1", { x: 0, y: 0 });

    // the post-turn getCanvasLayout refetch restores the saved island node by id
    const withIsland = [...sourceNodes, islandNode];
    expect(collectAgentCodeIslandPlans([islandRow()], withIsland, values)).toEqual([]);
  });

  it("dedupes the same edge id across a re-run (no double-draw)", () => {
    const first = collectAgentCodeIslandPlans([islandRow()], sourceNodes, values)[0]!;
    const second = collectAgentCodeIslandPlans([islandRow()], sourceNodes, values)[0]!;
    // deterministic edge ids: the identical part yields the identical edge id-set
    expect(new Set(second.edges.map((e) => e.id))).toEqual(
      new Set(first.edges.map((e) => e.id)),
    );
  });

  it("skips the part below the ≥2 published-source floor (fail-closed)", () => {
    // only SRC_A has published; SRC_B is on the canvas but unpublished
    const onlyA: Record<string, unknown> = {
      shared: { published: { [SRC_A]: { label: "Invoices", rowCount: 3 } } },
    };
    expect(collectAgentCodeIslandPlans([islandRow()], sourceNodes, onlyA)).toEqual([]);
  });

  it("falls back to the auto intent when the part's intent is blank", () => {
    const blank: MessagePart = { ...islandPart, intent: "   " };
    const plans = collectAgentCodeIslandPlans([islandRow(blank)], sourceNodes, values);
    expect(plans).toHaveLength(1);
    // the auto intent references the sandbox data global (build-tool-flow default)
    expect(plans[0]!.intent).toContain("window.__ISLAND_DATA__");
  });

  it("skips a part from an INACTIVE row (a non-displayed sibling)", () => {
    const row = historyRow({
      id: MSG_3,
      turnIndex: 2,
      isActive: false,
      parts: [islandPart],
    });
    expect(collectAgentCodeIslandPlans([row], sourceNodes, values)).toEqual([]);
  });

  it("skips when selectedNodeKeys reference nodes not on this canvas", () => {
    const ghostPart: MessagePart = {
      ...islandPart,
      selectedNodeKeys: ["spreadsheet:ghost1", "spreadsheet:ghost2"],
    };
    expect(collectAgentCodeIslandPlans([islandRow(ghostPart)], sourceNodes, values)).toEqual(
      [],
    );
  });
});
