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
 * proposal_cards: `Selected "{chosenTitle}"`. Any other widgetKind (clarify
 * widgets land in 24-04) stubs to the same bubble rendering one `{key}:
 * {value}` row per submitted field — the full `key-value-list` catalog
 * treatment lands in 24-04, but this component accepts both kinds NOW so the
 * part renderer never needs a second entry point later.
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

function ClarifySummary({ summary }: { readonly summary: Readonly<Record<string, unknown>> }): React.ReactElement {
  const entries = Object.entries(summary);
  return (
    <dl className="space-y-1 text-sm">
      {entries.map(([label, value]) => (
        <div key={label} className="flex gap-1">
          <dt className="font-medium">{label}:</dt>
          <dd>{String(value)}</dd>
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
