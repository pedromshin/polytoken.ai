import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { handleStripeEvent } from "../src/webhook";
import { makeFakeStore, PRICES } from "./_helpers";

function fakeSub(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    items: { data: [{ price: { id: "price_pro" }, current_period_end: 1893456000 }] },
    current_period_end: 1893456000,
    metadata: { userId: "u1", tier: "pro" },
    ...overrides,
  };
}

function event(type: string, object: unknown, id = "evt_1"): Stripe.Event {
  return { id, type, data: { object } } as unknown as Stripe.Event;
}

function stripeWith(retrieve?: unknown) {
  return {
    subscriptions: { retrieve: vi.fn().mockResolvedValue(retrieve ?? fakeSub()) },
  } as unknown as Stripe & { subscriptions: { retrieve: ReturnType<typeof vi.fn> } };
}

describe("handleStripeEvent", () => {
  it("skips an already-processed event (idempotency)", async () => {
    const stripe = stripeWith();
    const { store, events } = makeFakeStore(null);
    events.set("evt_1", true); // already processed

    const res = await handleStripeEvent(
      { stripe, store, prices: PRICES },
      event("checkout.session.completed", { id: "cs_1" }),
    );

    expect(res).toMatchObject({ handled: false, action: "skipped_duplicate" });
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it("ignores an unhandled event type", async () => {
    const stripe = stripeWith();
    const { store } = makeFakeStore(null);
    const res = await handleStripeEvent(
      { stripe, store, prices: PRICES },
      event("invoice.created", {}),
    );
    expect(res).toMatchObject({ handled: false, action: "unknown_event_type" });
  });

  it("fulfills checkout.session.completed by syncing the subscription tier", async () => {
    const stripe = stripeWith(fakeSub());
    const { store, current } = makeFakeStore(null);

    const res = await handleStripeEvent(
      { stripe, store, prices: PRICES },
      event("checkout.session.completed", {
        id: "cs_1",
        client_reference_id: "u1",
        subscription: "sub_1",
      }),
    );

    expect(res).toMatchObject({ handled: true, action: "checkout_fulfilled" });
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_1");
    expect(current()).toMatchObject({
      userId: "u1",
      tier: "pro",
      status: "active",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
    });
    expect(current()?.currentPeriodEnd).toBeInstanceOf(Date);
  });

  it("syncs tier on customer.subscription.updated (pro -> power)", async () => {
    const stripe = stripeWith();
    const { store, current } = makeFakeStore(null);
    const sub = fakeSub({
      items: { data: [{ price: { id: "price_power" }, current_period_end: 1893456000 }] },
      status: "active",
    });

    await handleStripeEvent(
      { stripe, store, prices: PRICES },
      event("customer.subscription.updated", sub),
    );

    expect(current()).toMatchObject({ userId: "u1", tier: "power", status: "active" });
    // Sub object handed in directly — no extra retrieve call needed.
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it("downgrades to free on customer.subscription.deleted", async () => {
    const stripe = stripeWith();
    const { store, current } = makeFakeStore({
      userId: "u1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      tier: "pro",
      status: "active",
      currentPeriodEnd: new Date("2099-01-01"),
    });

    const res = await handleStripeEvent(
      { stripe, store, prices: PRICES },
      event("customer.subscription.deleted", fakeSub({ status: "canceled" })),
    );

    expect(res).toMatchObject({ handled: true, action: "subscription_canceled" });
    expect(current()).toMatchObject({ tier: "free", status: "canceled", stripeSubscriptionId: null });
  });

  it("marks the event processed so a redelivery is a no-op", async () => {
    const stripe = stripeWith();
    const { store, events } = makeFakeStore(null);
    const evt = event("customer.subscription.updated", fakeSub());

    await handleStripeEvent({ stripe, store, prices: PRICES }, evt);
    expect(events.get("evt_1")).toBe(true);

    const second = await handleStripeEvent({ stripe, store, prices: PRICES }, evt);
    expect(second).toMatchObject({ handled: false, action: "skipped_duplicate" });
  });
});
