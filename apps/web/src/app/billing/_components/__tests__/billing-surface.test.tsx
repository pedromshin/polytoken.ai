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

let subData: Sub = { tier: "free", status: "inactive", currentPeriodEnd: null, hasSubscription: false };
const checkoutMutate = vi.fn();
const portalMutate = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("~/trpc/react", () => ({
  api: {
    billing: {
      currentSubscription: { useQuery: () => ({ data: subData, isLoading: false }) },
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

  it("renders the concrete per-tier entitlement caps from ENTITLEMENTS", async () => {
    await mount();
    const text = container.textContent ?? "";
    // Labels (text-2xs) present for the limits.
    expect(text).toContain("Daily email ingest");
    expect(text).toContain("Monthly chat turns");
    // free (current-plan section): 100 emails/day, 200 chat turns/mo.
    expect(text).toContain("100 / day");
    expect(text).toContain("200 / mo");
    // pro card: 500 emails/day, 2,000 chat turns/mo.
    expect(text).toContain("500 / day");
    expect(text).toContain("2,000 / mo");
    // power card: 2,000 emails/day, unlimited chat turns.
    expect(text).toContain("2,000 / day");
    expect(text).toContain("Unlimited");
  });

  it("shows the current plan's own caps (pro) in the current-plan section", async () => {
    subData = {
      tier: "pro",
      status: "active",
      currentPeriodEnd: new Date("2099-01-01"),
      hasSubscription: true,
    };
    await mount();
    const text = container.textContent ?? "";
    // pro caps must appear at least twice: once in the current-plan section,
    // once on the pro card.
    expect(text.match(/500 \/ day/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(text.match(/2,000 \/ mo/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
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
