import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { createCheckoutSession } from "../src/checkout";
import { DuplicateSubscriptionError } from "../src/errors";
import { makeFakeStore, PRICES } from "./_helpers";

/**
 * `nextCustomerId` is called once per REAL customer creation. Repeated calls
 * carrying the same idempotency key replay the first response without invoking
 * it — modelling Stripe's documented behaviour, which the concurrency guarantee
 * now leans on (checkout.ts no longer holds the lock across the API call).
 */
function fakeStripe(nextCustomerId: () => string = () => "cus_new") {
  const replay = new Map<string, { readonly id: string }>();
  const create = vi.fn(
    async (
      _params: unknown,
      options?: { readonly idempotencyKey?: string },
    ): Promise<{ readonly id: string }> => {
      const key = options?.idempotencyKey;
      const cached = key ? replay.get(key) : undefined;
      if (cached) return cached;
      const customer = { id: nextCustomerId() };
      if (key) replay.set(key, customer);
      return customer;
    },
  );

  return {
    customers: { create },
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

  it("two concurrent checkouts converge on ONE customer (TOCTOU)", async () => {
    let created = 0;
    // Counts REAL creations: an idempotent replay does not increment it, so a
    // genuine double-create is the only thing that can push this past 1.
    const stripe = fakeStripe(() => `cus_${++created}`);
    const { store, current } = makeFakeStore(null);

    const [r1, r2] = await Promise.all([
      createCheckoutSession({ stripe, store }, { userId: "u1", email: "u1@example.com", ...BASE }),
      createCheckoutSession({ stripe, store }, { userId: "u1", email: "u1@example.com", ...BASE }),
    ]);

    // Both calls may REACH Stripe — the lock is deliberately not held across the
    // call — but the per-user idempotency key collapses them onto one customer,
    // and the re-read under the lock persists exactly one.
    expect(created).toBe(1);
    expect(current()?.stripeCustomerId).toBe("cus_1");
    // Both still get a session url (convergence, not rejection).
    expect(r1.url).toBeTruthy();
    expect(r2.url).toBeTruthy();
    const customersUsed = stripe.checkout.sessions.create.mock.calls.map(
      (c) => (c[0] as Record<string, unknown>).customer,
    );
    expect(customersUsed).toEqual(["cus_1", "cus_1"]);
  });

  it("keys the customer-create per user, so a retry cannot fork a second customer", async () => {
    const stripe = fakeStripe();
    const { store } = makeFakeStore(null);

    await createCheckoutSession({ stripe, store }, { userId: "u1", ...BASE });

    const options = stripe.customers.create.mock.calls[0]![1] as { idempotencyKey?: string };
    expect(options?.idempotencyKey).toBe("billing:customer:u1");
  });

  it("runs the duplicate-active guard inside the lock (re-reads committed state)", async () => {
    const stripe = fakeStripe();
    const { store } = makeFakeStore(null);

    // Spy on the LOCKED store the callback is handed — the guard reads through
    // that, not through the outer store (see the deadlock note below).
    const readsInsideLock: string[] = [];
    const realLock = store.withUserLock.bind(store);
    const lockSpy = vi.spyOn(store, "withUserLock").mockImplementation((userId, fn) =>
      realLock(userId, (locked) =>
        fn({
          ...locked,
          getByUserId: (id) => {
            readsInsideLock.push(id);
            return locked.getByUserId(id);
          },
        }),
      ),
    );

    await createCheckoutSession({ stripe, store }, { userId: "u1", ...BASE });

    expect(lockSpy).toHaveBeenCalled();
    expect(readsInsideLock).toContain("u1");
  });

  // The checkout-hang regression. withUserLock is pg_advisory_xact_lock inside an
  // OPEN TRANSACTION; holding it across a Stripe round trip pins a pooled
  // connection for the length of a network call, and on a serverless function
  // with a bounded budget the invocation is killed mid-stream — which the
  // httpBatchStreamLink client observes as a promise that never settles.
  it("never calls Stripe while the per-user lock is held", async () => {
    const { store } = makeFakeStore(null);
    const realLock = store.withUserLock.bind(store);
    let held = 0;
    vi.spyOn(store, "withUserLock").mockImplementation((userId, fn) =>
      realLock(userId, async (locked) => {
        held += 1;
        try {
          return await fn(locked);
        } finally {
          held -= 1;
        }
      }),
    );

    const underLock: string[] = [];
    const stripe = fakeStripe();
    stripe.customers.create.mockImplementation(async () => {
      if (held > 0) underLock.push("customers.create");
      return { id: "cus_new" };
    });
    stripe.checkout.sessions.create.mockImplementation(async () => {
      if (held > 0) underLock.push("checkout.sessions.create");
      return { id: "cs_1", url: "https://checkout.stripe/cs_1" };
    });

    await createCheckoutSession({ stripe, store }, { userId: "u1", email: "u1@example.com", ...BASE });

    expect(underLock).toEqual([]);
  });

  // The REAL checkout hang, found in prod logs 2026-08-08 ("Vercel Runtime
  // Timeout Error: Task timed out after 60 seconds" on a 200 response).
  // withUserLock is a transaction, and on Vercel the pool holds ONE connection
  // (packages/db/src/client.ts `max: 1`). A row query issued against the OUTER
  // store from inside the lock waits for a second connection that only frees
  // when the transaction commits — which waits on that query. Self-deadlock, and
  // postgres-js has no queue timeout, so it hangs rather than erroring.
  it("issues every in-lock query through the locked store, never the outer one", async () => {
    const stripe = fakeStripe();
    const { store, outerCallsUnderLock } = makeFakeStore(null);

    await createCheckoutSession({ stripe, store }, { userId: "u1", email: "u1@example.com", ...BASE });

    expect(outerCallsUnderLock()).toEqual([]);
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
