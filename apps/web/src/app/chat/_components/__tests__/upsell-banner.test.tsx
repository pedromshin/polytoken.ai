/**
 * upsell-banner.test.tsx — the approaching-cap upsell banner (W8-1), the ONE
 * upgrade prompt outside /billing:
 *
 *   - shows at >= 80% of a FINITE tier's monthlyChatTurns (numbers from
 *     entitlementsFor, proven by asserting the real free/pro caps);
 *   - NEVER for power (unlimited) no matter the usage;
 *   - fail-quiet: loading / error / absent usage renders NOTHING;
 *   - dismiss latches for the SESSION — a re-render, a refetch, and even a
 *     fresh mount (the keyed ConversationView remount) stay hidden;
 *   - the notice links /billing (plain Link, per surrounding code).
 *
 * jsdom via createRoot + act (repo convention — no @testing-library). Layout
 * and look are owed to the real-browser gates, not asserted here.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface QueryState {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
}

// Mutable per-test — read at CALL time inside the hoisted mock factory
// (billing-surface.test.tsx's established shape).
let subState: QueryState = {
  data: { tier: "free", status: "inactive", currentPeriodEnd: null, hasSubscription: false },
  isLoading: false,
  isError: false,
};
let usageState: QueryState = {
  data: { dailyIngestUsed: 0, monthlyChatTurnsUsed: 0 },
  isLoading: false,
  isError: false,
};

vi.mock("~/trpc/react", () => ({
  api: {
    billing: {
      currentSubscription: { useQuery: () => subState },
      usage: { useQuery: () => usageState },
    },
  },
}));

import {
  APPROACHING_CAP_FRACTION,
  approachingCapNoticeFor,
  resetUpsellBannerDismissalForTests,
} from "../../_hooks/turn-cap-notices";
import { UpsellBanner } from "../upsell-banner";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function mount(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<UpsellBanner />);
  });
}

async function rerender(): Promise<void> {
  await act(async () => {
    root!.render(<UpsellBanner />);
  });
}

/** Tolerant teardown — the pure-derivation tests never mount at all. */
async function unmount(): Promise<void> {
  const current = root;
  root = null;
  if (current) {
    await act(async () => {
      current.unmount();
    });
  }
  container?.remove();
  container = null;
}

function setUsage(monthlyChatTurnsUsed: number): void {
  usageState = {
    data: { dailyIngestUsed: 0, monthlyChatTurnsUsed },
    isLoading: false,
    isError: false,
  };
}

function setTier(tier: string): void {
  subState = {
    data: { tier, status: "active", currentPeriodEnd: null, hasSubscription: tier !== "free" },
    isLoading: false,
    isError: false,
  };
}

function bannerText(): string {
  return container!.textContent ?? "";
}

function billingLink(): HTMLAnchorElement | null {
  return container!.querySelector('a[href="/billing"]');
}

function dismissButton(): HTMLButtonElement | null {
  return container!.querySelector('button[aria-label="Dismiss"]');
}

beforeEach(() => {
  resetUpsellBannerDismissalForTests();
  setTier("free");
  setUsage(0);
});

afterEach(async () => {
  await unmount();
});

// ---------------------------------------------------------------------------
// approachingCapNoticeFor — the pure derivation
// ---------------------------------------------------------------------------

describe("approachingCapNoticeFor", () => {
  it("free tier at exactly 80% of the entitlement — notice with the REAL cap (entitlementsFor, not hardcoded)", () => {
    // free's monthlyChatTurns is 200 (ENTITLEMENTS) → threshold 160.
    expect(
      approachingCapNoticeFor({ tier: "free", monthlyChatTurnsUsed: 160 }),
    ).toEqual({ used: 160, cap: 200 });
  });

  it("just below the threshold — null", () => {
    expect(
      approachingCapNoticeFor({ tier: "free", monthlyChatTurnsUsed: 159 }),
    ).toBeNull();
  });

  it("pro tier crosses at 80% of ITS OWN cap (2,000 → 1,600), not free's", () => {
    expect(
      approachingCapNoticeFor({ tier: "pro", monthlyChatTurnsUsed: 1599 }),
    ).toBeNull();
    expect(
      approachingCapNoticeFor({ tier: "pro", monthlyChatTurnsUsed: 1600 }),
    ).toEqual({ used: 1600, cap: 2000 });
  });

  it("power (unlimited) NEVER produces a notice, at any usage", () => {
    expect(
      approachingCapNoticeFor({ tier: "power", monthlyChatTurnsUsed: 999999 }),
    ).toBeNull();
  });

  it("absent tier or usage fails quiet — null", () => {
    expect(
      approachingCapNoticeFor({ tier: undefined, monthlyChatTurnsUsed: 500 }),
    ).toBeNull();
    expect(
      approachingCapNoticeFor({ tier: "free", monthlyChatTurnsUsed: undefined }),
    ).toBeNull();
  });

  it("the threshold is the exported fraction (0.8) — the copy and the gate agree", () => {
    expect(APPROACHING_CAP_FRACTION).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// UpsellBanner — the mounted surface
// ---------------------------------------------------------------------------

describe("UpsellBanner", () => {
  it("shows at >= 80% on a finite tier, reading out used and cap, with a /billing link", async () => {
    setUsage(160); // free cap 200 → 80%
    await mount();

    expect(bannerText()).toContain(
      "You've used 160 of 200 included chat turns this month",
    );
    const link = billingLink();
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain("see Billing");
  });

  it("stays hidden below the threshold", async () => {
    setUsage(159);
    await mount();
    expect(bannerText()).toBe("");
    expect(billingLink()).toBeNull();
  });

  it("NEVER shows for power (unlimited), no matter the usage", async () => {
    setTier("power");
    setUsage(1_000_000);
    await mount();
    expect(bannerText()).toBe("");
  });

  it("fail-quiet: renders nothing while either query is loading", async () => {
    setUsage(200);
    usageState = { ...usageState, isLoading: true, data: undefined };
    await mount();
    expect(bannerText()).toBe("");

    await unmount();
    setUsage(200);
    subState = { ...subState, isLoading: true, data: undefined };
    await mount();
    expect(bannerText()).toBe("");
  });

  it("fail-quiet: renders nothing when either query errored", async () => {
    setUsage(200);
    usageState = { ...usageState, isError: true, data: undefined };
    await mount();
    expect(bannerText()).toBe("");

    await unmount();
    setUsage(200);
    subState = { ...subState, isError: true, data: undefined };
    await mount();
    expect(bannerText()).toBe("");
  });

  it("fail-quiet: renders nothing when usage data is absent (resolved but empty)", async () => {
    usageState = { data: undefined, isLoading: false, isError: false };
    await mount();
    expect(bannerText()).toBe("");
  });

  it("dismiss latches for the session: hidden after the click, across re-renders, AND on a fresh mount", async () => {
    setUsage(160);
    await mount();
    expect(billingLink()).not.toBeNull();

    await act(async () => {
      dismissButton()!.click();
    });
    expect(bannerText()).toBe("");

    // A refetch bumping usage still stays hidden — the latch, not the data.
    setUsage(190);
    await rerender();
    expect(bannerText()).toBe("");

    // The keyed ConversationView remount (conversation switch) — a FRESH
    // mount in the same session must stay hidden too: the latch is module-
    // scoped, not per-mount.
    await unmount();
    await mount();
    expect(bannerText()).toBe("");
  });
});
