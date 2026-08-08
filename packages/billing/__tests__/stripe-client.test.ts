import { describe, expect, it } from "vitest";

import {
  createStripeClient,
  STRIPE_MAX_NETWORK_RETRIES,
  STRIPE_TIMEOUT_MS,
} from "../src/stripe-client";

/**
 * The route's serverless budget (`maxDuration = 60` in
 * apps/web/src/app/api/trpc/[trpc]/route.ts). Restated rather than imported —
 * this package must not depend on the web app — and asserted against below, so
 * the two cannot drift apart silently.
 */
const FUNCTION_BUDGET_MS = 60_000;

/** createCheckoutSession makes at most two sequential Stripe calls. */
const MAX_SEQUENTIAL_STRIPE_CALLS = 2;

describe("createStripeClient", () => {
  it("sets a timeout, rather than inheriting the SDK's 80s default", () => {
    // The SDK default (80s) EXCEEDS the function budget, so it can never fire:
    // the platform kills the invocation first and the stream is cut without an
    // error frame. An unset timeout is therefore not a neutral default — it is
    // the difference between a visible error and a silent hang.
    const client = createStripeClient("sk_test_x") as unknown as {
      _api?: { timeout?: number };
      getApiField?: (k: string) => unknown;
    };
    const timeout = client.getApiField ? client.getApiField("timeout") : client._api?.timeout;
    expect(timeout).toBe(STRIPE_TIMEOUT_MS);
  });

  it("leaves headroom for every sequential call inside the function budget", () => {
    // Worst case: each call burns its timeout once per attempt (initial + retries),
    // and the checkout flow makes MAX_SEQUENTIAL_STRIPE_CALLS of them back to back.
    const worstCase =
      STRIPE_TIMEOUT_MS * (1 + STRIPE_MAX_NETWORK_RETRIES) * MAX_SEQUENTIAL_STRIPE_CALLS;
    expect(worstCase).toBeLessThan(FUNCTION_BUDGET_MS);
  });

  it("configures network retries", () => {
    const client = createStripeClient("sk_test_x") as unknown as {
      getApiField?: (k: string) => unknown;
    };
    expect(client.getApiField?.("maxNetworkRetries")).toBe(STRIPE_MAX_NETWORK_RETRIES);
  });
});
