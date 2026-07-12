"use client";

/**
 * panel-actions-toolbar.tsx — PanelActionsToolbar: the panel toolbar chrome
 * mount point every PANL-01..04 entry point shares (52-UI-SPEC.md Component
 * 1, 52-02-PLAN.md Task 1).
 *
 * A new h-8 non-drag SECOND header row (Judgment Call #1 — NOT part of the
 * existing h-9 `.node-drag-handle` row; 26-UI-SPEC FIX-04 stays untouched):
 * left slot is the pack-switcher `Select` (PANL-01, wired end-to-end this
 * plan); right slot is the 4-action icon-button cluster (edit/regenerate/
 * re-theme/history — PANL-02/03/04), shipped this plan as interface-first
 * skeletons so Plans 52-03/52-04/52-06 can each implement one control
 * without ever re-touching this toolbar or the panel node.
 *
 * Owns the per-panel mutual-exclusion lock (`busyAction`) every control
 * shares via `PanelActionControlProps.isLocked`/`onBusyChange`: while any
 * one action (or the pack switch) is pending, every OTHER control is
 * locked, but the in-flight one keeps its own busy affordance instead of
 * the dimmed-disabled state. `isStreaming` force-locks every control
 * (including the pack switcher) — a stale edit must never race a live
 * regenerate-in-progress stream (mirrors `resolveActivePanel`'s own
 * streaming-always-wins posture).
 */

import * as React from "react";
import { useCallback, useState } from "react";

import { TooltipProvider } from "@polytoken/ui/tooltip";

import type { StylePackId } from "@polytoken/genui/theme";

import type { Provenance } from "./node-data-schemas";
import type { PanelActionControlProps, PanelActionId } from "./panel-overlay-context";
import { PackSwitcher } from "./controls/pack-switcher";
import { EditParamsControl } from "./controls/edit-params-control";
import { RegenerateControl } from "./controls/regenerate-control";
import { RethemeControl } from "./controls/retheme-control";
import { VersionHistoryControl } from "./controls/version-history-control";

export interface PanelActionsToolbarProps {
  readonly panelId: string;
  readonly provenance: Provenance;
  readonly activeSpecJson: string;
  readonly resolvedPackId: StylePackId;
  /** True while the panel's base spec is still streaming — every control
   * (including the pack switcher) is force-locked. */
  readonly isStreaming?: boolean;
  /** Forwards this toolbar's own `generating` signal up to the panel node
   * shell, which wraps its content in `<GeneratingRing>` while true
   * (Judgment Call #5) — the toolbar itself never renders the ring. */
  readonly onGeneratingChange?: (on: boolean) => void;
}

type NonPackActionId = Exclude<PanelActionId, "pack">;

const ACTION_IDS: readonly NonPackActionId[] = ["edit", "regenerate", "retheme", "history"];

const ACTION_CONTROLS: Record<NonPackActionId, React.ComponentType<PanelActionControlProps>> = {
  edit: EditParamsControl,
  regenerate: RegenerateControl,
  retheme: RethemeControl,
  history: VersionHistoryControl,
};

export function PanelActionsToolbar({
  panelId,
  provenance,
  activeSpecJson,
  resolvedPackId,
  isStreaming = false,
  onGeneratingChange,
}: PanelActionsToolbarProps): React.ReactElement {
  const [busyAction, setBusyAction] = useState<PanelActionId | null>(null);

  const isLockedFor = useCallback(
    (actionId: PanelActionId): boolean =>
      isStreaming || (busyAction !== null && busyAction !== actionId),
    [isStreaming, busyAction],
  );

  return (
    <div
      role="toolbar"
      aria-label="Panel actions"
      className="flex h-8 shrink-0 items-center justify-between gap-1 border-b border-border/60 bg-background px-2"
    >
      <PackSwitcher
        panelId={panelId}
        resolvedPackId={resolvedPackId}
        isLocked={isLockedFor("pack")}
        onBusyChange={(busy) => setBusyAction(busy ? "pack" : null)}
      />
      <TooltipProvider delayDuration={300}>
        <div className="flex items-center gap-1">
          {ACTION_IDS.map((actionId) => {
            const Control = ACTION_CONTROLS[actionId];
            return (
              <Control
                key={actionId}
                panelId={panelId}
                provenance={provenance}
                activeSpecJson={activeSpecJson}
                resolvedPackId={resolvedPackId}
                isLocked={isLockedFor(actionId)}
                onBusyChange={(busy) => setBusyAction(busy ? actionId : null)}
                onGeneratingChange={(on) => onGeneratingChange?.(on)}
              />
            );
          })}
        </div>
      </TooltipProvider>
    </div>
  );
}
