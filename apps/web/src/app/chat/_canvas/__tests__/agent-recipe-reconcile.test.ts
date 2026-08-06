/**
 * agent-recipe-reconcile.test.ts — Phase 73C-R3 (the agent-named recipe seam).
 * Covers the pure collector that turns a persisted `canvas_recipe` message part
 * into a `canvasRecipes.create` plan:
 *
 *   - keys are validated against the LIVE canvas ALL-OR-NOTHING — a part plans
 *     ONLY when every nodeKey AND every edgeKey resolves (with ≥1 nodeKey);
 *     any unknown key yields NO plan this pass (fail-closed: the part persists
 *     in history and retries once same-turn agent-authored nodes/edges have
 *     materialized, so a partial row is never frozen).
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
  it("collects a plan when EVERY node/edge key resolves against the live canvas", () => {
    const rows: ChatHistoryRow[] = [
      historyRow({
        id: MSG_1,
        turnIndex: 0,
        parts: [
          {
            type: "canvas_recipe",
            name: "Reconciliation",
            nodeKeys: ["spreadsheet:inv", "spreadsheet:bank"],
            edgeKeys: ["edge-1"],
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

  it("yields NO plan when ANY nodeKey fails resolution (fail-closed, not filtered)", () => {
    // A not-yet-materialized (same-turn agent-authored) or invented nodeKey
    // must NOT freeze a partial row — the part retries on a later pass.
    const rows: ChatHistoryRow[] = [
      historyRow({
        id: MSG_1,
        turnIndex: 0,
        parts: [
          recipeRow("Racing group", [
            "spreadsheet:inv",
            "not-on-canvas-yet",
            "spreadsheet:bank",
          ]),
        ],
      }),
    ];

    expect(collectAgentRecipePlans(rows, NODES, EDGES, [])).toEqual([]);
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

  it("skips a part whose edgeKeys include ONE unknown edge (all-or-nothing on edges too)", () => {
    const rows: ChatHistoryRow[] = [
      historyRow({
        id: MSG_1,
        turnIndex: 0,
        parts: [
          {
            type: "canvas_recipe",
            name: "Half-wired",
            nodeKeys: ["spreadsheet:inv", "spreadsheet:bank"],
            edgeKeys: ["edge-1", "ghost-edge"],
          },
        ],
      }),
    ];

    expect(collectAgentRecipePlans(rows, NODES, EDGES, [])).toEqual([]);
  });

  it("dedupes repeated present keys; tolerates absent edgeKeys", () => {
    const rows: ChatHistoryRow[] = [
      historyRow({
        id: MSG_1,
        turnIndex: 0,
        parts: [
          {
            type: "canvas_recipe",
            name: "Dupes",
            nodeKeys: ["spreadsheet:inv", "spreadsheet:inv"],
          },
        ],
      }),
    ];

    const plans = collectAgentRecipePlans(rows, NODES, EDGES, []);

    expect(plans).toHaveLength(1);
    expect(plans[0]!.nodeKeys).toEqual(["spreadsheet:inv"]);
    expect(plans[0]!.edgeKeys).toEqual([]);
  });

  it("yields NO plan for malformed key lists (non-string entries, non-array edgeKeys)", () => {
    const rows: ChatHistoryRow[] = [
      historyRow({
        id: MSG_1,
        turnIndex: 0,
        parts: [
          {
            type: "canvas_recipe",
            name: "Bad node entries",
            nodeKeys: ["spreadsheet:inv", 7, null],
          },
          {
            type: "canvas_recipe",
            name: "Bad edge list",
            nodeKeys: ["spreadsheet:inv"],
            edgeKeys: "not-an-array",
          },
        ],
      }),
    ];

    expect(collectAgentRecipePlans(rows, NODES, EDGES, [])).toEqual([]);
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

  it("caps an over-long name by CODE POINTS — never strands a lone surrogate", () => {
    // 199 BMP chars + two astral emoji: a UTF-16-unit slice(0, 200) would cut
    // the first emoji in half, stranding a high surrogate; the code-point cap
    // keeps the whole first emoji and drops the second.
    const overLong = `${"x".repeat(199)}\u{1F98A}\u{1F98A}`;
    const rows: ChatHistoryRow[] = [
      historyRow({
        id: MSG_1,
        turnIndex: 0,
        parts: [recipeRow(overLong, ["spreadsheet:inv"])],
      }),
    ];

    const plans = collectAgentRecipePlans(rows, NODES, EDGES, []);

    expect(plans).toHaveLength(1);
    const name = plans[0]!.name;
    expect(name).toBe(`${"x".repeat(199)}\u{1F98A}`);
    // No lone surrogate anywhere: every UTF-16 surrogate unit pairs up into a
    // full code point (a stranded half would survive Array.from as a lone unit).
    expect(
      Array.from(name).every((cp) => !/^[\uD800-\uDFFF]$/.test(cp)),
    ).toBe(true);
    // Round-trip stability: the stored name re-enters via the fetched list and
    // must dedupe the SAME part on the next pass (no permanent re-create loop).
    expect(collectAgentRecipePlans(rows, NODES, EDGES, [{ name }])).toEqual([]);
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
