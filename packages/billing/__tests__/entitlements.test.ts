import { describe, expect, it } from "vitest";

import { ENTITLEMENTS, entitlementsFor } from "../src/entitlements";
import type { Tier } from "../src/tiers";

describe("entitlements", () => {
  it("exposes the per-tier ingest caps", () => {
    expect(ENTITLEMENTS.free.dailyIngestEmailCap).toBe(100);
    expect(ENTITLEMENTS.pro.dailyIngestEmailCap).toBe(500);
    expect(ENTITLEMENTS.power.dailyIngestEmailCap).toBe(2000);
  });

  it("exposes the per-tier monthly chat turns (null = unlimited)", () => {
    expect(ENTITLEMENTS.free.monthlyChatTurns).toBe(200);
    expect(ENTITLEMENTS.pro.monthlyChatTurns).toBe(2000);
    expect(ENTITLEMENTS.power.monthlyChatTurns).toBeNull();
  });

  it("resolves a known tier to its entitlements", () => {
    expect(entitlementsFor("pro")).toBe(ENTITLEMENTS.pro);
    expect(entitlementsFor("power")).toBe(ENTITLEMENTS.power);
  });

  it("falls back to free for a bogus tier value", () => {
    expect(entitlementsFor("nonsense" as Tier)).toBe(ENTITLEMENTS.free);
  });
});
