"use client";

import { AlertTriangle } from "lucide-react";

/**
 * CostCapBlockedCard (D-21, STREAM-03) — renders when the pre-turn
 * fail-closed cost gate blocks a turn before it ever starts (zero content
 * ever streamed). Same visual family as InlineErrorCard, but deliberately
 * has NO retry action — raising the cap is a config change, not something
 * the user can resolve by trying again (22-UI-SPEC.md Copywriting Contract).
 */
export function CostCapBlockedCard(): React.ReactElement {
  return (
    <div
      role="alert"
      className="my-2 flex flex-col gap-1 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
        <span className="text-sm font-medium text-destructive">
          This turn would exceed today&apos;s cost limit.
        </span>
      </div>
      <p className="pl-6 text-xs text-muted-foreground">
        Ask an admin to raise the cap in settings — there&apos;s no in-app
        override.
      </p>
    </div>
  );
}
