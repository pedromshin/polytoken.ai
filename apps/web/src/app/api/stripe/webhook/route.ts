/**
 * POST /api/stripe/webhook — Stripe subscription webhook receiver.
 *
 * Unauthenticated by user session (Stripe calls it) — the AUTH is the Stripe
 * SIGNATURE (constructEventAsync over the RAW body + STRIPE_WEBHOOK_SECRET). This
 * route is the ONLY place STRIPE_* secrets are read on the web side, at request
 * time, never a NEXT_PUBLIC_ var.
 *
 * Idempotent: @polytoken/billing's handleStripeEvent dedupes on the event id via
 * the stripe_webhook_events table, so Stripe's aggressive retries are safe. A
 * transient handler failure returns 500 so Stripe retries (a duplicate is a
 * no-op); a bad signature returns 400 (never retried). Inert unless
 * BILLING_ENABLED === "true" AND the keys are configured (503 otherwise).
 *
 * Node runtime: the Stripe SDK + raw-body read need Node, not Edge.
 */

import { createStripeClient, handleStripeEvent, type TierPriceIds } from "@polytoken/billing";
import { createDrizzleBillingStore } from "@polytoken/billing/store-drizzle";
import { db } from "@polytoken/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface WebhookConfig {
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly prices: TierPriceIds;
}

// Read at request time; null when billing is disabled or not fully configured.
function getWebhookConfig(): WebhookConfig | null {
  if (process.env.BILLING_ENABLED !== "true") return null;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const pro = process.env.STRIPE_PRICE_PRO;
  const power = process.env.STRIPE_PRICE_POWER;
  if (!secretKey || !webhookSecret || !pro || !power) return null;
  return { secretKey, webhookSecret, prices: { pro, power } };
}

export async function POST(req: Request): Promise<Response> {
  const cfg = getWebhookConfig();
  if (!cfg) return jsonResponse({ error: "Billing is not enabled" }, 503);

  const signature = req.headers.get("stripe-signature");
  if (!signature) return jsonResponse({ error: "Missing stripe-signature header" }, 400);

  // Raw body is REQUIRED for signature verification — never req.json() here.
  const rawBody = await req.text();
  const stripe = createStripeClient(cfg.secretKey);

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, cfg.webhookSecret);
  } catch {
    // Bad/forged signature — never retry.
    return jsonResponse({ error: "Invalid signature" }, 400);
  }

  try {
    const store = createDrizzleBillingStore(db);
    const result = await handleStripeEvent({ stripe, store, prices: cfg.prices }, event);
    return jsonResponse({ received: true, action: result.action }, 200);
  } catch (err) {
    // Log server-side; return 500 so Stripe retries (idempotency makes it safe).
    console.error("stripe_webhook_handler_error", err);
    return jsonResponse({ error: "Webhook handler error" }, 500);
  }
}
