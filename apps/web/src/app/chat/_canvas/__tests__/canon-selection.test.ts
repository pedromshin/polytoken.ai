/**
 * canon-selection.test.ts — the pure multi-select helpers for canon curation
 * (RCNV-03 / Phase 63): click-to-toggle accumulation over React Flow's own
 * `selected` flag, the untrusted-node.data UUID gate, the suggest-only
 * promotable filter, and the immutable tier flip that drives the pmark.
 */

import { describe, expect, it } from "vitest";
import type { Node as FlowNode } from "@xyflow/react";

import {
  clearCanonSelection,
  isSourceNode,
  markSourcesConfirmed,
  promotableCanonEntries,
  readCanonEntry,
  selectedSourceNodes,
  toggleCanonSelection,
} from "../canon-selection";

const LEDGER_A = "550e8400-e29b-41d4-a716-446655440000";
const LEDGER_B = "550e8400-e29b-41d4-a716-446655440001";
const LEDGER_C = "550e8400-e29b-41d4-a716-446655440002";

function sourceNode(
  ledgerId: string,
  overrides: Partial<FlowNode> = {},
): FlowNode {
  return {
    id: `source:${ledgerId}`,
    type: "source",
    position: { x: 0, y: 0 },
    data: {
      sourceLedgerId: ledgerId,
      url: "https://example.com/a",
      title: "A source",
      tier: "suggested",
    },
    ...overrides,
  };
}

function chatNode(overrides: Partial<FlowNode> = {}): FlowNode {
  return {
    id: "chat:conv-1",
    type: "chat",
    position: { x: 100, y: 100 },
    data: { conversationId: "conv-1" },
    ...overrides,
  };
}

describe("isSourceNode / readCanonEntry", () => {
  it("recognizes only type 'source'", () => {
    expect(isSourceNode(sourceNode(LEDGER_A))).toBe(true);
    expect(isSourceNode(chatNode())).toBe(false);
  });

  it("extracts nodeId + ledger id + tier from a valid source node", () => {
    expect(readCanonEntry(sourceNode(LEDGER_A))).toEqual({
      nodeId: `source:${LEDGER_A}`,
      sourceLedgerId: LEDGER_A,
      tier: "suggested",
    });
  });

  it("resolves an ABSENT or unknown tier to suggested, never confirmed (suggest-only stance)", () => {
    const noTier = sourceNode(LEDGER_A, {
      data: { sourceLedgerId: LEDGER_A, url: "https://e.com", title: "t" },
    });
    expect(readCanonEntry(noTier)?.tier).toBe("suggested");

    const junkTier = sourceNode(LEDGER_A, {
      data: { sourceLedgerId: LEDGER_A, tier: "captured" },
    });
    expect(readCanonEntry(junkTier)?.tier).toBe("suggested");
  });

  it("returns null for a non-source node", () => {
    expect(readCanonEntry(chatNode())).toBeNull();
  });

  it("returns null for a tampered non-UUID ledger id — it must never reach a fetch URL", () => {
    const tampered = sourceNode(LEDGER_A, {
      data: { sourceLedgerId: "../../../etc/passwd", tier: "suggested" },
    });
    expect(readCanonEntry(tampered)).toBeNull();

    const nonString = sourceNode(LEDGER_A, {
      data: { sourceLedgerId: 42, tier: "suggested" },
    });
    expect(readCanonEntry(nonString)).toBeNull();

    const missing = sourceNode(LEDGER_A, { data: {} });
    expect(readCanonEntry(missing)).toBeNull();
  });
});

describe("toggleCanonSelection — click-to-toggle accumulation", () => {
  it("selects an unselected source node", () => {
    const nodes = [sourceNode(LEDGER_A), chatNode()];
    const next = toggleCanonSelection(nodes, `source:${LEDGER_A}`);
    expect(next.find((n) => n.id === `source:${LEDGER_A}`)?.selected).toBe(true);
  });

  it("PRESERVES other source selections while toggling (multi-select without a modifier key)", () => {
    const nodes = [
      sourceNode(LEDGER_A, { selected: true }),
      sourceNode(LEDGER_B),
      sourceNode(LEDGER_C),
    ];
    const next = toggleCanonSelection(nodes, `source:${LEDGER_B}`);
    expect(next.find((n) => n.id === `source:${LEDGER_A}`)?.selected).toBe(true);
    expect(next.find((n) => n.id === `source:${LEDGER_B}`)?.selected).toBe(true);
    expect(next.find((n) => n.id === `source:${LEDGER_C}`)?.selected).not.toBe(
      true,
    );
  });

  it("deselects an already-selected source node (toggle off)", () => {
    const nodes = [
      sourceNode(LEDGER_A, { selected: true }),
      sourceNode(LEDGER_B, { selected: true }),
    ];
    const next = toggleCanonSelection(nodes, `source:${LEDGER_A}`);
    expect(next.find((n) => n.id === `source:${LEDGER_A}`)?.selected).toBe(false);
    expect(next.find((n) => n.id === `source:${LEDGER_B}`)?.selected).toBe(true);
  });

  it("returns the SAME array instance for a non-source node id (stock behaviour untouched)", () => {
    const nodes = [sourceNode(LEDGER_A), chatNode()];
    expect(toggleCanonSelection(nodes, "chat:conv-1")).toBe(nodes);
  });

  it("returns the SAME array instance for an unknown id", () => {
    const nodes = [sourceNode(LEDGER_A)];
    expect(toggleCanonSelection(nodes, "source:missing")).toBe(nodes);
  });

  it("never mutates the input nodes", () => {
    const original = sourceNode(LEDGER_A);
    toggleCanonSelection([original], `source:${LEDGER_A}`);
    expect(original.selected).toBeUndefined();
  });
});

describe("selectedSourceNodes / promotableCanonEntries", () => {
  it("counts only SELECTED SOURCE nodes — a selected chat node never joins the canon selection", () => {
    const nodes = [
      sourceNode(LEDGER_A, { selected: true }),
      sourceNode(LEDGER_B),
      chatNode({ selected: true }),
    ];
    expect(selectedSourceNodes(nodes).map((n) => n.id)).toEqual([
      `source:${LEDGER_A}`,
    ]);
  });

  it("promotable excludes already-confirmed cards (no N that lies)", () => {
    const nodes = [
      sourceNode(LEDGER_A, { selected: true }),
      sourceNode(LEDGER_B, {
        selected: true,
        data: { sourceLedgerId: LEDGER_B, tier: "confirmed" },
      }),
    ];
    expect(promotableCanonEntries(nodes).map((e) => e.sourceLedgerId)).toEqual([
      LEDGER_A,
    ]);
  });

  it("promotable excludes a selected card with a tampered ledger id", () => {
    const nodes = [
      sourceNode(LEDGER_A, {
        selected: true,
        data: { sourceLedgerId: "not-a-uuid", tier: "suggested" },
      }),
      sourceNode(LEDGER_B, { selected: true }),
    ];
    expect(promotableCanonEntries(nodes).map((e) => e.sourceLedgerId)).toEqual([
      LEDGER_B,
    ]);
  });
});

describe("clearCanonSelection", () => {
  it("with no ids: deselects every selected source node, leaves other node types alone", () => {
    const nodes = [
      sourceNode(LEDGER_A, { selected: true }),
      sourceNode(LEDGER_B, { selected: true }),
      chatNode({ selected: true }),
    ];
    const next = clearCanonSelection(nodes);
    expect(next.find((n) => n.id === `source:${LEDGER_A}`)?.selected).toBe(false);
    expect(next.find((n) => n.id === `source:${LEDGER_B}`)?.selected).toBe(false);
    // Non-source selection is NOT this helper's business.
    expect(next.find((n) => n.id === "chat:conv-1")?.selected).toBe(true);
  });

  it("with ids: deselects only those (failed promotions stay selected for retry)", () => {
    const nodes = [
      sourceNode(LEDGER_A, { selected: true }),
      sourceNode(LEDGER_B, { selected: true }),
    ];
    const next = clearCanonSelection(nodes, [`source:${LEDGER_A}`]);
    expect(next.find((n) => n.id === `source:${LEDGER_A}`)?.selected).toBe(false);
    expect(next.find((n) => n.id === `source:${LEDGER_B}`)?.selected).toBe(true);
  });

  it("returns the SAME array instance when nothing is selected (no-op never re-renders)", () => {
    const nodes = [sourceNode(LEDGER_A), chatNode()];
    expect(clearCanonSelection(nodes)).toBe(nodes);
  });
});

describe("markSourcesConfirmed — the pmark flip", () => {
  it("flips data.tier to confirmed for the given source node ids only", () => {
    const nodes = [
      sourceNode(LEDGER_A, { selected: true }),
      sourceNode(LEDGER_B, { selected: true }),
    ];
    const next = markSourcesConfirmed(nodes, [`source:${LEDGER_A}`]);
    expect(
      (next.find((n) => n.id === `source:${LEDGER_A}`)?.data as { tier?: string })
        .tier,
    ).toBe("confirmed");
    expect(
      (next.find((n) => n.id === `source:${LEDGER_B}`)?.data as { tier?: string })
        .tier,
    ).toBe("suggested");
  });

  it("preserves the rest of node.data (url/title/ledger id survive the flip)", () => {
    const nodes = [sourceNode(LEDGER_A)];
    const next = markSourcesConfirmed(nodes, [`source:${LEDGER_A}`]);
    expect(next[0]?.data).toEqual({
      sourceLedgerId: LEDGER_A,
      url: "https://example.com/a",
      title: "A source",
      tier: "confirmed",
    });
  });

  it("never mutates the input node or its data", () => {
    const original = sourceNode(LEDGER_A);
    markSourcesConfirmed([original], [`source:${LEDGER_A}`]);
    expect((original.data as { tier?: string }).tier).toBe("suggested");
  });

  it("returns the SAME array instance for an empty id list or ids already confirmed", () => {
    const nodes = [
      sourceNode(LEDGER_A, {
        data: { sourceLedgerId: LEDGER_A, tier: "confirmed" },
      }),
    ];
    expect(markSourcesConfirmed(nodes, [])).toBe(nodes);
    expect(markSourcesConfirmed(nodes, [`source:${LEDGER_A}`])).toBe(nodes);
  });

  it("ignores non-source node ids — a tier must never be stamped onto a panel", () => {
    const nodes = [chatNode()];
    const next = markSourcesConfirmed(nodes, ["chat:conv-1"]);
    expect(next).toBe(nodes);
    expect((nodes[0]?.data as { tier?: string }).tier).toBeUndefined();
  });
});
