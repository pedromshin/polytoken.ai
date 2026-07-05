"use client";

/**
 * interactive-widget-boundary.tsx — InteractiveWidgetBoundary: the state
 * chrome (badges/submitting/error rows) around the UNMODIFIED SpecRenderer
 * path (Task 2, 24-03 — D-05/D-06/D-10/D-11/D-12).
 *
 * pending    — the live catalog spec (buildProposalCardsSpec) via
 *              GenuiPartBoundary, with a `setState` actions registry that
 *              calls onSubmitOption(optionId) on a real DOM click. No badge
 *              (24-UI-SPEC.md Design Decision 4 — the unmarked common case).
 * submitting — the SAME live spec, wrapped in a pointer-events-none group
 *              (cosmetic per D-11) plus a Loader2 "Submitting…" row; actions
 *              are a noop (the server round-trip is the real gate).
 * submitted  — REPLACES the live spec entirely (SpecRenderer output can't be
 *              reliably per-card styled from outside without fragile DOM
 *              selectors): the chosen option renders as one
 *              ring+wash+"Selected"-badged card, every other option renders
 *              as a plain dimmed (opacity-50, aria-disabled) title/description
 *              row — matching D-06 without per-node style injection.
 * superseded/stale — keeps the live spec rendered (buttons present but
 *              inert, cosmetic per D-11 — the server lock is authoritative)
 *              inside an opacity-50 pointer-events-none aria-disabled
 *              container carrying the matching badge + caption.
 *
 * Uses GenuiPartBoundary (never SpecRenderer directly) for every state that
 * still shows the live spec — the same FOUND-6 safeParse gate every other
 * genui part goes through. Consumes the SAME `variant` prop identically
 * (Component Inventory) so this new chrome never re-introduces a fourth
 * nesting layer inside a canvas panel (23-UI-REVIEW Top Fix #1).
 */

import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import type { ActionRegistry } from "@nauta/genui/renderer";

import {
  buildProposalCardsSpec,
  PROPOSAL_CHOICE_ACTION_KEY,
  type ProposalCardsDeclaration,
} from "./build-proposal-cards-spec";
import { GenuiPartBoundary } from "./genui-part-boundary";
import { WidgetStatusBadge } from "./widget-status-badge";

export type WidgetDisplayState =
  | "pending"
  | "submitting"
  | "submitted"
  | "superseded"
  | "stale";

export interface InteractiveWidgetPart {
  readonly type: "interactive_widget";
  readonly interactionId: string;
  readonly widgetKind: string;
  readonly declaration: ProposalCardsDeclaration;
}

export interface InteractiveWidgetBoundaryProps {
  readonly part: InteractiveWidgetPart;
  readonly displayState: WidgetDisplayState;
  readonly submittedValue?: { readonly optionId: string };
  readonly errorMessage?: string | null;
  readonly onSubmitOption: (optionId: string) => void;
  /** Same contract as GenuiPartBoundary's own variant — "bare" for canvas
   * panels (their own node shell is the one surviving border), "default"
   * (unset) for the transcript. */
  readonly variant?: "default" | "bare";
  readonly data?: Record<string, unknown>;
}

// Copy strings — verbatim per 24-UI-SPEC.md Copywriting Contract.
const SUPERSEDED_CAPTION = "You replied by typing instead.";
const STALE_CAPTION = "This is no longer the active response.";

const NOOP_ACTIONS: ActionRegistry = Object.freeze({});

function isValidChoicePayload(action: unknown): action is { key: string; value: string } {
  if (action === null || typeof action !== "object") return false;
  const record = action as { key?: unknown; value?: unknown };
  return record.key === PROPOSAL_CHOICE_ACTION_KEY && typeof record.value === "string";
}

function ErrorRow({ message }: { readonly message: string }): React.ReactElement {
  // Unboxed (Design Decision 3) — icon + text only, no border/background of
  // its own; it already lives inside one bordering layer (GenuiCard or the
  // bare node shell).
  return (
    <div role="alert" className="mb-2 flex items-center gap-2">
      <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
      <span className="text-sm text-destructive">{message}</span>
    </div>
  );
}

function SubmittingRow(): React.ReactElement {
  return (
    <div className="mt-2 flex items-center gap-2 text-muted-foreground">
      <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
      <span className="text-sm">Submitting…</span>
    </div>
  );
}

/** The submitted (locked) view — bypasses SpecRenderer entirely (see module
 * doc): the chosen option is one ring+wash+badge card, every other option is
 * a plain dimmed row. */
function SubmittedProposalView({
  declaration,
  chosenOptionId,
}: {
  readonly declaration: ProposalCardsDeclaration;
  readonly chosenOptionId: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      {declaration.options.map((option) => {
        const isChosen = option.id === chosenOptionId;
        return (
          <div
            key={option.id}
            className={
              isChosen
                ? "flex flex-col gap-1 rounded-lg bg-primary/5 p-4 ring-2 ring-primary ring-offset-1"
                : "flex flex-col gap-1 rounded-lg p-4 opacity-50"
            }
            aria-disabled={isChosen ? undefined : true}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-base font-semibold">{option.title}</span>
              {isChosen && <WidgetStatusBadge kind="selected" />}
            </div>
            {option.description !== undefined && (
              <span className="text-sm text-muted-foreground">{option.description}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function InteractiveWidgetBoundary({
  part,
  displayState,
  submittedValue,
  errorMessage,
  onSubmitOption,
  variant = "default",
  data,
}: InteractiveWidgetBoundaryProps): React.ReactElement {
  const captionId = `widget-caption-${part.interactionId}`;
  const declaration = part.declaration;
  const groupAriaLabel =
    declaration.prompt !== undefined && declaration.prompt.length > 0
      ? declaration.prompt
      : "Choose an option";

  if (displayState === "submitted") {
    return (
      <SubmittedProposalView
        declaration={declaration}
        chosenOptionId={submittedValue?.optionId ?? ""}
      />
    );
  }

  const isDimmed = displayState === "superseded" || displayState === "stale";
  const isSubmitting = displayState === "submitting";
  const isLive = displayState === "pending";

  const liveActions: ActionRegistry = {
    setState: (action?: unknown) => {
      if (isValidChoicePayload(action)) {
        onSubmitOption(action.value);
      }
    },
  };
  const actions = isLive ? liveActions : NOOP_ACTIONS;

  const specJson = JSON.stringify(buildProposalCardsSpec(declaration));

  const groupClassName = isSubmitting
    ? "pointer-events-none"
    : isDimmed
      ? "pointer-events-none opacity-50"
      : undefined;

  return (
    <div>
      {errorMessage && <ErrorRow message={errorMessage} />}
      {isDimmed && (
        <div className="mb-2">
          <WidgetStatusBadge kind={displayState === "superseded" ? "superseded" : "stale"} />
          <p id={captionId} className="mt-1 text-sm text-muted-foreground">
            {displayState === "superseded" ? SUPERSEDED_CAPTION : STALE_CAPTION}
          </p>
        </div>
      )}
      <div
        role="group"
        aria-label={groupAriaLabel}
        className={groupClassName}
        aria-disabled={isDimmed ? true : undefined}
        aria-describedby={isDimmed ? captionId : undefined}
      >
        <GenuiPartBoundary
          specJson={specJson}
          isStreaming={false}
          data={data}
          actions={actions}
          variant={variant}
        />
      </div>
      {isSubmitting && <SubmittingRow />}
    </div>
  );
}
