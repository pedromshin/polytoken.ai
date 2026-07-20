"use client";

/**
 * knowledge-mobile-list.tsx — mobile-only `/knowledge` presentation (MOBL-01),
 * on the LOCKED identity (Phase 62 / SURF-03). Below `md`,
 * `knowledge-surface.tsx` renders this INSTEAD of `KnowledgeGraphIsland` —
 * the graph's mount cost is never paid on a phone.
 *
 * Reuses `filter-rail.tsx`'s EXACT `NODE_TYPE_ROWS` facet data + kind-swatch
 * recipe (law 3: kind is structure, never hue — the swatch is a miniature of
 * the node card) and the UNCHANGED `NodeDetailPane` inside a full-width right
 * Sheet — no second vocabulary, no redesign.
 *
 * Structure, top to bottom:
 *   1. Filter-chip bar — pill toggles; the active chip is an INK fill
 *      (law 1: selection carries no hue)
 *   2. Node list — hairline-ruled rows; instance/email labels are the user's
 *      own material (serif + data-evidence, law 2)
 *   3. States — loading skeleton rows / error / genuinely-empty (teaching) /
 *      filtered-to-zero (SURF-06: production-grade, no first-draft nulls)
 *   4. Detail Sheet — full-width right Sheet wrapping NodeDetailPane
 *
 * SECURITY (T-53-06-01): same auth-gated `api.knowledge.graph` query and the
 * same NodeDetailPane (T-11-05 escaped-text rendering) as desktop — only the
 * layout differs.
 *
 * No font-medium (500) — only font-normal (400) / font-semibold (600).
 */

import * as React from "react";
import { useMemo, useState } from "react";

import { cn } from "@polytoken/ui";
import { Sheet, SheetContent, SheetTitle } from "@polytoken/ui/sheet";
import { Skeleton } from "@polytoken/ui/skeleton";

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
  "knowledge_node",
]);

/** Node kinds whose row label is the user's own material (law 2 → serif). */
const EVIDENCE_LABEL_TYPES = new Set<string>(["entity_instance", "email"]);

// ---------------------------------------------------------------------------
// Local type mirror of GraphNode (same minimal shape knowledge-graph.tsx uses)
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

const SWATCH_CLASS_BY_TYPE = new Map<string, string>(
  NODE_TYPE_ROWS.map((row) => [row.type, row.swatchClass]),
);
const LABEL_BY_TYPE = new Map<string, string>(
  NODE_TYPE_ROWS.map((row) => [row.type, row.label]),
);

function swatchClassFor(type: string): string {
  return (
    SWATCH_CLASS_BY_TYPE.get(type) ??
    "h-3 w-4 rounded-[2px] border border-rule bg-bright"
  );
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
    () => allNodes.filter((node) => visibleTypes.has(node.type as NodeTypeKey)),
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
  const isFilteredEmpty =
    !isLoading && !isGenuinelyEmpty && visibleNodes.length === 0;

  return (
    <div className="flex h-full w-full flex-col">
      {/* Filter-chip bar — active chip is an ink fill (law 1) */}
      <div
        role="group"
        aria-label="Filter by type"
        className="flex gap-2 overflow-x-auto border-b border-hair bg-leaf px-3 py-1.5"
      >
        {NODE_TYPE_ROWS.map(({ type, label, swatchClass }) => {
          const active = visibleTypes.has(type);
          return (
            <button
              key={type}
              type="button"
              aria-pressed={active}
              onClick={() => handleToggleType(type)}
              className={cn(
                "flex h-11 shrink-0 items-center gap-2 rounded-pill border px-3 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink",
                active
                  ? "border-ink bg-ink font-semibold text-on-fill"
                  : "border-rule bg-bright text-faded hover:bg-shade hover:text-ink",
              )}
            >
              <span
                aria-hidden
                className={cn(swatchClass, "shrink-0", active && "opacity-90")}
              />
              {label}
            </button>
          );
        })}
      </div>

      {/* Node list / states */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          /* Loading — skeleton rows in the list's own rhythm (SURF-06) */
          <div aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-b border-hair px-row-x py-row-y"
              >
                <Skeleton className="h-3 w-4 rounded-[2px]" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40 rounded-sm" />
                  <Skeleton className="h-3 w-24 rounded-sm" />
                </div>
              </div>
            ))}
          </div>
        ) : isGenuinelyEmpty ? (
          <GraphNoSchemaState />
        ) : isFilteredEmpty ? (
          /* Filtered to zero — the next action is the only prominent thing */
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-sm font-semibold text-ink">
              Nothing matches these filters.
            </p>
            <p className="text-sm text-faded">
              Toggle another type above to bring nodes back.
            </p>
          </div>
        ) : (
          visibleNodes.map((node) => {
            const evidence = EVIDENCE_LABEL_TYPES.has(node.type);
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => setSelectedNodeId(node.id)}
                className="flex min-h-16 w-full items-center gap-3 border-b border-hair px-row-x py-row-y text-left transition-colors hover:bg-shade focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
              >
                <span
                  aria-hidden
                  className={cn(swatchClassFor(node.type), "shrink-0")}
                />
                <span className="min-w-0 flex-1">
                  {evidence ? (
                    <span
                      data-evidence
                      className="block truncate font-serif text-sm text-ink"
                    >
                      {node.label}
                    </span>
                  ) : (
                    <span className="block truncate text-sm text-ink">
                      {node.label}
                    </span>
                  )}
                  <span className="block truncate text-xs text-pencil">
                    {typeLabelFor(node.type)}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Detail Sheet — full-width, wraps the unchanged NodeDetailPane */}
      <Sheet
        open={selectedNodeId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedNodeId(null);
        }}
      >
        <SheetContent side="right" className="w-full p-0 sm:max-w-full">
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
