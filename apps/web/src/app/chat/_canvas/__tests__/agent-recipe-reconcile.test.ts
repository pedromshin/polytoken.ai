/**
 * agent-recipe-reconcile.test.ts — Phase 73C-R3 (the agent-named recipe seam).
 * Covers the pure collector that turns a persisted `canvas_recipe` message part
 * into a `canvasRecipes.create` plan:
 *
 *   - keys are validated against the LIVE canvas — unknown node/edge keys are
 *     dropped, never trusted; a part with zero present nodeKeys yields no plan.
 *   - dedupe is idempotent on the conversation + name key: a name already in
 *     the fetched `canvasRecipes.list` data is skipped, so the post-turn
 *     refetch (after create + invalidate) cannot double-create; two same-name
 *     parts in one pass collapse to one plan.
 *   - the plan carries exactly the create input (trimmed name, resolved keys,
 *     sourceRef only when a plain object) plus the runner's provenanceKey.
 */

import { describe, expect, it } from "vitest";
import type { Edge as FlowEdge, Node as FlowNode } from "@xyflow/react";

import type { ChatHistoryRow } from "../../_hooks/use-conversation-controller";
import { collectAgentRecipePlans } from "../agent-recipe-reconcile";

const MSG_1 = "00000000-0000-0000-0000-0000000000c1";
const MSG_2 = "00000000-0000-0000-0000-0000000000c2";

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

function flowNode(id: string): FlowNode {
  return { id, type: "spreadsheet", position: { x: 0, y: 0 }, data: {} };
}

function flowEdge(id: string): FlowEdge {
  return { id, source: "a", target: "b" };
}

const NODES: FlowNode[] = [flowNode("spreadsheet:inv"), flowNode("spreadsheet:bank")];
const EDGES: FlowEdge[] = [flowEdge("edge-1")];

function recipeRow(name: string, nodeKeys: readonly string[], extra?: Record<string, unknown>) {
  return { type: "canvas_recipe", name, nodeKeys, edgeKeys: [], ...extra };
}

describe("collectAgentRecipePlans — key validation (never trust the model)", () => {
  it("collects a plan keeping ONLY the live-present node/edge keys", () => {
    const rows: ChatHistoryRow[] = [
      historyRow({
        id: MSG_1,
        turnIndex: 0,
        parts: [
          {
            type: "canvas_recipe",
            name: "Reconciliation",
            nodeKeys: ["spreadsheet:inv", "not-on-canvas", "spreadsheet:bank"],
            edgeKeys: ["edge-1", "ghost-edge"],
            sourceRef: { kind: "gmail_query" },
          },
        ],
      }),
    ];

    const plans = collectAgentRecipePlans(rows, NODES, EDGES, []);

    expect(plans).toHaveLength(1);
    expect(plans[0]).toEqual({
      provenanceKey: `${MSG_1}:0`,
      name: "Reconciliation",
      nodeKeys: ["spreadsheet:inv", "spreadsheet:bank"],
      edgeKeys: ["edge-1"],
      sourceRef: { kind: "gmail_query" },
    });
  });

  it("yields NO plan when every nodeKey fails resolution (fail-closed)", () => {
    const rows: ChatHistoryRow[] = [
      historyRow({
        id: MSG_1,
        turnIndex: 0,
        parts: [recipeRow("Ghost group", ["nope-1", "nope-2"])],
      }),
    ];

    expect(collectAgentRecipePlans(rows, NODES, EDGES, [])).toEqual([]);
  });

  it("dedupes repeated keys and drops non-string entries without throwing", () => {
    const rows: ChatHistoryRow[] = [
      historyRow({
        id: MSG_1,
        turnIndex: 0,
        parts: [
          {
            type: "canvas_recipe",
            name: "Dupes",
            nodeKeys: ["spreadsheet:inv", "spreadsheet:inv", 7, null],
            edgeKeys: "not-an-array",
          },
        ],
      }),
    ];

    const plans = collectAgentRecipePlans(rows, NODES, EDGES, []);

    expect(plans).toHaveLength(1);
    expect(plans[0]!.nodeKeys).toEqual(["spreadsheet:inv"]);
    expect(plans[0]!.edgeKeys).toEqual([]);
  });

  it("skips inactive rows, non-recipe parts, and unusable names", () => {
    const rows: ChatHistoryRow[] = [
      historyRow({
        id: MSG_1,
        turnIndex: 0,
        isActive: false,
        parts: [recipeRow("Inactive", ["spreadsheet:inv"])],
      }),
      historyRow({
        id: MSG_2,
        turnIndex: 1,
        parts: [
          { type: "text", text: "not a recipe" },
          recipeRow("   ", ["spreadsheet:inv"]),
          { type: "canvas_recipe", name: 42, nodeKeys: ["spreadsheet:inv"] },
        ],
      }),
    ];

    expect(collectAgentRecipePlans(rows, NODES, EDGES, [])).toEqual([]);
  });

  it("omits sourceRef when it is not a plain object", () => {
    const rows: ChatHistoryRow[] = [
      historyRow({
        id: MSG_1,
        turnIndex: 0,
        parts: [recipeRow("No ref", ["spreadsheet:inv"], { sourceRef: ["nope"] })],
      }),
    ];

    const plans = collectAgentRecipePlans(rows, NODES, EDGES, []);

    expect(plans).toHaveLength(1);
    expect("sourceRef" in plans[0]!).toBe(false);
  });
});

describe("collectAgentRecipePlans — idempotent dedupe (conversation + name)", () => {
  it("skips a part whose (trimmed) name already exists in the fetched recipes", () => {
    const rows: ChatHistoryRow[] = [
      historyRow({
        id: MSG_1,
        turnIndex: 0,
        parts: [recipeRow("  Reconciliation  ", ["spreadsheet:inv"])],
      }),
    ];
    const existing = [{ name: "Reconciliation" }];

    expect(collectAgentRecipePlans(rows, NODES, EDGES, existing)).toEqual([]);
  });

  it("collapses two same-name parts in one pass to a single plan (first wins)", () => {
    const rows: ChatHistoryRow[] = [
      historyRow({
        id: MSG_1,
        turnIndex: 0,
        parts: [recipeRow("Twice", ["spreadsheet:inv"])],
      }),
      historyRow({
        id: MSG_2,
        turnIndex: 1,
        parts: [recipeRow("Twice", ["spreadsheet:bank"])],
      }),
    ];

    const plans = collectAgentRecipePlans(rows, NODES, EDGES, []);

    expect(plans).toHaveLength(1);
    expect(plans[0]!.provenanceKey).toBe(`${MSG_1}:0`);
    expect(plans[0]!.nodeKeys).toEqual(["spreadsheet:inv"]);
  });

  it("is idempotent across the post-create refetch: once the created recipe is in the list, a re-run yields nothing", () => {
    const rows: ChatHistoryRow[] = [
      historyRow({
        id: MSG_1,
        turnIndex: 0,
        parts: [recipeRow("Invoice loop", ["spreadsheet:inv", "spreadsheet:bank"])],
      }),
    ];

    const firstPass = collectAgentRecipePlans(rows, NODES, EDGES, []);
    expect(firstPass).toHaveLength(1);

    // Simulate the runner having created the row + invalidated the list — the
    // SAME part on the refetch-driven re-run must not plan a second create.
    const afterCreate = [{ name: firstPass[0]!.name }];
    expect(collectAgentRecipePlans(rows, NODES, EDGES, afterCreate)).toEqual([]);
  });

  it("never mutates its inputs", () => {
    const parts = [recipeRow("Frozen", ["spreadsheet:inv"])];
    const rows: ChatHistoryRow[] = [historyRow({ id: MSG_1, turnIndex: 0, parts })];
    const existing = [{ name: "Other" }];
    const nodesBefore = JSON.stringify(NODES);
    const existingBefore = JSON.stringify(existing);

    collectAgentRecipePlans(rows, NODES, EDGES, existing);

    expect(JSON.stringify(NODES)).toBe(nodesBefore);
    expect(JSON.stringify(existing)).toBe(existingBefore);
    expect(parts[0]!.nodeKeys).toEqual(["spreadsheet:inv"]);
  });
});
