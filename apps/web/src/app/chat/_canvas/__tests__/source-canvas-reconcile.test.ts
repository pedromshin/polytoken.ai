/**
 * source-canvas-reconcile.test.ts — RCNV-02/RSRCH-03 (the ledger→canvas wiring
 * seam). Covers `reconcileNodesFromHistory`'s Pass 2c: turning a
 * `chat_source_ledger` row into a materialized `source` node WITHOUT the user
 * asking ("arrival is free", taste-references §3).
 *
 *   - a ledger row materializes as a node with the `source:{ledgerId}` id
 *     (via `sourceNodeId`), type "source", and the immutable display payload
 *     mapped into node.data (url/title/excerpt/tier); isNew: true, cascade-placed
 *     clear of every already-placed rect.
 *   - tier derives from the promotion anchor: knowledgeNodeId set ⇒ "confirmed",
 *     else the suggest-only default "suggested".
 *   - snippet maps to excerpt, truncated to the 500-char cap; a null/blank
 *     snippet omits excerpt entirely.
 *   - an unsafe (non-http(s)) url is SKIPPED, never placed as a broken node.
 *   - materialization is idempotent: once a source node is saved, the same
 *     ledger row on refetch is a no-op (Pass 1 restores it, Pass 2c skips it).
 *   - the default empty `sourceRows` argument places no source nodes
 *     (backward-compatible with every pre-RCNV-02 caller).
 */

import { describe, expect, it } from "vitest";

import type { ChatHistoryRow } from "../../_hooks/use-conversation-controller";
import {
  reconcileNodesFromHistory,
  sourceNodeId,
  type PersistedCanvasNode,
  type SourceLedgerRow,
} from "../use-canvas-persistence";

const LEDGER_1 = "00000000-0000-0000-0000-0000000000d1";
const LEDGER_2 = "00000000-0000-0000-0000-0000000000d2";
const KNOWLEDGE_NODE = "00000000-0000-0000-0000-0000000000e1";

function ledgerRow(overrides: Partial<SourceLedgerRow> & Pick<SourceLedgerRow, "id">): SourceLedgerRow {
  return {
    url: "https://example.com/article",
    title: "An example source",
    snippet: "A short excerpt from the source.",
    knowledgeNodeId: null,
    ...overrides,
  };
}

describe("reconcileNodesFromHistory — chat_source_ledger rows (RCNV-02)", () => {
  it("materializes a source node with the source:{ledgerId} id, type, and mapped data", () => {
    const reconciled = reconcileNodesFromHistory([], [], [ledgerRow({ id: LEDGER_1 })]);

    expect(reconciled).toHaveLength(1);
    const node = reconciled[0]!;
    expect(node.id).toBe(sourceNodeId(LEDGER_1));
    expect(node.id).toBe(`source:${LEDGER_1}`);
    expect(node.type).toBe("source");
    expect(node.isNew).toBe(true);
    expect(node.data).toEqual({
      sourceLedgerId: LEDGER_1,
      url: "https://example.com/article",
      title: "An example source",
      excerpt: "A short excerpt from the source.",
      tier: "suggested",
    });
  });

  it("derives tier 'confirmed' when the ledger row was promoted (knowledgeNodeId set)", () => {
    const reconciled = reconcileNodesFromHistory(
      [],
      [],
      [ledgerRow({ id: LEDGER_1, knowledgeNodeId: KNOWLEDGE_NODE })],
    );
    expect(reconciled[0]!.data).toMatchObject({ tier: "confirmed" });
  });

  it("truncates a long snippet to the 500-char excerpt cap", () => {
    const long = "x".repeat(900);
    const reconciled = reconcileNodesFromHistory(
      [],
      [],
      [ledgerRow({ id: LEDGER_1, snippet: long })],
    );
    const excerpt = (reconciled[0]!.data as { excerpt?: string }).excerpt;
    expect(excerpt).toHaveLength(500);
  });

  it("omits excerpt when the snippet is null or blank", () => {
    const nullSnippet = reconcileNodesFromHistory([], [], [ledgerRow({ id: LEDGER_1, snippet: null })]);
    expect((nullSnippet[0]!.data as { excerpt?: string }).excerpt).toBeUndefined();

    const blankSnippet = reconcileNodesFromHistory([], [], [ledgerRow({ id: LEDGER_2, snippet: "   " })]);
    expect((blankSnippet[0]!.data as { excerpt?: string }).excerpt).toBeUndefined();
  });

  it("SKIPS a row whose url is not an absolute http(s) URL (never a broken/unsafe node)", () => {
    const reconciled = reconcileNodesFromHistory(
      [],
      [],
      [ledgerRow({ id: LEDGER_1, url: "javascript:alert(1)" })],
    );
    expect(reconciled).toEqual([]);
  });

  it("SKIPS a row with an empty title (SourceNodeDataSchema min/1)", () => {
    const reconciled = reconcileNodesFromHistory([], [], [ledgerRow({ id: LEDGER_1, title: "" })]);
    expect(reconciled).toEqual([]);
  });

  it("cascade-places a new source node clear of an already-placed node", () => {
    const saved: PersistedCanvasNode[] = [
      { id: "chat:c1", type: "chat", position: { x: 0, y: 0 }, data: { conversationId: "c1" } },
    ];
    const reconciled = reconcileNodesFromHistory(saved, [], [ledgerRow({ id: LEDGER_1 })]);

    expect(reconciled).toHaveLength(2);
    const sourceNode = reconciled.find((n) => n.id === sourceNodeId(LEDGER_1))!;
    // placed clear of the (0,0) chat node — never overlapping it exactly
    expect(sourceNode.position).not.toEqual({ x: 0, y: 0 });
    expect(sourceNode.isNew).toBe(true);
  });

  it("is idempotent: a saved source node is NOT re-placed by its still-present ledger row", () => {
    const saved: PersistedCanvasNode[] = [
      {
        id: sourceNodeId(LEDGER_1),
        type: "source",
        position: { x: 700, y: 800 },
        data: {
          sourceLedgerId: LEDGER_1,
          url: "https://example.com/article",
          title: "An example source",
          tier: "suggested",
        },
      },
    ];
    const reconciled = reconcileNodesFromHistory(saved, [], [ledgerRow({ id: LEDGER_1 })]);

    // exactly one node, restored at its EXACT saved position (Pass 1), never a
    // second copy from Pass 2c
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]!.position).toEqual({ x: 700, y: 800 });
    expect(reconciled[0]!.isNew).toBe(false);
  });

  it("places one node per distinct ledger row", () => {
    const reconciled = reconcileNodesFromHistory(
      [],
      [],
      [ledgerRow({ id: LEDGER_1 }), ledgerRow({ id: LEDGER_2 })],
    );
    expect(reconciled.map((n) => n.id).sort()).toEqual(
      [sourceNodeId(LEDGER_1), sourceNodeId(LEDGER_2)].sort(),
    );
  });

  it("defaults to no source nodes when sourceRows is omitted (backward compatible)", () => {
    const rows: ChatHistoryRow[] = [];
    expect(reconcileNodesFromHistory([], rows)).toEqual([]);
  });
});
