"use client";

/**
 * use-canvas-history.ts — useCanvasHistory: the React shell over the pure
 * `canvas-history.ts` command stack (CI-06). It owns the undo/redo stacks,
 * captures the live `{nodes, edges}` snapshot at the moment a mutation is
 * recorded, and applies a restored snapshot back through the SAME
 * `setNodes`/`setEdges` React Flow setters + the SAME debounced `scheduleSave`
 * every other canvas mutation uses — never a parallel write path.
 *
 * The pattern is RECORD-BEFORE: a caller calls `record(label)` immediately
 * BEFORE it mutates `nodes`/`edges` (adds a node, deletes, connects, edits a
 * label, or — via `onNodeDragStart` — starts a move). The hook snapshots the
 * current live arrays from a ref that is kept fresh every render, so the
 * restore point is the state as it was before the edit. `undo`/`redo` then
 * swap snapshots and return the label to announce (the host toasts/announces
 * it via its aria-live region).
 *
 * A `historyRef` mirrors the stack state so `undo`/`redo` read a synchronous,
 * always-current stack (never a stale closure) while `historyVersion` state
 * exists only to re-render `canUndo`/`canRedo` for any chrome that reflects
 * them.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Edge as FlowEdge,
  Node as FlowNode,
} from "@xyflow/react";

import {
  canRedo as canRedoStack,
  canUndo as canUndoStack,
  EMPTY_CANVAS_HISTORY,
  recordHistory,
  reconcileServerOwnedData,
  redoHistory,
  undoHistory,
  type CanvasHistoryState,
} from "./canvas-history";

type NodesSetter = (
  updater: FlowNode[] | ((prev: FlowNode[]) => FlowNode[]),
) => void;
type EdgesSetter = (
  updater: FlowEdge[] | ((prev: FlowEdge[]) => FlowEdge[]),
) => void;

export interface UseCanvasHistoryOptions {
  readonly nodes: readonly FlowNode[];
  readonly edges: readonly FlowEdge[];
  readonly setNodes: NodesSetter;
  readonly setEdges: EdgesSetter;
  /** Called after a snapshot is restored so the restore persists through the
   * existing debounced `chat.saveCanvasLayout` — never a new save path. */
  readonly onAfterApply?: () => void;
}

export interface UseCanvasHistoryResult {
  /** Records a restore point (the CURRENT live state) labeled with the
   * about-to-happen mutation. Call it immediately BEFORE the mutation. */
  readonly record: (label: string) => void;
  /** Restores the newest restore point; returns the announced label, or
   * `null` when there was nothing to undo. */
  readonly undo: () => string | null;
  /** Re-applies the newest redone-away point; returns the announced label, or
   * `null` when there was nothing to redo. */
  readonly redo: () => string | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export function useCanvasHistory({
  nodes,
  edges,
  setNodes,
  setEdges,
  onAfterApply,
}: UseCanvasHistoryOptions): UseCanvasHistoryResult {
  const historyRef = useRef<CanvasHistoryState>(EMPTY_CANVAS_HISTORY);
  const [, setHistoryVersion] = useState(0);

  // The live arrays, kept fresh every render so a restore point captured at
  // event time is never a stale closure snapshot.
  const liveRef = useRef({ nodes, edges });
  useEffect(() => {
    liveRef.current = { nodes, edges };
  }, [nodes, edges]);

  const commit = useCallback((next: CanvasHistoryState) => {
    historyRef.current = next;
    setHistoryVersion((v) => v + 1);
  }, []);

  const record = useCallback(
    (label: string) => {
      commit(
        recordHistory(historyRef.current, {
          label,
          snapshot: {
            nodes: liveRef.current.nodes,
            edges: liveRef.current.edges,
          },
        }),
      );
    },
    [commit],
  );

  const undo = useCallback((): string | null => {
    const transition = undoHistory(historyRef.current, {
      nodes: liveRef.current.nodes,
      edges: liveRef.current.edges,
    });
    if (transition === null) return null;
    commit(transition.history);
    setNodes(reconcileServerOwnedData(transition.snapshot.nodes, liveRef.current.nodes));
    setEdges([...transition.snapshot.edges]);
    onAfterApply?.();
    return transition.label;
  }, [commit, setNodes, setEdges, onAfterApply]);

  const redo = useCallback((): string | null => {
    const transition = redoHistory(historyRef.current, {
      nodes: liveRef.current.nodes,
      edges: liveRef.current.edges,
    });
    if (transition === null) return null;
    commit(transition.history);
    setNodes(reconcileServerOwnedData(transition.snapshot.nodes, liveRef.current.nodes));
    setEdges([...transition.snapshot.edges]);
    onAfterApply?.();
    return transition.label;
  }, [commit, setNodes, setEdges, onAfterApply]);

  return {
    record,
    undo,
    redo,
    canUndo: canUndoStack(historyRef.current),
    canRedo: canRedoStack(historyRef.current),
  };
}
