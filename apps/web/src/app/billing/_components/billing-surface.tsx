"use client";

import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { entitlementsFor, type Tier } from "@polytoken/billing";
import { Button } from "@polytoken/ui/button";
import { cn } from "@polytoken/ui";

import { api } from "~/trpc/react";

/**
 * BillingSurface — the client half of /billing (C1).
 *
 * Reads the caller's current plan and offers the two paid tiers. The primary
 * action (Subscribe) is one click from arrival (taste — click economy). Chrome
 * only: no serif, no decorative hue, actions wear ink (laws 1 + 2); amounts wear
 * `tabular`. Flat framed cards (`bg-bright` + `border-rule`, zero shadow — not
 * the centered-card-with-shadow generic).
 *
 * Billing may be OFF (the flag/keys unset): `currentSubscription` degrades to
 * `free`, and a Subscribe click surfaces a friendly toast rather than an error.
 */

interface PlanDef {
  readonly tier: "pro" | "power";
  readonly name: string;
  /** Display price (USD/mo). MUST match the amount on the Stripe price whose id
   * is wired to this tier via STRIPE_PRICE_PRO / STRIPE_PRICE_POWER. */
  readonly price: number;
  readonly blurb: string;
}

const PLANS: readonly PlanDef[] = [
  {
    tier: "pro",
    name: "Pro",
    price: 29,
    blurb:
      "Your inbox becomes a knowledge graph — email parsed and extracted, the canvas, grounded chat, and bespoke tools built over your own data.",
  },
  {
    tier: "power",
    name: "Power",
    price: 49,
    blurb: "Everything in Pro, with higher ingest and processing limits and a larger workspace.",
  },
];

/** Live consumption against the metered caps, from `billing.usage`. */
interface Usage {
  readonly dailyIngestUsed: number;
  readonly monthlyChatTurnsUsed: number;
}

/**
 * The concrete per-tier caps, read straight from @polytoken/billing's
 * ENTITLEMENTS via entitlementsFor. `power`'s monthlyChatTurns is null →
 * rendered as "Unlimited".
 *
 * When `usage` is supplied (the current-plan section only), the rows switch to
 * a live "X / Y used" readout against those caps: `X` is what the caller has
 * consumed (emails ingested today; user chat turns this UTC month), `Y` is the
 * tier's cap. An unlimited cap (power's monthlyChatTurns) shows the used count
 * with no denominator. The plan CARDS pass no usage and keep the static "what
 * the tier grants" allowance.
 */
function EntitlementRows({
  tier,
  usage,
}: {
  tier: Tier;
  usage?: Usage;
}): React.ReactElement {
  const ent = entitlementsFor(tier);

  const dailyValue = usage
    ? `${usage.dailyIngestUsed.toLocaleString()} / ${ent.dailyIngestEmailCap.toLocaleString()} used`
    : `${ent.dailyIngestEmailCap.toLocaleString()} / day`;

  let monthlyValue: string;
  if (usage) {
    monthlyValue =
      ent.monthlyChatTurns === null
        ? `${usage.monthlyChatTurnsUsed.toLocaleString()} used`
        : `${usage.monthlyChatTurnsUsed.toLocaleString()} / ${ent.monthlyChatTurns.toLocaleString()} used`;
  } else {
    monthlyValue =
      ent.monthlyChatTurns === null
        ? "Unlimited"
        : `${ent.monthlyChatTurns.toLocaleString()} / mo`;
  }

  return (
    <dl className="flex flex-col gap-1 border-t border-rule pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-2xs uppercase tracking-wide text-muted-foreground">Daily email ingest</dt>
        <dd className="text-xs text-ink tabular">{dailyValue}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-2xs uppercase tracking-wide text-muted-foreground">Monthly chat turns</dt>
        <dd className="text-xs text-ink tabular">{monthlyValue}</dd>
      </div>
    </dl>
  );
}

function friendlyError(code: string | undefined, fallback: string): string {
  if (code === "PRECONDITION_FAILED") return "Billing isn't available yet.";
  if (code === "CONFLICT") return "You already have an active subscription.";
  return fallback;
}

export function BillingSurface(): React.ReactElement {
  const query = api.billing.currentSubscription.useQuery();
  const usageQuery = api.billing.usage.useQuery();

  const checkout = api.billing.createCheckoutSession.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (err) => {
      toast.error(friendlyError(err.data?.code, "Couldn't start checkout."));
    },
  });

  const portal = api.billing.createPortalSession.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (err) => {
      toast.error(friendlyError(err.data?.code, "Couldn't open the billing portal."));
    },
  });

  const sub = query.data;
  const currentTier = sub?.tier ?? "free";
  const busy = checkout.isPending || portal.isPending;
  // Graceful default: before the query resolves (or when billing/data is
  // absent) usage reads as 0, so the live readout shows "0 / cap used" rather
  // than erroring.
  const usage: Usage = usageQuery.data ?? { dailyIngestUsed: 0, monthlyChatTurnsUsed: 0 };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {/* Current plan */}
      <section className="flex flex-col gap-2 rounded-md border border-rule bg-bright p-panel">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-2xs uppercase tracking-wide text-muted-foreground">
              Current plan
            </span>
            <span className="text-base font-semibold capitalize text-ink">
              {query.isLoading ? "…" : currentTier}
            </span>
            {sub?.currentPeriodEnd ? (
              <span className="text-xs text-muted-foreground tabular">
                {sub.status === "canceled" ? "Ends" : "Renews"}{" "}
                {new Date(sub.currentPeriodEnd).toLocaleDateString()}
              </span>
            ) : null}
          </div>
          {sub?.hasSubscription ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => portal.mutate()}
            >
              Manage billing
            </Button>
          ) : null}
        </div>
        <EntitlementRows tier={currentTier as Tier} usage={usage} />
      </section>

      {/* Plans */}
      <div className="grid gap-4 sm:grid-cols-2">
        {PLANS.map((plan) => {
          const isCurrent = currentTier === plan.tier;
          return (
            <section
              key={plan.tier}
              className={cn(
                "flex flex-col gap-3 rounded-md border bg-bright p-panel",
                isCurrent ? "border-ink" : "border-rule",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-lg font-semibold text-ink">{plan.name}</span>
                <span className="text-ink">
                  <span className="text-xl font-semibold tabular">${plan.price}</span>
                  <span className="text-xs text-muted-foreground">/mo</span>
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{plan.blurb}</p>
              <EntitlementRows tier={plan.tier} />
              <div className="mt-auto pt-1">
                {isCurrent ? (
                  <Button variant="outline" size="sm" disabled className="w-full">
                    Current plan
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={busy}
                    className="w-full"
                    onClick={() => checkout.mutate({ tier: plan.tier })}
                  >
                    {checkout.isPending && checkout.variables?.tier === plan.tier
                      ? "Starting…"
                      : `Subscribe to ${plan.name}`}
                  </Button>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <p className="text-2xs text-muted-foreground">
        Billed monthly in USD; local currency is presented at checkout. Cancel anytime from Manage
        billing. By subscribing you agree to our{" "}
        <Link className="underline" href="/legal/terms">
          Terms
        </Link>{" "}
        and{" "}
        <Link className="underline" href="/legal/privacy">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}
