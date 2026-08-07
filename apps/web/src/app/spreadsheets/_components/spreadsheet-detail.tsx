"use client";

import Link from "next/link";
import { ArrowLeft, Table2 } from "lucide-react";
import * as React from "react";

import { Skeleton } from "@polytoken/ui/skeleton";
import { SpreadsheetGrid } from "@polytoken/ui/spreadsheet-grid";
import type {
  SpreadsheetColumn,
  SpreadsheetRow,
} from "@polytoken/ui/spreadsheet-grid";

import { api } from "~/trpc/react";

/**
 * spreadsheet-detail.tsx — the /spreadsheets/[id] standalone table viewer
 * (vLAUNCH Wave 0.65 lane P2 — PEDRO-CHECKLIST §5: rows get an open
 * affordance).
 *
 * Reads the owner-scoped `spreadsheets.byId` tRPC procedure (ownership
 * asserted server-side BEFORE the read; missing-or-not-yours surfaces as
 * NOT_FOUND) and renders the stored columns/rows through the SAME
 * `SpreadsheetGrid` the canvas `spreadsheet` node uses — one grid, two
 * mounts, zero drift. READ-ONLY here exactly as on the canvas: the table is
 * produced/updated by the `table.create`/`table.update` capabilities, so this
 * surface never wires cell editing.
 *
 * Shell SHAPE mirrors `documents/_components/document-detail.tsx` (the locked
 * detail/re-open idiom): back link to the registry, pending skeleton,
 * error-and-not-found COLLAPSED into one unavailable state (no existence
 * oracle client-side either), then the artifact. A malformed URL id fails the
 * server's uuid parse and lands in the same unavailable state.
 *
 * LAW 2: the table TITLE is the user's own structured material — SERIF +
 * `data-evidence`, exactly as the canvas node marks it. The "N rows ·
 * updated …" caption is polytoken's summary chrome, so it stays SANS. States
 * speak ink (law 1) — no hue anywhere on this surface.
 *
 * The stored columns/rows cross the tRPC boundary as `unknown` (jsonb). The
 * table.* capability input schemas validated their shape on write, so the
 * narrowing below (mirroring the canvas node's) is defensive, not a trust
 * boundary — a malformed document renders an empty grid, never a throw.
 */

function asColumns(value: unknown): SpreadsheetColumn[] {
  return Array.isArray(value) ? (value as SpreadsheetColumn[]) : [];
}
function asRows(value: unknown): SpreadsheetRow[] {
  return Array.isArray(value) ? (value as SpreadsheetRow[]) : [];
}

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

function formatDate(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : dateFmt.format(d);
}

function toIso(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

export function SpreadsheetDetail({ id }: { id: string }): React.ReactElement {
  const query = api.spreadsheets.byId.useQuery({ spreadsheetId: id });

  return (
    <main className="min-h-[calc(100vh-3.5rem)] w-full bg-shelf">
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <Link
          href="/spreadsheets"
          className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden strokeWidth={1.5} />
          All tables
        </Link>

        {query.isPending ? (
          <div className="mt-6" aria-busy>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-4 h-8 w-1/2" />
            <Skeleton className="mt-6 h-8 w-full" />
            <Skeleton className="mt-2 h-6 w-full" />
            <Skeleton className="mt-2 h-6 w-5/6" />
          </div>
        ) : query.isError || !query.data ? (
          <div className="mt-6 rounded-md border border-rule bg-bright p-panel">
            <p className="text-sm font-medium text-ink">
              This table isn’t available.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              It may have been removed, or it isn’t yours to open.
            </p>
          </div>
        ) : (
          <SpreadsheetBody
            id={id}
            title={query.data.title}
            columns={asColumns(query.data.columns)}
            rows={asRows(query.data.rows)}
            updatedAt={query.data.updatedAt}
          />
        )}
      </div>
    </main>
  );
}

function SpreadsheetBody({
  id,
  title,
  columns,
  rows,
  updatedAt,
}: {
  id: string;
  title: string;
  columns: readonly SpreadsheetColumn[];
  rows: readonly SpreadsheetRow[];
  updatedAt: Date | string;
}): React.ReactElement {
  return (
    <article className="mt-6">
      <header>
        <div className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          <Table2 className="h-3.5 w-3.5" aria-hidden strokeWidth={1.5} />
          Polytoken · Table
        </div>
        {/* The table's own title — SERIF + data-evidence (law 2). */}
        <h1
          className="mt-2 font-serif text-xl font-semibold leading-tight text-ink"
          data-evidence
        >
          {title || "Untitled table"}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted-foreground">
          <span>
            <span className="tabular">{rows.length}</span>{" "}
            {rows.length === 1 ? "row" : "rows"}
          </span>
          <span>
            Updated{" "}
            <time className="tabular" dateTime={toIso(updatedAt)}>
              {formatDate(updatedAt)}
            </time>
          </span>
        </div>
      </header>

      <div className="mt-4">
        <SpreadsheetGrid
          rows={rows}
          columns={columns}
          isEditable={false}
          dataSourceId={id}
          saveStatus="idle"
          totalRecords={rows.length}
        />
      </div>
    </article>
  );
}
