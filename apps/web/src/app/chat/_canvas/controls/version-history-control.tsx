"use client";

/**
 * version-history-control.tsx — VersionHistoryControl: the toolbar's
 * `History` icon-button entry point for PANL-03 (Version History Popover,
 * 52-UI-SPEC.md Component 4, 52-04-PLAN.md Task 2).
 *
 * Replaces Plan 52-02's inert interface-first skeleton. Minimal list, no
 * diff view (52-CONTEXT.md, locked): a top "Current" row, then
 * `listPriorVersions(overlay)` newest-first with a per-provenance icon+verb
 * (52-UI-SPEC.md's provenance table) + `formatRelativeTime` + a "Restore
 * version" ghost button, or the empty-state copy when no prior version
 * exists.
 *
 * Restore is supersede-never-mutate (`restoreVersion` APPENDS a clone of
 * the target version, it never rewinds/removes anything — panel-overlay.ts).
 * The persist-failure surrogate (`writeOverlay`/`scheduleSave` throwing
 * synchronously) mirrors `pack-switcher.tsx`'s identical test seam — the
 * SAME established pattern from Plan 52-02, not a new one.
 */

import * as React from "react";
import { useState } from "react";
import {
  History,
  Loader2,
  PanelsTopLeft,
  RotateCw,
  SlidersHorizontal,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@polytoken/ui/badge";
import { Button } from "@polytoken/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@polytoken/ui/popover";
import { ScrollArea } from "@polytoken/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@polytoken/ui/tooltip";

import { formatRelativeTime } from "../format-relative-time";
import {
  listPriorVersions,
  restoreVersion,
  type PanelVersion,
  type PanelVersionVerb,
} from "../panel-overlay";
import { usePanelOverlay, type PanelActionControlProps } from "../panel-overlay-context";
import { PANEL_ACTION_ICON_BUTTON_CLASS } from "./panel-action-button-class";

const RESTORE_ERROR_COPY = "Couldn't restore that version — try again.";
const RESTORE_SUCCESS_COPY = "Restored to an earlier version";
const EMPTY_STATE_COPY = "No earlier versions yet — changes will appear here.";

// 52-UI-SPEC.md's provenance icon+verb table — reuses the SAME icon
// vocabulary as the toolbar buttons (one icon set the user learns once).
const VERB_LABELS: Readonly<Record<PanelVersionVerb, string>> = {
  regenerate: "Regenerated",
  retheme: "Re-themed",
  edit: "Edited",
};

const VERB_ICONS: Readonly<Record<PanelVersionVerb, LucideIcon>> = {
  regenerate: RotateCw,
  retheme: Wand2,
  edit: SlidersHorizontal,
};

/** verbFor(generatedBy) — the row's display verb; defensively falls back to
 * "Generated" (never actually reachable — `PanelVersionVerb` is a closed
 * 3-member enum — kept only so a future verb addition degrades instead of
 * rendering `undefined`). */
function verbFor(generatedBy: PanelVersionVerb): string {
  return VERB_LABELS[generatedBy] ?? "Generated";
}

function VersionIcon({
  generatedBy,
  className,
}: {
  readonly generatedBy: PanelVersionVerb;
  readonly className?: string;
}): React.ReactElement {
  const Icon = VERB_ICONS[generatedBy] ?? PanelsTopLeft;
  return <Icon className={className} aria-hidden />;
}

interface VersionRowProps {
  readonly version: PanelVersion;
  readonly isRestoringThisRow: boolean;
  readonly isRestoringAny: boolean;
  readonly onRestore: (versionId: string) => void;
}

function VersionRow({
  version,
  isRestoringThisRow,
  isRestoringAny,
  onRestore,
}: VersionRowProps): React.ReactElement {
  return (
    <li className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2 text-xs">
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <VersionIcon generatedBy={version.generatedBy} className="size-3 shrink-0" />
        <span className="truncate">
          {verbFor(version.generatedBy)} · {formatRelativeTime(version.createdAt)}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 px-2 text-xs"
        disabled={isRestoringAny}
        onClick={() => onRestore(version.id)}
      >
        {isRestoringThisRow ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          "Restore version"
        )}
      </Button>
    </li>
  );
}

export function VersionHistoryControl({
  panelId,
  isLocked,
}: PanelActionControlProps): React.ReactElement {
  const { overlay, writeOverlay } = usePanelOverlay(panelId);
  const [open, setOpen] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const priorVersions = listPriorVersions(overlay);

  function handleRestore(versionId: string): void {
    if (overlay === undefined) return;
    setRestoringId(versionId);

    try {
      writeOverlay(restoreVersion(overlay, versionId));
      setRestoringId(null);
      setOpen(false);
      toast.success(RESTORE_SUCCESS_COPY);
    } catch {
      // Persist failure surrogate (mirrors pack-switcher.tsx) — stays open,
      // offers Retry, never rewinds/removes anything either way (append-only).
      setRestoringId(null);
      toast.error(RESTORE_ERROR_COPY, {
        action: { label: "Retry", onClick: () => handleRestore(versionId) },
      });
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Version history"
              disabled={isLocked}
              className={PANEL_ACTION_ICON_BUTTON_CLASS}
            >
              <History className="size-3.5" aria-hidden />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Version history</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" side="bottom" className="w-80 p-0">
        <div className="border-b border-border/60 px-3 py-2">
          <p className="text-xs font-semibold text-foreground">Version history</p>
        </div>
        <ScrollArea className="max-h-64">
          <ul role="list" aria-label="Panel versions">
            <li className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <PanelsTopLeft className="size-3 shrink-0" aria-hidden />
                Current
              </span>
              <Badge variant="outline" className="shrink-0 px-1 py-0 text-[10px]">
                Current
              </Badge>
            </li>
            {priorVersions.map((version) => (
              <VersionRow
                key={version.id}
                version={version}
                isRestoringThisRow={restoringId === version.id}
                isRestoringAny={restoringId !== null}
                onRestore={handleRestore}
              />
            ))}
            {priorVersions.length === 0 && (
              <li className="px-3 py-4 text-center text-xs text-muted-foreground">
                {EMPTY_STATE_COPY}
              </li>
            )}
          </ul>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
