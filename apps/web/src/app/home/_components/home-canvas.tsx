"use client";

/**
 * home-canvas.tsx — HomeCanvas: renders the home-scoped board as a real
 * React Flow canvas (Phase 74 / MORN-07). This is what makes the composed
 * morning board VISIBLE: the overnight composer (or the client "Assemble board"
 * button) writes a node set into the home layout, and this surface PAINTS it —
 * closing the gap where `/home` was a fixed panel grid that ignored `nodes[]`.
 *
 * It reuses the /chat canvas's node-type map verbatim (the same `brief` /
 * `review-queue` / `usage` / … components, which fetch their own live data on
 * render), wrapped in the same `CanvasStoreProvider` so the Wave-B publish port
 * still works. It is deliberately SMALL — no edge picker, no history, no genui
 * reconcile: a home board is a placed node set, dragged and persisted by
 * last-write-wins snapshot (mirrors `saveHomeCanvasLayout`). It is only ever
 * reached through `home-canvas-island.tsx`'s `dynamic(ssr:false)` import, so the
 * xyflow runtime + its unlayered stylesheet never enter the /home static graph.
 */

import "@xyflow/react/dist/style.css";

import * as React from "react";
import { useCallback, useMemo, useRef } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  useNodesState,
  type Node as FlowNode,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";

import { createCanvasStore } from "~/app/chat/_canvas/canvas-store";
import { CanvasStoreProvider } from "~/app/chat/_canvas/canvas-store-context";
import { nodeTypes } from "~/app/chat/_canvas/node-types";
import {
  buildSnapshot,
  DRAG_HANDLE_SELECTOR,
  type PersistedCanvasNode,
} from "~/app/chat/_canvas/use-canvas-persistence";
import type { CanvasSnapshot } from "@polytoken/api-client/chat-canvas";

export interface HomeCanvasProps {
  /** The home layout's persisted nodes (from `chat.getHomeCanvasLayout`). */
  readonly initialNodes: readonly PersistedCanvasNode[];
  /** Persist a new whole-snapshot after a drag/delete (last-write-wins, exactly
   * like `saveCanvasLayout` — the home board has one row per user). */
  readonly onPersist: (snapshot: CanvasSnapshot) => void;
}

function toFlowNode(node: PersistedCanvasNode): FlowNode {
  return {
    id: node.id,
    type: node.type,
    position: { x: node.position.x, y: node.position.y },
    dragHandle: DRAG_HANDLE_SELECTOR,
    data: node.data,
  };
}

export function HomeCanvas({ initialNodes, onPersist }: HomeCanvasProps): React.ReactElement {
  // One store per mount, seeded empty — the home nodes are ref-only and
  // republish their own values on render (Wave B), so no sharedState seed is
  // needed for the three MVP node types.
  const store = useMemo(() => createCanvasStore(), []);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(
    initialNodes.map(toFlowNode),
  );
  const rfRef = useRef<ReactFlowInstance<FlowNode> | null>(null);

  const persist = useCallback(
    (current: readonly FlowNode[]) => {
      try {
        onPersist(buildSnapshot(current, [], null, {}));
      } catch {
        // buildSnapshot only throws on an internal invariant violation; a home
        // board that fails to serialize is not worth crashing the page over.
      }
    },
    [onPersist],
  );

  // Persist after a drag settles or a node is removed (its X button uses
  // useReactFlow().deleteElements, surfaced here as a "remove" change).
  const handleNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      onNodesChange(changes);
      const settled = changes.some(
        (c) => (c.type === "position" && c.dragging === false) || c.type === "remove",
      );
      if (settled) {
        // Read the post-change set on the next tick via the functional setter.
        setNodes((current) => {
          persist(current);
          return current;
        });
      }
    },
    [onNodesChange, setNodes, persist],
  );

  return (
    <CanvasStoreProvider store={store}>
      <div className="h-full w-full">
        <ReactFlow
          nodes={nodes}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onInit={(instance) => {
            rfRef.current = instance as ReactFlowInstance<FlowNode>;
          }}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: false }}
          minZoom={0.2}
          maxZoom={2}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </CanvasStoreProvider>
  );
}
