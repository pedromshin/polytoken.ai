"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { cn } from "@polytoken/ui";
import { Button } from "@polytoken/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@polytoken/ui/dropdown-menu";

import { api } from "~/trpc/react";

import { ROLE_LABEL, type WorkspaceRole } from "../_lib/roles";

/**
 * workspace-switcher.tsx — a self-contained workspace dropdown (Stream B).
 *
 * Lists `workspaces.list` and lets the user pick a "current" workspace. It is
 * PURELY PRESENTATIONAL this phase: the choice is persisted to localStorage
 * (`STORAGE_KEY`) and surfaced via `onSelect`, but it does NOT re-scope any
 * global data — no resource-list query is touched. Wiring the selection into
 * app-wide scoping is a deliberate later step.
 *
 * Monochrome chrome (law 1): the trigger + items are ink/rule only; the role
 * is a plain sans label.
 *
 * Mounted in the shared nav (app-sidebar header + mobile "More" sheet) with
 * `hideWhenEmpty` — there it renders NOTHING while the list is loading or
 * empty, so a zero-workspace user sees quiet chrome, never an error and never
 * a dead disabled control. Without the prop (a management surface that wants
 * an explicit empty state) the original disabled "No workspaces" trigger is
 * preserved. The dropdown's last row links to /workspaces, which is otherwise
 * reachable only by typing the URL.
 */

export const STORAGE_KEY = "polytoken:selectedWorkspaceId";

function readPersisted(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writePersisted(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // A blocked/full localStorage must not break selection.
  }
}

interface SwitcherWorkspace {
  id: string;
  name: string;
  role: WorkspaceRole;
}

export function WorkspaceSwitcher(props: {
  className?: string;
  onSelect?: (workspaceId: string) => void;
  /**
   * Nav-chrome mode: render nothing while the list is loading, empty, or
   * errored. A rail must stay quiet for a zero-workspace user — no disabled
   * control, no "Loading…", never an error.
   */
  hideWhenEmpty?: boolean;
}): React.ReactElement | null {
  const query = api.workspaces.list.useQuery();
  const workspaces = (query.data ?? []) as SwitcherWorkspace[];

  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  // Restore the persisted selection on mount (client-only — avoids an SSR
  // hydration mismatch by reading localStorage in an effect, not in render).
  React.useEffect(() => {
    setSelectedId(readPersisted());
  }, []);

  // If nothing valid is selected once the list arrives, default to the first
  // (newest) workspace — but never overwrite a still-valid persisted choice.
  React.useEffect(() => {
    if (workspaces.length === 0) return;
    const stillValid =
      selectedId !== null && workspaces.some((w) => w.id === selectedId);
    if (!stillValid) {
      setSelectedId(workspaces[0]!.id);
    }
  }, [workspaces, selectedId]);

  // After all hooks (rules-of-hooks): the quiet nav mode bails out entirely
  // rather than rendering loading/empty/error chrome into the rail.
  if (props.hideWhenEmpty && workspaces.length === 0) {
    return null;
  }

  function select(id: string): void {
    setSelectedId(id);
    writePersisted(id);
    props.onSelect?.(id);
  }

  const selected = workspaces.find((w) => w.id === selectedId) ?? null;

  const triggerLabel = query.isPending
    ? "Loading…"
    : workspaces.length === 0
      ? "No workspaces"
      : (selected?.name ?? "Select workspace");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-8 justify-between gap-2 border-rule bg-bright text-ink",
            props.className,
          )}
          disabled={query.isPending || workspaces.length === 0}
          aria-label="Switch workspace"
        >
          <span className="min-w-0 truncate text-sm">{triggerLabel}</span>
          <ChevronsUpDown
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden
            strokeWidth={1.5}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel className="text-2xs text-muted-foreground">
          Workspaces
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((w) => (
          <DropdownMenuItem
            key={w.id}
            onSelect={() => select(w.id)}
            className="gap-2"
          >
            <Check
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                w.id === selectedId ? "text-ink" : "opacity-0",
              )}
              aria-hidden
              strokeWidth={1.5}
            />
            <span className="min-w-0 flex-1 truncate text-sm text-ink">
              {w.name}
            </span>
            <span className="shrink-0 text-2xs text-muted-foreground">
              {ROLE_LABEL[w.role]}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {/* /workspaces was direct-URL-only before this row existed — the
            switcher is the one place the destination naturally belongs. */}
        <DropdownMenuItem asChild>
          <Link
            href="/workspaces"
            className="text-sm text-muted-foreground"
          >
            Manage workspaces
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
