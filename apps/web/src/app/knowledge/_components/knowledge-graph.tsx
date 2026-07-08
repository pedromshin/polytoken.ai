"use client";

/**
 * knowledge-graph.tsx — three-zone ResizablePanelGroup composition for the /knowledge surface.
 *
 * Loaded via `dynamic(ssr: false)` from knowledge-graph-island.tsx.
 *
 * Zone layout (defaultSize 18 / 57 / 25):
 *   [Filter Rail 18%] | [Graph Canvas 57%] | [Node Detail Pane 25%]
 *
 * State owned here:
 *   selectedNodeId     — synced with ReactFlow node selection
 *   visibleTypes       — set of NodeTypeKey controlling which node types render
 *   showInstances      — toggles includeInstances API flag
 *   bannerDismissed    — persisted to localStorage key
 *
 * Interaction rules:
 *   node click → selectedNodeId = node.id, ReactFlow node.selected = true
 *   canvas click (pane) → deselect all
 *   Escape key → deselect all
 *   toolbar fitView → reactFlowInstance.fitView({ padding: 0.2 })
 *   double-click node → fitView to that node
 *
 * Invariants:
 *   D-02: Never blank — entity_type + entity_type_field always requested (even
 *         when visibleTypes excludes them, we still pass includeInstances=false
 *         and filter client-side so taxonomy is never lost).
 *   D-09: No node CRUD — purely read-only. GRAPH-02's `expandNode` useMutation
 *         is an explicit user-triggered READ (a bounded server-side graph
 *         walk), not a write — mirrors D-09's read-only posture, not an
 *         exception to it.
 *   T-11-05: No dangerouslySetInnerHTML in this file or its children.
 *
 * No font-medium (500) anywhere — only font-normal (400) or font-semibold (600).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Background,
  Controls,
  MiniMap,
  MarkerType,
  Panel,
  ReactFlow,
  useNodesState,
  useEdgesState,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type ReactFlowInstance,
  type ReactFlowProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// Workaround: moduleResolution:bundler + `export { default as ReactFlow }` causes TS
// to see the named export as the module namespace rather than the component value.
// Casting via the known props interface restores the JSX call signature.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ReactFlowJSX = ReactFlow as React.ComponentType<ReactFlowProps<FlowNode, FlowEdge>>;

import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@nauta/ui/resizable";

import { api } from "~/trpc/react";

import { FilterRail, type NodeTypeKey } from "./filter-rail";
import { GraphToolbar } from "./graph-toolbar";
import { GraphErrorState, GraphNoSchemaState } from "./graph-states";
import { mergeGraph } from "./graph-merge";
import { NodeDetailPane, type SelectedNode } from "./node-detail-pane";
import { TaxonomyBanner } from "./taxonomy-banner";
import { layoutGraph } from "./graph-layout";
import { nodeTypes } from "./graph-nodes";
import { tierEdgeStyle } from "./tier-edge-style";
import { GraphLegend } from "./graph-legend";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BANNER_DISMISSED_KEY = "nauta.knowledge.taxonomy-banner-dismissed";

/** Instance count threshold below which instances are automatically shown. */
const AUTO_SHOW_INSTANCES_THRESHOLD = 50;

const DEFAULT_VISIBLE_TYPES = new Set<NodeTypeKey>([
  "entity_type",
  "entity_type_field",
]);

// ---------------------------------------------------------------------------
// Local type mirrors of @nauta/api-client GraphNode/GraphEdge
// (No subpath export from @nauta/api-client for the router internals —
//  inlining the minimal shapes avoids brittle dist path imports.)
// ---------------------------------------------------------------------------

interface GraphNode {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly [key: string]: unknown;
}

interface GraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly relationType: string;
  readonly tier?: string;
}

// ---------------------------------------------------------------------------
// Taxonomy edge relation types — these have NO arrowhead per UI-SPEC
// ---------------------------------------------------------------------------

const TAXONOMY_RELATION_TYPES = new Set<string>(["has_field"]);

// ---------------------------------------------------------------------------
// Conversion helpers — GraphNode/GraphEdge → React Flow Node/Edge
// Never mutates inputs; always returns new objects (CLAUDE.md immutability).
// ---------------------------------------------------------------------------

function toFlowNodes(
  graphNodes: ReadonlyArray<GraphNode>,
  visibleTypes: ReadonlySet<NodeTypeKey>,
): FlowNode[] {
  return graphNodes
    .filter((gn) => visibleTypes.has(gn.type as NodeTypeKey))
    .map((gn) => ({
      id: gn.id,
      type: gn.type,
      position: { x: 0, y: 0 },
      data: { ...gn },
    }));
}

function toFlowEdges(graphEdges: ReadonlyArray<GraphEdge>): FlowEdge[] {
  return graphEdges.map((ge) => {
    const isTaxonomy = TAXONOMY_RELATION_TYPES.has(ge.relationType);
    const isKnowledgeEdge = ge.id.startsWith("kne-");
    // GRAPH-01: tier-based style override applies ONLY to kne- edges — structural
    // FK-derived edges never carry a tier and must keep React Flow's default look.
    const tierStyle = isKnowledgeEdge ? tierEdgeStyle(ge.tier) : {};
    return {
      id: ge.id,
      source: ge.source,
      target: ge.target,
      label: ge.relationType,
      type: "smoothstep",
      // Carried through so a merged edge keeps its tier for future re-styling.
      data: { tier: ge.tier },
      ...tierStyle,
      ...(isTaxonomy
        ? {}
        : {
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 6,
              height: 6,
            },
          }),
    };
  });
}

// ---------------------------------------------------------------------------
// Count helpers
// ---------------------------------------------------------------------------

function countByType(
  nodes: ReadonlyArray<GraphNode>,
  type: NodeTypeKey,
): number {
  return nodes.filter((n) => n.type === type).length;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface KnowledgeGraphProps {
  readonly className?: string;
}

export function KnowledgeGraph({ className }: KnowledgeGraphProps): React.ReactElement {
  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  const [visibleTypes, setVisibleTypes] = useState<ReadonlySet<NodeTypeKey>>(
    () => new Set(DEFAULT_VISIBLE_TYPES),
  );

  const [showInstances, setShowInstances] = useState<boolean>(false);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // GRAPH-02 — the node currently mid-expand (pulse-ring loading state).
  const [pendingExpandNodeId, setPendingExpandNodeId] = useState<
    string | null
  >(null);

  const [bannerDismissed, setBannerDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(BANNER_DISMISSED_KEY) === "true";
  });

  // -------------------------------------------------------------------------
  // tRPC query — derive includeInstances from showInstances + visibleTypes
  // -------------------------------------------------------------------------

  const includeInstances =
    showInstances ||
    visibleTypes.has("entity_instance") ||
    visibleTypes.has("email") ||
    visibleTypes.has("email_component") ||
    visibleTypes.has("knowledge_node");

  const { data, isError } = api.knowledge.graph.useQuery({
    includeInstances,
    includeEmails: visibleTypes.has("email") || visibleTypes.has("email_component"),
  });

  // -------------------------------------------------------------------------
  // Auto-show instances when count is below threshold (D-02 convenience)
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (data == null) return;
    const instanceCount = countByType(data.nodes, "entity_instance");
    if (instanceCount > 0 && instanceCount < AUTO_SHOW_INSTANCES_THRESHOLD) {
      setVisibleTypes((prev) => {
        if (prev.has("entity_instance")) return prev;
        return new Set([...prev, "entity_instance"]);
      });
    }
  }, [data]);

  // -------------------------------------------------------------------------
  // Derived counts for Filter Rail footer
  // -------------------------------------------------------------------------

  const railCounts = useMemo(() => {
    if (data == null) return { types: 0, fields: 0, instances: 0 };
    return {
      types: countByType(data.nodes, "entity_type"),
      fields: countByType(data.nodes, "entity_type_field"),
      instances: countByType(data.nodes, "entity_instance"),
    };
  }, [data]);

  // -------------------------------------------------------------------------
  // Banner counts
  // -------------------------------------------------------------------------

  const entityTypeCount = railCounts.types;
  const fieldCount = railCounts.fields;

  // -------------------------------------------------------------------------
  // No-schema detection: true when data exists but has zero entity_type nodes
  // -------------------------------------------------------------------------

  const hasNoSchema =
    data != null && countByType(data.nodes, "entity_type") === 0;

  // -------------------------------------------------------------------------
  // React Flow nodes + edges (re-laid-out whenever data or visibility changes)
  // -------------------------------------------------------------------------

  const initialNodes = useMemo<FlowNode[]>(() => {
    if (data == null) return [];
    const flowNodes = toFlowNodes(data.nodes, visibleTypes);
    const flowEdges = toFlowEdges(data.edges);
    // Only pass edges whose source + target are both visible
    const visibleIds = new Set(flowNodes.map((n) => n.id));
    const filteredEdges = flowEdges.filter(
      (e) => visibleIds.has(e.source) && visibleIds.has(e.target),
    );
    return layoutGraph(flowNodes, filteredEdges);
  }, [data, visibleTypes]);

  const initialEdges = useMemo<FlowEdge[]>(() => {
    if (data == null) return [];
    const allEdges = toFlowEdges(data.edges);
    const visibleIds = new Set(initialNodes.map((n) => n.id));
    return allEdges.filter(
      (e) => visibleIds.has(e.source) && visibleIds.has(e.target),
    );
  }, [data, initialNodes]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync nodes/edges when the memoized sources change (data/visibility).
  // useNodesState/useEdgesState only seed from their argument on first render —
  // on mount `data` is undefined so both start empty; these effects push the
  // real nodes AND edges once the query resolves (without the edges sync, the
  // graph renders nodes but no relationship lines).
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  // -------------------------------------------------------------------------
  // GRAPH-02 — bounded click-expand
  //
  // Read-only (D-09) — `expandNode` is a tRPC `.query`, not a mutation
  // (mirrors `knowledge.graph`'s read-only posture); triggered imperatively
  // via `utils.knowledge.expandNode.fetch` on click (the "lazy query"
  // alternative the UI-SPEC explicitly allows in place of `useMutation`,
  // since this procedure never writes and shouldn't be misclassified as one).
  // On success, the returned nodes/edges are deduped onto the current canvas
  // (mergeGraph) and the WHOLE merged union is re-laid-out via the existing
  // dagre helper (per UI-SPEC: acceptable to reposition existing nodes,
  // documented as an implementation choice, not a visual regression).
  // -------------------------------------------------------------------------

  const utils = api.useUtils();

  const expandNode = useCallback(
    async (nodeId: string): Promise<void> => {
      setPendingExpandNodeId(nodeId);
      try {
        const result = await utils.knowledge.expandNode.fetch({
          nodeId,
          depth: 1,
        });

        const newFlowNodes = toFlowNodes(result.nodes, visibleTypes);
        const newFlowEdges = toFlowEdges(result.edges);
        const merged = mergeGraph(nodes, edges, newFlowNodes, newFlowEdges);
        const laidOutNodes = layoutGraph(merged.nodes, merged.edges);

        setNodes(laidOutNodes);
        setEdges(merged.edges);

        if (result.truncated) {
          toast.info(
            "Showing the first 50 related items — narrow the tier filter to see more.",
          );
        }
      } finally {
        setPendingExpandNodeId(null);
      }
    },
    [utils, nodes, edges, visibleTypes, setNodes, setEdges],
  );

  // -------------------------------------------------------------------------
  // ReactFlow instance for programmatic fitView
  // -------------------------------------------------------------------------

  const rfInstance = useRef<ReactFlowInstance<FlowNode, FlowEdge> | null>(null);

  const handleInit = useCallback(
    (instance: ReactFlowInstance<FlowNode, FlowEdge>) => {
      rfInstance.current = instance;
    },
    [],
  );

  const handleFitView = useCallback(() => {
    rfInstance.current?.fitView({ padding: 0.2, duration: 400 });
  }, []);

  // -------------------------------------------------------------------------
  // Selected node derivation
  // -------------------------------------------------------------------------

  const selectedNode = useMemo<SelectedNode | null>(() => {
    if (selectedNodeId == null || data == null) return null;
    const gn = data.nodes.find((n) => n.id === selectedNodeId) ?? null;
    if (gn == null) return null;
    return gn as SelectedNode;
  }, [selectedNodeId, data]);

  // -------------------------------------------------------------------------
  // Interaction handlers
  // -------------------------------------------------------------------------

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: FlowNode) => {
      setSelectedNodeId(node.id);
      // GRAPH-02: selection and expand fire on the SAME click.
      void expandNode(node.id);
    },
    [expandNode],
  );

  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: FlowNode) => {
      rfInstance.current?.fitView({
        nodes: [{ id: node.id }],
        padding: 0.8,
        duration: 400,
      });
    },
    [],
  );

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // Escape key deselects
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        setSelectedNodeId(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // -------------------------------------------------------------------------
  // Filter Rail handlers (immutable set updates — CLAUDE.md)
  // -------------------------------------------------------------------------

  const handleToggleType = useCallback((type: NodeTypeKey) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const handleToggleInstances = useCallback((value: boolean) => {
    setShowInstances(value);
  }, []);

  // -------------------------------------------------------------------------
  // Banner dismiss handler
  // -------------------------------------------------------------------------

  const handleDismissBanner = useCallback(() => {
    setBannerDismissed(true);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(BANNER_DISMISSED_KEY, "true");
    }
  }, []);

  // -------------------------------------------------------------------------
  // Node detail pane handlers
  // -------------------------------------------------------------------------

  const handleCloseDetail = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const handleSelectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, []);

  // Selection overlay — applied at render time so a node click never re-runs the
  // dagre layout (which lives in initialNodes, keyed on [data, visibleTypes]) and
  // so dragged positions survive selection. selectedNodeId is the single source
  // of truth, so Escape / pane-click / detail-close clear the ring too.
  const displayedNodes = useMemo<FlowNode[]>(
    () =>
      nodes.map((n) => ({
        ...n,
        selected: n.id === selectedNodeId,
        className:
          n.id === pendingExpandNodeId
            ? "animate-pulse motion-reduce:animate-none"
            : undefined,
      })),
    [nodes, selectedNodeId, pendingExpandNodeId],
  );

  // -------------------------------------------------------------------------
  // Graph key (re-mount ReactFlow when data identity changes)
  // -------------------------------------------------------------------------

  const graphKey =
    data != null
      ? `graph-${data.nodes.length}-${data.edges.length}`
      : "graph-empty";

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className={`flex h-full w-full flex-col ${className ?? ""}`}>
      {/* Top Toolbar — spans full width above the three-zone panel group */}
      <GraphToolbar total={nodes.length} onFitView={handleFitView} />

      {/* Three-zone ResizablePanelGroup */}
      <ResizablePanelGroup
        direction="horizontal"
        className="flex-1 overflow-hidden"
      >
        {/* Zone 1: Filter Rail — defaultSize 18% */}
        <ResizablePanel defaultSize={18} minSize={12} maxSize={28}>
          <FilterRail
            visibleTypes={visibleTypes}
            onToggleType={handleToggleType}
            showInstances={showInstances}
            onToggleInstances={handleToggleInstances}
            counts={railCounts}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Zone 2: Graph Canvas — defaultSize 57% */}
        <ResizablePanel defaultSize={57} minSize={30}>
          <div className="relative h-full w-full">
            {isError ? (
              <GraphErrorState />
            ) : hasNoSchema ? (
              <GraphNoSchemaState />
            ) : (
              <ReactFlowJSX
                key={graphKey}
                nodes={displayedNodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={handleNodeClick}
                onNodeDoubleClick={handleNodeDoubleClick}
                onPaneClick={handlePaneClick}
                onInit={handleInit}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.1}
                maxZoom={2}
                proOptions={{ hideAttribution: false }}
                aria-label="Knowledge graph"
              >
                <Background gap={16} size={1} />
                <Controls />
                <MiniMap nodeStrokeWidth={2} pannable zoomable />

                {/* GRAPH-01 — tier legend, bottom-left, always visible */}
                <Panel position="bottom-left">
                  <GraphLegend />
                </Panel>

                {/* Taxonomy Banner — absolute inside canvas */}
                {!bannerDismissed && (
                  <TaxonomyBanner
                    entityTypeCount={entityTypeCount}
                    fieldCount={fieldCount}
                    onDismiss={handleDismissBanner}
                  />
                )}
              </ReactFlowJSX>
            )}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Zone 3: Node Detail Pane — defaultSize 25% */}
        <ResizablePanel defaultSize={25} minSize={18} maxSize={40}>
          <NodeDetailPane
            selectedNode={selectedNode}
            onClose={handleCloseDetail}
            onSelectNode={handleSelectNode}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
