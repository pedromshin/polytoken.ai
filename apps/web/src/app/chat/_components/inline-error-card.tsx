"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@nauta/ui/button";

export interface InlineErrorCardProps {
  /** Re-runs the failed turn (regenerate under the hood, CHAT-04/CHAT-05).
   * The composer draft is NEVER touched by this handler — draft and turn
   * state are fully decoupled (D-19, T-22-36). */
  readonly onRetry: () => void;
}

/**
 * InlineErrorCard (CHAT-05, D-19) — renders in place of a failed assistant
 * turn's content. Reuses generation-state-chrome.tsx's fallback-banner
 * treatment verbatim (role="alert", border-destructive/30 bg-destructive/5,
 * AlertTriangle) as a self-contained bordered card per 22-UI-SPEC.md.
 */
export function InlineErrorCard({
  onRetry,
}: InlineErrorCardProps): React.ReactElement {
  return (
    <div
      role="alert"
      className="my-2 flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
        <span className="text-sm font-medium text-destructive">
          Something went wrong generating this response.
        </span>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={onRetry}
      >
        Retry
      </Button>
    </div>
  );
}
