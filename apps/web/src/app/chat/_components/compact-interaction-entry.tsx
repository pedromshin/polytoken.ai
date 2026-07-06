"use client";

/**
 * compact-interaction-entry.tsx — CompactInteractionEntry: the D-16 compact
 * structured "user response" transcript entry that appears immediately after
 * a successful widget submit (24-UI-SPEC.md Copywriting Contract / Component
 * Inventory).
 *
 * Reuses `MessageTurn`'s existing user-bubble classes verbatim (`flex
 * justify-end` + `max-w-[85%] rounded-lg bg-muted px-4 py-2`) — not a new
 * visual treatment, a direct reuse (24-UI-SPEC.md Spacing Scale exceptions).
 *
 * proposal_cards: `Selected "{chosenTitle}"`. clarify_widget (24-04, D-16;
 * key-value-list routing 24-05): one `{label}: {value}` row per submitted
 * field, resolved server-side from the summary's `fields: [{label, value}]`
 * shape (submit_widget_interaction.py's `_resolve_summary`) — a boolean value
 * renders as "Yes"/"No" — rendered via the mandated `key-value-list` catalog
 * primitive (`aria-label="Your response"`), the SAME mechanism
 * `SubmittedClarifyView` (interactive-widget-boundary.tsx) already uses, NOT
 * a hand-rolled `<dl>` (24-UI-REVIEW.md Copywriting Contract violation #2).
 */

import * as React from "react";

import type { SpecRoot } from "@nauta/genui/schema";

import { GenuiPartBoundary } from "./genui-part-boundary";

export interface CompactInteractionEntryProps {
  readonly widgetKind: string;
  readonly summary: Readonly<Record<string, unknown>>;
}

const BUBBLE_CLASS = "max-w-[85%] rounded-lg bg-muted px-4 py-2";
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
  // "bare" — this already sits inside the compact bubble's own bg-muted/rounded-lg
  // shell; GenuiPartBoundary's default GenuiCard wrapper would add an unwanted
  // second bordering layer (24-UI-SPEC.md's no-more-nesting posture).
  return <GenuiPartBoundary specJson={specJson} isStreaming={false} variant="bare" />;
}

export function CompactInteractionEntry({
  widgetKind,
  summary,
}: CompactInteractionEntryProps): React.ReactElement {
  return (
    <div className="flex justify-end">
      <div className={BUBBLE_CLASS}>
        {widgetKind === "proposal_cards" ? (
          <ProposalSummary summary={summary} />
        ) : (
          <ClarifySummary summary={summary} />
        )}
      </div>
    </div>
  );
}
