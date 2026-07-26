import type { Metadata } from "next";
import * as React from "react";

import { SuccessConfirm } from "./_components/success-confirm";

export const metadata: Metadata = {
  title: "Subscription confirmed — Polytoken",
};

/**
 * /billing/success — where Stripe redirects after a completed checkout.
 *
 * The webhook is the source of truth for fulfilment, but it can lag; the client
 * surface below closes that race with a verify-session fallback (retrieve the
 * session, fulfil if complete, refresh the plan) so the buyer's tier reflects
 * immediately. Chrome/monochrome, sans (laws 1 + 2). No session-id trust for
 * attribution — the identity is resolved server-side from the subscription's
 * own Stripe-held metadata inside `verifyCheckout`.
 *
 * `SuccessConfirm` reads `?session_id` via `useSearchParams`, which requires a
 * Suspense boundary during SSG/prerender in the Next 15 app router.
 */
export default function BillingSuccessPage(): React.ReactElement {
  return (
    <React.Suspense fallback={null}>
      <SuccessConfirm />
    </React.Suspense>
  );
}
