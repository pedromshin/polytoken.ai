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
  capKind,
  draftText,
  onRestoreDraft,
}: {
  /** Server-supplied copy for a monthly-turns cap block (the listener cap
   * mirror rides it on the cost_capped event as data.message). PRESENTATION
   * only — the remedy line switches on `capKind`, never on this. When absent,
   * the headline keeps its original daily-cost-cap copy byte-identical. */
  readonly message?: string;
  /** The remedy DISCRIMINANT (Wave 0.6): 'monthly_chat_turns' (read
   * explicitly from the cost_capped event's breached_cap) routes the user to
   * Billing; absent keeps the daily-cost admin remedy byte-identical. */
  readonly capKind?: "monthly_chat_turns";
  /** The composer text this pre-turn block destroyed (the optimistic bubble
   * is dropped on terminal). Rendered back to the user with a one-click
   * "Restore draft" affordance — absent when the blocked turn carried no
   * draft (regenerate / widget continuation). */
  readonly draftText?: string;
  /** Puts `draftText` back into the Composer (threaded from the controller's
   * draft-restore channel — turn-cap-notices.ts). */
  readonly onRestoreDraft?: (text: string) => void;
}): React.ReactElement {
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
        {capKind === "monthly_chat_turns"
          ? "See Billing for your plan's allowance."
          : "Ask an admin to raise the cap in settings — there's no in-app override."}
      </p>
      {draftText !== undefined && (
        <div className="pl-6">
          {/* The message the block would otherwise have destroyed — shown so
              nothing typed is ever lost, restorable in ONE click. Law 2: the
              user's own words, quoted back — not polytoken's voice. */}
          <p className="border-l-2 border-rule pl-2 text-xs whitespace-pre-wrap text-ink">
            {draftText}
          </p>
          {onRestoreDraft !== undefined && (
            <button
              type="button"
              className="mt-1 text-xs font-semibold text-ink underline underline-offset-2 hover:opacity-80 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink"
              onClick={() => onRestoreDraft(draftText)}
            >
              Restore draft
            </button>
          )}
        </div>
      )}
    </div>
  );
}
