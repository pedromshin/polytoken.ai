"use client";

/**
 * version-history-control.tsx — VersionHistoryControl: the toolbar's
 * `History` icon-button entry point for PANL-03 (Version History Popover,
 * 52-UI-SPEC.md Component 4).
 *
 * INTERFACE-FIRST SKELETON — full implementation lands in Plan 52-03 / 52-04
 * / 52-06 (this phase). Do not defer. Implements the full
 * `PanelActionControlProps` contract so that follow-up plan can build
 * directly against it without ever re-touching the toolbar or the panel
 * node; renders inert (always `disabled`) so no placeholder mutation risk
 * exists in the meantime.
 */

import * as React from "react";
import { History } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@polytoken/ui/tooltip";

import type { PanelActionControlProps } from "../panel-overlay-context";
import { PANEL_ACTION_ICON_BUTTON_CLASS } from "./panel-action-button-class";

export function VersionHistoryControl(_props: PanelActionControlProps): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Version history"
          disabled
          className={PANEL_ACTION_ICON_BUTTON_CLASS}
        >
          <History className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>Version history</TooltipContent>
    </Tooltip>
  );
}
