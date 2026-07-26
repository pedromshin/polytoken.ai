import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { verifySession } from "../src/verify";
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

function fakeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_1",
    status: "complete",
    subscription: "sub_1",
    client_reference_id: "u1",
    metadata: { userId: "u1", tier: "pro" },
    ...overrides,
  };
}

/** Fake stripe: a checkout-session retrieve + a subscription retrieve. */
function stripeWith(session?: unknown, sub?: unknown) {
  return {
    checkout: {
      sessions: { retrieve: vi.fn().mockResolvedValue(session ?? fakeSession()) },
    },
    subscriptions: { retrieve: vi.fn().mockResolvedValue(sub ?? fakeSub()) },
  } as unknown as Stripe & {
    checkout: { sessions: { retrieve: ReturnType<typeof vi.fn> } };
    subscriptions: { retrieve: ReturnType<typeof vi.fn> };
  };
}

describe("verifySession", () => {
  it("fulfills a completed session by syncing the subscription tier", async () => {
    const stripe = stripeWith();
    const { store, current } = makeFakeStore(null);

    const res = await verifySession({ stripe, store, prices: PRICES }, "cs_1");

    expect(res).toEqual({ fulfilled: true, status: "complete" });
    expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_1");
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

  it("is idempotent — a second verify against the same session is a no-op", async () => {
    const stripe = stripeWith();
    const { store, events } = makeFakeStore(null);

    await verifySession({ stripe, store, prices: PRICES }, "cs_1");
    expect(events.get("verify:cs_1")).toBe(true);
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledTimes(1);

    const second = await verifySession({ stripe, store, prices: PRICES }, "cs_1");
    expect(second).toEqual({ fulfilled: true, status: "complete" });
    // The dedupe key short-circuits before re-syncing the subscription.
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledTimes(1);
  });

  it("does not fulfill a session that is not complete", async () => {
    const stripe = stripeWith(fakeSession({ status: "open" }));
    const { store, current, events } = makeFakeStore(null);

    const res = await verifySession({ stripe, store, prices: PRICES }, "cs_1");

    expect(res).toEqual({ fulfilled: false, status: "open" });
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(current()).toBeNull();
    expect(events.has("verify:cs_1")).toBe(false);
  });

  it("resolves the user from the subscription's own metadata, not the session", async () => {
    // Session carries an ATTACKER-supplied client_reference_id / metadata; the
    // subscription's own metadata (Stripe-held) is the trusted attribution.
    const stripe = stripeWith(
      fakeSession({ client_reference_id: "attacker", metadata: { userId: "attacker" } }),
      fakeSub({ metadata: { userId: "u1", tier: "pro" } }),
    );
    const { store, current } = makeFakeStore(null);

    await verifySession({ stripe, store, prices: PRICES }, "cs_1");

    expect(current()).toMatchObject({ userId: "u1", tier: "pro" });
  });
});
