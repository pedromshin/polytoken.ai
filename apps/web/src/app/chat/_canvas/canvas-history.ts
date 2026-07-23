/**
 * canvas-history.ts — the command-pattern undo/redo stack for canvas
 * mutations (CI-06). PURE + framework-agnostic: it moves `{nodes, edges}`
 * SNAPSHOTS between two stacks and never touches React, React Flow, or the
 * persistence layer. `use-canvas-history.ts` is the thin React shell that
 * drives it against `useNodesState`/`useEdgesState` and the debounced save.
 *
 * SCOPE (CI-06, verbatim): add / remove / move / connect / label — the
 * structural canvas mutations. NEVER chat content: a genui-panel node carries
 * only a provenance ref in `node.data`, and edges carry only
 * `{sourcePath, targetKey}`, so a snapshot of the `nodes`/`edges` arrays is
 * exactly "the canvas layout" and nothing volatile/streaming (which lives in
 * React context, not in the arrays — D-07).
 *
 * RECORD-BEFORE SEMANTICS. A caller records a restore point with the label of
 * the action it is ABOUT to perform, capturing the state as it is NOW (before
 * the mutation). `recordHistory` therefore stores the *before* snapshot; the
 * live *after* snapshot is captured at undo time and parked on the redo stack
 * under the SAME label, so a do → undo → redo round-trip restores byte-for-
 * byte and the label reads correctly in both directions ("Undid Add node" /
 * "Redid Add node"). Any new record clears the redo stack (a fresh branch of
 * history), the universal undo/redo contract.
 */

import type { Edge as FlowEdge, Node as FlowNode } from "@xyflow/react";

export interface CanvasHistorySnapshot {
  readonly nodes: readonly FlowNode[];
  readonly edges: readonly FlowEdge[];
}

export interface CanvasHistoryEntry {
  /** Human label of the mutation this entry brackets — surfaced verbatim in
   * the undo/redo toast ("Undid {label}"). */
  readonly label: string;
  readonly snapshot: CanvasHistorySnapshot;
}

export interface CanvasHistoryState {
  /** Restore points, oldest→newest; the tail is the next undo target. */
  readonly past: readonly CanvasHistoryEntry[];
  /** Redone-away points, oldest→newest; the tail is the next redo target. */
  readonly future: readonly CanvasHistoryEntry[];
}

export const EMPTY_CANVAS_HISTORY: CanvasHistoryState = { past: [], future: [] };

/** Bound on the undo depth — an unbounded stack would pin every historical
 * `nodes`/`edges` array in memory for the life of the canvas. 100 discrete
 * structural edits is well beyond any single session's realistic reach. */
export const CANVAS_HISTORY_LIMIT = 100;

/** The outcome of an undo/redo step: the new stack state, the snapshot the
 * caller must apply to React Flow, and the label to announce. */
export interface CanvasHistoryTransition {
  readonly history: CanvasHistoryState;
  readonly snapshot: CanvasHistorySnapshot;
  readonly label: string;
}

/**
 * recordHistory — push a restore point (the *before* snapshot of an
 * about-to-happen mutation) and clear the redo stack. The oldest entry is
 * dropped once `past` would exceed `limit`.
 */
export function recordHistory(
  state: CanvasHistoryState,
  entry: CanvasHistoryEntry,
  limit: number = CANVAS_HISTORY_LIMIT,
): CanvasHistoryState {
  const past = [...state.past, entry];
  // Keep only the newest `limit` entries.
  const trimmed = past.length > limit ? past.slice(past.length - limit) : past;
  return { past: trimmed, future: [] };
}

/**
 * undoHistory — pop the newest restore point and return its snapshot to apply.
 * The `current` (live) snapshot is parked on the redo stack under the popped
 * entry's label so redo can return the canvas to exactly where undo left it.
 * Returns `null` (a no-op) when there is nothing to undo.
 */
export function undoHistory(
  state: CanvasHistoryState,
  current: CanvasHistorySnapshot,
): CanvasHistoryTransition | null {
  const entry = state.past[state.past.length - 1];
  if (entry === undefined) return null;
  return {
    history: {
      past: state.past.slice(0, -1),
      future: [...state.future, { label: entry.label, snapshot: current }],
    },
    snapshot: entry.snapshot,
    label: entry.label,
  };
}

/**
 * redoHistory — pop the newest redone-away point and return its snapshot to
 * apply, parking the live snapshot back on the undo stack under the same
 * label. Returns `null` (a no-op) when there is nothing to redo.
 */
export function redoHistory(
  state: CanvasHistoryState,
  current: CanvasHistorySnapshot,
): CanvasHistoryTransition | null {
  const entry = state.future[state.future.length - 1];
  if (entry === undefined) return null;
  return {
    history: {
      past: [...state.past, { label: entry.label, snapshot: current }],
      future: state.future.slice(0, -1),
    },
    snapshot: entry.snapshot,
    label: entry.label,
  };
}

export function canUndo(state: CanvasHistoryState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: CanvasHistoryState): boolean {
  return state.future.length > 0;
}

/** Keys on `node.data` the SERVER owns (canon-promotion state), NOT the canvas.
 * CI-06's scope is structural — add/remove/move/connect/label — explicitly "not
 * content". A history snapshot still carries the whole `node.data`, so undoing
 * a move made *before* a promote would otherwise restore the pre-promote `tier`
 * onto the node and the debounced save would persist that demotion, drifting
 * the canvas from the server's knowledge ledger. Reconcile overlays the LIVE
 * value of these fields onto every restored node so undo/redo can never revert
 * server-owned canon state. */
const SERVER_OWNED_DATA_KEYS = ["tier"] as const;

export function reconcileServerOwnedData(
  restored: readonly FlowNode[],
  live: readonly FlowNode[],
): FlowNode[] {
  const liveById = new Map(live.map((n) => [n.id, n]));
  return restored.map((node) => {
    const liveData = liveById.get(node.id)?.data as Record<string, unknown> | undefined;
    if (liveData === undefined) return node;
    const restoredData = (node.data ?? {}) as Record<string, unknown>;
    let data = restoredData;
    for (const key of SERVER_OWNED_DATA_KEYS) {
      if (key in liveData && liveData[key] !== restoredData[key]) {
        data = { ...data, [key]: liveData[key] };
      }
    }
    return data === restoredData ? node : { ...node, data };
  });
}
