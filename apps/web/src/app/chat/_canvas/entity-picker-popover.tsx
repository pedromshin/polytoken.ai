"use client";

// Explicit React import — vitest's classic-runtime esbuild JSX transform needs
// `React` in scope for any suite that mounts this file directly (documented
// gotcha, mirrors add-email-thread-popover.tsx).
import * as React from "react";
import { useState } from "react";
import { Box } from "lucide-react";

import { Button } from "@polytoken/ui/button";
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

import { CANVAS_PANEL_BUTTON_CLASS } from "./canvas-panel-button-class";

export interface EntityPickerPopoverProps {
  /** Place an entity node for the selected entity id. */
  readonly onAdd: (entityId: string) => void;
  /** A monotonically-changing nonce the Add-node menu bumps to open this picker
   * programmatically ("Add node ▸ Entity…"); the initial value never auto-opens. */
  readonly requestOpenNonce?: number;
}

/**
 * EntityPickerPopover — the "Add entity" picker. Mirrors AddEmailThreadPopover's
 * exact Popover + Command composition (search-select list, select-to-close): it
 * lists the caller's CONFIRMED entities via `api.entities.list` (owner-scoped
 * server-side, TENA-03) and on select places an entity node with data
 * `{ entityId }`. The card itself rehydrates name/type/aliases via entities.byId.
 */
export function EntityPickerPopover({
  onAdd,
  requestOpenNonce,
}: EntityPickerPopoverProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Open when the host bumps the nonce (skip the initial mount value).
  const lastNonceRef = React.useRef(requestOpenNonce);
  React.useEffect(() => {
    if (requestOpenNonce !== undefined && requestOpenNonce !== lastNonceRef.current) {
      lastNonceRef.current = requestOpenNonce;
      setOpen(true);
    }
  }, [requestOpenNonce]);

  const { data } = api.entities.list.useQuery(
    {
      status: "confirmed",
      limit: 25,
      ...(search.trim().length > 0 ? { search: search.trim() } : {}),
    },
    { enabled: open },
  );
  const entities = data?.items ?? [];

  function handleSelect(entityId: string): void {
    onAdd(entityId);
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
                aria-label="Add entity"
                className={CANVAS_PANEL_BUTTON_CLASS}
              >
                <Box className="size-4" aria-hidden />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Add entity</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        align="end"
        className="w-[26rem] p-0 data-[state=open]:animate-none data-[state=closed]:animate-none"
      >
        <div className="t-dropdown-reveal">
          <p className="px-3 pt-3 text-xs font-semibold text-foreground">Add an entity</p>
          {/* `shouldFilter={false}` — the server already filters by `search`, so
              the Command list must not additionally client-filter it away. */}
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search your entities…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>No entities found.</CommandEmpty>
              {entities.map((entity) => (
                <CommandItem
                  key={entity.id}
                  value={entity.id}
                  onSelect={() => handleSelect(entity.id)}
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-xs font-normal text-foreground">
                      {entity.displayName}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {entity.entityTypeLabel ?? entity.entityTypeId}
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
