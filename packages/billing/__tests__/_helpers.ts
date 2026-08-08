/** Test helpers — an in-memory BillingStore fake (no db). */

import type { BillingStore, BillingSubscription, BillingSubscriptionPatch } from "../src/store";

export function makeFakeStore(initial: BillingSubscription | null = null) {
  let sub = initial;
  // eventId -> processed flag. Presence = claimed; value=true = fully processed.
  const events = new Map<string, boolean>();
  // Per-row event-ordering high-water mark (mirrors the last_event_at column).
  let lastEventAt: Date | null = null;
  // Per-user serialization tail for withUserLock (a chained async mutex).
  const lockTails = new Map<string, Promise<unknown>>();
  // How many locks are currently held, and how many row queries were issued
  // against the OUTER store while one was. In production that count must be
  // zero: the lock is a real transaction and the Vercel pool holds a single
  // connection, so an outer query inside the lock waits for a connection that
  // only frees when the transaction commits — which waits on the query.
  // Self-deadlock, presenting as a hang. An in-memory fake has an imaginary
  // unbounded pool and cannot reproduce that, so it counts the violation.
  let lockDepth = 0;
  const outerCallsUnderLock: string[] = [];

  /** Wrap an outer-store row method so it records lock-scope violations. */
  function outer<A extends unknown[], R>(name: string, impl: (...a: A) => Promise<R>) {
    return async (...args: A): Promise<R> => {
      if (lockDepth > 0) outerCallsUnderLock.push(name);
      return impl(...args);
    };
  }

  const getByUserIdImpl = async (userId: string): Promise<BillingSubscription | null> =>
    sub && sub.userId === userId ? sub : null;
  const getByCustomerIdImpl = async (customerId: string): Promise<BillingSubscription | null> =>
    sub && sub.stripeCustomerId === customerId ? sub : null;
  const upsertByUserIdImpl = async (
    userId: string,
    patch: BillingSubscriptionPatch,
  ): Promise<void> => {
    applyPatch(userId, patch);
  };

  function applyPatch(userId: string, patch: BillingSubscriptionPatch): void {
    const base: BillingSubscription = sub ?? {
      userId,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      tier: "free",
      status: "inactive",
      currentPeriodEnd: null,
    };
    const next: Record<string, unknown> = { ...base, userId };
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) next[k] = v;
    }
    sub = next as unknown as BillingSubscription;
  }

  const store: BillingStore = {
    getByUserId: outer("getByUserId", getByUserIdImpl),
    getByCustomerId: outer("getByCustomerId", getByCustomerIdImpl),
    upsertByUserId: outer("upsertByUserId", upsertByUserIdImpl),
    async applyOrderedSync(userId, patch, eventAt) {
      // Reject a strictly-older event (the resurrection guard).
      if (lastEventAt && eventAt.getTime() < lastEventAt.getTime()) return false;
      // Same-second tie-break: Stripe's `event.created` is second-granular, so a
      // stale `subscription.updated` can arrive in the SAME second as the
      // `subscription.deleted` that canceled the row. A non-cancel event must not
      // resurrect a canceled row at an equal timestamp; a cancel still wins ties.
      if (
        lastEventAt &&
        eventAt.getTime() === lastEventAt.getTime() &&
        sub?.status === "canceled" &&
        patch.status !== undefined &&
        patch.status !== "canceled"
      ) {
        return false;
      }
      applyPatch(userId, patch);
      if (!lastEventAt || eventAt.getTime() > lastEventAt.getTime()) lastEventAt = eventAt;
      return true;
    },
    async withUserLock(userId, fn) {
      const prev = lockTails.get(userId) ?? Promise.resolve();
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      // The next waiter queues behind this call's gate.
      lockTails.set(
        userId,
        prev.then(() => gate),
      );
      await prev; // wait for the previous holder to release
      lockDepth += 1;
      try {
        // Hand `fn` a store bound to "the locked connection". The methods are
        // the same in-memory ones, but routing through this object is what the
        // production store requires, and `outerCallsUnderLock` below counts any
        // call that bypasses it — modelling the ONE constraint this fake would
        // otherwise be blind to: on Vercel the pool is capped at a single
        // connection, so a query on the outer store from inside the lock
        // deadlocks. A fake with an unbounded imaginary pool can never
        // reproduce that, so it counts the violation instead.
        return await fn({
          getByUserId: getByUserIdImpl,
          getByCustomerId: getByCustomerIdImpl,
          upsertByUserId: upsertByUserIdImpl,
        });
      } finally {
        lockDepth -= 1;
        release();
      }
    },
    async wasEventProcessed(id) {
      return events.get(id) === true;
    },
    async recordEventStart(id) {
      if (events.has(id)) return false; // already claimed/processed
      events.set(id, false);
      return true;
    },
    async markEventProcessed(id) {
      events.set(id, true);
    },
    async releaseUnprocessedEvent(id) {
      if (events.get(id) === false) events.delete(id);
    },
  };

  return {
    store,
    current: () => sub,
    events,
    lastEventAt: () => lastEventAt,
    /** Row queries issued against the OUTER store while a lock was held. Must be
     * empty — see the note on `outerCallsUnderLock`. */
    outerCallsUnderLock: () => [...outerCallsUnderLock],
  };
}

export const PRICES = { pro: "price_pro", power: "price_power" } as const;
