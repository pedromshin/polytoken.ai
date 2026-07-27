/**
 * billing-surface.test.tsx — the /billing client surface (C1).
 *
 * jsdom via createRoot + act (this repo's convention — no @testing-library):
 * proves the plan copy, the current-plan readout, and that a Subscribe/Manage
 * click fires the right mutation. Layout/look is NOT asserted here — jsdom does
 * no layout; that's owed to screenshot/geometry.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Sub {
  tier: string;
  status: string;
  currentPeriodEnd: Date | null;
  hasSubscription: boolean;
}

interface UsageData {
  dailyIngestUsed: number;
  monthlyChatTurnsUsed: number;
}

let subData: Sub = { tier: "free", status: "inactive", currentPeriodEnd: null, hasSubscription: false };
let usageData: UsageData = { dailyIngestUsed: 0, monthlyChatTurnsUsed: 0 };
const checkoutMutate = vi.fn();
const portalMutate = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("~/trpc/react", () => ({
  api: {
    billing: {
      currentSubscription: { useQuery: () => ({ data: subData, isLoading: false }) },
      usage: { useQuery: () => ({ data: usageData, isLoading: false }) },
      createCheckoutSession: {
        useMutation: () => ({ mutate: checkoutMutate, isPending: false, variables: undefined }),
      },
      createPortalSession: {
        useMutation: () => ({ mutate: portalMutate, isPending: false }),
      },
    },
  },
}));

import { BillingSurface } from "../billing-surface";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<BillingSurface />);
  });
}

function button(re: RegExp): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((b) =>
    re.test(b.textContent ?? ""),
  ) as HTMLButtonElement | undefined;
}

beforeEach(() => {
  subData = { tier: "free", status: "inactive", currentPeriodEnd: null, hasSubscription: false };
  usageData = { dailyIngestUsed: 0, monthlyChatTurnsUsed: 0 };
  checkoutMutate.mockClear();
  portalMutate.mockClear();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("BillingSurface", () => {
  it("renders both paid tiers with their prices", async () => {
    await mount();
    const text = container.textContent ?? "";
    expect(text).toContain("Pro");
    expect(text).toContain("Power");
    expect(text).toContain("$29");
    expect(text).toContain("$49");
  });

  it("renders the concrete per-tier entitlement caps from ENTITLEMENTS on the plan cards", async () => {
    await mount();
    const text = container.textContent ?? "";
    // Labels (text-2xs) present for the limits.
    expect(text).toContain("Daily email ingest");
    expect(text).toContain("Monthly chat turns");
    // pro card: 500 emails/day, 2,000 chat turns/mo (static allowance).
    expect(text).toContain("500 / day");
    expect(text).toContain("2,000 / mo");
    // power card: 2,000 emails/day, unlimited chat turns.
    expect(text).toContain("2,000 / day");
    expect(text).toContain("Unlimited");
  });

  it("shows LIVE usage against the current tier's caps in the current-plan section", async () => {
    // free current tier: caps are 100/day and 200/mo.
    usageData = { dailyIngestUsed: 37, monthlyChatTurnsUsed: 142 };
    await mount();
    const text = container.textContent ?? "";
    // Current-plan section shows "X / Y used" against the free caps.
    expect(text).toContain("37 / 100 used");
    expect(text).toContain("142 / 200 used");
  });

  it("shows 0 usage gracefully when the caller has no rows", async () => {
    usageData = { dailyIngestUsed: 0, monthlyChatTurnsUsed: 0 };
    await mount();
    const text = container.textContent ?? "";
    expect(text).toContain("0 / 100 used");
    expect(text).toContain("0 / 200 used");
  });

  it("shows the used count with no denominator when the tier's chat cap is unlimited (power)", async () => {
    subData = {
      tier: "power",
      status: "active",
      currentPeriodEnd: new Date("2099-01-01"),
      hasSubscription: true,
    };
    usageData = { dailyIngestUsed: 512, monthlyChatTurnsUsed: 4096 };
    await mount();
    const text = container.textContent ?? "";
    // power daily cap is 2,000 → "512 / 2,000 used".
    expect(text).toContain("512 / 2,000 used");
    // power monthlyChatTurns is null (unlimited) → used count, no denominator.
    expect(text).toContain("4,096 used");
  });

  it("shows the current plan's own caps (pro): live usage in current-plan, static on the card", async () => {
    subData = {
      tier: "pro",
      status: "active",
      currentPeriodEnd: new Date("2099-01-01"),
      hasSubscription: true,
    };
    usageData = { dailyIngestUsed: 42, monthlyChatTurnsUsed: 137 };
    await mount();
    const text = container.textContent ?? "";
    // Current-plan section: live usage against pro caps.
    expect(text).toContain("42 / 500 used");
    expect(text).toContain("137 / 2,000 used");
    // pro CARD keeps the static allowance.
    expect(text).toContain("500 / day");
    expect(text).toContain("2,000 / mo");
  });

  it("starts checkout for the clicked tier", async () => {
    await mount();
    const btn = button(/subscribe to power/i);
    expect(btn).toBeTruthy();
    await act(async () => {
      btn!.click();
    });
    expect(checkoutMutate).toHaveBeenCalledWith({ tier: "power" });
  });

  it("marks the active tier as current and offers Manage billing", async () => {
    subData = {
      tier: "pro",
      status: "active",
      currentPeriodEnd: new Date("2099-01-01"),
      hasSubscription: true,
    };
    await mount();
    expect(button(/current plan/i)).toBeTruthy();
    expect(button(/subscribe to pro/i)).toBeUndefined();
    expect(button(/subscribe to power/i)).toBeTruthy();
    expect(button(/manage billing/i)).toBeTruthy();
  });

  it("opens the portal when Manage billing is clicked", async () => {
    subData = {
      tier: "pro",
      status: "active",
      currentPeriodEnd: new Date("2099-01-01"),
      hasSubscription: true,
    };
    await mount();
    await act(async () => {
      button(/manage billing/i)!.click();
    });
    expect(portalMutate).toHaveBeenCalled();
  });
});
