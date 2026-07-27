/**
 * Stripe webhook event handling (subscription lifecycle) with idempotency.
 *
 * Idempotency: every event id is deduped through the BillingStore
 * (stripe_webhook_events) — a duplicate delivery is a no-op. Signature
 * verification happens at the route boundary (constructEvent), not here.
 *
 * Handled events keep the `subscriptions` row in sync with Stripe as the source
 * of truth: checkout completion + subscription create/update sync tier/status,
 * and deletion downgrades to `free`.
 */

import type Stripe from "stripe";

import { WebhookProcessingError } from "./errors";
import type { BillingStore, WebhookResult } from "./store";
import { tierFromPriceId, type TierPriceIds } from "./tiers";

export interface WebhookDeps {
  readonly stripe: Stripe;
  readonly store: BillingStore;
  readonly prices: TierPriceIds;
}

const HANDLED_EVENTS = new Set<string>([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

/** Read the current-period-end unix seconds defensively — Stripe moved this
 * field between the subscription and its items across API versions. */
function readPeriodEndUnix(sub: Stripe.Subscription): number | null {
  const top = (sub as unknown as { current_period_end?: number | null }).current_period_end;
  if (typeof top === "number") return top;
  const item = sub.items?.data?.[0] as unknown as { current_period_end?: number | null } | undefined;
  return typeof item?.current_period_end === "number" ? item.current_period_end : null;
}

function customerIdOf(customer: Stripe.Subscription["customer"]): string {
  return typeof customer === "string" ? customer : customer.id;
}

/**
 * Sync the `subscriptions` row from Stripe's subscription object (the source of
 * truth). Shared by the webhook's checkout.session.completed / subscription.*
 * handlers AND the verify-session fallback (`verify.ts`) so both fulfil through
 * ONE code path — the upsert is keyed by `userId`, so running it from the
 * webhook and the verify fallback for the same purchase converges on the same
 * row (no double-fulfill).
 *
 * Pass `userIdHint` only when the caller has a TRUSTED server-side identity
 * (the webhook carries the checkout's `client_reference_id`). Omit it to force
 * resolution from the subscription's OWN `metadata.userId` (stamped at checkout
 * creation, held by Stripe) — this is what the verify fallback does so it never
 * trusts a client-supplied session field for attribution.
 */
export async function syncSubscription(
  deps: WebhookDeps,
  args: {
    subscription?: Stripe.Subscription;
    subscriptionId?: string;
    userIdHint?: string | null;
    /** Ordering high-water mark for this write (the Stripe event's `created`, or
     * the Checkout Session's `created` for the verify fallback). When provided,
     * the write goes through the event-ordered guard so a stale event cannot
     * resurrect a canceled subscription. Omit only for legacy callers. */
    eventAt?: Date;
  },
): Promise<void> {
  const sub =
    args.subscription ??
    (args.subscriptionId ? await deps.stripe.subscriptions.retrieve(args.subscriptionId) : null);
  if (!sub) throw new WebhookProcessingError("no subscription to sync");

  const customerId = customerIdOf(sub.customer);
  const userId =
    args.userIdHint ??
    (sub.metadata?.userId || null) ??
    (await deps.store.getByCustomerId(customerId))?.userId ??
    null;
  if (!userId) {
    throw new WebhookProcessingError(`cannot resolve userId for subscription ${sub.id}`);
  }

  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const periodEndUnix = readPeriodEndUnix(sub);
  const patch = {
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    tier: tierFromPriceId(priceId, deps.prices),
    status: sub.status,
    currentPeriodEnd: periodEndUnix ? new Date(periodEndUnix * 1000) : null,
  };
  if (args.eventAt) {
    await deps.store.applyOrderedSync(userId, patch, args.eventAt);
  } else {
    await deps.store.upsertByUserId(userId, patch);
  }
}

async function applyCanceled(
  deps: WebhookDeps,
  sub: Stripe.Subscription,
  eventAt: Date,
): Promise<void> {
  const customerId = customerIdOf(sub.customer);
  const userId =
    (sub.metadata?.userId || null) ?? (await deps.store.getByCustomerId(customerId))?.userId ?? null;
  // A cancel for an unknown user is a no-op, not a failure.
  if (!userId) return;
  // Event-ordered: a `deleted` that is itself stale (an even newer event already
  // applied) is skipped; otherwise it downgrades and raises the high-water mark
  // so a late `updated` cannot re-activate the tier.
  await deps.store.applyOrderedSync(
    userId,
    {
      tier: "free",
      status: sub.status ?? "canceled",
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
    },
    eventAt,
  );
}

/**
 * Process a Stripe webhook event idempotently. The caller has already verified
 * the signature and constructed the typed event.
 */
export async function handleStripeEvent(
  deps: WebhookDeps,
  event: Stripe.Event,
): Promise<WebhookResult> {
  const eventId = event.id;
  const eventType = event.type;
  // Ordering high-water mark for every state write in this event (Stripe's
  // `created` is the generation time, so it orders out-of-order deliveries).
  const eventAt = new Date((event.created ?? 0) * 1000);

  if (await deps.store.wasEventProcessed(eventId)) {
    return { eventId, eventType, handled: false, action: "skipped_duplicate" };
  }
  if (!HANDLED_EVENTS.has(eventType)) {
    return { eventId, eventType, handled: false, action: "unknown_event_type" };
  }

  // Atomic idempotency gate: claim the event id (unique insert). If the claim is
  // lost, a concurrent duplicate delivery already owns it — do NOT run the
  // handler a second time. This closes the check-then-act race that
  // `wasEventProcessed` alone leaves open between claim and mark-processed.
  const claimed = await deps.store.recordEventStart(eventId, eventType, event.data.object);
  if (!claimed) {
    return { eventId, eventType, handled: false, action: "skipped_duplicate" };
  }

  let action = "noop";
  try {
    switch (eventType) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id ?? session.metadata?.userId ?? null;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : (session.subscription?.id ?? null);
        if (userId && subscriptionId) {
          await syncSubscription(deps, { subscriptionId, userIdHint: userId, eventAt });
          action = "checkout_fulfilled";
        } else {
          action = "checkout_no_subscription";
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        await syncSubscription(deps, {
          subscription: event.data.object as Stripe.Subscription,
          eventAt,
        });
        action = "subscription_synced";
        break;
      }
      case "customer.subscription.deleted": {
        await applyCanceled(deps, event.data.object as Stripe.Subscription, eventAt);
        action = "subscription_canceled";
        break;
      }
    }
  } catch (err) {
    // Release the claim so Stripe's retry can re-run this event instead of the
    // crashed claim silently swallowing it (recordEventStart would otherwise
    // reject the retry as a duplicate).
    await deps.store.releaseUnprocessedEvent(eventId);
    throw err;
  }

  await deps.store.markEventProcessed(eventId);
  return { eventId, eventType, handled: true, action };
}
