/**
 * Stripe client factory.
 *
 * The API version is intentionally NOT pinned to a literal here — passing it
 * couples the build to one SDK-bundled version string. Omitted, the SDK uses the
 * account's default API version (safe + stable). A deployment that wants to pin
 * can pass `apiVersion` explicitly (e.g. from an env var) without a code change.
 */

import Stripe from "stripe";

/**
 * Per-request Stripe timeout, in ms. MUST stay well below the serverless
 * function budget (`maxDuration = 60` on the tRPC route).
 *
 * The Stripe SDK defaults to an **80 second** timeout. With a 60s function
 * budget that default can never fire: the platform kills the invocation first,
 * the stream is cut without an error frame, and — because the clients use
 * `httpBatchStreamLink` — the caller's promise never settles. That is the
 * "Starting…  forever" checkout hang, and it is structural: with the SDK
 * default, a stalled Stripe call CANNOT surface as an error, only as silence.
 *
 * 10s × (1 + MAX_NETWORK_RETRIES) = 20s worst case per call, and
 * `createCheckoutSession` makes at most two sequential calls = 40s, still
 * inside the 60s budget. So a stall now throws where tRPC can serialise it into
 * an error frame the UI can show.
 */
export const STRIPE_TIMEOUT_MS = 10_000;

/** Retries apply to network errors/timeouts only; Stripe requests are made
 * idempotent by the callers that need it (see checkout.ts). */
export const STRIPE_MAX_NETWORK_RETRIES = 1;

export interface StripeClientOptions {
  /** Optional explicit Stripe API version to pin (e.g. from env). */
  readonly apiVersion?: Stripe.StripeConfig["apiVersion"];
}

/** Create a configured Stripe client. `secretKey` is a server-only sk_/rk_ key —
 * never expose it to the browser bundle. */
export function createStripeClient(secretKey: string, options: StripeClientOptions = {}): Stripe {
  return new Stripe(secretKey, {
    ...(options.apiVersion ? { apiVersion: options.apiVersion } : {}),
    appInfo: { name: "polytoken-billing" },
    timeout: STRIPE_TIMEOUT_MS,
    maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
  });
}
