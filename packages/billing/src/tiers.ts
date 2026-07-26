/**
 * Subscription tiers for polytoken.
 *
 * polytoken is a subscription product (not credit-packs): a signed-in user is on
 * exactly one tier. `free` is the default/absent state; `pro` and `power` are the
 * two paid tiers (track 09 pricing: ~$25–30 main / ~$50 power). The Stripe price
 * ids for the paid tiers are configuration (env), so the tier↔price mapping is
 * injected rather than hard-coded here.
 */

export type Tier = "free" | "pro" | "power";

export const PAID_TIERS: readonly Tier[] = ["pro", "power"] as const;

/** The Stripe price id for each paid tier (from env; never hard-coded). */
export interface TierPriceIds {
  readonly pro: string;
  readonly power: string;
}

/** Narrow an arbitrary string to a paid Tier, or null if it isn't one. */
export function asPaidTier(value: string | null | undefined): Tier | null {
  return value === "pro" || value === "power" ? value : null;
}

/** Resolve a Stripe price id back to its tier (for webhook sync), else `free`. */
export function tierFromPriceId(priceId: string | null | undefined, prices: TierPriceIds): Tier {
  if (priceId && priceId === prices.pro) return "pro";
  if (priceId && priceId === prices.power) return "power";
  return "free";
}

/** The Stripe price id to charge for a paid tier. */
export function priceIdForTier(tier: Tier, prices: TierPriceIds): string | null {
  if (tier === "pro") return prices.pro;
  if (tier === "power") return prices.power;
  return null;
}
