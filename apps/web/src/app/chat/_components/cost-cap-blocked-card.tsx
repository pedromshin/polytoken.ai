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
 */
export function CostCapBlockedCard(): React.ReactElement {
  return (
    <div
      role="alert"
      className="my-2 flex flex-col gap-1 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
        <span className="text-sm font-semibold text-destructive">
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
