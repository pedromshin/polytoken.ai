/**
 * Stripe client factory.
 *
 * The API version is intentionally NOT pinned to a literal here — passing it
 * couples the build to one SDK-bundled version string. Omitted, the SDK uses the
 * account's default API version (safe + stable). A deployment that wants to pin
 * can pass `apiVersion` explicitly (e.g. from an env var) without a code change.
 */

import Stripe from "stripe";

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
  });
}
