"use client";

// Explicit React import — Next.js's SWC automatic JSX runtime tolerates its
// absence, but vitest's classic-runtime esbuild JSX transform needs `React`
// in scope for any suite that mounts this file directly (documented gotcha,
// see model-picker.tsx / genui-panel-node.tsx / 53-03 / 53-04's identical fix).
import * as React from "react";
import { useState } from "react";
import { Mail } from "lucide-react";

import type { RouterOutputs } from "@polytoken/api-client";
import { Button } from "@polytoken/ui/button";

import { CANVAS_PANEL_BUTTON_CLASS } from "./canvas-panel-button-class";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@polytoken/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@polytoken/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@polytoken/ui/tooltip";

import { api } from "~/trpc/react";

import { formatRelativeTime } from "./format-relative-time";

export interface AddEmailThreadPopoverProps {
  readonly onAdd: (threadId: string) => void;
  /** A monotonically-changing nonce the pane context menu bumps to open this
   * popover programmatically (CI-01 "Add node ▸ Email thread"); the initial
   * value never auto-opens. */
  readonly requestOpenNonce?: number;
}

type ThreadListItem = RouterOutputs["emails"]["listThreads"]["items"][number];
type SelectableThread = ThreadListItem & { readonly threadId: string };

/**
 * toIsoString — `latestReceivedAt` is typed `Date` server-side (list-threads.ts)
 * but may arrive client-side as either a hydrated `Date` (superjson) or a
 * plain string, depending on the transport — the same defensive `Date |
 * string` posture inbox-thread-group.tsx's own `formatDate` already applies
 * to this exact field. `formatRelativeTime` (format-relative-time.ts) is
 * reused verbatim (52-UI-SPEC.md's named relative-time vocabulary,
 * 54-UI-SPEC.md instruction) rather than duplicated — this local helper only
 * normalizes the input type, never re-implements the formatting itself.
 */
function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * hasThreadId — threads with `threadId === null` (a pre-backfill singleton,
 * see list-threads.ts's `singletonKey`) are excluded from the picker: there
 * is no thread to link against, and `EmailThreadNodeDataSchema.threadId` is
 * a required uuid (54-UI-SPEC.md Component 2).
 */
function hasThreadId(thread: ThreadListItem): thread is SelectableThread {
  return thread.threadId !== null;
}

/**
 * AddEmailThreadPopover — the "Add thread" picker (CLUS-01, 54-UI-SPEC.md
 * Component 2). Reuses `ModelPicker`'s exact `Popover` + `Command`
 * composition (`.t-dropdown-reveal` transition, select-to-close) — a
 * search-select list, not a manual-paste form (diverges deliberately from
 * `AddKnowledgePreviewPopover`'s precedent, Judgment Call #5): 54-CONTEXT.md
 * explicitly specifies "a thread picker listing the user's threads," and
 * `emails.listThreads` already returns exactly the rows a picker needs.
 */
export function AddEmailThreadPopover({
  onAdd,
  requestOpenNonce,
}: AddEmailThreadPopoverProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  // Open when the host bumps the nonce (skip the initial mount value).
  const lastNonceRef = React.useRef(requestOpenNonce);
  React.useEffect(() => {
    if (requestOpenNonce !== undefined && requestOpenNonce !== lastNonceRef.current) {
      lastNonceRef.current = requestOpenNonce;
      setOpen(true);
    }
  }, [requestOpenNonce]);
  const { data } = api.emails.listThreads.useQuery({});
  const threads: readonly SelectableThread[] = (data?.items ?? []).filter(hasThreadId);

  function handleSelect(threadId: string): void {
    onAdd(threadId);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Add thread"
                className={CANVAS_PANEL_BUTTON_CLASS}
              >
                <Mail className="size-4" aria-hidden />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Add thread</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        align="end"
        className="w-[26rem] p-0 data-[state=open]:animate-none data-[state=closed]:animate-none"
      >
        <div className="t-dropdown-reveal">
          <p className="px-3 pt-3 text-xs font-semibold text-foreground">Add a thread</p>
          <Command>
            <CommandInput placeholder="Search your threads…" />
            <CommandList>
              <CommandEmpty>No threads found.</CommandEmpty>
              {threads.map((thread) => (
                <CommandItem
                  key={thread.threadId}
                  value={thread.subject ?? "Untitled thread"}
                  onSelect={() => handleSelect(thread.threadId)}
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-xs font-normal text-foreground">
                      {thread.subject ?? "Untitled thread"}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {thread.messageCount} message{thread.messageCount === 1 ? "" : "s"} ·{" "}
                      {formatRelativeTime(toIsoString(thread.latestReceivedAt))}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </div>
      </PopoverContent>
    </Popover>
  );
}
