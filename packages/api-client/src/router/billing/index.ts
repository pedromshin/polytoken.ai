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

import { and, count, eq, gte } from "drizzle-orm";
import { z } from "zod";

import {
  createCheckoutSession,
  createPortalSession,
  createStripeClient,
  DuplicateSubscriptionError,
  verifySession,
  type TierPriceIds,
} from "@polytoken/billing";
import { createDrizzleBillingStore } from "@polytoken/billing/store-drizzle";
import {
  ChatConversations,
  ChatMessages,
  Emails,
  Importers,
  Subscriptions,
} from "@polytoken/db/schema";

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
   * usage — the caller's LIVE consumption against the two metered entitlement
   * caps, so /billing can render "X / Y used" instead of a static allowance.
   *
   *   - `dailyIngestUsed`: the caller's BUSIEST importer's `emails` today —
   *     max over importers of the per-importer count with created_at >= the
   *     start of the current UTC day. Matches the IngestBudgetGuard exactly,
   *     which is PER-IMPORTER and filters on server-stamped `created_at` (NEVER
   *     the sender-controlled `received_at`, which a mail-bomb could backdate).
   *     A cross-importer sum against the per-importer cap would falsely read
   *     >100% for a multi-importer user, so we compare the worst importer.
   *   - `monthlyChatTurnsUsed`: ACTIVE user-role `chat_messages` in the caller's
   *     own conversations (chat_messages.conversation_id → chat_conversations.user_id
   *     = ctx.user.id) since the 1st of the current UTC month. is_active=true
   *     counts one row per logical turn — a regenerated/edited turn adds a
   *     sibling row, and only the active one should count, matching `monthlyChatTurns`.
   *
   * STRICTLY caller-scoped: every count joins to the owning tenant column and
   * filters on ctx.user.id — no client field, no cross-user leak. Safe to call
   * regardless of the billing flag, and graceful: any query failure (e.g. a
   * table absent before its migration) degrades to 0, never a 500. Zero is also
   * the honest reading when the caller simply has no rows yet.
   */
  usage: protectedProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const startOfUtcDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const startOfUtcMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );

    let dailyIngestUsed = 0;
    let monthlyChatTurnsUsed = 0;

    try {
      const rows = await ctx.db
        .select({ importerId: Emails.importerId, value: count() })
        .from(Emails)
        .innerJoin(Importers, eq(Emails.importerId, Importers.id))
        .where(
          and(
            eq(Importers.userId, ctx.user.id),
            // created_at (server-stamped), NEVER received_at (sender header,
            // backdatable) — the guard caps on created_at.
            gte(Emails.createdAt, startOfUtcDay),
          ),
        )
        .groupBy(Emails.importerId);
      // Per-importer cap → "used" is the busiest importer (the one that hits the
      // cap first), not a cross-importer sum.
      dailyIngestUsed = rows.reduce((m, r) => Math.max(m, Number(r.value ?? 0)), 0);
    } catch {
      // Graceful default — a missing table / unapplied migration reads as 0.
      dailyIngestUsed = 0;
    }

    try {
      const rows = await ctx.db
        .select({ value: count() })
        .from(ChatMessages)
        .innerJoin(
          ChatConversations,
          eq(ChatMessages.conversationId, ChatConversations.id),
        )
        .where(
          and(
            eq(ChatConversations.userId, ctx.user.id),
            eq(ChatMessages.role, "user"),
            // Only the active sibling counts — a regenerated/edited turn adds a
            // row sharing sibling_group_id; counting all would over-report turns.
            eq(ChatMessages.isActive, true),
            gte(ChatMessages.createdAt, startOfUtcMonth),
          ),
        );
      monthlyChatTurnsUsed = Number(rows[0]?.value ?? 0);
    } catch {
      monthlyChatTurnsUsed = 0;
    }

    return { dailyIngestUsed, monthlyChatTurnsUsed };
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
   * verifyCheckout — verify-session fallback for /billing/success (webhook-lag
   * recovery). Retrieves the Checkout Session from Stripe and, if complete,
   * fulfils the subscription through the SAME idempotent sync path the webhook
   * uses (deduped under a `verify:{sessionId}` key). Attribution comes from the
   * subscription's own Stripe-held metadata — the session's client fields are
   * never trusted for identity — so it's safe as a plain protectedProcedure.
   */
  verifyCheckout: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const cfg = getBillingConfig();
      const stripe = createStripeClient(cfg.secretKey);
      const store = createDrizzleBillingStore(ctx.db);
      try {
        const { fulfilled } = await verifySession(
          { stripe, store, prices: cfg.prices },
          input.sessionId,
        );
        return { fulfilled };
      } catch {
        // Never leak Stripe internals; the webhook remains the backstop, so a
        // failed verify is a soft miss (the client just keeps its `free` view).
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not verify checkout.",
        });
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
