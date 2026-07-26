/**
 * Per-tier entitlements — the single source of truth for what each subscription
 * tier is allowed to consume. Gates read these numbers instead of hard-coding a
 * limit at the call site, so raising a tier's allowance is a one-line edit here.
 *
 * `dailyIngestEmailCap` is the per-importer per-UTC-day count past which the
 * ingest pipeline skips the expensive enrichment (see IngestBudgetGuard). The
 * Python listener mirrors these numbers in
 * apps/email-listener/app/domain/services/tier_entitlements.py — the two MUST be
 * kept in sync (there is no shared runtime between TS and Python).
 */

import type { Tier } from "./tiers";

export interface TierEntitlements {
  readonly dailyIngestEmailCap: number;
  /** null = unlimited. */
  readonly monthlyChatTurns: number | null;
}

export const ENTITLEMENTS: Record<Tier, TierEntitlements> = {
  free: { dailyIngestEmailCap: 100, monthlyChatTurns: 200 },
  pro: { dailyIngestEmailCap: 500, monthlyChatTurns: 2000 },
  power: { dailyIngestEmailCap: 2000, monthlyChatTurns: null },
};

/** The entitlements for a tier, falling back to `free` for any unknown value. */
export function entitlementsFor(tier: Tier): TierEntitlements {
  return ENTITLEMENTS[tier] ?? ENTITLEMENTS.free;
}
