"use client";

/**
 * tool-round-activity-row.tsx — ToolRoundActivityRow (TUI-01, 39-UI-SPEC.md
 * "Component 1"). Renders while a server-tool round is in flight (streamed
 * `server_tool_call` frame) — a bare status line, deliberately NOT wrapped
 * in `<GeneratingRing>` (no panel/card here, just a spinner + gerund label,
 * mirroring `interactive-widget-boundary.tsx`'s `SubmittingRow` /
 * `message-list.tsx`'s `GeneratingIndicator` idiom rather than reinventing
 * one). Unmounts the instant the round settles, replaced in-place by
 * `ToolInvocationResultRow` via the part-array swap (see the SSE contract in
 * `use-chat-stream.ts`'s `applyRunEvent`).
 *
 * ────────────────────────────────────────────────────────────────────────
 * IT IS NOT A BUTTON, AND IT SPENT TWO MILESTONES DRESSED AS ONE (61-04).
 * ────────────────────────────────────────────────────────────────────────
 *
 * This is a `role="status"` div. It has no handler, no tabindex, and is not
 * focusable. It shipped wearing `hover:bg-accent hover:text-accent-foreground`
 * and `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1`
 * — a hover state that invites a click that does nothing, and a focus ring on
 * an element that can never receive focus. Both are AFFORDANCE LIES: chrome
 * promising an interaction the element does not have. They are gone.
 *
 * What it is instead is the sketch's `.tool` (direction-final.html:422): a
 * `--pencil` status line at the small step, quiet machine bookkeeping
 * SUBORDINATE to the answer it produced. The round is not the point; the
 * answer below it is.
 *
 * `--pencil` IS LEGAL HERE, AND THAT NEEDED CHECKING RATHER THAN ASSUMING
 * (brand-guide §3 "Enforcement" — the gate catches the token PAIR it can see;
 * this usage rule is on the author). Pencil is below the AA floor on `--shade`
 * (4.23:1 light / 4.02:1 dark) and legal on `--shelf`/`--leaf`/`--bright`.
 * This row renders inside an ASSISTANT turn, never inside the user's `--shade`
 * bubble, and an assistant turn sits on the chat column's `--bright` when
 * docked (page.tsx) or on the ChatNode's `bg-background` -> `--shelf` on the
 * canvas (chat-node.tsx). Both are legal grounds.
 */

import * as React from "react";
import { Loader2 } from "lucide-react";

import { DEEP_RESEARCH_TOOL_NAME, ResearchActivityRow } from "./research-trace";

export interface ToolRoundActivityRowProps {
  readonly toolName: string;
}

// 39-UI-SPEC.md Component 1 "Copy (label)" — tool-name -> human gerund label.
const LABEL_BY_TOOL_NAME: Readonly<Record<string, string>> = {
  lookup_entity: "Looking up an entity…",
  search_emails: "Searching emails…",
  search_knowledge: "Searching knowledge…",
  // CLUS-03 (Phase 54-06, 54-UI-SPEC.md Component 4) — zero new component,
  // reuses this existing tool-round chrome verbatim.
  web_search: "Searching the web…",
};

const FALLBACK_LABEL = "Running a lookup…";

export function ToolRoundActivityRow({
  toolName,
}: ToolRoundActivityRowProps): React.ReactElement {
  // Phase 69 (RSRCH-04): a deep-research round is minutes, not seconds — it
  // gets its own two-line status row (same register, honest expectation)
  // rather than a gerund label. Dispatch, not a parallel path: the part
  // contract and this component's role are unchanged.
  if (toolName === DEEP_RESEARCH_TOOL_NAME) {
    return <ResearchActivityRow />;
  }
  const label = LABEL_BY_TOOL_NAME[toolName] ?? FALLBACK_LABEL;
  return (
    // The sketch's `.tool`: flex, gap 7px (`gap-1.5` = 6px, the named step),
    // 12px, `--pencil`. No `rounded-md` and no `transition-colors` either —
    // both existed only to serve the hover that is now gone.
    <div
      role="status"
      className="flex items-center gap-1.5 text-xs text-pencil motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
    >
      <Loader2 className="size-3.5 shrink-0 motion-safe:animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
