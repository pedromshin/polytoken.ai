"use client";

/**
 * spreadsheet-node.tsx — SpreadsheetNode: the canvas's `spreadsheet` custom
 * React Flow node (FEATURE-CATALOG CV-03) — wires the previously-unwired
 * packages/ui/src/spreadsheet-grid into the canvas as a read-only panel.
 *
 * It mirrors DocumentNode's shape: a fixed shell on the shared card recipe,
 * data fetched HERE (`api.spreadsheets.byId`, gated through ownership.ts) with
 * node.data carrying ONLY the `spreadsheetId` ref (never the fetched
 * columns/rows), and a loading/error/unavailable/success body in that branch
 * order. The grid renders in READ-ONLY mode (isEditable=false) — cell editing
 * is deliberately not wired here; the table is produced/updated by the
 * `table.create`/`table.update` capabilities, not by direct canvas edits.
 *
 * LAW 2 on this card: the table TITLE is the user's own structured material, so
 * it is SERIF + data-evidence — marked on the SPAN, exactly as DocumentNode
 * marks a document title. The "N rows" caption is polytoken's summary chrome, so
 * it stays SANS.
 *
 * Kind geometry: `CANVAS_NODE_KIND_GEOMETRY["spreadsheet"]` — a rule-4 DOUBLE
 * left rule ("a substantial bound artifact of structured material"; law 3: kind
 * is shape, never hue). Remove mirrors the sibling nodes: `deleteElements` drops
 * only the placement; the underlying spreadsheet row survives.
 */

import { memo } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { AlertCircle, Table2, X } from "lucide-react";

import { Skeleton } from "@polytoken/ui/skeleton";
import { SpreadsheetGrid } from "@polytoken/ui/spreadsheet-grid";
import type {
  SpreadsheetColumn,
  SpreadsheetRow,
} from "@polytoken/ui/spreadsheet-grid";

import { api } from "~/trpc/react";

import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";
import type { SpreadsheetNodeData } from "./node-data-schemas";

export type SpreadsheetNodeType = Node<SpreadsheetNodeData, "spreadsheet">;

/**
 * resolveHeaderLabel — mirrors DocumentNode's 3-step order: explicit
 * `customLabel` always wins -> the fetched table's own `title` once the query
 * settles -> the fallback literal "Untitled table".
 */
export function resolveHeaderLabel(
  customLabel: string | undefined,
  fetchedTitle: string | null | undefined,
): string {
  if (customLabel !== undefined) return customLabel;
  if (fetchedTitle) return fetchedTitle;
  return "Untitled table";
}

/** The stored columns/rows cross the tRPC boundary as `unknown` (jsonb). The
 * table.* capability input schemas already validated their shape on write, so
 * this is a narrowing, not a trust boundary — but keep it defensive. */
function asColumns(value: unknown): SpreadsheetColumn[] {
  return Array.isArray(value) ? (value as SpreadsheetColumn[]) : [];
}
function asRows(value: unknown): SpreadsheetRow[] {
  return Array.isArray(value) ? (value as SpreadsheetRow[]) : [];
}

export const SpreadsheetNode = memo(function SpreadsheetNode({
  id,
  data,
  selected,
}: NodeProps<SpreadsheetNodeType>) {
  const { deleteElements } = useReactFlow();
  const query = api.spreadsheets.byId.useQuery({ spreadsheetId: data.spreadsheetId });

  const headerLabel = resolveHeaderLabel(data.label, query.data?.title);
  const columns = asColumns(query.data?.columns);
  const rows = asRows(query.data?.rows);

  return (
    <div
      className={`flex w-[640px] flex-col ${canvasNodeShellClass(CANVAS_NODE_KIND_GEOMETRY.spreadsheet, selected === true)}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-hair px-3 active:cursor-grabbing">
        <span className="flex min-w-0 items-center gap-2">
          <Table2 className="size-3 shrink-0 text-faded" aria-hidden />
          {/* The table's own title — SERIF, marked on the SPAN (law 2). */}
          <span
            className="truncate font-serif text-xs font-semibold text-ink"
            data-evidence
          >
            {headerLabel}
          </span>
        </span>
        <button
          type="button"
          aria-label="Remove table"
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-pencil transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
          onClick={(event) => {
            event.stopPropagation();
            void deleteElements({ nodes: [{ id }] });
          }}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      <div className="relative flex flex-1 flex-col px-2 py-2">
        {query.isPending ? (
          <div
            role="status"
            aria-label="Loading table"
            className="flex flex-col gap-2 p-2"
          >
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-5/6" />
          </div>
        ) : query.isError ? (
          <div className="flex flex-col items-center justify-center gap-1.5 px-1 py-8 text-center">
            <AlertCircle className="size-5 shrink-0 text-ink" aria-hidden />
            <p className="text-xs text-faded">
              Couldn&apos;t load this table. Try again, or open it from your
              workspace.
            </p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="rounded-sm px-1.5 py-0.5 text-xs text-faded transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              Retry
            </button>
          </div>
        ) : query.data === null ? (
          <div className="flex flex-col items-center justify-center gap-1.5 px-1 py-8 text-center">
            <Table2 className="size-5 shrink-0 text-faded" aria-hidden />
            <p className="text-xs text-faded">
              This table is unavailable. It may have been removed or is no longer
              accessible.
            </p>
          </div>
        ) : query.data ? (
          // nowheel/nodrag: the grid owns its own scroll + pointer interactions;
          // without these the canvas would pan/zoom instead of scrolling the grid.
          <div className="nowheel nodrag">
            <SpreadsheetGrid
              rows={rows}
              columns={columns}
              isEditable={false}
              dataSourceId={data.spreadsheetId}
              saveStatus="idle"
              totalRecords={rows.length}
            />
          </div>
        ) : null}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
});
