import { describe, expect, it } from "vitest";

import { asKnownTier, asPaidTier, priceIdForTier, tierFromPriceId } from "../src/tiers";

const PRICES = { pro: "price_pro", power: "price_power" };

describe("tiers", () => {
  it("maps a price id back to its tier", () => {
    expect(tierFromPriceId("price_pro", PRICES)).toBe("pro");
    expect(tierFromPriceId("price_power", PRICES)).toBe("power");
  });

  it("maps an unknown/absent price id to free", () => {
    expect(tierFromPriceId("price_other", PRICES)).toBe("free");
    expect(tierFromPriceId(null, PRICES)).toBe("free");
    expect(tierFromPriceId(undefined, PRICES)).toBe("free");
  });

  it("maps a paid tier to its price id, free to null", () => {
    expect(priceIdForTier("pro", PRICES)).toBe("price_pro");
    expect(priceIdForTier("power", PRICES)).toBe("price_power");
    expect(priceIdForTier("free", PRICES)).toBeNull();
  });

  it("narrows only pro/power as paid tiers", () => {
    expect(asPaidTier("pro")).toBe("pro");
    expect(asPaidTier("power")).toBe("power");
    expect(asPaidTier("free")).toBeNull();
    expect(asPaidTier("nonsense")).toBeNull();
    expect(asPaidTier(null)).toBeNull();
  });

  it("narrows unknown/absent tiers to free (fail-closed default)", () => {
    expect(asKnownTier("pro")).toBe("pro");
    expect(asKnownTier("power")).toBe("power");
    expect(asKnownTier("free")).toBe("free");
    expect(asKnownTier("enterprise-gibberish")).toBe("free");
    expect(asKnownTier(null)).toBe("free");
    expect(asKnownTier(undefined)).toBe("free");
  });
});
