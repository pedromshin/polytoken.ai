/**
 * Stripe Customer Portal session — where a subscriber manages/cancels their plan
 * and payment method. Thin wrapper over billingPortal.sessions.create.
 */

import type Stripe from "stripe";

export interface PortalDeps {
  readonly stripe: Stripe;
}

export interface PortalParams {
  readonly customerId: string;
  readonly returnUrl: string;
}

export async function createPortalSession(
  deps: PortalDeps,
  params: PortalParams,
): Promise<{ readonly url: string }> {
  const session = await deps.stripe.billingPortal.sessions.create({
    customer: params.customerId,
    return_url: params.returnUrl,
  });
  return { url: session.url };
}
