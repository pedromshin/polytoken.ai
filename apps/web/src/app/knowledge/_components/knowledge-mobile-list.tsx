"use client";

/**
 * knowledge-mobile-list.tsx — mobile-only `/knowledge` presentation (MOBL-01,
 * 53-UI-SPEC.md Component Inventory §3). Below `md`, `knowledge-surface.tsx`
 * renders this INSTEAD of `KnowledgeGraphIsland` (the `dynamic(ssr:false)`
 * React-Flow graph) — the graph's mount cost is never paid on a phone.
 *
 * Self-contained: fetches `api.knowledge.graph.useQuery` itself, since the
 * desktop `KnowledgeGraph` only mounts at `>=md` and there is no shared query
 * to lift. Reuses `filter-rail.tsx`'s EXACT `NODE_TYPE_ROWS` facet data +
 * active-state color recipe (Judgment Call #4) and the UNCHANGED
 * `NodeDetailPane` (Judgment Call #5) inside a full-width right `Sheet` — no
 * second vocabulary, no redesign.
 *
 * Structure, top to bottom (53-UI-SPEC §3):
 *   1. Filter-chip bar — h-11 pill toggles, one per NODE_TYPE_ROWS entry
 *   2. Node list — min-h-16 InboxRow-idiom rows, post-filter
 *   3. Empty states — filtered-to-zero (new copy) / genuinely-empty-graph
 *      (GraphNoSchemaState, reused verbatim)
 *   4. Detail Sheet — full-width right Sheet wrapping the unchanged
 *      NodeDetailPane
 *
 * SECURITY (T-53-06-01): reuses the SAME auth-gated `api.knowledge.graph`
 * query and the SAME NodeDetailPane component (T-11-05 escaped-text
 * rendering, no dangerouslySetInnerHTML) as desktop — only the layout
 * differs; no new endpoint or authorization change.
 *
 * No font-medium (500) — only font-normal (400) / font-semibold (600).
 */

import * as React from "react";
import { useMemo, useState } from "react";

import { cn } from "@polytoken/ui";
import { Sheet, SheetContent, SheetTitle } from "@polytoken/ui/sheet";

import { api } from "~/trpc/react";

import { NODE_TYPE_ROWS, type NodeTypeKey } from "./filter-rail";
import { GraphErrorState, GraphNoSchemaState } from "./graph-states";
import { NodeDetailPane, type SelectedNode } from "./node-detail-pane";

// ---------------------------------------------------------------------------
// Constants — mirrors knowledge-graph.tsx's DEFAULT_VISIBLE_TYPES verbatim
// ---------------------------------------------------------------------------

const DEFAULT_VISIBLE_TYPES = new Set<NodeTypeKey>([
  "entity_type",
  "entity_type_field",
]);

// ---------------------------------------------------------------------------
// Local type mirror of GraphNode (same minimal shape knowledge-graph.tsx uses
// — no subpath export from @polytoken/api-client for the router internals).
// ---------------------------------------------------------------------------

interface GraphNode {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Facet lookup helpers — built FROM NODE_TYPE_ROWS, never a second vocabulary
// ---------------------------------------------------------------------------

const DOT_CLASS_BY_TYPE = new Map<string, string>(
  NODE_TYPE_ROWS.map((row) => [row.type, row.dotClass]),
);
const LABEL_BY_TYPE = new Map<string, string>(
  NODE_TYPE_ROWS.map((row) => [row.type, row.label]),
);

function dotClassFor(type: string): string {
  return DOT_CLASS_BY_TYPE.get(type) ?? "bg-muted-foreground/40 border-border";
}

function typeLabelFor(type: string): string {
  return LABEL_BY_TYPE.get(type) ?? type;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KnowledgeMobileList(): React.ReactElement {
  const [visibleTypes, setVisibleTypes] = useState<ReadonlySet<NodeTypeKey>>(
    () => new Set(DEFAULT_VISIBLE_TYPES),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Derive the graph query flags from visibleTypes exactly as
  // knowledge-graph.tsx does (minus its desktop-only showInstances override
  // switch, which has no mobile equivalent).
  const includeInstances =
    visibleTypes.has("entity_instance") ||
    visibleTypes.has("email") ||
    visibleTypes.has("email_component") ||
    visibleTypes.has("knowledge_node");
  const includeEmails =
    visibleTypes.has("email") || visibleTypes.has("email_component");

  const { data, isError } = api.knowledge.graph.useQuery({
    includeInstances,
    includeEmails,
  });

  const allNodes = (data?.nodes ?? []) as ReadonlyArray<GraphNode>;

  const visibleNodes = useMemo(
    () =>
      allNodes.filter((node) => visibleTypes.has(node.type as NodeTypeKey)),
    [allNodes, visibleTypes],
  );

  const selectedNode = useMemo<SelectedNode | null>(() => {
    if (selectedNodeId == null) return null;
    const node = allNodes.find((n) => n.id === selectedNodeId);
    if (node == null) return null;
    return { ...node } as SelectedNode;
  }, [allNodes, selectedNodeId]);

  function handleToggleType(type: NodeTypeKey): void {
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  if (isError) {
    return <GraphErrorState />;
  }

  const isLoading = data == null;
  const isGenuinelyEmpty = !isLoading && allNodes.length === 0;
  const isFilteredEmpty = !isLoading && !isGenuinelyEmpty && visibleNodes.length === 0;

  return (
    <div className="flex h-full w-full flex-col">
      {/* Filter-chip bar */}
      <div
        role="group"
        aria-label="Filter by type"
        className="flex gap-2 overflow-x-auto border-b border-border/50 bg-background px-3 py-1"
      >
        {NODE_TYPE_ROWS.map(({ type, label, dotClass }) => {
          const active = visibleTypes.has(type);
          return (
            <button
              key={type}
              type="button"
              aria-pressed={active}
              onClick={() => handleToggleType(type)}
              className={cn(
                "flex h-11 shrink-0 items-center gap-2 rounded-pill border px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                active
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border bg-muted/40 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <span
                aria-hidden
                className={cn("size-2 shrink-0 rounded-full border", dotClass)}
              />
              {label}
            </button>
          );
        })}
      </div>

      {/* Node list / empty states */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? null : isGenuinelyEmpty ? (
          <GraphNoSchemaState />
        ) : isFilteredEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No nodes match your filters — try showing another type.
            </p>
          </div>
        ) : (
          visibleNodes.map((node) => (
            <button
              key={node.id}
              type="button"
              onClick={() => setSelectedNodeId(node.id)}
              className="flex min-h-16 w-full items-center gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full border",
                  dotClassFor(node.type),
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-normal text-foreground">
                  {node.label}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {typeLabelFor(node.type)}
                </span>
              </span>
            </button>
          ))
        )}
      </div>

      {/* Detail Sheet — full-width, wraps the unchanged NodeDetailPane */}
      <Sheet
        open={selectedNodeId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedNodeId(null);
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-full p-0">
          <SheetTitle className="sr-only">
            {selectedNode?.label ?? "Node details"}
          </SheetTitle>
          <NodeDetailPane
            selectedNode={selectedNode}
            onClose={() => setSelectedNodeId(null)}
            onSelectNode={setSelectedNodeId}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
