"use client";

/**
 * compact-interaction-entry.tsx — CompactInteractionEntry: the D-16 compact
 * structured "user response" transcript entry that appears immediately after
 * a successful widget submit (24-UI-SPEC.md Copywriting Contract / Component
 * Inventory).
 *
 * Reuses `MessageTurn`'s user-bubble treatment — not a new visual treatment, a
 * direct reuse (24-UI-SPEC.md Spacing Scale exceptions). As of 61-04 that
 * reuse is REAL rather than promised: both this entry and `MessageTurn` import
 * the one `USER_BUBBLE_CLASS` (user-bubble-class.ts, which explains why it is
 * its own module). This header used to name the classes it copied — a
 * duplicate held true only by discipline, in the one place drift is most
 * visible, since both bubbles appear in the SAME transcript.
 *
 * The alignment is still this component's own: it sits INSIDE a turn, so it
 * right-aligns with `flex justify-end`, whereas `MessageTurn` is a flex-column
 * child of the sketch's `.turns` and uses `self-end`. Only the bubble's
 * appearance is shared.
 *
 * proposal_cards: `Selected "{chosenTitle}"`. confirm_action (Phase 40-02,
 * CONF-02) reuses this SAME `ProposalSummary` path verbatim — its server-side
 * `_resolve_summary` output is `{chosenTitle: "Confirm" | "Reject"}`, an
 * identical shape to proposal_cards' — zero new web components. clarify_widget
 * (24-04, D-16; key-value-list routing 24-05): one `{label}: {value}` row per
 * submitted field, resolved server-side from the summary's
 * `fields: [{label, value}]` shape (submit_widget_interaction.py's
 * `_resolve_summary`) — a boolean value renders as "Yes"/"No" — rendered via
 * the mandated `key-value-list` catalog primitive
 * (`aria-label="Your response"`), the SAME mechanism `SubmittedClarifyView`
 * (interactive-widget-boundary.tsx) already uses, NOT a hand-rolled `<dl>`
 * (24-UI-REVIEW.md Copywriting Contract violation #2).
 */

import * as React from "react";

import type { SpecRoot } from "@polytoken/genui/schema";

import { GenuiPartBoundary } from "./genui-part-boundary";
import { USER_BUBBLE_CLASS } from "./user-bubble-class";

export interface CompactInteractionEntryProps {
  readonly widgetKind: string;
  readonly summary: Readonly<Record<string, unknown>>;
}

const YOUR_RESPONSE_LABEL = "Your response";

function ProposalSummary({ summary }: { readonly summary: Readonly<Record<string, unknown>> }): React.ReactElement {
  const chosenTitle = typeof summary.chosenTitle === "string" ? summary.chosenTitle : "";
  return <span className="text-sm">Selected &quot;{chosenTitle}&quot;</span>;
}

function formatFieldValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined) return "";
  return String(value);
}

interface ClarifySummaryField {
  readonly label?: unknown;
  readonly value?: unknown;
}

/** Builds the key-value-list SpecRoot for the compact clarify read-out — mirrors
 * build-clarify-widget-spec.ts's buildClarifySubmittedSpec, but consumes the
 * ALREADY-RESOLVED `{label, value}[]` summary shape (server-resolved) rather than
 * a declaration + raw values map. */
function buildClarifyCompactSpec(fields: readonly ClarifySummaryField[]): SpecRoot {
  const root = {
    type: "key-value-list" as const,
    label: YOUR_RESPONSE_LABEL,
    items: fields.map((field) => ({
      key: String(field.label ?? ""),
      value: formatFieldValue(field.value),
    })),
  };
  return { v: 1, root } as unknown as SpecRoot;
}

function ClarifySummary({ summary }: { readonly summary: Readonly<Record<string, unknown>> }): React.ReactElement {
  const fields = Array.isArray(summary.fields) ? (summary.fields as readonly ClarifySummaryField[]) : [];
  if (fields.length === 0) {
    return <span className="text-sm text-muted-foreground">{YOUR_RESPONSE_LABEL}</span>;
  }
  const specJson = JSON.stringify(buildClarifyCompactSpec(fields));
  // "bare" — this already sits inside the compact bubble's own filled, rounded
  // shell (USER_BUBBLE_CLASS); GenuiPartBoundary's default GenuiCard wrapper
  // would add an unwanted second bordering layer (24-UI-SPEC.md's
  // no-more-nesting posture).
  return <GenuiPartBoundary specJson={specJson} isStreaming={false} variant="bare" />;
}

export function CompactInteractionEntry({
  widgetKind,
  summary,
}: CompactInteractionEntryProps): React.ReactElement {
  return (
    <div className="flex justify-end">
      <div className={USER_BUBBLE_CLASS}>
        {widgetKind === "proposal_cards" || widgetKind === "confirm_action" ? (
          <ProposalSummary summary={summary} />
        ) : (
          <ClarifySummary summary={summary} />
        )}
      </div>
    </div>
  );
}
