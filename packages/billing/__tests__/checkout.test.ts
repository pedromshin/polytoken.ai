import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { createCheckoutSession } from "../src/checkout";
import { DuplicateSubscriptionError } from "../src/errors";
import { makeFakeStore, PRICES } from "./_helpers";

function fakeStripe() {
  return {
    customers: { create: vi.fn().mockResolvedValue({ id: "cus_new" }) },
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe/cs_1" }),
      },
    },
  } as unknown as Stripe & {
    customers: { create: ReturnType<typeof vi.fn> };
    checkout: { sessions: { create: ReturnType<typeof vi.fn> } };
  };
}

const BASE = {
  tier: "pro" as const,
  prices: PRICES,
  successUrl: "https://app/success",
  cancelUrl: "https://app/cancel",
};

describe("createCheckoutSession", () => {
  it("creates a Stripe customer (first time) and a subscription-mode session", async () => {
    const stripe = fakeStripe();
    const { store, current } = makeFakeStore(null);

    const result = await createCheckoutSession(
      { stripe, store },
      { userId: "u1", email: "u1@example.com", ...BASE },
    );

    expect(result.url).toBe("https://checkout.stripe/cs_1");
    expect(stripe.customers.create).toHaveBeenCalledOnce();
    // The customer id is persisted so the webhook can map customer -> user.
    expect(current()?.stripeCustomerId).toBe("cus_new");

    const args = stripe.checkout.sessions.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.mode).toBe("subscription");
    expect(args.customer).toBe("cus_new");
    expect(args.client_reference_id).toBe("u1");
    expect(args.line_items).toEqual([{ price: "price_pro", quantity: 1 }]);
    // userId+tier ride on the SUBSCRIPTION metadata so lifecycle events can sync.
    expect(args.subscription_data).toEqual({ metadata: { userId: "u1", tier: "pro" } });
  });

  it("reuses an existing Stripe customer instead of creating a new one", async () => {
    const stripe = fakeStripe();
    const { store } = makeFakeStore({
      userId: "u1",
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: null,
      tier: "free",
      status: "canceled",
      currentPeriodEnd: null,
    });

    await createCheckoutSession({ stripe, store }, { userId: "u1", ...BASE });

    expect(stripe.customers.create).not.toHaveBeenCalled();
    const args = stripe.checkout.sessions.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.customer).toBe("cus_existing");
  });

  it("blocks a second checkout while a paid subscription is active", async () => {
    const stripe = fakeStripe();
    const { store } = makeFakeStore({
      userId: "u1",
      stripeCustomerId: "cus_existing",
      stripeSubscriptionId: "sub_1",
      tier: "pro",
      status: "active",
      currentPeriodEnd: new Date("2099-01-01"),
    });

    await expect(
      createCheckoutSession({ stripe, store }, { userId: "u1", ...BASE }),
    ).rejects.toBeInstanceOf(DuplicateSubscriptionError);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("serializes two concurrent checkouts: one customer created, not two (TOCTOU)", async () => {
    const stripe = fakeStripe();
    let seq = 0;
    // Distinct customer id per create call so a double-create would be visible.
    stripe.customers.create.mockImplementation(async () => ({ id: `cus_${++seq}` }));
    const { store, current } = makeFakeStore(null);

    const [r1, r2] = await Promise.all([
      createCheckoutSession({ stripe, store }, { userId: "u1", email: "u1@example.com", ...BASE }),
      createCheckoutSession({ stripe, store }, { userId: "u1", email: "u1@example.com", ...BASE }),
    ]);

    // The per-user lock serialized the guard+customer-create: the second call
    // re-read the persisted customer and reused it instead of creating a second.
    expect(stripe.customers.create).toHaveBeenCalledOnce();
    expect(current()?.stripeCustomerId).toBe("cus_1");
    // Both still get a session url (serialization, not rejection).
    expect(r1.url).toBeTruthy();
    expect(r2.url).toBeTruthy();
    const customersUsed = stripe.checkout.sessions.create.mock.calls.map(
      (c) => (c[0] as Record<string, unknown>).customer,
    );
    expect(customersUsed).toEqual(["cus_1", "cus_1"]);
  });

  it("runs the duplicate-active guard inside the lock (re-reads committed state)", async () => {
    const stripe = fakeStripe();
    const { store } = makeFakeStore(null);
    const getSpy = vi.spyOn(store, "getByUserId");
    const lockSpy = vi.spyOn(store, "withUserLock");

    await createCheckoutSession({ stripe, store }, { userId: "u1", ...BASE });

    // The guard's read happened; and it happened through the lock wrapper.
    expect(lockSpy).toHaveBeenCalledOnce();
    expect(getSpy).toHaveBeenCalledWith("u1");
    expect(lockSpy.mock.invocationCallOrder[0]).toBeLessThan(getSpy.mock.invocationCallOrder[0]!);
  });

  it("rejects a tier with no configured price", async () => {
    const stripe = fakeStripe();
    const { store } = makeFakeStore(null);
    await expect(
      createCheckoutSession(
        { stripe, store },
        { userId: "u1", ...BASE, prices: { pro: "", power: "price_power" } },
      ),
    ).rejects.toThrow(/no stripe price/i);
  });
});
