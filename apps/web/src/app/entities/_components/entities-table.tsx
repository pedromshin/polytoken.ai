"use client";

/**
 * entities-table.tsx — FEATURE-CATALOG EN-01: the entity table rendered through
 * packages/ui/src/spreadsheet-grid (the previously-unwired Excel-like grid), in
 * READ-MOSTLY mode. This is the lowest-risk first wiring of that grid — it
 * proves the grid renders + wires against a real surface before CV-03 puts it
 * on the canvas.
 *
 * Read-mostly, not editable: entity fields (display name, occurrence counts,
 * last-seen) are DERIVED aggregates, and the existing entities mutations router
 * (confirmMerge/rejectMerge/unmerge) exposes no field-edit endpoint — so there
 * is no honest persistence path for a cell edit, and inventing one would violate
 * EN-01's "no new persistence" constraint. The grid therefore renders with
 * `isEditable={false}`; what it DOES wire is the grid's own machinery: column
 * sorting, the column header menu, and CONDITIONAL FORMATTING for the
 * "needs review" states (candidate status + pending duplicates). Clicking a
 * row's number opens the entity detail page.
 *
 * The `GalleryItem` type + the `EntitiesTableProps` shape are preserved verbatim
 * so entities-gallery.tsx is untouched. `sort`/`onSortChange` remain on the prop
 * type (the gallery's server-sort dropdown drives them); the grid additionally
 * offers client-side column sorting over the loaded page.
 */

import * as React from "react";
import { useMemo } from "react";
import { useRouter } from "next/navigation";

import { SpreadsheetGrid } from "@polytoken/ui/spreadsheet-grid";
import type {
  FormattingRules,
  SpreadsheetColumn,
  SpreadsheetRow,
} from "@polytoken/ui/spreadsheet-grid";

// ---------------------------------------------------------------------------
// Types — re-exported so entities-gallery can import GalleryItem from here
// ---------------------------------------------------------------------------

export interface GalleryItem {
  readonly id: string;
  readonly displayName: string;
  readonly entityTypeId: string;
  readonly entityTypeLabel: string | null;
  readonly keyIdentifiers: Record<string, unknown>;
  readonly occurrenceCount: number;
  readonly pendingDuplicatesCount: number;
  readonly lastSeen: Date | null;
  readonly status: "confirmed" | "candidate";
}

type SortOption = "last_seen" | "name" | "occurrences";

interface EntitiesTableProps {
  readonly items: ReadonlyArray<GalleryItem>;
  readonly sort: SortOption;
  readonly onSortChange: (sort: SortOption) => void;
}

// ---------------------------------------------------------------------------
// Grid model — the pure GalleryItem[] -> (columns, rows, formatting) mapping.
// Exported so it is unit-testable without mounting the grid (jsdom does no
// layout — the mapping is the behaviour worth pinning).
// ---------------------------------------------------------------------------

/** The columns the entity table renders — schema-derived, in display order. */
export const ENTITY_GRID_COLUMNS: readonly SpreadsheetColumn[] = [
  { name: "Display name", type: "text" },
  { name: "Entity type", type: "text" },
  { name: "Key identifiers", type: "text" },
  { name: "Occurrences", type: "number" },
  { name: "Last seen", type: "date" },
  { name: "Status", type: "text" },
  { name: "Duplicates", type: "number" },
];

/**
 * Conditional formatting for the "needs review" states (EN-01): a `candidate`
 * status and any pending duplicates are the two signals a reviewer acts on.
 * chart-* are the grid's tokenized formatting palette (types.ts FormatColor).
 */
export const ENTITY_GRID_FORMATTING: FormattingRules = {
  Status: [
    { id: "status-candidate", condition: "equals", value: "candidate", color: "chart-3" },
  ],
  Duplicates: [
    { id: "duplicates-review", condition: "greater_than", value: 0, color: "chart-1" },
  ],
};

function formatKeyIdentifiers(identifiers: Record<string, unknown>): string {
  return Object.values(identifiers)
    .filter((v) => v !== null && v !== undefined && v !== "")
    .join(", ");
}

/** Map one GalleryItem to a grid row — cells keyed by column name (types.ts
 * SpreadsheetRow.data is `Record<string, unknown>`). */
export function entityToRow(item: GalleryItem): SpreadsheetRow {
  return {
    id: item.id,
    data: {
      "Display name": item.displayName,
      "Entity type": item.entityTypeLabel ?? "",
      "Key identifiers": formatKeyIdentifiers(item.keyIdentifiers),
      Occurrences: item.occurrenceCount,
      "Last seen": item.lastSeen ? item.lastSeen.toISOString() : null,
      Status: item.status,
      Duplicates: item.pendingDuplicatesCount,
    },
  };
}

export function buildEntityGridRows(
  items: ReadonlyArray<GalleryItem>,
): SpreadsheetRow[] {
  return items.map(entityToRow);
}

// ---------------------------------------------------------------------------
// Main table component
// ---------------------------------------------------------------------------

export function EntitiesTable({ items }: EntitiesTableProps): React.ReactElement {
  const router = useRouter();

  const rows = useMemo(() => buildEntityGridRows(items), [items]);

  return (
    <div aria-label="Entities" className="p-4">
      <SpreadsheetGrid
        rows={rows}
        columns={ENTITY_GRID_COLUMNS}
        isEditable={false}
        dataSourceId="entities"
        saveStatus="idle"
        totalRecords={items.length}
        formattingRules={ENTITY_GRID_FORMATTING}
        onRowDetailOpen={(rowId) => router.push(`/entities/${rowId}`)}
      />
    </div>
  );
}
