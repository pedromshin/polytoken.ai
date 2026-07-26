import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { createPortalSession } from "../src/portal";

describe("createPortalSession", () => {
  it("creates a billing portal session for the customer and returns its url", async () => {
    const create = vi.fn().mockResolvedValue({ url: "https://portal.stripe/x" });
    const stripe = {
      billingPortal: { sessions: { create } },
    } as unknown as Stripe;

    const result = await createPortalSession(
      { stripe },
      { customerId: "cus_1", returnUrl: "https://app/billing" },
    );

    expect(result).toEqual({ url: "https://portal.stripe/x" });
    expect(create).toHaveBeenCalledWith({
      customer: "cus_1",
      return_url: "https://app/billing",
    });
  });
});
