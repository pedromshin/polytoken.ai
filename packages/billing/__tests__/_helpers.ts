/** Test helpers — an in-memory BillingStore fake (no db). */

import type { BillingStore, BillingSubscription } from "../src/store";

export function makeFakeStore(initial: BillingSubscription | null = null) {
  let sub = initial;
  const events = new Map<string, boolean>(); // eventId -> processed

  const store: BillingStore = {
    async getByUserId(userId) {
      return sub && sub.userId === userId ? sub : null;
    },
    async getByCustomerId(customerId) {
      return sub && sub.stripeCustomerId === customerId ? sub : null;
    },
    async upsertByUserId(userId, patch) {
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
    },
    async wasEventProcessed(id) {
      return events.get(id) === true;
    },
    async recordEventStart(id) {
      if (!events.has(id)) events.set(id, false);
    },
    async markEventProcessed(id) {
      events.set(id, true);
    },
  };

  return { store, current: () => sub, events };
}

export const PRICES = { pro: "price_pro", power: "price_power" } as const;
