"use client";

/**
 * edit-params-control.tsx — EditParamsControl: the toolbar's
 * `SlidersHorizontal` icon-button entry point for PANL-02 (Parameter Editor
 * Popover, 52-UI-SPEC.md Component 2).
 *
 * INTERFACE-FIRST SKELETON — full implementation lands in Plan 52-03 / 52-04
 * / 52-06 (this phase). Do not defer. Implements the full
 * `PanelActionControlProps` contract so that follow-up plan can build
 * directly against it without ever re-touching the toolbar or the panel
 * node; renders inert (always `disabled`) so no placeholder mutation risk
 * exists in the meantime.
 */

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@polytoken/ui/tooltip";

import type { PanelActionControlProps } from "../panel-overlay-context";
import { PANEL_ACTION_ICON_BUTTON_CLASS } from "./panel-action-button-class";

export function EditParamsControl(_props: PanelActionControlProps): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Edit parameters"
          disabled
          className={PANEL_ACTION_ICON_BUTTON_CLASS}
        >
          <SlidersHorizontal className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>Edit parameters</TooltipContent>
    </Tooltip>
  );
}
