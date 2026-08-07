"use client";

import Link from "next/link";
import { Table2 } from "lucide-react";
import * as React from "react";

import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";
import { formatRelativeTime } from "../../chat/_canvas/format-relative-time";

/**
 * spreadsheets-list.tsx — the /spreadsheets list surface (Stream A — CV-03).
 *
 * Reads the owner-scoped `spreadsheets.list` tRPC procedure (scoped through
 * ctx.user.id server-side — this client never sends a user id). The procedure
 * returns `[{ id, title, createdAt, updatedAt }]` newest-first (by updatedAt),
 * omitting the heavy columns/rows jsonb.
 *
 * Each row is a single-click open: the whole row is the link to
 * `/spreadsheets/[id]` (interaction-economy — the primary action of the
 * surface is reachable in one click from arrival, the /documents registry
 * idiom verbatim). The viewer route renders the same read-only grid the
 * canvas `spreadsheet` node mounts; the canvas remains the place a table is
 * MADE, this is where a stored one is re-opened.
 *
 * The empty state TEACHES the next action (taste contract) rather than showing a
 * bare "no tables" — a table is created by the agent on the canvas, so it points
 * there.
 *
 * Relative time reuses `formatRelativeTime` (the studio/canvas vocabulary) VERBATIM
 * rather than inventing a second relative-time vocabulary.
 */

function toIso(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

export function SpreadsheetsList(): React.ReactElement {
  const query = api.spreadsheets.list.useQuery();

  if (query.isPending) {
    return (
      <ul className="flex flex-col gap-2" aria-busy>
        {[0, 1, 2, 3].map((i) => (
          <li
            key={i}
            className="flex items-center gap-3 rounded-md border border-rule bg-bright px-4 py-3"
          >
            <Skeleton className="h-4 w-4 rounded-sm" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="ml-auto h-3 w-20" />
          </li>
        ))}
      </ul>
    );
  }

  if (query.isError) {
    return (
      <div className="rounded-md border border-rule bg-bright p-panel text-sm text-ink">
        <p className="font-medium">Couldn’t load your tables.</p>
        <p className="mt-1 text-muted-foreground">
          {query.error.message}. Try again in a moment.
        </p>
      </div>
    );
  }

  const items = query.data ?? [];

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-md rounded-md border border-rule bg-bright p-panel text-center">
        <Table2
          className="mx-auto h-6 w-6 text-ink"
          aria-hidden
          strokeWidth={1.5}
        />
        <p className="mt-3 text-sm font-medium text-ink">No tables yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Tables are built on the canvas — ask for one in{" "}
          <Link href="/chat" className="text-ink underline underline-offset-2">
            chat
          </Link>{" "}
          and it lands here, stored and re-openable.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((table) => {
        const iso = toIso(table.updatedAt);
        return (
          <li key={table.id} data-slot="spreadsheet-row">
            <Link
              href={`/spreadsheets/${table.id}`}
              className="group flex items-center gap-3 rounded-md border border-rule bg-bright px-4 py-3 transition-colors hover:border-ink"
            >
              <Table2
                className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-ink"
                aria-hidden
                strokeWidth={1.5}
              />
              <span
                className="min-w-0 flex-1 truncate font-serif text-sm text-ink"
                data-evidence
              >
                {table.title}
              </span>
              <time
                className="tabular shrink-0 text-2xs text-muted-foreground"
                dateTime={iso}
              >
                {formatRelativeTime(iso)}
              </time>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
