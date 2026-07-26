import type { Metadata } from "next";
import Link from "next/link";
import * as React from "react";

import { Button } from "@polytoken/ui/button";

export const metadata: Metadata = {
  title: "Subscription confirmed — Polytoken",
};

/**
 * /billing/success — where Stripe redirects after a completed checkout.
 *
 * Fulfillment is done by the webhook (the source of truth), so this page is just
 * a confirmation + a way back to /billing (which re-reads the now-updated plan).
 * Chrome/monochrome, sans (law 1 + 2). Static server component — no secrets, no
 * session id trust (the plan comes from the webhook, never this URL param).
 */
export default function BillingSuccessPage(): React.ReactElement {
  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] w-full flex-col items-center justify-center bg-shelf p-4">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-md border border-rule bg-bright p-panel">
        <h1 className="text-base font-semibold text-ink">You&rsquo;re subscribed</h1>
        <p className="text-sm text-muted-foreground">
          Thanks — your subscription is being activated. It may take a moment to reflect on your
          account.
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
