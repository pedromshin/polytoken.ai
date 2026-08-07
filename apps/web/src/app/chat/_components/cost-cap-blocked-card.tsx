"use client";

// Explicit React import — Next.js's SWC automatic JSX runtime tolerates its
// absence, but vitest's classic-runtime esbuild JSX transform needs `React`
// in scope for any suite that mounts this file directly (documented gotcha —
// see message-list.tsx / genui-panel-node.tsx / 53-03 / 53-04's identical
// fix). message-stream-law.test.tsx (61-04) mounts MessageTurn across every
// part type and status, which reaches this file for the first time.
import * as React from "react";

import { AlertTriangle } from "lucide-react";

/**
 * CostCapBlockedCard (D-21, STREAM-03) — renders when the pre-turn
 * fail-closed cost gate blocks a turn before it ever starts (zero content
 * ever streamed). Same visual family as InlineErrorCard, but deliberately
 * has NO retry action — raising the cap is a config change, not something
 * the user can resolve by trying again (22-UI-SPEC.md Copywriting Contract).
 *
 * LAW 1 (61-08, D-58-01): swept off the irreversible colour, exactly as its
 * sibling `InlineErrorCard` was — see that file's header for the reasoning. The
 * temptation is sharper here, because this card genuinely CANNOT be retried and
 * "irreversible" feels apt. It still is not: the identity's colour means "this
 * ACTION cannot be undone", and this card is not an action at all — it is a
 * blocked state, and the user's route out (ask an admin to raise the cap) exists.
 * A card that cannot be dismissed is not the same claim as a button that cannot
 * be taken back.
 */
export function CostCapBlockedCard({
  message,
}: {
  /** Server-supplied copy for a monthly-turns cap block (the listener cap
   * mirror rides it on the cost_capped event as data.message). When absent,
   * the card keeps its original daily-cost-cap copy byte-identical. */
  readonly message?: string;
} = {}): React.ReactElement {
  return (
    <div
      role="alert"
      className="my-2 flex flex-col gap-1 rounded-card border border-rule p-panel"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0 text-ink" aria-hidden />
        <span className="text-sm font-semibold text-ink">
          {message ?? "This turn would exceed today's cost limit."}
        </span>
      </div>
      <p className="pl-6 text-xs text-muted-foreground">
        {message !== undefined
          ? "See Billing for your plan's allowance."
          : "Ask an admin to raise the cap in settings — there's no in-app override."}
      </p>
    </div>
  );
}
