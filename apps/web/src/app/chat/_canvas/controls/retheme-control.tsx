"use client";

/**
 * retheme-control.tsx — RethemeControl: the toolbar's `Wand2` icon-button
 * entry point for PANL-04's NL Re-theme Popover (52-UI-SPEC.md Component 5,
 * 52-06-PLAN.md Task 1).
 *
 * Replaces Plan 52-02's inert interface-first skeleton. A bounded
 * (≤280-char) natural-language instruction resolves, via the Plan 52-05
 * `genui.resolveRetheme` tRPC procedure (a `.query()` — same D-06 manual
 * `useQuery(..., { enabled: false })` + `refetch()` idiom
 * `regenerate-control.tsx` uses for `genui.generate`), to a
 * `{ stylePackId, tokenOverrides }` envelope. On success the CURRENT
 * content spec (`activeSpecJson`, unchanged) is appended as a new `retheme`
 * version carrying that pack + overrides via `appendVersion` — a re-theme
 * changes look, never content. One-shot (no repair loop, no screenshot
 * judging — locked): a failed/invalid resolution shows the inline error
 * banner with the popover open and the typed instruction preserved — never
 * a partial or silent apply.
 */

import * as React from "react";
import { useState } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";

import type { StylePackId } from "@polytoken/genui/theme";

import { Button } from "@polytoken/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@polytoken/ui/popover";
import { Textarea } from "@polytoken/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@polytoken/ui/tooltip";

import { api } from "~/trpc/react";

import { appendVersion } from "../panel-overlay";
import { usePanelOverlay, type PanelActionControlProps } from "../panel-overlay-context";
import { PANEL_ACTION_ICON_BUTTON_CLASS } from "./panel-action-button-class";

const INSTRUCTION_MAX_LENGTH = 280;

const RETHEME_ERROR_COPY = "Couldn't apply that look — try describing it differently.";
const RETHEME_SUCCESS_COPY = "Panel re-themed";

export function RethemeControl({
  panelId,
  activeSpecJson,
  resolvedPackId,
  isLocked,
  onBusyChange,
  onGeneratingChange,
}: PanelActionControlProps): React.ReactElement {
  const { overlay, writeOverlay } = usePanelOverlay(panelId);

  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [inlineError, setInlineError] = useState(false);

  // D-06-style manual trigger (mirrors regenerate-control.tsx's identical
  // genui.generate usage): enabled:false, refetch() on Apply click only.
  const q = api.genui.resolveRetheme.useQuery(
    { instruction, currentStylePackId: resolvedPackId },
    { enabled: false },
  );

  function handleOpenChange(nextOpen: boolean): void {
    if (nextOpen) {
      setInstruction("");
      setInlineError(false);
    }
    setOpen(nextOpen);
  }

  function handleDiscard(): void {
    setInstruction("");
    setInlineError(false);
    setOpen(false);
  }

  function handleInstructionChange(value: string): void {
    // Defense-in-depth alongside the Textarea's own `maxLength` HTML
    // attribute (which only constrains real keystroke/paste input, not a
    // programmatic value assignment) — keeps the client-side bound aligned
    // with the tRPC input schema's own `z.string().max(280)` gate.
    setInstruction(value.slice(0, INSTRUCTION_MAX_LENGTH));
  }

  async function handleApply(): Promise<void> {
    setInlineError(false);
    setIsPending(true);
    onBusyChange(true);
    onGeneratingChange(true);

    const result = await q.refetch();
    const data = result.data;

    if (data !== undefined && data.ok && data.stylePackId !== undefined) {
      writeOverlay(
        appendVersion(overlay, {
          generatedBy: "retheme",
          // Re-theme changes look, not content — the CURRENT active content
          // spec is carried forward unchanged into the new version.
          specJson: activeSpecJson,
          stylePackId: data.stylePackId as StylePackId,
          tokenOverrides: data.tokenOverrides,
          instruction,
        }),
      );
      setInstruction("");
      setOpen(false);
      toast.success(RETHEME_SUCCESS_COPY);
    } else {
      // Never a partial/silent apply — popover stays open, instruction preserved.
      setInlineError(true);
    }

    setIsPending(false);
    onBusyChange(false);
    onGeneratingChange(false);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Re-theme"
              disabled={isLocked}
              className={PANEL_ACTION_ICON_BUTTON_CLASS}
            >
              <Wand2 className="size-3.5" aria-hidden />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Re-theme</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" side="bottom" className="w-72 space-y-3">
        <p className="text-xs font-semibold text-foreground">Describe a new look</p>
        {inlineError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
          >
            {RETHEME_ERROR_COPY}
          </div>
        )}
        <div className="space-y-1">
          <Textarea
            rows={3}
            maxLength={INSTRUCTION_MAX_LENGTH}
            readOnly={isPending}
            placeholder='e.g. "Make it feel more playful and colorful"'
            value={instruction}
            onChange={(event) => handleInstructionChange(event.target.value)}
          />
          <p className="text-right text-xs text-muted-foreground">
            {instruction.length}/{INSTRUCTION_MAX_LENGTH}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={handleDiscard}>
            Discard
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={instruction.trim().length === 0 || isPending}
            onClick={() => {
              void handleApply();
            }}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
                Re-theming…
              </>
            ) : (
              <>
                <Wand2 className="mr-1 size-3.5" aria-hidden />
                Apply look
              </>
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
