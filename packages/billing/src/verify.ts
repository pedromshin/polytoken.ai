/**
 * Verify-session fallback — close the webhook-lag race on /billing/success.
 *
 * A buyer who just paid is redirected to /billing/success with the Checkout
 * Session id, but the `customer.subscription.*` / `checkout.session.completed`
 * webhook that actually fulfils the subscription can lag seconds behind. Until
 * it lands, `currentSubscription` still reads `free`. This is the standard
 * Stripe pattern: on arrival, retrieve the session and fulfil from it directly.
 *
 * Idempotency vs the webhook:
 *  - Fulfilment goes through the SAME `syncSubscription` helper the webhook uses
 *    (webhook.ts). That upsert is keyed by `userId`, so the webhook and this
 *    fallback firing for the same purchase converge on one row — never a double.
 *  - The verify path itself is deduped through the store's event table under a
 *    `verify:{sessionId}` key, so a re-mount / retry is a no-op and can't race
 *    its own second call.
 *  - Attribution is taken from the SUBSCRIPTION's own `metadata.userId` (stamped
 *    at checkout creation, held by Stripe) — never from a client-reachable
 *    session field. `syncSubscription` is called WITHOUT a `userIdHint`.
 */

import type Stripe from "stripe";

import { syncSubscription, type WebhookDeps } from "./webhook";

/** Dependencies for `verifySession` — identical to the webhook's DI shape. */
export type VerifyDeps = WebhookDeps;

export interface VerifyResult {
  /** True once the subscription has been synced (or was already synced). */
  readonly fulfilled: boolean;
  /** The Stripe Checkout Session status (`open` / `complete` / `expired` / …). */
  readonly status: string;
}

/** Dedupe key for the verify path — distinct from any webhook event id. */
function verifyKey(sessionId: string): string {
  return `verify:${sessionId}`;
}

/**
 * Fulfil a completed Checkout Session immediately (idempotently), so the buyer's
 * plan reflects on /billing/success without waiting for the webhook.
 */
export async function verifySession(deps: VerifyDeps, sessionId: string): Promise<VerifyResult> {
  const session = await deps.stripe.checkout.sessions.retrieve(sessionId);
  const status = session.status ?? "unknown";

  // Only a completed session fulfils; open/expired sessions are not paid.
  if (status !== "complete") {
    return { fulfilled: false, status };
  }

  const key = verifyKey(sessionId);
  // Already fulfilled through this fallback — no-op (idempotent re-mount/retry).
  if (await deps.store.wasEventProcessed(key)) {
    return { fulfilled: true, status };
  }
  await deps.store.recordEventStart(key, "verify.checkout.session", session);

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : (session.subscription?.id ?? null);

  if (subscriptionId) {
    // No userIdHint: resolve identity from the subscription's OWN metadata, not
    // from any client-reachable session field.
    await syncSubscription(deps, { subscriptionId });
  }

  await deps.store.markEventProcessed(key);
  return { fulfilled: true, status };
}
