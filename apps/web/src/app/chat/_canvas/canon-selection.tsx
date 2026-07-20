/**
 * canon-selection.tsx — multi-select state helpers for SOURCE canvas nodes
 * (RCNV-03 / Phase 63: canon curation).
 *
 * WHERE THE SELECTION LIVES — and why this module owns no React state of its
 * own: the canvas's ONLY selection substrate is React Flow's per-node
 * `selected` flag on the `nodes` array `chat-canvas.tsx` holds via
 * `useNodesState` (that file's `handlePaneClick` clears it; its add-handlers
 * seed a new node `selected: true` while deselecting the rest). A second,
 * parallel "canon selection" Set would be the exact drift trap the canvas's
 * one-store discipline (STATE-01/D-10) exists to prevent: two sources of
 * truth about which cards look selected. So every helper here is a PURE
 * function over `FlowNode[]` — chat-canvas.tsx applies them inside its
 * existing `setNodes` functional-updater idiom and React Flow's own selected
 * ring/chrome renders the result for free (`canvasNodeShellClass` already
 * takes `selected`).
 *
 * THE ONE DEVIATION from stock React Flow selection, and the reason this file
 * exists at all: stock click-selection is single-select (a plain click
 * deselects everything else; multi-select needs shift/meta). Curation is a
 * GATHERING gesture — "these four sources belong in the canon" — and asking
 * for a held modifier to gather is ceremony. `toggleCanonSelection` therefore
 * makes a plain click on a SOURCE node toggle that node while PRESERVING
 * every other source node's selection (click-to-toggle accumulation). It
 * deliberately leaves non-source nodes alone: panels/chat/preview nodes keep
 * stock single-select behaviour, because only sources have a canon to join.
 *
 * SUGGEST-ONLY STANCE (tier.ts / SourceNodeDataSchema restated): nothing in
 * this module promotes anything. Selection is free; promotion is the
 * deliberate, user-clicked act in `canon-toolbar.tsx`, which calls the
 * EXISTING Phase 56-05 promotion gate (PromoteSourceLedgerEntryUseCase →
 * unchanged SourceCaptureHandler/PromoteEdgeUseCase, INFERRED → EXTRACTED).
 * `markSourcesConfirmed` here only mirrors an ALREADY-CONFIRMED promotion
 * back onto node.data so the pmark flips dashed-suggested → solid-confirmed
 * (source-node.tsx renders both tiers from `data.tier`; law 3 — tier owns the
 * mark, kind owns the shape).
 *
 * NODE.DATA IS UNTRUSTED AT READ TIME (T-61-04's posture, same as
 * `safeSourceHref`): these nodes restore from `chat_canvas_layouts` — a
 * user-writable row revalidated only against the generic snapshot schema —
 * so `readCanonEntry` re-gates `sourceLedgerId` to a UUID shape before the
 * toolbar may ever interpolate it into a promotion URL. A tampered id
 * degrades to "not promotable", never to a request with attacker-shaped
 * path segments.
 */

import type { Node as FlowNode } from "@xyflow/react";

// ---------------------------------------------------------------------------
// Node predicates + entry extraction
// ---------------------------------------------------------------------------

/** The node type the whole module keys on — `node-type-registry`'s "source". */
export const SOURCE_NODE_TYPE = "source";

/** UUID shape gate for a ledger id read out of user-writable node.data — the
 * render-time half of SourceNodeDataSchema's `z.string().uuid()` (which the
 * generic restore path does NOT re-run per node type). */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSourceNode(node: FlowNode): boolean {
  return node.type === SOURCE_NODE_TYPE;
}

/**
 * One selected source card as the toolbar sees it: the canvas node id (what
 * `setNodes` keys on), the ledger row id (what the promotion gate keys on),
 * and the resolved tier (absent/unknown resolves to "suggested", NEVER
 * "confirmed" — resolveSourceTier's stance, restated here because this module
 * must not import the component just for a 3-line default).
 */
export interface CanonEntry {
  readonly nodeId: string;
  readonly sourceLedgerId: string;
  readonly tier: "confirmed" | "suggested";
}

/**
 * readCanonEntry — extract a CanonEntry from an (untrusted) source node, or
 * null when the node is not a source / carries no UUID-shaped ledger id.
 * The null branch is the security posture, not an error path: a tampered
 * `sourceLedgerId` must degrade to "not promotable" rather than ride into a
 * fetch URL (see the module header).
 */
export function readCanonEntry(node: FlowNode): CanonEntry | null {
  if (!isSourceNode(node)) return null;
  const data = (node.data ?? {}) as { sourceLedgerId?: unknown; tier?: unknown };
  const ledgerId = data.sourceLedgerId;
  if (typeof ledgerId !== "string" || !UUID_PATTERN.test(ledgerId)) return null;
  return {
    nodeId: node.id,
    sourceLedgerId: ledgerId,
    // Suggest-only default: an absent/unknown tier is "suggested", never
    // "confirmed" — an auto-capture must not claim a confirmation the user
    // never gave.
    tier: data.tier === "confirmed" ? "confirmed" : "suggested",
  };
}

// ---------------------------------------------------------------------------
// Selection queries
// ---------------------------------------------------------------------------

/** Every currently-selected SOURCE node (other node types never count toward
 * the canon selection, however selected they are). */
export function selectedSourceNodes(
  nodes: readonly FlowNode[],
): readonly FlowNode[] {
  return nodes.filter((node) => isSourceNode(node) && node.selected === true);
}

/**
 * promotableCanonEntries — the subset of the selection the "Add N to canon"
 * action may actually send through the gate: selected source nodes with a
 * valid ledger id whose tier is still "suggested". Already-confirmed cards
 * are excluded (promotion is idempotent server-side via the uuid5 upsert, but
 * re-sending a confirmed row is a wasted round trip and an N that lies).
 */
export function promotableCanonEntries(
  nodes: readonly FlowNode[],
): readonly CanonEntry[] {
  return selectedSourceNodes(nodes).flatMap((node) => {
    const entry = readCanonEntry(node);
    return entry !== null && entry.tier === "suggested" ? [entry] : [];
  });
}

// ---------------------------------------------------------------------------
// Selection transitions — all pure; all return THE SAME array instance when
// nothing changed (so a no-op never forces a React Flow re-render), and fresh
// node objects only for the nodes that actually changed (CLAUDE.md
// immutability — never mutate an input node).
// ---------------------------------------------------------------------------

/**
 * toggleCanonSelection — the click-to-toggle gathering gesture (see module
 * header). Flips `selected` on the source node with `nodeId`, preserving
 * every OTHER source node's selection. Returns `nodes` unchanged when the id
 * is missing or names a non-source node (those keep stock React Flow
 * behaviour — this helper must never hijack a panel click).
 */
export function toggleCanonSelection(
  nodes: readonly FlowNode[],
  nodeId: string,
): readonly FlowNode[] {
  const target = nodes.find((node) => node.id === nodeId);
  if (target === undefined || !isSourceNode(target)) return nodes;
  return nodes.map((node) =>
    node.id === nodeId ? { ...node, selected: node.selected !== true } : node,
  );
}

/**
 * clearCanonSelection — deselect source nodes. With no `nodeIds`, clears the
 * WHOLE canon selection (the toolbar's explicit clear action, and the same
 * posture as chat-canvas.tsx's `handlePaneClick`); with `nodeIds`, deselects
 * only those (the post-promotion path: promoted cards leave the selection,
 * failed ones stay selected so the user can retry without re-gathering).
 */
export function clearCanonSelection(
  nodes: readonly FlowNode[],
  nodeIds?: readonly string[],
): readonly FlowNode[] {
  const ids = nodeIds === undefined ? null : new Set(nodeIds);
  const shouldClear = (node: FlowNode): boolean =>
    isSourceNode(node) &&
    node.selected === true &&
    (ids === null || ids.has(node.id));
  if (!nodes.some(shouldClear)) return nodes;
  return nodes.map((node) =>
    shouldClear(node) ? { ...node, selected: false } : node,
  );
}

/**
 * markSourcesConfirmed — mirror a completed promotion back onto node.data:
 * flips `data.tier` to "confirmed" for the given source node ids, which is
 * exactly what flips the pmark from dashed pencil-amber (suggested) to solid
 * verdigris (confirmed) on the next render — source-node.tsx already renders
 * both tiers from `data.tier`, so no component changes are involved.
 *
 * ONLY call this with ids the promotion gate actually confirmed (the
 * `promotedNodeIds` of a settled `promoteSourcesToCanon` call) — flipping a
 * tier the server never granted would fabricate a confirmation, the exact
 * thing the suggest-only stance forbids.
 */
export function markSourcesConfirmed(
  nodes: readonly FlowNode[],
  nodeIds: readonly string[],
): readonly FlowNode[] {
  if (nodeIds.length === 0) return nodes;
  const ids = new Set(nodeIds);
  const needsFlip = (node: FlowNode): boolean =>
    isSourceNode(node) &&
    ids.has(node.id) &&
    (node.data as { tier?: unknown } | undefined)?.tier !== "confirmed";
  if (!nodes.some(needsFlip)) return nodes;
  return nodes.map((node) =>
    needsFlip(node)
      ? { ...node, data: { ...(node.data ?? {}), tier: "confirmed" } }
      : node,
  );
}
