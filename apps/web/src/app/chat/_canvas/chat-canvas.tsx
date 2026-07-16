"use client";

/**
 * chat-canvas.tsx — ChatCanvas: the /chat canvas's React Flow surface
 * (CANVAS-01, CANVAS-02, CANVAS-03, D-02/D-03/D-05/D-06).
 *
 * Persistence (plan 23-04): on mount, `useCanvasPersistence` fetches the
 * conversation's saved `chat_canvas_layouts` row; while that fetch is in
 * flight, this component renders ONLY `CanvasSkeleton` — React Flow itself
 * (and its `useNodesState`/`useEdgesState`) is never mounted with a fresh/
 * unlaid-out default in the interim, so restore always "applies exactly
 * before the first paint settles" (23-UI-SPEC.md). The moment restore
 * resolves, ONE effect seeds `nodes`/`edges`/`viewport` from the restored
 * data reconciled against the conversation's CURRENT `historyRows` via
 * `reconcileNodesFromHistory` (adds any genui-panel node for a turn that
 * completed since the last save; degrades any now-unrecognized type to the
 * inert placeholder, keeping its saved position — CANVAS-03/T-23-09) plus
 * `withDefaultChatNode` (D-02's "one chat node always present" default for a
 * conversation with no saved layout yet). The SAME effect re-runs on every
 * later `historyRows` change (a turn completing while the canvas stays
 * mounted), reconciling the CURRENT `nodes` state (so drag positions are
 * never lost) against the latest history — this is the ONE seam that adds a
 * brand-new node; it never touches an already-placed node's position.
 *
 * Renders inside `CanvasSpecProvider` (23-02, history-derived
 * specsByProvenance) and `ChatControllerProvider` (23-03's D-02 seam) so
 * `GenuiPanelNode`/`ChatNode` read volatile/streaming state without ever
 * touching the `nodes` array's `data` field (D-07).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Map as MapIcon } from "lucide-react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge as FlowEdge,
  type EdgeChange,
  type Node as FlowNode,
  type NodeChange,
  type ReactFlowInstance,
  type ReactFlowProps,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// Workaround: moduleResolution:bundler + `export { default as ReactFlow }` causes TS
// to see the named export as the module namespace rather than the component value.
// Casting via the known props interface restores the JSX call signature (mirrors
// /knowledge's knowledge-graph.tsx).
const ReactFlowJSX = ReactFlow as React.ComponentType<ReactFlowProps<FlowNode, FlowEdge>>;

import { Button } from "@polytoken/ui/button";

import type { MessagePart } from "../_hooks/use-chat-stream";
import type {
  ChatHistoryRow,
  ConversationController,
} from "../_hooks/use-conversation-controller";
import { AddEmailThreadPopover } from "./add-email-thread-popover";
import { AddKnowledgePreviewPopover } from "./add-knowledge-preview-popover";
import { CanvasEmptyState } from "./canvas-empty-state";
import { CANVAS_PANEL_BUTTON_CLASS } from "./canvas-panel-button-class";
import {
  CanvasKeyboardHint,
  KEYBOARD_HINT_DISMISSED_KEY,
} from "./canvas-keyboard-hint";
import {
  CANVAS_NODE_DIMENSIONS,
  DEFAULT_CANVAS_NODE_DIMENSIONS,
  offsetCascadePosition,
  type CanvasRect,
} from "./canvas-layout";
import { CanvasSkeleton } from "./canvas-skeleton";
import { CanvasSpecProvider, type CanvasSpecEntry } from "./canvas-spec-context";
import {
  CanvasEdgesProvider,
  CanvasStoreProvider,
  toCanvasStoreSeed,
  useCanvasStoreInstance,
  type DataCarryingEdge,
} from "./canvas-store-context";
import { EdgeLabelClickProvider, type DataEdgeClickPayload } from "./data-edge";
import { EdgeCreationPicker } from "./edge-creation-picker";
import { edgeTypes } from "./edge-types";
import type { EdgePayload } from "./edge-payload-schema";
import { ChatControllerProvider } from "./chat-node";
import { nodeTypes } from "./node-types";
import {
  CanvasPersistenceProvider,
  type CanvasPersistenceContextValue,
} from "./panel-overlay-context";
import {
  reconcileNodesFromHistory,
  withDefaultChatNode,
  type PersistedCanvasEdge,
  type ReconciledNode,
  type SaveStatus,
  useCanvasPersistence,
} from "./use-canvas-persistence";

/**
 * The data edge's arrowhead. `color` is 61-05's and it is NOT decoration:
 * without it React Flow paints the marker with its own hardcoded blue-grey
 * (#b1b1b7). Measured on the live canvas — the wire rendered ink while its own
 * arrowhead rendered stock grey.
 *
 * It is the one piece of stock chrome that `globals.css`'s theming block CANNOT
 * reach, and the reason is worth knowing: React Flow computes the marker colour
 * in JS and applies it as an INLINE STYLE on the polyline, so the `--xy-*`
 * variable the stylesheet reads is never consulted. Verified directly — the var
 * resolves correctly AT the arrowhead element (`--xy-edge-stroke` = the edge
 * token) and is simply ignored, because an inline style outranks it.
 *
 * That also makes it react-flow-stock-ban.test.ts's blind spot, stated plainly
 * in that gate's header: a stylesheet parser cannot see a colour the library
 * hardcodes in JavaScript.
 *
 * `--edge` (not ink) because canvas edges are NEUTRAL by decision: a data wire
 * is plumbing, not provenance, so it earns no hue, and `--edge` is the sketch's
 * own `.e-neutral` stroke. NOTE for 61-06, which owns `data-edge.tsx`: the
 * PATH still says `!stroke-primary` (ink at 2px), so the wire and its arrowhead
 * currently disagree. That `!` is a cascade-LAYER workaround, not a design
 * choice (see globals.css's React Flow header) — the sketch's neutral edge is
 * `--edge` at 1.5px, which makes the pair agree in one line.
 */
const DATA_EDGE_MARKER_END = { type: MarkerType.ArrowClosed, color: "var(--edge)" } as const;

const DRAG_HANDLE_SELECTOR = ".node-drag-handle";
// New-panel materialization fade (23-UI-SPEC.md Interaction Contracts) —
// `motion-safe:` gates it out entirely under prefers-reduced-motion. Applied
// ONLY to a node `reconcileNodesFromHistory` just marked `isNew` — a node
// restored from a saved layout must NOT replay this entrance on every reload.
const GENUI_PANEL_CLASS_NAME = "motion-safe:animate-in fade-in duration-200";

/** `messageId:partIndex` — mirrors canvas-spec-context.tsx's own provenance
 * lookup key convention exactly. */
export function provenanceKey(messageId: string, partIndex: number): string {
  return `${messageId}:${partIndex}`;
}

/** History-derived specsByProvenance map — feeds CanvasSpecProvider (23-02
 * seam); keys mirror canvas-spec-context.tsx's own provenanceKey exactly. */
export function buildSpecsByProvenance(
  historyRows: readonly ChatHistoryRow[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of historyRows) {
    if (!row.isActive) continue;
    const parts = (row.parts as MessagePart[] | null) ?? [];
    parts.forEach((part, partIndex) => {
      if (part.type !== "genui_spec") return;
      map.set(provenanceKey(row.id, partIndex), JSON.stringify(part.spec));
    });
  }
  return map;
}

/** History-derived partsByProvenance map — feeds CanvasSpecProvider so a
 * genui-panel node can branch on the RAW part type (Task 4, D-08:
 * interactive_widget renders its own state chrome on the canvas, exactly as
 * in the transcript). Covers both genui_spec and interactive_widget parts
 * (the two panel-materializing part types — see buildExpectedGenuiPanelSpecs);
 * interaction_result is a transcript entry, never a panel. */
export function buildPartsByProvenance(
  historyRows: readonly ChatHistoryRow[],
): Map<string, MessagePart> {
  const map = new Map<string, MessagePart>();
  for (const row of historyRows) {
    if (!row.isActive) continue;
    const parts = (row.parts as MessagePart[] | null) ?? [];
    parts.forEach((part, partIndex) => {
      if (part.type !== "genui_spec" && part.type !== "interactive_widget") return;
      map.set(provenanceKey(row.id, partIndex), part);
    });
  }
  return map;
}

/** React Flow node -> the plain persisted-node shape `reconcileNodesFromHistory`
 * expects as its `savedNodes` argument — used to feed the CURRENT `nodes`
 * state back through reconciliation on a later `historyRows` change. */
function toPersistedShape(node: FlowNode): {
  readonly id: string;
  readonly type: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly data: Record<string, unknown>;
} {
  return {
    id: node.id,
    type: node.type ?? "unknown-node-type",
    position: { x: node.position.x, y: node.position.y },
    data: (node.data ?? {}) as Record<string, unknown>,
  };
}

function toFlowNode(reconciled: ReconciledNode): FlowNode {
  return {
    id: reconciled.id,
    type: reconciled.type,
    position: reconciled.position,
    dragHandle: DRAG_HANDLE_SELECTOR,
    className:
      reconciled.isNew && reconciled.type === "genui-panel"
        ? GENUI_PANEL_CLASS_NAME
        : undefined,
    data: reconciled.data,
  };
}

function toFlowEdge(edge: PersistedCanvasEdge): FlowEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "data-edge",
    animated: false, // reduced-motion posture — never a flowing/dashed edge (23-UI-SPEC.md)
    markerEnd: DATA_EDGE_MARKER_END,
    data: { sourcePath: edge.data.sourcePath, targetKey: edge.data.targetKey },
  };
}

// ---------------------------------------------------------------------------
// Edge-creation/edit picker state (STATE-02, D-09) — a single discriminated
// state so "drag-to-connect" (create) and "click an existing label pill"
// (edit) share one popover instance. The edge is NOT created/updated until
// EdgeCreationPicker's "Connect fields" fires (never auto-wired by the
// drag/click gesture alone — T-23-13).
// ---------------------------------------------------------------------------

interface PickerState {
  readonly mode: "create" | "edit";
  readonly edgeId?: string;
  readonly source: string;
  readonly target: string;
  readonly initialSourcePath?: string;
  readonly initialTargetKey?: string;
  readonly anchor: { readonly x: number; readonly y: number };
}

function extractPointerPosition(event: MouseEvent | TouchEvent): {
  readonly x: number;
  readonly y: number;
} {
  if ("clientX" in event) return { x: event.clientX, y: event.clientY };
  const touch = event.changedTouches[0];
  return { x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 };
}

/**
 * buildStreamingByProvenance — the CANVAS-04 seam (D-07): overlays the
 * LIVE streaming pseudo-turn's partial genui content onto an EXISTING,
 * already-materialized genui-panel node — never creates a new one. A
 * brand-new genui_spec part has no stable provenance id until its turn
 * finishes and `chat.getHistory` refetches (the backend only inserts the
 * assistant message row at finalize; there is no messageId to key a NEW
 * node's provenance on mid-stream), so the only stream this can safely
 * "just work" for is a REGENERATE of an already-materialized message —
 * `controller.regeneratingMessageId` is that message's stable, already-real
 * id. Returns an empty map whenever nothing is regenerating — the common
 * case (a first-time send is watched live via the ChatNode's own embedded
 * MessageList instead, which reads `controller.turns` directly; the
 * settled panel materializes once the turn completes via the historyRows
 * reconcile effect above).
 *
 * Pure, framework-agnostic w.r.t. node state — NEVER touches `nodes`/
 * `setNodes`. Streamed content flows to `GenuiPanelNodeBody` exclusively via
 * `useCanvasSpec` (React context) — the memo-identity invariant D-07
 * requires: a streamed token changes this map's CONTENTS (a new Map
 * instance, cheap) but never the `nodes` ARRAY passed to React Flow, so no
 * node ever remounts, repositions, or forces a layout pass while it streams.
 */
export function buildStreamingByProvenance(
  controller: ConversationController,
): ReadonlyMap<string, CanvasSpecEntry> {
  const map = new Map<string, CanvasSpecEntry>();
  const { regeneratingMessageId } = controller;
  if (regeneratingMessageId === null || controller.activeStreamState !== "streaming") {
    return map;
  }

  const streamingTurn = controller.turns.find(
    (turn) => turn.id === controller.streamingTurnId,
  );
  const parts = streamingTurn?.parts ?? [];
  parts.forEach((part, partIndex) => {
    if (part.type === "genui_spec_streaming") {
      map.set(provenanceKey(regeneratingMessageId, partIndex), {
        specJson: part.partialJson,
        isStreaming: true,
      });
    } else if (part.type === "genui_spec") {
      map.set(provenanceKey(regeneratingMessageId, partIndex), {
        specJson: JSON.stringify(part.spec),
        isStreaming: false,
      });
    }
  });
  return map;
}

export interface ChatCanvasProps {
  readonly conversationId: string;
  readonly controller: ConversationController;
  readonly historyRows: readonly ChatHistoryRow[];
  /** Reports the debounced-save status up to the host page (page.tsx mounts
   * `SaveStatusIndicator` in the conversation toolbar's right zone,
   * 23-UI-SPEC.md) — optional so ChatCanvas stays usable standalone. */
  readonly onSaveStatusChange?: (status: SaveStatus) => void;
  /**
   * onOpenConversation (54-04, CLUS-01/CLUS-02) — threaded down to
   * `CanvasPersistenceContext` so `EmailThreadNode`'s "Attach chat" action
   * can switch the app to the newly created + thread-attached conversation
   * (mirrors the rail's "New chat" open UX, ultimately page.tsx's
   * `setSelectedId`). Optional so ChatCanvas stays usable standalone/in
   * tests without a host wired for this yet.
   */
  readonly onOpenConversation?: (conversationId: string) => void;
}

export function ChatCanvas({
  conversationId,
  controller,
  historyRows,
  onSaveStatusChange,
  onOpenConversation,
}: ChatCanvasProps): React.ReactElement {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);
  const [viewport, setViewportState] = useState<Viewport | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const persistence = useCanvasPersistence({ conversationId, nodes, edges, viewport });
  const seededRef = useRef(false);

  // ONE canvas store per conversation (STATE-01/D-10) — only actually built
  // once restore resolves (`ready = !isRestoring`), so it hydrates from the
  // REAL persisted sharedState rather than permanently baking in an empty
  // seed on the pre-restore render (see useCanvasStoreInstance's own doc).
  const canvasStore = useCanvasStoreInstance(
    conversationId,
    toCanvasStoreSeed(persistence.initialSharedState),
    !persistence.isRestoring,
  );

  // Exposes scheduleSave + conversationId to every editable-panel control
  // (PANL-01..04, 52-01-PLAN.md Task 3) without any panel needing to know
  // about chat.saveCanvasLayout directly — mirrors every other save call
  // site in this file (`persistence.scheduleSave(canvasStore)`), never a
  // new/parallel save path. `onError` passes through to the SAME real
  // `chat.saveCanvasLayout` failure signal every other scheduleSave caller
  // in this file feeds into `saveStatus` — panels get the same real signal,
  // not a parallel/synthetic one (52-UI-REVIEW.md finding #1).
  const canvasPersistenceValue = useMemo<CanvasPersistenceContextValue>(
    () => ({
      scheduleSave: (onError) => persistence.scheduleSave(canvasStore, onError),
      conversationId,
      onOpenConversation,
    }),
    [persistence, canvasStore, conversationId, onOpenConversation],
  );

  // Seed once restore resolves, then reconcile on every later historyRows
  // change (new turns completing while the canvas stays mounted) — a single
  // effect so a brand-new node is never lost between the two concerns.
  useEffect(() => {
    if (persistence.isRestoring) return;

    // [Rule 1 - Bug] `setNodes`'s functional updater is invoked by React
    // asynchronously (deferred to the render phase), NOT synchronously at the
    // `setNodes(...)` call site — so mutating `seededRef.current` AFTER this
    // call (below) could race ahead of the updater actually running, making
    // the updater observe the ALREADY-flipped `true` value and fall back to
    // `prev` (still `[]` on a fresh mount) instead of `persistence.initialNodes`,
    // silently dropping every restored node beyond the synthesized default
    // chat node. Captured synchronously, BEFORE either `setNodes` or the ref
    // mutation, so the updater always sees the seed-state that was actually
    // true when this effect ran (found live via Phase 50 Plan 02's UAT-41
    // burn-down — a saved `knowledge-preview` node never survived restore).
    const wasSeeded = seededRef.current;

    setNodes((prev) => {
      const baseline = wasSeeded ? prev.map(toPersistedShape) : persistence.initialNodes;
      const reconciled = withDefaultChatNode(
        reconcileNodesFromHistory(baseline, historyRows),
        conversationId,
      );
      return reconciled.map(toFlowNode);
    });

    if (!wasSeeded) {
      seededRef.current = true;
      setEdges(persistence.initialEdges.map(toFlowEdge));
      if (persistence.initialViewport) {
        setViewportState(persistence.initialViewport);
      }
      setAnnouncement("Canvas layout restored");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `setNodes`/`setEdges` are stable (useNodesState/useEdgesState); `prev` is read via the functional updater, not a dependency.
  }, [
    persistence.isRestoring,
    persistence.initialNodes,
    persistence.initialEdges,
    persistence.initialViewport,
    historyRows,
    conversationId,
  ]);

  // Reports saveStatus up to the host toolbar; announces "Layout saved" via
  // this component's own aria-live region on success (23-UI-SPEC.md).
  useEffect(() => {
    onSaveStatusChange?.(persistence.saveStatus);
    if (persistence.saveStatus === "saved") {
      setAnnouncement("Layout saved");
    }
  }, [persistence.saveStatus, onSaveStatusChange]);

  // Announce "New panel added" the moment reconciliation adds a node whose
  // id wasn't present in the PREVIOUS render's node set — never fires on the
  // initial seed (prevNodeIdsRef starts null) and never fires on a plain
  // drag/select tick (those change positions/selection, never the id set).
  const prevNodeIdsRef = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    const currentIds = new Set(nodes.map((node) => node.id));
    const previousIds = prevNodeIdsRef.current;
    if (previousIds !== null && seededRef.current) {
      const hasNewNode = [...currentIds].some((id) => !previousIds.has(id));
      if (hasNewNode) {
        setAnnouncement("New panel added");
      }
    }
    prevNodeIdsRef.current = currentIds;
  }, [nodes]);

  const specsByProvenance = useMemo(
    () => buildSpecsByProvenance(historyRows),
    [historyRows],
  );
  const partsByProvenance = useMemo(
    () => buildPartsByProvenance(historyRows),
    [historyRows],
  );
  // CANVAS-04/D-07 seam — see buildStreamingByProvenance's own doc comment.
  // Recomputed every render (controller is a fresh object each call, same
  // as historyRows/specsByProvenance's existing posture) — cheap, and NEVER
  // touches `nodes`/`setNodes`.
  const streamingByProvenance = buildStreamingByProvenance(controller);

  // Session-only (23-UI-SPEC.md Layout & Structure "Minimap decision") —
  // deliberately NOT persisted, resets to off on reload.
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [hintDismissed, setHintDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(KEYBOARD_HINT_DISMISSED_KEY) === "true";
  });

  const rfInstanceRef = useRef<ReactFlowInstance<FlowNode, FlowEdge> | null>(null);
  const handleInit = useCallback((instance: ReactFlowInstance<FlowNode, FlowEdge>) => {
    rfInstanceRef.current = instance;
  }, []);

  const handlePaneClick = useCallback(() => {
    setNodes((prev) =>
      prev.map((node) => (node.selected ? { ...node, selected: false } : node)),
    );
  }, [setNodes]);

  // Debounced save triggers (D-06): node drag end, edge add/remove, viewport
  // settle. A single trailing timer inside the hook coalesces rapid
  // successive calls into ONE `chat.saveCanvasLayout` mutation.
  const handleNodeDragStop = useCallback(() => {
    persistence.scheduleSave(canvasStore);
  }, [persistence, canvasStore]);

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]) => {
      onEdgesChange(changes);
      if (changes.some((change) => change.type === "add" || change.type === "remove")) {
        persistence.scheduleSave(canvasStore);
      }
    },
    [onEdgesChange, persistence, canvasStore],
  );

  // PREV-01: node removal (the knowledge-preview node's own remove button,
  // or React Flow's own Backspace-key deletion) now triggers the SAME
  // debounced save handleEdgesChange already uses for edge add/remove —
  // mirrors handleEdgesChange's exact shape. "add" is deliberately NOT
  // checked here — handleAddKnowledgePreview below calls scheduleSave
  // directly at the moment it appends the new node.
  const handleNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      onNodesChange(changes);
      if (changes.some((change) => change.type === "remove")) {
        persistence.scheduleSave(canvasStore);
      }
    },
    [onNodesChange, persistence, canvasStore],
  );

  // PREV-01: AddKnowledgePreviewPopover's onAdd — materializes a new
  // knowledge-preview node near the current viewport center, selected
  // (discoverable chrome), cascading away from any overlapping existing
  // node (mirrors D-03's offsetCascadePosition fallback).
  const handleAddKnowledgePreview = useCallback(
    (focusNodeId: string, label: string | undefined) => {
      const center = rfInstanceRef.current?.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      }) ?? { x: 0, y: 0 };
      const existingRects: CanvasRect[] = nodes.map((node) => ({
        x: node.position.x,
        y: node.position.y,
        ...(CANVAS_NODE_DIMENSIONS[node.type ?? ""] ?? DEFAULT_CANVAS_NODE_DIMENSIONS),
      }));
      const position = offsetCascadePosition(
        { x: center.x, y: center.y, width: 320, height: 240 },
        existingRects,
      );
      const newNode: FlowNode = {
        id: `knowledge-preview:${crypto.randomUUID()}`,
        type: "knowledge-preview",
        position,
        dragHandle: DRAG_HANDLE_SELECTOR,
        selected: true,
        data: { focusNodeId, ...(label ? { label } : {}) },
      };
      setNodes((prev) => [
        ...prev.map((node) => (node.selected ? { ...node, selected: false } : node)),
        newNode,
      ]);
      persistence.scheduleSave(canvasStore);
    },
    [nodes, setNodes, persistence, canvasStore],
  );

  // CLUS-01: AddEmailThreadPopover's onAdd — materializes a new email-thread
  // node near the current viewport center, selected, cascading away from any
  // overlapping existing node — byte-identical placement mechanics to
  // handleAddKnowledgePreview above (54-04-PLAN.md interfaces).
  const handleAddEmailThread = useCallback(
    (threadId: string) => {
      const center = rfInstanceRef.current?.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      }) ?? { x: 0, y: 0 };
      const existingRects: CanvasRect[] = nodes.map((node) => ({
        x: node.position.x,
        y: node.position.y,
        ...(CANVAS_NODE_DIMENSIONS[node.type ?? ""] ?? DEFAULT_CANVAS_NODE_DIMENSIONS),
      }));
      const position = offsetCascadePosition(
        { x: center.x, y: center.y, width: 320, height: 220 },
        existingRects,
      );
      const newNode: FlowNode = {
        id: `email-thread:${crypto.randomUUID()}`,
        type: "email-thread",
        position,
        dragHandle: DRAG_HANDLE_SELECTOR,
        selected: true,
        data: { threadId },
      };
      setNodes((prev) => [
        ...prev.map((node) => (node.selected ? { ...node, selected: false } : node)),
        newNode,
      ]);
      persistence.scheduleSave(canvasStore);
    },
    [nodes, setNodes, persistence, canvasStore],
  );

  const handleMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, nextViewport: Viewport) => {
      setViewportState(nextViewport);
      persistence.scheduleSave(canvasStore);
    },
    [persistence, canvasStore],
  );

  const PAN_STEP_PX = 50;

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Only handle these keys when the CONTAINER itself has focus — never
      // when focus is inside a node's composer/form controls (typing "+" or
      // arrow keys into a message must never hijack pan/zoom). 23-UI-SPEC.md
      // Accessibility: "When canvas has focus (not inside a specific node)".
      if (event.target !== event.currentTarget) return;
      const instance = rfInstanceRef.current;
      if (!instance) return;

      if (
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight"
      ) {
        event.preventDefault();
        const currentViewport = instance.getViewport();
        const delta =
          event.key === "ArrowUp"
            ? { x: 0, y: PAN_STEP_PX }
            : event.key === "ArrowDown"
              ? { x: 0, y: -PAN_STEP_PX }
              : event.key === "ArrowLeft"
                ? { x: PAN_STEP_PX, y: 0 }
                : { x: -PAN_STEP_PX, y: 0 };
        instance.setViewport({
          x: currentViewport.x + delta.x,
          y: currentViewport.y + delta.y,
          zoom: currentViewport.zoom,
        });
        persistence.scheduleSave(canvasStore);
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        instance.zoomIn();
        persistence.scheduleSave(canvasStore);
        return;
      }
      if (event.key === "-") {
        event.preventDefault();
        instance.zoomOut();
        persistence.scheduleSave(canvasStore);
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        void instance.fitView({ padding: 0.2, duration: 200 });
        persistence.scheduleSave(canvasStore);
        return;
      }
      if (event.key === "Escape") {
        handlePaneClick();
      }
    },
    [handlePaneClick, persistence, canvasStore],
  );

  const handleDismissHint = useCallback(() => {
    setHintDismissed(true);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(KEYBOARD_HINT_DISMISSED_KEY, "true");
    }
  }, []);

  const handleToggleMiniMap = useCallback(() => {
    setShowMiniMap((prev) => !prev);
  }, []);

  // ---------------------------------------------------------------------
  // Data-carrying edges (STATE-02, D-09) — drag-to-connect NEVER auto-wires:
  // `onConnect` only remembers the pending source/target pair;
  // `onConnectEnd` opens `EdgeCreationPicker` at the drop point. No edge
  // enters `edges` state until the picker's "Connect fields" confirms.
  // ---------------------------------------------------------------------
  const [pickerState, setPickerState] = useState<PickerState | null>(null);
  const pendingConnectionRef = useRef<{ source: string; target: string } | null>(null);

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    pendingConnectionRef.current = { source: connection.source, target: connection.target };
  }, []);

  const handleConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    const pending = pendingConnectionRef.current;
    pendingConnectionRef.current = null;
    if (!pending) return; // drag ended without landing on a valid target handle
    setPickerState({
      mode: "create",
      source: pending.source,
      target: pending.target,
      anchor: extractPointerPosition(event),
    });
  }, []);

  const handleEdgeLabelClick = useCallback((payload: DataEdgeClickPayload) => {
    setPickerState({
      mode: "edit",
      edgeId: payload.edgeId,
      source: payload.source,
      target: payload.target,
      initialSourcePath: payload.sourcePath,
      initialTargetKey: payload.targetKey,
      anchor: { x: payload.clientX, y: payload.clientY },
    });
  }, []);

  const handlePickerCancel = useCallback(() => {
    setPickerState(null);
  }, []);

  const handlePickerConfirm = useCallback(
    (payload: EdgePayload) => {
      setPickerState((current) => {
        if (!current) return null;
        if (current.mode === "create") {
          const newEdge: FlowEdge = {
            id: `data-edge:${current.source}:${current.target}:${payload.targetKey}`,
            source: current.source,
            target: current.target,
            type: "data-edge",
            animated: false,
            markerEnd: DATA_EDGE_MARKER_END,
            data: { sourcePath: payload.sourcePath, targetKey: payload.targetKey },
          };
          setEdges((prev) => [...prev, newEdge]);
        } else if (current.edgeId) {
          const edgeId = current.edgeId;
          setEdges((prev) =>
            prev.map((edge) =>
              edge.id === edgeId
                ? { ...edge, data: { sourcePath: payload.sourcePath, targetKey: payload.targetKey } }
                : edge,
            ),
          );
        }
        return null;
      });
      persistence.scheduleSave(canvasStore);
    },
    [setEdges, persistence, canvasStore],
  );

  const handlePickerRemove = useCallback(() => {
    setPickerState((current) => {
      if (current?.edgeId) {
        const edgeId = current.edgeId;
        setEdges((prev) => prev.filter((edge) => edge.id !== edgeId));
      }
      return null;
    });
    persistence.scheduleSave(canvasStore);
  }, [setEdges, persistence, canvasStore]);

  // edgesByTarget lookup feeding usePanelData's live subscription overlay
  // (D-09) — recomputed whenever `edges` changes (add/remove/re-pick).
  const dataCarryingEdges = useMemo<DataCarryingEdge[]>(() => {
    return edges.flatMap((edge) => {
      const edgeData = (edge.data ?? {}) as { sourcePath?: unknown; targetKey?: unknown };
      const { sourcePath, targetKey } = edgeData;
      if (typeof sourcePath !== "string" || typeof targetKey !== "string") return [];
      if (sourcePath.length === 0 || targetKey.length === 0) return [];
      return [{ target: edge.target, sourcePath, targetKey }];
    });
  }, [edges]);

  if (persistence.isRestoring || canvasStore === null) {
    return <CanvasSkeleton />;
  }

  const isEmpty = nodes.length === 0;

  return (
    <CanvasStoreProvider store={canvasStore}>
      <CanvasPersistenceProvider value={canvasPersistenceValue}>
      <CanvasEdgesProvider edges={dataCarryingEdges}>
        <CanvasSpecProvider
          specsByProvenance={specsByProvenance}
          streamingByProvenance={streamingByProvenance}
          partsByProvenance={partsByProvenance}
        >
          <ChatControllerProvider controller={controller}>
            <EdgeLabelClickProvider onLabelClick={handleEdgeLabelClick}>
              <div
                role="application"
                aria-label="Conversation canvas"
                aria-roledescription="node-based diagram"
                tabIndex={0}
                onKeyDown={handleKeyDown}
                className="relative h-full w-full"
              >
                <span className="sr-only" aria-live="polite">
                  {announcement}
                </span>
                {isEmpty ? (
                  <CanvasEmptyState />
                ) : (
                  <ReactFlowJSX
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    onNodesChange={handleNodesChange}
                    onEdgesChange={handleEdgesChange}
                    onNodeDragStop={handleNodeDragStop}
                    onConnect={handleConnect}
                    onConnectEnd={handleConnectEnd}
                    onMoveEnd={handleMoveEnd}
                    onPaneClick={handlePaneClick}
                    onInit={handleInit}
                    defaultViewport={viewport ?? undefined}
                    fitView={!viewport}
                    fitViewOptions={{ padding: 0.2 }}
                    minZoom={0.1}
                    maxZoom={2}
                    proOptions={{ hideAttribution: false }}
                    aria-label="Conversation canvas"
                  >
                    {/*
                      THE BOARD. 58-IDENTITY's ban #12 (no decorative pattern)
                      carries an explicit exception written for exactly this
                      surface, in the sketch's own CSS and its own words:

                        "ban #12 exception: this surface IS a canvas, so a grid
                         is the working surface, not decoration."

                      (direction-final.html:445-446). That is D-58-01
                      PRE-AUTHORIZING this grid — a monochrome-chrome identity
                      with a visible grid looks like a violation and someone
                      WILL try to remove it. It is the one place the identity
                      says a pattern earns its keep.

                      22px is the sketch's own background-size. The token is
                      `--grid`, which exists for precisely this: the value here
                      used to be the structural boundary token (via `--border`,
                      which resolves to `--rule`) doing decorative duty at 16px,
                      and it read as noise rather than as a surface. React Flow
                      takes `color` as a raw CSS value, so this works at the call
                      site regardless of @theme registration; globals.css also
                      sets the system default behind it, so a Background with no
                      colour prop is on the identity too.

                      `size` IS the sketch's dot, and it is NOT the inherited 1.
                      React Flow's `size` is the dot DIAMETER (it renders a
                      circle at r = size/2 — measured, not assumed). The sketch
                      draws `radial-gradient(var(--grid) 1px, transparent 1px)`,
                      which is solid out to a 1px RADIUS: a 2px dot. Inheriting
                      size={1} therefore drew the sketch's grid at HALF its
                      diameter, and at `--grid`'s 10%/8% alpha a 1px dot is not
                      subtle, it is invisible — measured at r=0.375px on screen,
                      a sub-pixel dot nobody can see. A grid that cannot be seen
                      is not a working surface, it is a dead call site that
                      passes every gate.
                    */}
                    <Background gap={22} size={2} color="var(--grid)" />
                    <Controls showZoom showFitView showInteractive />
                    {showMiniMap && (
                      <MiniMap
                        pannable
                        zoomable
                        maskColor="color-mix(in srgb, var(--background) 60%, transparent)"
                        nodeColor="color-mix(in srgb, var(--muted-foreground) 35%, transparent)"
                        nodeStrokeColor="var(--border)"
                      />
                    )}
                    <Panel position="top-right">
                      {/*
                        ONE CARD, three segments — the same chrome language as
                        the Controls card (globals.css): the CONTAINER carries
                        the `--bright` fill and the `--rule` hairline, the
                        buttons sit transparent inside it. This replaced three
                        free-floating `bg-background/95` ghosts — an opacity
                        trick, not a designed control, through which the board's
                        grid showed faintly. No shadow: "flat surfaces, hairline
                        rules, zero shadow anywhere". `overflow-hidden` clips
                        each segment's hover fill to the card's radius.
                      */}
                      <div className="flex items-center overflow-hidden rounded-card border border-rule bg-bright">
                        <AddEmailThreadPopover onAdd={handleAddEmailThread} />
                        <AddKnowledgePreviewPopover onAdd={handleAddKnowledgePreview} />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-pressed={showMiniMap}
                          aria-label="Toggle minimap"
                          className={CANVAS_PANEL_BUTTON_CLASS}
                          onClick={handleToggleMiniMap}
                        >
                          <MapIcon className="size-4" aria-hidden />
                        </Button>
                      </div>
                    </Panel>
                  </ReactFlowJSX>
                )}
                {!hintDismissed && <CanvasKeyboardHint onDismiss={handleDismissHint} />}
                {pickerState && (
                  <EdgeCreationPicker
                    anchor={pickerState.anchor}
                    sourcePanelId={pickerState.source}
                    targetPanelId={pickerState.target}
                    initialSourcePath={pickerState.initialSourcePath}
                    initialTargetKey={pickerState.initialTargetKey}
                    isEditing={pickerState.mode === "edit"}
                    onConfirm={handlePickerConfirm}
                    onCancel={handlePickerCancel}
                    onRemove={pickerState.mode === "edit" ? handlePickerRemove : undefined}
                  />
                )}
              </div>
            </EdgeLabelClickProvider>
          </ChatControllerProvider>
        </CanvasSpecProvider>
      </CanvasEdgesProvider>
      </CanvasPersistenceProvider>
    </CanvasStoreProvider>
  );
}
