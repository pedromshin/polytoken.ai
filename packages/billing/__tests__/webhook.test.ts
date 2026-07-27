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

function event(type: string, object: unknown, id = "evt_1", created = 1_700_000_000): Stripe.Event {
  return { id, type, created, data: { object } } as unknown as Stripe.Event;
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

  // --- Fix 1: event-ordering guard (no resurrection of a canceled tier) ---

  it("does NOT resurrect a canceled tier from a stale updated arriving after delete", async () => {
    const stripe = stripeWith();
    const { store, current } = makeFakeStore({
      userId: "u1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      tier: "pro",
      status: "active",
      currentPeriodEnd: new Date("2099-01-01"),
    });

    // deleted at t=2000 (newer) is applied first.
    await handleStripeEvent(
      { stripe, store, prices: PRICES },
      event("customer.subscription.deleted", fakeSub({ status: "canceled" }), "evt_del", 2000),
    );
    expect(current()).toMatchObject({ tier: "free", status: "canceled", stripeSubscriptionId: null });

    // A stale updated generated at t=1000 (older) is delivered afterwards.
    const res = await handleStripeEvent(
      { stripe, store, prices: PRICES },
      event(
        "customer.subscription.updated",
        fakeSub({ status: "active", items: { data: [{ price: { id: "price_pro" } }] } }),
        "evt_upd",
        1000,
      ),
    );

    // Still handled (recorded), but the state stays canceled — the stale event is ignored.
    expect(res).toMatchObject({ handled: true, action: "subscription_synced" });
    expect(current()).toMatchObject({ tier: "free", status: "canceled", stripeSubscriptionId: null });
  });

  it("does NOT resurrect a canceled tier from a SAME-SECOND stale updated (tie-break)", async () => {
    // Stripe `event.created` is second-granular, so a rapid update immediately
    // followed by a cancel can share a timestamp. A non-cancel event must not win
    // the tie against a canceled row — a cancel is terminal at equal time.
    const stripe = stripeWith();
    const { store, current } = makeFakeStore({
      userId: "u1",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      tier: "pro",
      status: "active",
      currentPeriodEnd: new Date("2099-01-01"),
    });

    // deleted at t=1000 applied first.
    await handleStripeEvent(
      { stripe, store, prices: PRICES },
      event("customer.subscription.deleted", fakeSub({ status: "canceled" }), "evt_del", 1000),
    );
    expect(current()).toMatchObject({ tier: "free", status: "canceled" });

    // A stale updated with the IDENTICAL created second is delivered afterwards.
    await handleStripeEvent(
      { stripe, store, prices: PRICES },
      event(
        "customer.subscription.updated",
        fakeSub({ status: "active", items: { data: [{ price: { id: "price_pro" } }] } }),
        "evt_upd_same",
        1000,
      ),
    );

    // The canceled row survives the equal-timestamp non-cancel event.
    expect(current()).toMatchObject({ tier: "free", status: "canceled", stripeSubscriptionId: null });
  });

  it("applies a genuinely newer updated after an earlier sync", async () => {
    const stripe = stripeWith();
    const { store, current } = makeFakeStore(null);

    await handleStripeEvent(
      { stripe, store, prices: PRICES },
      event("customer.subscription.created", fakeSub(), "evt_a", 1000),
    );
    expect(current()).toMatchObject({ tier: "pro", status: "active" });

    await handleStripeEvent(
      { stripe, store, prices: PRICES },
      event(
        "customer.subscription.updated",
        fakeSub({ items: { data: [{ price: { id: "price_power" } }] } }),
        "evt_b",
        2000,
      ),
    );
    expect(current()).toMatchObject({ tier: "power", status: "active" });
  });

  // --- Fix 2: atomic idempotency (concurrent duplicate deliveries run once) ---

  it("runs the handler exactly once for two concurrent duplicate deliveries", async () => {
    const stripe = stripeWith();
    const { store } = makeFakeStore(null);
    // Spy on the atomic claim to prove only one caller wins.
    const recordSpy = vi.spyOn(store, "recordEventStart");
    const syncSpy = vi.spyOn(store, "applyOrderedSync");

    const evt = event("customer.subscription.updated", fakeSub(), "evt_dup");
    const [a, b] = await Promise.all([
      handleStripeEvent({ stripe, store, prices: PRICES }, evt),
      handleStripeEvent({ stripe, store, prices: PRICES }, evt),
    ]);

    // Both claimed, but exactly one won and ran the sync; the loser skipped.
    expect(recordSpy).toHaveBeenCalledTimes(2);
    expect(syncSpy).toHaveBeenCalledTimes(1);
    const actions = [a.action, b.action].sort();
    expect(actions).toEqual(["skipped_duplicate", "subscription_synced"]);
  });

  it("releases the claim on handler failure so a retry can re-process", async () => {
    const { store, events } = makeFakeStore(null);
    // A stripe whose retrieve rejects makes the checkout fulfillment throw.
    const stripe = {
      subscriptions: { retrieve: vi.fn().mockRejectedValue(new Error("stripe down")) },
    } as unknown as Stripe & { subscriptions: { retrieve: ReturnType<typeof vi.fn> } };

    const evt = event("checkout.session.completed", {
      id: "cs_1",
      client_reference_id: "u1",
      subscription: "sub_1",
    });

    await expect(
      handleStripeEvent({ stripe, store, prices: PRICES }, evt),
    ).rejects.toThrow(/stripe down/);
    // Claim was released — the ledger no longer holds evt_1, so Stripe's retry re-claims.
    expect(events.has("evt_1")).toBe(false);

    // Retry succeeds now that stripe is healthy.
    stripe.subscriptions.retrieve.mockResolvedValue(fakeSub());
    const retry = await handleStripeEvent({ stripe, store, prices: PRICES }, evt);
    expect(retry).toMatchObject({ handled: true, action: "checkout_fulfilled" });
  });
});
