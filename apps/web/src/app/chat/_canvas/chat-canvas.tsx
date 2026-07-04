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
  MiniMap,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge as FlowEdge,
  type Node as FlowNode,
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

import { Button } from "@nauta/ui/button";

import type { MessagePart } from "../_hooks/use-chat-stream";
import type {
  ChatHistoryRow,
  ConversationController,
} from "../_hooks/use-conversation-controller";
import { CanvasEmptyState } from "./canvas-empty-state";
import {
  CanvasKeyboardHint,
  KEYBOARD_HINT_DISMISSED_KEY,
} from "./canvas-keyboard-hint";
import { CanvasSkeleton } from "./canvas-skeleton";
import { CanvasSpecProvider } from "./canvas-spec-context";
import { ChatControllerProvider } from "./chat-node";
import { nodeTypes } from "./node-types";
import {
  reconcileNodesFromHistory,
  withDefaultChatNode,
  type PersistedCanvasEdge,
  type ReconciledNode,
  useCanvasPersistence,
} from "./use-canvas-persistence";

const DRAG_HANDLE_SELECTOR = ".node-drag-handle";
// New-panel materialization fade (23-UI-SPEC.md Interaction Contracts) —
// `motion-safe:` gates it out entirely under prefers-reduced-motion. Applied
// ONLY to a node `reconcileNodesFromHistory` just marked `isNew` — a node
// restored from a saved layout must NOT replay this entrance on every reload.
const GENUI_PANEL_CLASS_NAME = "motion-safe:animate-in fade-in duration-200";

/** `messageId:partIndex` — mirrors canvas-spec-context.tsx's own provenance
 * lookup key convention exactly. */
function provenanceKey(messageId: string, partIndex: number): string {
  return `${messageId}:${partIndex}`;
}

/** History-derived specsByProvenance map — feeds CanvasSpecProvider (23-02
 * seam); keys mirror canvas-spec-context.tsx's own provenanceKey exactly. */
function buildSpecsByProvenance(
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
    data: { sourcePath: edge.data.sourcePath, targetKey: edge.data.targetKey },
  };
}

export interface ChatCanvasProps {
  readonly conversationId: string;
  readonly controller: ConversationController;
  readonly historyRows: readonly ChatHistoryRow[];
}

export function ChatCanvas({
  conversationId,
  controller,
  historyRows,
}: ChatCanvasProps): React.ReactElement {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);
  const [viewport, setViewportState] = useState<Viewport | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const persistence = useCanvasPersistence({ conversationId, nodes, edges, viewport });
  const seededRef = useRef(false);

  // Seed once restore resolves, then reconcile on every later historyRows
  // change (new turns completing while the canvas stays mounted) — a single
  // effect so a brand-new node is never lost between the two concerns.
  useEffect(() => {
    if (persistence.isRestoring) return;

    setNodes((prev) => {
      const baseline = seededRef.current
        ? prev.map(toPersistedShape)
        : persistence.initialNodes;
      const reconciled = withDefaultChatNode(
        reconcileNodesFromHistory(baseline, historyRows),
        conversationId,
      );
      return reconciled.map(toFlowNode);
    });

    if (!seededRef.current) {
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

  const specsByProvenance = useMemo(
    () => buildSpecsByProvenance(historyRows),
    [historyRows],
  );

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
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        instance.zoomIn();
        return;
      }
      if (event.key === "-") {
        event.preventDefault();
        instance.zoomOut();
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        void instance.fitView({ padding: 0.2, duration: 200 });
        return;
      }
      if (event.key === "Escape") {
        handlePaneClick();
      }
    },
    [handlePaneClick],
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

  if (persistence.isRestoring) {
    return <CanvasSkeleton />;
  }

  const isEmpty = nodes.length === 0;

  return (
    <CanvasSpecProvider specsByProvenance={specsByProvenance}>
      <ChatControllerProvider controller={controller}>
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
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
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
              <Background gap={16} size={1} />
              <Controls showZoom showFitView showInteractive />
              {showMiniMap && <MiniMap pannable zoomable />}
              <Panel position="top-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-pressed={showMiniMap}
                  aria-label="Toggle minimap"
                  className="size-11 bg-background/70 backdrop-blur-md"
                  onClick={handleToggleMiniMap}
                >
                  <MapIcon className="size-4" aria-hidden />
                </Button>
              </Panel>
            </ReactFlowJSX>
          )}
          {!hintDismissed && <CanvasKeyboardHint onDismiss={handleDismissHint} />}
        </div>
      </ChatControllerProvider>
    </CanvasSpecProvider>
  );
}
