/**
 * billing/index.ts — billingRouter (Stripe subscriptions).
 *
 * The owner-scoped control plane for a user's subscription. Every procedure is
 * `protectedProcedure`; the acting identity is ALWAYS `ctx.user.id`, never a
 * client field. The heavy Stripe logic lives in `@polytoken/billing` (DI, unit-
 * tested); this router just wires it with a request-time config + the drizzle
 * store.
 *
 * ## Config + secrets (T-24-13 idiom)
 * Stripe keys/prices are read at REQUEST time inside `getBillingConfig()`, never
 * at module init and never as a `NEXT_PUBLIC_` var — so they can't reach the
 * client bundle. `BILLING_ENABLED !== "true"` (the default) makes every write
 * procedure refuse with PRECONDITION_FAILED, so the router is inert until Pedro
 * configures Stripe and flips the flag.
 *
 * ## No open redirect
 * success/cancel/return URLs are built from a SERVER-known base
 * (`BILLING_APP_URL`) + fixed paths — the client never supplies a redirect
 * target Stripe would send the buyer to.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  createCheckoutSession,
  createPortalSession,
  createStripeClient,
  DuplicateSubscriptionError,
  type TierPriceIds,
} from "@polytoken/billing";
import { createDrizzleBillingStore } from "@polytoken/billing/store-drizzle";
import { Subscriptions } from "@polytoken/db/schema";

import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../../trpc";

interface BillingConfig {
  readonly secretKey: string;
  readonly prices: TierPriceIds;
  readonly appUrl: string;
}

/** Read Stripe config at request time; throws PRECONDITION_FAILED when billing
 * is disabled or not fully configured (a real kill-switch — no partial state). */
function getBillingConfig(): BillingConfig {
  if (process.env.BILLING_ENABLED !== "true") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Billing is not enabled." });
  }
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const pro = process.env.STRIPE_PRICE_PRO;
  const power = process.env.STRIPE_PRICE_POWER;
  const appUrl = process.env.BILLING_APP_URL;
  if (!secretKey || !pro || !power || !appUrl) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Billing is not fully configured." });
  }
  return { secretKey, prices: { pro, power }, appUrl: appUrl.replace(/\/$/, "") };
}

export const billingRouter = createTRPCRouter({
  /**
   * currentSubscription — the caller's tier/status. Safe to call regardless of
   * the billing flag: a user with no row (or before the migration is applied)
   * reads as `free`. Scoped directly to `ctx.user.id`.
   */
  currentSubscription: protectedProcedure.query(async ({ ctx }) => {
    try {
      const rows = await ctx.db
        .select({
          tier: Subscriptions.tier,
          status: Subscriptions.status,
          currentPeriodEnd: Subscriptions.currentPeriodEnd,
          stripeSubscriptionId: Subscriptions.stripeSubscriptionId,
        })
        .from(Subscriptions)
        .where(eq(Subscriptions.userId, ctx.user.id))
        .limit(1);
      const row = rows[0];
      return {
        tier: row?.tier ?? "free",
        status: row?.status ?? "inactive",
        currentPeriodEnd: row?.currentPeriodEnd ?? null,
        hasSubscription: Boolean(row?.stripeSubscriptionId),
      };
    } catch {
      // Graceful default before the 0056 migration is applied (Pedro-gated) —
      // billing is off until then anyway, so everyone is effectively `free`.
      return { tier: "free", status: "inactive", currentPeriodEnd: null, hasSubscription: false };
    }
  }),

  /**
   * createCheckoutSession — start a Stripe Checkout for a paid tier. Returns the
   * hosted-checkout URL for the client to redirect to. Owner stamped server-side.
   */
  createCheckoutSession: protectedProcedure
    .input(z.object({ tier: z.enum(["pro", "power"]) }))
    .mutation(async ({ ctx, input }) => {
      const cfg = getBillingConfig();
      const stripe = createStripeClient(cfg.secretKey);
      const store = createDrizzleBillingStore(ctx.db);
      try {
        const { url } = await createCheckoutSession(
          { stripe, store },
          {
            userId: ctx.user.id,
            email: ctx.user.email ?? null,
            tier: input.tier,
            prices: cfg.prices,
            successUrl: `${cfg.appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${cfg.appUrl}/billing?canceled=1`,
          },
        );
        return { url };
      } catch (err) {
        if (err instanceof DuplicateSubscriptionError) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "You already have an active subscription. Manage it from the billing portal.",
          });
        }
        // Never leak Stripe internals to the client; the real error is logged upstream.
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not start checkout." });
      }
    }),

  /**
   * createPortalSession — a Stripe Customer Portal URL to manage/cancel the
   * subscription. Requires an existing Stripe customer for the caller.
   */
  createPortalSession: protectedProcedure.mutation(async ({ ctx }) => {
    const cfg = getBillingConfig();
    const store = createDrizzleBillingStore(ctx.db);
    const sub = await store.getByUserId(ctx.user.id);
    if (!sub?.stripeCustomerId) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No billing account yet." });
    }
    const stripe = createStripeClient(cfg.secretKey);
    const { url } = await createPortalSession(
      { stripe },
      { customerId: sub.stripeCustomerId, returnUrl: `${cfg.appUrl}/billing` },
    );
    return { url };
  }),
});
