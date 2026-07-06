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
 * proposal_cards: `Selected "{chosenTitle}"`. clarify_widget (24-04, D-16):
 * one `{label}: {value}` row per submitted field, resolved server-side from
 * the summary's `fields: [{label, value}]` shape (submit_widget_interaction.py's
 * `_resolve_summary`) — a boolean value renders as "Yes"/"No".
 */

import * as React from "react";

export interface CompactInteractionEntryProps {
  readonly widgetKind: string;
  readonly summary: Readonly<Record<string, unknown>>;
}

const BUBBLE_CLASS = "max-w-[85%] rounded-lg bg-muted px-4 py-2";

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

function ClarifySummary({ summary }: { readonly summary: Readonly<Record<string, unknown>> }): React.ReactElement {
  const fields = Array.isArray(summary.fields) ? (summary.fields as readonly ClarifySummaryField[]) : [];
  return (
    <dl className="space-y-1 text-sm">
      {fields.map((field, index) => (
        <div key={index} className="flex gap-1">
          <dt className="font-medium">{String(field.label ?? "")}:</dt>
          <dd>{formatFieldValue(field.value)}</dd>
        </div>
      ))}
    </dl>
  );
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
