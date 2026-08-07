"use client";

// Explicit React import — Next.js's SWC automatic JSX runtime tolerates its
// absence, but vitest's classic-runtime esbuild JSX transform needs `React`
// in scope for any suite that mounts this file directly (documented gotcha,
// see composer.tsx / genui-panel-node.tsx).
import * as React from "react";
import Link from "next/link";
import { X } from "lucide-react";

import type { Tier } from "@polytoken/billing";

import { api } from "~/trpc/react";

import {
  approachingCapNoticeFor,
  useUpsellBannerDismissal,
} from "../_hooks/turn-cap-notices";

/**
 * UpsellBanner (W8-1) — the ONE upgrade prompt outside /billing.
 *
 * A quiet, dismissible, single-line ink notice rendered directly above the
 * composer when the caller has used >= 80% of a FINITE monthlyChatTurns
 * entitlement. All the judgement lives in approachingCapNoticeFor
 * (turn-cap-notices.ts): the numbers come from entitlementsFor — never
 * hardcoded — and an unlimited tier (power) never sees it.
 *
 * FAIL-QUIET is the contract: a loading, errored, or absent
 * billing.currentSubscription / billing.usage read renders NOTHING. A billing
 * hiccup must never add chrome to the chat surface — the composer below works
 * regardless.
 *
 * Dismiss latches for the SESSION (module-scope latch in turn-cap-notices.ts):
 * neither a re-render, a usage refetch, nor a conversation switch (keyed
 * ConversationView remount) resurrects it.
 *
 * Chrome follows the composer's dock idiom (composer.tsx): a hairline top rule
 * dividing it from the transcript, the same mx-auto max-w-3xl px-4 reading
 * column, and NO background of its own — it is part of the `.chatcol` surface.
 * States speak ink (law 1): pencil body, ink link, ink-on-shade hover for the
 * dismiss, zero hue.
 */
export function UpsellBanner(): React.ReactElement | null {
  const subscription = api.billing.currentSubscription.useQuery();
  const usage = api.billing.usage.useQuery();
  const { dismissed, dismiss } = useUpsellBannerDismissal();

  if (dismissed) return null;
  // Fail-quiet: either query still loading or errored → no banner.
  if (subscription.isLoading || subscription.isError) return null;
  if (usage.isLoading || usage.isError) return null;

  const notice = approachingCapNoticeFor({
    // The router types tier as string ("free" default) — same boundary cast
    // /billing's surface makes (billing-surface.tsx); entitlementsFor falls
    // back to `free` for anything unknown, matching the enforcement gate.
    tier: subscription.data?.tier as Tier | undefined,
    monthlyChatTurnsUsed: usage.data?.monthlyChatTurnsUsed,
  });
  if (notice === null) return null;

  return (
    <div role="status" className="w-full shrink-0 border-t border-hair">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-1.5">
        <p className="min-w-0 flex-1 truncate text-xs text-pencil">
          You&apos;ve used {notice.used.toLocaleString()} of{" "}
          {notice.cap.toLocaleString()} included chat turns this month —{" "}
          <Link
            href="/billing"
            className="text-ink underline underline-offset-2"
          >
            see Billing
          </Link>
          .
        </p>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-faded hover:bg-shade hover:text-ink focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
