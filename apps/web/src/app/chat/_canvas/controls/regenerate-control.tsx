"use client";

/**
 * regenerate-control.tsx — RegenerateControl: the toolbar's `RotateCw`
 * icon-button entry point for PANL-03's one-click regenerate action
 * (52-UI-SPEC.md Component 3).
 *
 * INTERFACE-FIRST SKELETON — full implementation lands in Plan 52-03 / 52-04
 * / 52-06 (this phase). Do not defer. Implements the full
 * `PanelActionControlProps` contract so that follow-up plan can build
 * directly against it without ever re-touching the toolbar or the panel
 * node; renders inert (always `disabled`) so no placeholder mutation risk
 * exists in the meantime.
 */

import * as React from "react";
import { RotateCw } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@polytoken/ui/tooltip";

import type { PanelActionControlProps } from "../panel-overlay-context";
import { PANEL_ACTION_ICON_BUTTON_CLASS } from "./panel-action-button-class";

export function RegenerateControl(_props: PanelActionControlProps): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Regenerate"
          disabled
          className={PANEL_ACTION_ICON_BUTTON_CLASS}
        >
          <RotateCw className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>Regenerate</TooltipContent>
    </Tooltip>
  );
}
