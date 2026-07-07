"use client";

/**
 * history-island.tsx — History tab: newest-first paginated master list + read-only
 * detail view of past generations (STDO-05 / STDO-06 / D-18).
 *
 * Architecture:
 *   - Master list: api.genui.historyList.useQuery({ limit: 20, offset })
 *     - Newest-first (sorted server-side per D-14)
 *     - Pager: prev / next page buttons (offset-based; D-18)
 *     - Loading, empty, and error states (D-18)
 *   - Detail: api.genui.historyById.useQuery({ id: selectedId }, { enabled })
 *     - Reuses SHARED SpecRendererIsland in 55/45 ResizablePanelGroup (STDO-02)
 *     - NO actions prop → read-only (D-18); no Generate / edit controls
 *     - specJson re-parsed via SpecRootSchema.safeParse; falls back to
 *       SAFE_FALLBACK_SPEC when stored spec no longer parses (D-17 / T-16-05-T)
 *
 * Security:
 *   - No eval / Function / dangerouslySetInnerHTML (GR-01)
 *   - No actions/ActionRegistry in the detail — read-only (T-16-05-E)
 *   - EMAIL_LISTENER_API_KEY stays server-side (tRPC proxy)
 *
 * STDO-02 contract:
 *   Exactly ONE SpecRendererIsland import in this file; no new dynamic() wrapper.
 */

import React, { useState } from "react";

import { Badge } from "@nauta/ui/badge";
import { Button } from "@nauta/ui/button";
import { ScrollArea } from "@nauta/ui/scroll-area";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@nauta/ui/resizable";

import { api } from "~/trpc/react";
import { SpecRootSchema, SAFE_FALLBACK_SPEC } from "@nauta/genui/schema";
import type { SpecRoot } from "@nauta/genui/schema";

import { SpecRendererIsland } from "./spec-renderer-island";
import { JsonPane } from "./json-pane";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20 as const;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Formats an ISO date string as a relative time string (e.g. "3 minutes ago").
 * Falls back to the raw string if the date is invalid.
 */
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? "s" : ""} ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} hour${diffHour !== 1 ? "s" : ""} ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} day${diffDay !== 1 ? "s" : ""} ago`;
}

/**
 * Truncates a string to `maxLength` characters, appending an ellipsis when truncated.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "…";
}

/**
 * Parses specJson (Record<string, unknown>) into a SpecRoot, falling back to
 * SAFE_FALLBACK_SPEC if the stored spec no longer parses under the current schema.
 * Satisfies T-16-05-T: no spec-validation bypass, degrades gracefully.
 */
function parseSpecSafe(specJson: Record<string, unknown>): {
  readonly spec: SpecRoot;
  readonly fallback: boolean;
} {
  const result = SpecRootSchema.safeParse(specJson);
  if (result.success) {
    return { spec: result.data, fallback: false };
  }
  return { spec: SAFE_FALLBACK_SPEC, fallback: true };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** A single row in the master list. */
function HistoryRow({
  id,
  intentText,
  createdAt,
  registryVersion,
  useCount,
  validationStatus,
  isSelected,
  onSelect,
}: {
  readonly id: string;
  readonly intentText: string;
  readonly createdAt: string;
  readonly registryVersion: string;
  readonly useCount: number;
  readonly validationStatus: string;
  readonly isSelected: boolean;
  readonly onSelect: (id: string) => void;
}): React.ReactElement {
  const truncatedIntent = truncate(intentText, 80);
  const relativeTime = formatRelativeTime(createdAt);
  const versionBadge = registryVersion.slice(0, 8);

  return (
    <button
      type="button"
      aria-selected={isSelected}
      aria-label={`View generation: ${intentText}`}
      onClick={(): void => { onSelect(id); }}
      className={[
        "w-full text-left px-4 py-3 border-b border-border/50 transition-colors",
        "hover:bg-muted/50 focus:outline-none focus:bg-muted/70",
        isSelected ? "bg-muted" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          title={intentText}
          className="text-sm text-foreground leading-snug line-clamp-2 flex-1 min-w-0"
        >
          {truncatedIntent}
        </p>
        <Badge
          variant="outline"
          className="shrink-0 font-mono text-[10px] px-1 py-0"
        >
          {versionBadge}
        </Badge>
      </div>
      <div className="mt-1 flex items-center gap-3 flex-wrap">
        <time
          dateTime={createdAt}
          className="text-xs text-muted-foreground"
          title={createdAt}
        >
          {relativeTime}
        </time>
        <span className="text-xs text-muted-foreground">
          Used {useCount}×
        </span>
        <Badge
          variant={validationStatus === "validated" ? "secondary" : "outline"}
          className="text-[10px] px-1 py-0"
        >
          {validationStatus}
        </Badge>
      </div>
    </button>
  );
}

/** Loading skeleton for the master list. */
function HistoryListSkeleton(): React.ReactElement {
  return (
    <div aria-busy="true" aria-label="Loading history" className="flex flex-col">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="px-4 py-3 border-b border-border/50">
          <div className="h-4 w-3/4 rounded bg-muted animate-pulse mb-2" />
          <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
        </div>
      ))}
    </div>
  );
}

/** Empty state for the master list. */
function HistoryListEmpty(): React.ReactElement {
  return (
    <div
      aria-live="polite"
      className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground"
    >
      <p>No generations yet.</p>
      <p className="mt-1 text-xs">Generate something in the Sandbox to see it here.</p>
    </div>
  );
}

/** Error state for the master list. */
function HistoryListError(): React.ReactElement {
  return (
    <div
      role="alert"
      className="px-4 py-6 text-sm text-destructive"
    >
      Failed to load generation history. Please try again later.
    </div>
  );
}

/** Detail panel skeleton. */
function DetailSkeleton(): React.ReactElement {
  return (
    <div
      aria-busy="true"
      aria-label="Loading detail"
      className="flex flex-1 items-center justify-center text-sm text-muted-foreground"
    >
      <div className="h-4 w-32 rounded bg-muted animate-pulse" />
    </div>
  );
}

/** Prompt shown when no row is selected yet. */
function DetailEmpty(): React.ReactElement {
  return (
    <div
      aria-live="polite"
      className="flex flex-1 items-center justify-center text-sm text-muted-foreground"
    >
      Select a row to inspect its rendered spec.
    </div>
  );
}

/** Safe-fallback notice rendered inside the detail when the stored spec could not be parsed. */
function FallbackNotice(): React.ReactElement {
  return (
    <div
      role="alert"
      className="shrink-0 border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive"
    >
      This spec no longer parses under the current schema — showing fallback output.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Master list sub-component
// ---------------------------------------------------------------------------

interface MasterListProps {
  readonly selectedId: string | undefined;
  readonly onSelect: (id: string) => void;
  /** WR-03: called whenever the user navigates to a different page so the
   *  parent can clear the stale selectedId. */
  readonly onPageChange: () => void;
}

function HistoryMasterList({
  selectedId,
  onSelect,
  onPageChange,
}: MasterListProps): React.ReactElement {
  const [offset, setOffset] = useState<number>(0);

  const { data: rows, isLoading, isError } = api.genui.historyList.useQuery({
    limit: PAGE_SIZE,
    offset,
  });

  const hasPrevPage = offset > 0;
  const hasNextPage = rows !== undefined && rows.length === PAGE_SIZE;

  // WR-03: reset selectedId in parent before changing page so a stale cross-
  // page selection can never occur. onPageChange() must be called BEFORE
  // setOffset() so the detail panel dismisses immediately.
  const handlePrev = (): void => {
    onPageChange();
    setOffset((prev) => Math.max(0, prev - PAGE_SIZE));
  };

  const handleNext = (): void => {
    onPageChange();
    setOffset((prev) => prev + PAGE_SIZE);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <ScrollArea className="flex-1 min-h-0">
        {isLoading && <HistoryListSkeleton />}
        {isError && <HistoryListError />}
        {!isLoading && !isError && rows !== undefined && rows.length === 0 && (
          <HistoryListEmpty />
        )}
        {!isLoading && !isError && rows !== undefined && rows.length > 0 && (
          <ul role="list" aria-label="Generation history">
            {rows.map((row, index) => (
              <li
                key={row.id}
                role="listitem"
                className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
                style={{ animationDelay: `${Math.min(index, 5) * 40}ms` }}
              >
                <HistoryRow
                  id={row.id}
                  intentText={row.intentText}
                  createdAt={row.createdAt}
                  registryVersion={row.registryVersion}
                  useCount={row.useCount}
                  validationStatus={row.validationStatus}
                  isSelected={selectedId === row.id}
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>

      {/* Pager — prev / next (offset-based; D-18) */}
      <div
        className="shrink-0 flex items-center justify-between border-t border-border/50 px-4 py-2"
        aria-label="History pagination"
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={handlePrev}
          disabled={!hasPrevPage}
          aria-label="Previous page"
        >
          Previous
        </Button>
        <span className="text-xs text-muted-foreground">
          {/* WR-02: show "0" when the list is empty/loading so we never render
              the nonsensical "1–0" range. */}
          {rows !== undefined && rows.length > 0
            ? `${offset + 1}–${offset + rows.length}`
            : "0"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleNext}
          disabled={!hasNextPage}
          aria-label="Next page"
        >
          Next
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail sub-component (55/45 split reused from Sandbox — STDO-02)
// ---------------------------------------------------------------------------

interface DetailViewProps {
  readonly selectedId: string;
}

function HistoryDetailView({ selectedId }: DetailViewProps): React.ReactElement {
  const { data: detail, isLoading, isError } = api.genui.historyById.useQuery(
    { id: selectedId },
    { enabled: selectedId.length > 0 },
  );

  if (isLoading) {
    return <DetailSkeleton />;
  }

  // WR-01: surface network/5xx failures as an explicit error state so the user
  // can distinguish a transient failure from a genuine 404 "not found".
  if (isError) {
    return (
      <div
        role="alert"
        className="flex flex-1 items-center justify-center text-sm text-destructive px-4 text-center"
      >
        Could not load generation details. Please try again.
      </div>
    );
  }

  if (detail === null || detail === undefined) {
    return (
      <div
        role="alert"
        className="flex flex-1 items-center justify-center text-sm text-muted-foreground"
      >
        Generation not found or no longer available.
      </div>
    );
  }

  const { spec, fallback } = parseSpecSafe(detail.specJson);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Read-only badge header */}
      <div className="shrink-0 flex items-center gap-2 border-b border-border/50 px-4 py-2 bg-muted/30">
        <span
          className="text-xs font-normal text-muted-foreground truncate flex-1"
          title={detail.intentText}
        >
          {truncate(detail.intentText, 120)}
        </span>
        <Badge variant="outline" className="shrink-0 text-[10px] px-1 py-0">
          Read-only
        </Badge>
      </div>

      {/* Safe-fallback notice when stored spec could not parse */}
      {fallback && <FallbackNotice />}

      {/* 55/45 ResizablePanelGroup — mirrors generation-sandbox-island.tsx (D-09 / STDO-02) */}
      <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
        {/* Left (55): rendered spec via SHARED SpecRendererIsland — NO actions = read-only (D-18) */}
        <ResizablePanel defaultSize={55} minSize={30}>
          <div
            role="region"
            aria-label="Rendered output (read-only)"
            className="h-full overflow-y-auto scrollbar-token p-6"
          >
            <SpecRendererIsland spec={spec} />
          </div>
        </ResizablePanel>

        <ResizableHandle />

        {/* Right (45): spec JSON */}
        <ResizablePanel defaultSize={45} minSize={25}>
          <div
            role="region"
            aria-label="Spec JSON"
            className="flex h-full flex-col bg-muted"
          >
            <JsonPane value={spec} />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HistoryIsland — public export
// ---------------------------------------------------------------------------

/**
 * HistoryIsland — master list + read-only detail view for the History tab.
 *
 * "use client" — tRPC hooks + useState require client context.
 * Read-only: no Generate button, no edit controls (D-18 / T-16-05-E).
 * Reuses SHARED SpecRendererIsland — no second renderer introduced (STDO-02).
 */
export function HistoryIsland(): React.ReactElement {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const handleSelect = (id: string): void => {
    setSelectedId(id);
  };

  // WR-03: reset selection when the user navigates to a different page so
  // the detail panel never shows a row that is not visible in the current list.
  const handlePageChange = (): void => {
    setSelectedId(undefined);
  };

  return (
    <div className="flex flex-1 min-h-0">
      {/* Master list — left panel (fixed width, scrollable) */}
      <div
        className="w-80 shrink-0 flex flex-col border-r border-border/50 min-h-0"
        role="navigation"
        aria-label="Past generations"
      >
        <div className="shrink-0 px-4 py-3 border-b border-border/50">
          <h2 className="text-sm font-semibold">Generation History</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Newest first</p>
        </div>
        <HistoryMasterList selectedId={selectedId} onSelect={handleSelect} onPageChange={handlePageChange} />
      </div>

      {/* Detail view — right panel, flex-1 */}
      <div className="flex flex-1 min-h-0 flex-col">
        {selectedId === undefined ? (
          <DetailEmpty />
        ) : (
          <HistoryDetailView selectedId={selectedId} />
        )}
      </div>
    </div>
  );
}
