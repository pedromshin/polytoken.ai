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
    async getByUserId(userId) {
      return sub && sub.userId === userId ? sub : null;
    },
    async getByCustomerId(customerId) {
      return sub && sub.stripeCustomerId === customerId ? sub : null;
    },
    async upsertByUserId(userId, patch) {
      applyPatch(userId, patch);
    },
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
      try {
        return await fn();
      } finally {
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

  return { store, current: () => sub, events, lastEventAt: () => lastEventAt };
}

export const PRICES = { pro: "price_pro", power: "price_power" } as const;
