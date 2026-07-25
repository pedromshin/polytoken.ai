"use client";

/**
 * rule-suggestions-node.tsx — RuleSuggestionsNode: the canvas's
 * `rule-suggestions` custom React Flow node. It surfaces the sender /
 * categorization rules the matcher INFERS from the user's recent mail
 * (MAIL-01's suggest-only screener seam), placed as a first-class board card.
 *
 * Ref-only like every sibling: `node.data` carries ONLY an optional `label`
 * (node-data-schemas idiom — `.strict()`), never any fetched suggestion. The
 * data rehydrates HERE via two owner-scoped tRPC reads, composed exactly the
 * way circle-pack-node composes a scope into a live query:
 *
 *   1. `api.emails.list` — the caller's recent owned mail (ids only are used).
 *   2. `api.emails.ruleSuggestions` — the batch, READ-ONLY rule match over
 *      those ids. Both scope server-side to `userOwnedImporterIds`, so this
 *      node can never address another tenant's mail.
 *
 * The per-email suggestion rows are AGGREGATED by rule: one row per inferred
 * rule, with a count of how many of the recent emails it matched. That is the
 * screener view — "these are the rules your mail keeps triggering" — rather
 * than a flat per-message list.
 *
 * READ-ONLY BY CONSTRUCTION (the suggest-only invariant, mirrored from
 * `emails/rule-suggestions.ts`): the matcher NEVER applies an action, and there
 * is deliberately NO accept/apply mutation on this read seam — accepting a
 * suggestion executes downstream through the capability permission model
 * (MAIL-02), not here. So every row renders with a DASHED "Suggested" marker
 * (tier owns solid-vs-dashed; a suggestion is dashed until a human blesses it)
 * and there is no Accept button to wire yet. When MAIL-02 lands its mutation,
 * an Accept action drops onto each row without touching the fetch above.
 *
 * GESTURE ISOLATION: the scrollable rule list wears `nowheel nopan nodrag` so a
 * wheel/drag over the list scrolls the list instead of panning the board — the
 * same discipline circle-pack-node / editor-node apply. The header keeps
 * `node-drag-handle`, so the card still drags by its title bar.
 *
 * DESIGN LAW: the shell wears the shared card recipe (`canvasNodeShellClass`)
 * plus the `rule-suggestions` kind geometry (assigned centrally in
 * canvas-vocabulary at wiring time). Remove is INK — dropping a card from the
 * board is not irreversible (T-61-19); the underlying mail and the matcher are
 * untouched.
 */

import * as React from "react";
import { memo } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { AlertCircle, Forward, ListFilter, Sparkles, Table2, Tag, X } from "lucide-react";

import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";

import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";
import { type RuleSuggestionsNodeData } from "./node-data-schemas";

export type RuleSuggestionsNodeType = Node<RuleSuggestionsNodeData, "rule-suggestions">;

/** How many recent emails to scan for inferred rules (matcher batch cap is 100). */
const SCAN_LIMIT = 50;

/** One aggregated rule — the same rule inferred across N recent emails. */
interface AggregatedRule {
  readonly ruleId: string;
  readonly capabilityId: string;
  readonly describe: string;
  /** How many of the recent emails this rule matched. */
  readonly matchCount: number;
}

/**
 * capabilityChrome — polytoken's word + icon for each suggest capability
 * (mirrors the SUGGEST_* ids in emails/rule-suggestions.ts). Sans chrome: this
 * names an action polytoken would take, it is not the mail's own words. An
 * unknown id degrades to a generic "Suggested action" rather than throwing —
 * the capability set can grow in the Python matcher before this map does.
 */
function capabilityChrome(capabilityId: string): {
  readonly label: string;
  readonly Icon: React.ComponentType<{ className?: string }>;
} {
  switch (capabilityId) {
    case "suggest_forward_email":
      return { label: "Forward", Icon: Forward };
    case "suggest_apply_label":
      return { label: "Apply label", Icon: Tag };
    case "suggest_extract_to_sheet":
      return { label: "Extract to sheet", Icon: Table2 };
    default:
      return { label: "Suggested action", Icon: Sparkles };
  }
}

/**
 * aggregateSuggestions — collapse the per-email suggestion batch into one row
 * per rule, counting matches, preserving first-seen rule order (the matcher
 * emits rules in a deterministic order). Pure, so the render body stays a thin
 * projection.
 */
function aggregateSuggestions(
  batch: ReadonlyArray<{
    readonly suggestions: ReadonlyArray<{
      readonly ruleId: string;
      readonly capabilityId: string;
      readonly describe: string;
    }>;
  }>,
): ReadonlyArray<AggregatedRule> {
  const byRule = new Map<string, { rule: AggregatedRule; count: number }>();
  for (const entry of batch) {
    for (const suggestion of entry.suggestions) {
      const existing = byRule.get(suggestion.ruleId);
      if (existing) {
        existing.count += 1;
      } else {
        byRule.set(suggestion.ruleId, {
          count: 1,
          rule: {
            ruleId: suggestion.ruleId,
            capabilityId: suggestion.capabilityId,
            describe: suggestion.describe,
            matchCount: 0,
          },
        });
      }
    }
  }
  return Array.from(byRule.values()).map(({ rule, count }) => ({
    ...rule,
    matchCount: count,
  }));
}

export const RuleSuggestionsNode = memo(function RuleSuggestionsNode({
  id,
  data,
  selected,
}: NodeProps<RuleSuggestionsNodeType>) {
  const { deleteElements } = useReactFlow();
  const label = data.label ?? "Rule suggestions";

  // 1. Recent owned mail — only the ids feed the matcher (server truncates the
  //    body; we never read it here). Default limit/offset input is explicit for
  //    readability. Owner-scoped server-side.
  const listQuery = api.emails.list.useQuery({ limit: SCAN_LIMIT, offset: 0 });

  const emailIds = React.useMemo(
    () => listQuery.data?.items.map((item) => item.id) ?? [],
    [listQuery.data],
  );

  // 2. The read-only rule match over those ids — enabled only once we have ids,
  //    so an empty inbox never fires a zero-length batch query.
  const suggestionsQuery = api.emails.ruleSuggestions.useQuery(
    { emailIds },
    { enabled: emailIds.length > 0 },
  );

  const rules = React.useMemo(
    () => (suggestionsQuery.data ? aggregateSuggestions(suggestionsQuery.data) : []),
    [suggestionsQuery.data],
  );

  return (
    <div
      className={`flex h-[300px] w-[340px] flex-col animate-in fade-in-0 zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none ${canvasNodeShellClass(
        CANVAS_NODE_KIND_GEOMETRY["rule-suggestions"],
        selected === true,
      )}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-hair px-3 active:cursor-grabbing">
        <span className="flex min-w-0 items-center gap-2">
          <ListFilter className="size-3 shrink-0 text-faded" aria-hidden />
          {/* polytoken's word for the view — chrome, sans (law 2). */}
          <span className="truncate text-xs font-semibold text-ink">{label}</span>
        </span>
        <button
          type="button"
          aria-label="Remove rule suggestions"
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-pencil transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
          onClick={(event) => {
            event.stopPropagation();
            void deleteElements({ nodes: [{ id }] });
          }}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      {/* GESTURE ISOLATION — `nowheel nopan nodrag` keep a wheel/drag OVER the
          list from bubbling to React Flow, so the gesture scrolls the rules
          instead of panning the board. Mirrors circle-pack-node / editor-node. */}
      <div className="nowheel nopan nodrag relative flex flex-1 flex-col overflow-y-auto px-3 py-2">
        <RuleSuggestionsBody
          listPending={listQuery.isPending}
          listError={listQuery.isError}
          onRetryList={() => void listQuery.refetch()}
          hasEmails={emailIds.length > 0}
          suggestionsPending={suggestionsQuery.isPending && suggestionsQuery.fetchStatus !== "idle"}
          suggestionsError={suggestionsQuery.isError}
          onRetrySuggestions={() => void suggestionsQuery.refetch()}
          rules={rules}
        />
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

/**
 * RuleSuggestionsBody — the state machine, in the established sibling branch
 * order: loading -> error -> empty -> success. Split out so no hook is called
 * conditionally in the shell (the shell always mounts both queries).
 */
function RuleSuggestionsBody({
  listPending,
  listError,
  onRetryList,
  hasEmails,
  suggestionsPending,
  suggestionsError,
  onRetrySuggestions,
  rules,
}: {
  readonly listPending: boolean;
  readonly listError: boolean;
  readonly onRetryList: () => void;
  readonly hasEmails: boolean;
  readonly suggestionsPending: boolean;
  readonly suggestionsError: boolean;
  readonly onRetrySuggestions: () => void;
  readonly rules: ReadonlyArray<AggregatedRule>;
}): React.ReactElement {
  // Loading — either the mail page or the matcher pass is in flight.
  if (listPending || suggestionsPending) {
    return (
      <div role="status" aria-label="Loading rule suggestions" className="flex flex-col gap-2">
        <Skeleton className="h-12 w-full rounded-card" />
        <Skeleton className="h-12 w-full rounded-card" />
        <Skeleton className="h-12 w-full rounded-card" />
      </div>
    );
  }

  // Error — the mail read failed, or the matcher read failed. Same compact
  // recipe email-thread-node uses: INK icon (a failure is a state, not an
  // irreversible action — law 1), one-line message, quiet Retry.
  if (listError || suggestionsError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-1 text-center">
        <AlertCircle className="size-5 shrink-0 text-ink" aria-hidden />
        <p className="text-xs text-faded">
          Couldn&apos;t load your rule suggestions. Try again.
        </p>
        <button
          type="button"
          onClick={listError ? onRetryList : onRetrySuggestions}
          className="rounded-sm px-1.5 py-0.5 text-xs text-faded transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          Retry
        </button>
      </div>
    );
  }

  // Empty — no recent mail at all.
  if (!hasEmails) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-1 text-center">
        <ListFilter className="size-5 shrink-0 text-faded" aria-hidden />
        <p className="text-xs text-faded">
          No recent mail to analyze yet. Forward mail to your polytoken address and rules will
          surface here.
        </p>
      </div>
    );
  }

  // Empty — mail exists, but no rule matched any of it.
  if (rules.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-1 text-center">
        <Sparkles className="size-5 shrink-0 text-faded" aria-hidden />
        <p className="text-xs text-faded">
          No rules inferred from your recent mail. As patterns emerge, suggested rules appear here.
        </p>
      </div>
    );
  }

  // Success — one row per inferred rule.
  return (
    <ul className="flex flex-col gap-2">
      {rules.map((rule) => {
        const { label: capabilityLabel, Icon } = capabilityChrome(rule.capabilityId);
        return (
          <li
            key={rule.ruleId}
            // Tier owns solid-vs-dashed; a suggestion is DASHED until a human
            // blesses it (mirrors the email-detail screener). The row is a
            // bounded, ink-framed guess — never a hue (law 3).
            className="flex flex-col gap-1 rounded-card border border-dashed border-rule px-2.5 py-2"
          >
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-ink">
                <Icon className="size-3.5 shrink-0 text-faded" aria-hidden />
                <span className="truncate">{capabilityLabel}</span>
              </span>
              {/* The suggest-only marker — dashed, sans chrome, no hue. */}
              <span className="shrink-0 rounded-sm border border-dashed border-rule px-1.5 py-0.5 text-2xs text-faded">
                Suggested
              </span>
            </div>
            {/* The matcher's rationale — polytoken's summary OF the mail, sans. */}
            <p className="text-2xs leading-relaxed text-faded">{rule.describe}</p>
            <span className="tabular text-2xs text-pencil">
              Matches {rule.matchCount} of your recent{" "}
              {rule.matchCount === 1 ? "email" : "emails"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
