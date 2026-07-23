"use client";

/**
 * interactive-widget-boundary.tsx — InteractiveWidgetBoundary: the state
 * chrome (badges/submitting/error rows) around the UNMODIFIED SpecRenderer
 * path (24-03 Task 2, 24-04 Task 3 — D-05/D-06/D-09/D-10/D-11/D-12/D-16).
 *
 * Generalized over widgetKind (Phase 24-04): proposal_cards (24-03) and
 * clarify_widget (24-04) share the SAME state-chrome machinery
 * (pending/submitting/submitted/superseded/stale, error row, variant prop) —
 * only the LIVE spec builder, the submitted (locked) view, and the
 * setState -> onSubmitResult mapping differ per kind. `onSubmitResult` fires
 * with the schema-conforming result body the 24-02 submit endpoint expects
 * opaquely — `{optionId}` for proposal_cards, the FLAT field-name map (e.g.
 * `{reason, subscribe}`) for clarify_widget: the listener derives a flat
 * response schema with additionalProperties:false, so a `{values:{...}}`
 * wrapper would 422.
 *
 * pending    — the live catalog spec (proposal cards OR the unmodified
 *              Phase-19 form engine) via GenuiPartBoundary, with a `setState`
 *              actions registry that calls onSubmitResult(result) on a real
 *              DOM interaction. No badge (24-UI-SPEC.md Design Decision 4).
 * submitting — the SAME live spec, wrapped in a pointer-events-none group
 *              (cosmetic per D-11) plus a Loader2 "Submitting…" row; actions
 *              are a noop (the server round-trip is the real gate).
 * submitted  — REPLACES the live spec entirely:
 *                proposal_cards: the chosen option renders as one
 *                  ring+wash+"Selected"-badged card, every other option
 *                  renders as a plain dimmed (opacity-50, aria-disabled) row
 *                  (D-06) — SpecRenderer output can't be reliably per-card
 *                  styled from outside without fragile DOM selectors.
 *                clarify_widget: the ENTIRE live form is replaced by the
 *                  "Your response" heading + Submitted badge + the
 *                  key-value-list read-out of the submitted values (D-16,
 *                  Design Decision 6) — rendered through GenuiPartBoundary,
 *                  the SAME FOUND-6 gate, not a hand-rolled <dl>.
 * superseded/stale — keeps the live spec rendered (buttons/controls present
 *              but inert, cosmetic per D-11 — the server lock is authoritative)
 *              inside an opacity-50 pointer-events-none aria-disabled
 *              container carrying the matching badge + caption.
 *
 * Uses GenuiPartBoundary (never SpecRenderer directly) for every state that
 * still shows the live spec — the same FOUND-6 safeParse gate every other
 * genui part goes through. Consumes the SAME `variant` prop identically
 * (Component Inventory) so this chrome never re-introduces a fourth nesting
 * layer inside a canvas panel (23-UI-REVIEW Top Fix #1).
 */

import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import type { ActionRegistry } from "@polytoken/genui/renderer";

import {
  buildClarifySubmittedSpec,
  buildClarifyWidgetSpec,
  CLARIFY_SUBMIT_ACTION_KEY,
  type ClarifyWidgetDeclaration,
} from "./build-clarify-widget-spec";
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

/** Either widget kind this boundary knows how to render — generic over
 * widgetKind (24-04): the declaration's own shape disambiguates (proposal
 * cards always have `options`, clarify widgets always have `submitLabel` +
 * `fields`), but callers/tests always know which kind they're passing via
 * `part.widgetKind`, so this boundary branches on that string instead. */
export type WidgetDeclaration = ProposalCardsDeclaration | ClarifyWidgetDeclaration;

export interface InteractiveWidgetPart {
  readonly type: "interactive_widget";
  readonly interactionId: string;
  readonly widgetKind: string;
  readonly declaration: WidgetDeclaration;
}

export interface InteractiveWidgetBoundaryProps {
  readonly part: InteractiveWidgetPart;
  readonly displayState: WidgetDisplayState;
  /** The raw submitted_value payload (opaque per widgetKind) — proposal_cards
   * stores `{optionId}`, clarify_widget stores the flat field-name map
   * (the same shape sent to the listener). */
  readonly submittedValue?: Readonly<Record<string, unknown>>;
  readonly errorMessage?: string | null;
  readonly onSubmitResult: (result: Readonly<Record<string, unknown>>) => void;
  /** Same contract as GenuiPartBoundary's own variant — "bare" for canvas
   * panels (their own node shell is the one surviving border), "default"
   * (unset) for the transcript. */
  readonly variant?: "default" | "bare";
  readonly data?: Record<string, unknown>;
}

// Copy strings — verbatim per 24-UI-SPEC.md Copywriting Contract.
const SUPERSEDED_CAPTION = "You replied by typing instead.";
const STALE_CAPTION = "This is no longer the active response.";
const YOUR_RESPONSE_HEADING = "Your response";

const NOOP_ACTIONS: ActionRegistry = Object.freeze({});

function isValidChoicePayload(action: unknown): action is { key: string; value: string } {
  if (action === null || typeof action !== "object") return false;
  const record = action as { key?: unknown; value?: unknown };
  return record.key === PROPOSAL_CHOICE_ACTION_KEY && typeof record.value === "string";
}

function isValidClarifySubmitPayload(
  action: unknown,
): action is { key: string; values: Readonly<Record<string, unknown>> } {
  if (action === null || typeof action !== "object") return false;
  const record = action as { key?: unknown; values?: unknown };
  return (
    record.key === CLARIFY_SUBMIT_ACTION_KEY &&
    record.values !== null &&
    typeof record.values === "object"
  );
}

function ErrorRow({ message }: { readonly message: string }): React.ReactElement {
  // Unboxed (Design Decision 3) — icon + text only, no border/background of
  // its own; it already lives inside one bordering layer (GenuiCard or the
  // bare node shell).
  //
  // LAW 1 (61-08): ink, not the irreversible colour. A failed widget submit is a
  // state, and this row is the least "irreversible" thing on the surface — the
  // widget is still sitting there, still submittable. The glyph carries it.
  return (
    <div role="alert" className="mb-2 flex items-center gap-2">
      <AlertTriangle className="size-4 shrink-0 text-ink" aria-hidden />
      <span className="text-sm text-ink">{message}</span>
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

/** The submitted (locked) proposal_cards view — bypasses SpecRenderer entirely (see module
 * doc): the chosen option is one ring+wash+badge card, every other option is a plain dimmed
 * row. */
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
              // Matches the live catalog Card's own chrome (rounded-xl/border/shadow/p-6,
              // packages/ui/src/card.tsx) — 24-05 fix pass (24-UI-REVIEW.md Top Fix #2):
              // the submitted (locked) shell must not lose the Card's container identity
              // at the exact moment a choice locks in.
              isChosen
                ? "flex flex-col gap-1 rounded-xl border border-border bg-primary/5 p-6 shadow ring-2 ring-primary ring-offset-1"
                : "flex flex-col gap-1 rounded-xl border border-border bg-card p-6 shadow opacity-50"
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

/** The submitted (locked) clarify_widget view (D-16, Design Decision 6): the ENTIRE live form
 * is replaced by a "Your response" heading + Submitted badge + the key-value-list read-out —
 * rendered through GenuiPartBoundary (the same FOUND-6 gate), not a hand-rolled <dl>. */
function SubmittedClarifyView({
  declaration,
  values,
  variant,
}: {
  readonly declaration: ClarifyWidgetDeclaration;
  readonly values: Readonly<Record<string, unknown>>;
  readonly variant: "default" | "bare";
}): React.ReactElement {
  const specJson = JSON.stringify(buildClarifySubmittedSpec(declaration, values));
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{YOUR_RESPONSE_HEADING}</span>
        <WidgetStatusBadge kind="submitted" />
      </div>
      <GenuiPartBoundary specJson={specJson} isStreaming={false} variant={variant} />
    </div>
  );
}

function extractSubmittedValues(
  submittedValue: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
  if (submittedValue === undefined) return {};
  // The submitted_value for clarify_widget IS the flat field-name map.
  // Defensive unwrap only when the record is EXACTLY {values: {...}} — the
  // pre-fix wrapped shape — so any such row still reads out correctly.
  const keys = Object.keys(submittedValue);
  const inner = submittedValue.values;
  if (
    keys.length === 1 &&
    keys[0] === "values" &&
    inner !== null &&
    typeof inner === "object" &&
    !Array.isArray(inner)
  ) {
    return inner as Readonly<Record<string, unknown>>;
  }
  return submittedValue;
}

export function InteractiveWidgetBoundary({
  part,
  displayState,
  submittedValue,
  errorMessage,
  onSubmitResult,
  variant = "default",
  data,
}: InteractiveWidgetBoundaryProps): React.ReactElement {
  const captionId = `widget-caption-${part.interactionId}`;
  const declaration = part.declaration;
  const isClarify = part.widgetKind === "clarify_widget";

  if (displayState === "submitted") {
    if (isClarify) {
      return (
        <SubmittedClarifyView
          declaration={declaration as ClarifyWidgetDeclaration}
          values={extractSubmittedValues(submittedValue)}
          variant={variant}
        />
      );
    }
    const optionId = typeof submittedValue?.optionId === "string" ? submittedValue.optionId : "";
    return (
      <SubmittedProposalView declaration={declaration as ProposalCardsDeclaration} chosenOptionId={optionId} />
    );
  }

  const isDimmed = displayState === "superseded" || displayState === "stale";
  const isSubmitting = displayState === "submitting";
  const isLive = displayState === "pending";

  const liveActions: ActionRegistry = isClarify
    ? {
        setState: (action?: unknown) => {
          if (isValidClarifySubmitPayload(action)) {
            // FLAT result body — the listener validates against a derived
            // per-field schema (additionalProperties:false); wrapping in
            // {values: ...} 422s every clarify submit.
            onSubmitResult({ ...action.values });
          }
        },
      }
    : {
        setState: (action?: unknown) => {
          if (isValidChoicePayload(action)) {
            onSubmitResult({ optionId: action.value });
          }
        },
      };
  const actions = isLive ? liveActions : NOOP_ACTIONS;

  const specJson = isClarify
    ? JSON.stringify(buildClarifyWidgetSpec(declaration as ClarifyWidgetDeclaration))
    : JSON.stringify(buildProposalCardsSpec(declaration as ProposalCardsDeclaration));

  const groupClassName = isSubmitting
    ? "pointer-events-none"
    : isDimmed
      ? "pointer-events-none opacity-50"
      : undefined;

  // Group semantics (role="group"/aria-label) only apply to the proposal-card
  // stack (24-UI-SPEC.md Accessibility) — a clarify-widget's own `form`
  // element already carries its own aria-label (FormComponent, unmodified).
  const proposalPrompt = !isClarify ? (declaration as ProposalCardsDeclaration).prompt : undefined;
  const groupAriaLabel = isClarify
    ? undefined
    : proposalPrompt !== undefined && proposalPrompt.length > 0
      ? proposalPrompt
      : "Choose an option";

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
        role={isClarify ? undefined : "group"}
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
