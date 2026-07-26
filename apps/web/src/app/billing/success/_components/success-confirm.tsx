"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { Button } from "@polytoken/ui/button";

import { api } from "~/trpc/react";

/**
 * SuccessConfirm — the client half of /billing/success (webhook-lag recovery).
 *
 * Stripe redirects here with `?session_id=…`. On mount (once) we call
 * `verifyCheckout`, which fulfils the subscription immediately if the webhook
 * hasn't landed yet, then invalidate `currentSubscription` so the plan reflects
 * right away. Purely additive: the webhook is still the backstop, so a failed or
 * disabled verify is a silent no-op — the copy is unconditional.
 *
 * Chrome/monochrome, sans throughout (laws 1 + 2): `text-ink`, `border-rule`,
 * `bg-bright`. No serif, no decorative hue.
 */
export function SuccessConfirm(): React.ReactElement {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");

  const utils = api.useUtils();
  const verify = api.billing.verifyCheckout.useMutation({
    onSettled: () => {
      // Whether verify fulfilled now or the webhook already had, re-read the plan.
      void utils.billing.currentSubscription.invalidate();
    },
  });

  // Fire exactly once, only when a session_id is present. Guarded by a ref so a
  // re-render (or React 18 strict double-mount) never double-invokes.
  const firedRef = React.useRef(false);
  React.useEffect(() => {
    if (firedRef.current) return;
    if (!sessionId) return; // No session id → nothing to verify; friendly copy still shows.
    firedRef.current = true;
    verify.mutate({ sessionId });
    // Intentionally mount-only: sessionId is stable for the life of this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] w-full flex-col items-center justify-center bg-shelf p-4">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-md border border-rule bg-bright p-panel">
        <h1 className="text-base font-semibold text-ink">You&rsquo;re subscribed</h1>
        <p className="text-sm text-muted-foreground">
          Thanks — your subscription is active. If your plan hasn&rsquo;t updated yet, it will in a
          moment.
        </p>
        <div className="pt-1">
          <Button asChild size="sm">
            <Link href="/billing">Back to billing</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
