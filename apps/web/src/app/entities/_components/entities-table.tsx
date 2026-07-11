"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Badge } from "@polytoken/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@polytoken/ui/table";

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
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeDate(date: Date | null): string {
  if (date === null) return "—";
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

function formatKeyIdentifiers(identifiers: Record<string, unknown>): string {
  return Object.values(identifiers)
    .filter((v) => v !== null && v !== undefined && v !== "")
    .join(", ");
}

// ---------------------------------------------------------------------------
// Sortable column header
// ---------------------------------------------------------------------------

type SortableColumn = "name" | "occurrences" | "last_seen";

function SortableHead({
  label,
  column,
  activeSort,
  onSort,
  className = "",
}: {
  readonly label: string;
  readonly column: SortableColumn;
  readonly activeSort: SortOption;
  readonly onSort: (col: SortOption) => void;
  readonly className?: string;
}): React.ReactElement {
  const isActive = activeSort === column;
  const ariaSort: "ascending" | "descending" | "none" = isActive
    ? column === "name"
      ? "ascending"
      : "descending"
    : "none";

  return (
    <TableHead
      className={`cursor-pointer select-none ${className}`}
      aria-sort={ariaSort}
      onClick={() => onSort(column)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          column === "name" ? (
            <ChevronUp className="h-3 w-3 inline" aria-hidden />
          ) : (
            <ChevronDown className="h-3 w-3 inline" aria-hidden />
          )
        ) : null}
      </span>
    </TableHead>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({
  status,
}: {
  readonly status: "confirmed" | "candidate";
}): React.ReactElement {
  if (status === "confirmed") {
    return (
      <Badge className="bg-primary/10 text-primary border-primary/20 text-xs px-2 py-1">
        Confirmed
      </Badge>
    );
  }
  return (
    <Badge className="bg-tier-inferred text-tier-inferred-foreground border-tier-inferred text-xs px-2 py-1">
      Candidate
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Main table component
// ---------------------------------------------------------------------------

export function EntitiesTable({
  items,
  sort,
  onSortChange,
}: EntitiesTableProps): React.ReactElement {
  const router = useRouter();

  return (
    <Table role="table" aria-label="Entities">
      <TableHeader>
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          <SortableHead
            label="Display name"
            column="name"
            activeSort={sort}
            onSort={onSortChange}
            className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex-1 min-w-[180px]"
          />
          <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide w-36">
            Entity type
          </TableHead>
          <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide w-48">
            Key identifiers
          </TableHead>
          <SortableHead
            label="Occurrences"
            column="occurrences"
            activeSort={sort}
            onSort={onSortChange}
            className="text-xs font-semibold text-muted-foreground uppercase tracking-wide w-24 text-right"
          />
          <SortableHead
            label="Last seen"
            column="last_seen"
            activeSort={sort}
            onSort={onSortChange}
            className="text-xs font-semibold text-muted-foreground uppercase tracking-wide w-32"
          />
          <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide w-32">
            Status
          </TableHead>
          <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide w-32">
            Duplicates
          </TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {items.map((item) => {
          const isCandidate = item.status === "candidate";
          const identifierText = formatKeyIdentifiers(item.keyIdentifiers);

          return (
            <TableRow
              key={item.id}
              role="row"
              className={`hover:bg-muted/50 cursor-pointer border-b border-border/50 py-3 ${
                isCandidate ? "bg-tier-inferred/10" : ""
              }`}
              onClick={() => router.push(`/entities/${item.id}`)}
            >
              {/* Display name — graph-entity dot accent + link */}
              <TableCell className="flex-1 min-w-[180px]">
                <Link
                  href={`/entities/${item.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-foreground hover:text-primary"
                >
                  <span
                    className="inline-block size-2 rounded-full bg-graph-entity shrink-0"
                    aria-hidden
                  />
                  {item.displayName}
                </Link>
              </TableCell>

              {/* Entity type — graph-entity badge */}
              <TableCell className="w-36">
                {item.entityTypeLabel !== null ? (
                  <Badge className="bg-graph-entity/10 text-graph-entity border-graph-entity/30 text-xs px-2 py-1">
                    {item.entityTypeLabel}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>

              {/* Key identifiers — truncated */}
              <TableCell className="w-48">
                <span
                  className="text-xs text-muted-foreground truncate block max-w-[11rem]"
                  title={identifierText}
                >
                  {identifierText || "—"}
                </span>
              </TableCell>

              {/* Occurrences — right-aligned tabular nums */}
              <TableCell className="w-24 text-right">
                <span className="text-sm font-semibold tabular-nums">
                  {item.occurrenceCount}
                </span>
              </TableCell>

              {/* Last seen — relative date */}
              <TableCell className="w-32">
                <span
                  className="text-xs text-muted-foreground"
                  title={item.lastSeen?.toISOString() ?? undefined}
                >
                  {formatRelativeDate(item.lastSeen)}
                </span>
              </TableCell>

              {/* Status badge */}
              <TableCell className="w-32">
                <StatusBadge status={item.status} />
              </TableCell>

              {/* Pending duplicates */}
              <TableCell className="w-32">
                {item.pendingDuplicatesCount > 0 ? (
                  <Badge className="bg-destructive/10 text-destructive border-destructive/30 text-xs px-2 py-1">
                    {item.pendingDuplicatesCount} possible duplicates
                  </Badge>
                ) : null}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
