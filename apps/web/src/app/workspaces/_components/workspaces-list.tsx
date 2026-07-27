"use client";

import Link from "next/link";
import { Users } from "lucide-react";
import * as React from "react";

import { Button } from "@polytoken/ui/button";
import { Input } from "@polytoken/ui/input";
import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";

import { ROLE_LABEL, type WorkspaceRole } from "../_lib/roles";

/**
 * workspaces-list.tsx — the /workspaces list surface (Stream B).
 *
 * Reads the owner/membership-scoped `workspaces.list` procedure (a single
 * membership scan server-side — the owner is itself a member row; this client
 * never sends a user id). Each row is a single-click open: the whole row links
 * to `/workspaces/[id]` (interaction-economy — the primary navigation of the
 * surface is one click from arrival).
 *
 * The "New workspace" create form is the surface's primary ACTION and sits
 * inline at the top (≤1 keystroke to start typing a name, one click to
 * create) rather than behind a modal. On success it invalidates
 * `workspaces.list` via `useUtils`, so the new row appears without a manual
 * refetch.
 *
 * Chrome is monochrome (law 1): the per-workspace role is stated as a plain
 * sans label in `text-muted-foreground`, never a coloured badge.
 */

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function formatDate(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : dateFmt.format(d);
}

export function WorkspacesList(): React.ReactElement {
  const utils = api.useUtils();
  const query = api.workspaces.list.useQuery();
  const [name, setName] = React.useState("");

  const create = api.workspaces.create.useMutation({
    onSuccess: async () => {
      setName("");
      await utils.workspaces.list.invalidate();
    },
  });

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !create.isPending;

  function onSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canSubmit) return;
    create.mutate({ name: trimmed });
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-2 rounded-md border border-rule bg-bright p-panel sm:flex-row sm:items-end"
        aria-label="Create a workspace"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label
            htmlFor="new-workspace-name"
            className="text-2xs font-medium text-muted-foreground"
          >
            New workspace
          </label>
          <Input
            id="new-workspace-name"
            value={name}
            maxLength={200}
            placeholder="Untitled workspace"
            onChange={(e) => setName(e.target.value)}
            disabled={create.isPending}
          />
        </div>
        <Button type="submit" disabled={!canSubmit}>
          {create.isPending ? "Creating…" : "Create"}
        </Button>
      </form>

      {create.isError ? (
        <p className="text-2xs text-ink" role="alert">
          Couldn’t create the workspace: {create.error.message}
        </p>
      ) : null}

      <WorkspaceRows
        isPending={query.isPending}
        isError={query.isError}
        errorMessage={query.error?.message}
        rows={query.data ?? []}
      />
    </div>
  );
}

interface WorkspaceRow {
  id: string;
  name: string;
  role: WorkspaceRole;
  createdAt: Date | string;
}

function WorkspaceRows(props: {
  isPending: boolean;
  isError: boolean;
  errorMessage?: string;
  rows: readonly WorkspaceRow[];
}): React.ReactElement {
  if (props.isPending) {
    return (
      <ul className="flex flex-col gap-2" aria-busy>
        {[0, 1, 2].map((i) => (
          <li
            key={i}
            className="flex items-center gap-3 rounded-md border border-rule bg-bright px-4 py-3"
          >
            <Skeleton className="h-4 w-4 rounded-sm" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="ml-auto h-3 w-16" />
          </li>
        ))}
      </ul>
    );
  }

  if (props.isError) {
    return (
      <div className="rounded-md border border-rule bg-bright p-panel text-sm text-ink">
        <p className="font-medium">Couldn’t load your workspaces.</p>
        <p className="mt-1 text-muted-foreground">
          {props.errorMessage}. Try again in a moment.
        </p>
      </div>
    );
  }

  if (props.rows.length === 0) {
    return (
      <div className="mx-auto max-w-md rounded-md border border-rule bg-bright p-panel text-center">
        <Users
          className="mx-auto h-6 w-6 text-ink"
          aria-hidden
          strokeWidth={1.5}
        />
        <p className="mt-3 text-sm font-medium text-ink">No workspaces yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          A workspace is a shared team space. Create one above — you become its
          owner, and can then add members and manage their roles.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {props.rows.map((ws) => (
        <li key={ws.id}>
          <Link
            href={`/workspaces/${ws.id}`}
            className="group flex items-center gap-3 rounded-md border border-rule bg-bright px-4 py-3 transition-colors hover:border-ink"
          >
            <Users
              className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-ink"
              aria-hidden
              strokeWidth={1.5}
            />
            <span className="min-w-0 flex-1 truncate text-sm text-ink">
              {ws.name}
            </span>
            <span className="shrink-0 text-2xs text-muted-foreground">
              {ROLE_LABEL[ws.role]}
            </span>
            <time
              className="tabular shrink-0 text-2xs text-muted-foreground"
              dateTime={
                ws.createdAt instanceof Date
                  ? ws.createdAt.toISOString()
                  : String(ws.createdAt)
              }
            >
              {formatDate(ws.createdAt)}
            </time>
          </Link>
        </li>
      ))}
    </ul>
  );
}
