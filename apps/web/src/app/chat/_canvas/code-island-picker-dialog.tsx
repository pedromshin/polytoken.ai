"use client";

/**
 * code-island-picker-dialog.tsx — "Your tools" (Phase 76 / 76-04c). The summon
 * loop BUILDS bespoke apps; this lets you RE-DROP one you already built back onto
 * the canvas. It lists the caller's saved islands (`codeIslands.list`,
 * owner-scoped server-side) and on select places a `code-island` node with just
 * an `islandId` ref — the node rehydrates its code + wired inputs via
 * `codeIslands.byId`, exactly as a freshly-summoned one does.
 *
 * A Dialog (opened via `requestOpenNonce`), NOT another always-visible Panel
 * button — the entry point is the Add-node menu's "Your tools…" item, so this
 * adds no chrome to the canvas toolbar (mirrors BuildToolDialog's pattern).
 *
 * The island's `intent` is the user's OWN words, so it renders SERIF +
 * data-evidence (58-IDENTITY law 2); the relative time is polytoken's chrome,
 * sans + faded. Loading → empty → list, the established branch order.
 */

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Boxes } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@polytoken/ui/dialog";
import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";

import { formatRelativeTime } from "./format-relative-time";

export interface CodeIslandPickerDialogProps {
  /** Place a code-island node for the selected saved island id. */
  readonly onAdd: (islandId: string) => void;
  /** A monotonically-changing nonce the Add-node menu bumps to open this picker
   * ("Your tools…"); the initial value never auto-opens. */
  readonly requestOpenNonce?: number;
}

/** Coerce a Date | ISO string (drizzle/superjson can hand back either) into the
 * ISO string `formatRelativeTime` expects. */
function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
  }
  return new Date(0).toISOString();
}

export function CodeIslandPickerDialog({
  onAdd,
  requestOpenNonce,
}: CodeIslandPickerDialogProps): React.ReactElement {
  const [open, setOpen] = useState(false);

  const lastNonceRef = useRef(requestOpenNonce);
  useEffect(() => {
    if (requestOpenNonce !== undefined && requestOpenNonce !== lastNonceRef.current) {
      lastNonceRef.current = requestOpenNonce;
      setOpen(true);
    }
  }, [requestOpenNonce]);

  const query = api.codeIslands.list.useQuery(undefined, { enabled: open });
  const tools = query.data ?? [];

  function handleSelect(islandId: string): void {
    onAdd(islandId);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="size-4 shrink-0 text-faded" aria-hidden />
            Your tools
          </DialogTitle>
          <DialogDescription>
            Drop a tool you&apos;ve already built back onto the canvas. It
            rehydrates and re-wires to its data.
          </DialogDescription>
        </DialogHeader>

        <div className="nowheel max-h-[50vh] overflow-y-auto">
          {query.isPending ? (
            <div role="status" aria-label="Loading tools" className="flex flex-col gap-2 py-1">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-5/6" />
            </div>
          ) : query.isError ? (
            <p className="px-1 py-6 text-center text-xs text-faded">
              Couldn&apos;t load your tools. Try again.
            </p>
          ) : tools.length === 0 ? (
            <p className="px-1 py-6 text-center text-xs text-faded">
              No tools yet. Select 2+ data nodes and choose{" "}
              <span className="text-ink">Build a tool from these</span>.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {tools.map((tool) => (
                <li key={tool.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(tool.id)}
                    className="flex w-full flex-col items-start gap-0.5 rounded-sm border border-hair px-2.5 py-2 text-left transition-colors hover:bg-ink-08 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  >
                    <span
                      className="line-clamp-2 font-serif text-sm text-ink"
                      data-evidence
                    >
                      {tool.intent}
                    </span>
                    <span className="text-2xs text-faded tabular">
                      {formatRelativeTime(toIso(tool.updatedAt))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
