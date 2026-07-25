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

import type { ChatHistoryRow } from "../../_hooks/use-conversation-controller";
import {
  agentEdgeId,
  agentNodeId,
  collectAgentEdges,
  reconcileNodesFromHistory,
  type PersistedCanvasNode,
} from "../use-canvas-persistence";

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
    expect(edge.data).toEqual({ sourcePath: "total", targetKey: "input" });
    expect(edge.id).toBe(
      agentEdgeId(agentNodeId("sheet"), agentNodeId("tile"), "total", "input"),
    );
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
