/**
 * desktop-cost.test.ts — the money math for the cloud-desktop live cost ticker
 * (E5 / RFC §5.3). Pure arithmetic, so this is exhaustive to the cent: rate ×
 * elapsed, the zero-duration floor, fractional-cent preservation vs. display
 * rounding, and the clamps that stop a tampered row or a skewed clock from ever
 * printing a negative bill.
 */
import { describe, expect, it } from "vitest";

import {
  accruedCents,
  accruedUsdLabel,
  elapsedRunningMs,
  formatHourlyRate,
  formatUsd,
} from "./desktop-cost";

const HOUR = 3_600_000;

describe("accruedCents — rate × elapsed", () => {
  it("a full hour at the declared rate accrues exactly the rate", () => {
    expect(accruedCents(5, HOUR)).toBe(5);
    expect(accruedCents(250, HOUR)).toBe(250);
  });

  it("prorates linearly under an hour (half hour = half the rate)", () => {
    expect(accruedCents(5, HOUR / 2)).toBeCloseTo(2.5, 10);
    expect(accruedCents(120, HOUR / 4)).toBeCloseTo(30, 10);
  });

  it("preserves FRACTIONAL cents (5¢/h after one minute is a sub-cent)", () => {
    // 5 cents/hr × 60_000ms / 3_600_000ms = 0.0833… cents
    expect(accruedCents(5, 60_000)).toBeCloseTo(0.08333, 4);
  });

  it("accumulates many hours without drift", () => {
    expect(accruedCents(5, 8 * HOUR)).toBe(40); // an 8h max-lifetime run at 5¢/h
  });
});

describe("accruedCents — zero-duration + clamps", () => {
  it("zero elapsed accrues nothing", () => {
    expect(accruedCents(5, 0)).toBe(0);
  });

  it("a zero or non-positive rate accrues nothing (a free/destroyed session never bills)", () => {
    expect(accruedCents(0, HOUR)).toBe(0);
    expect(accruedCents(-5, HOUR)).toBe(0);
  });

  it("a negative elapsed (clock skew) clamps to zero, never a negative bill", () => {
    expect(accruedCents(5, -HOUR)).toBe(0);
  });

  it("non-finite inputs clamp to zero (a tampered row cannot invent money)", () => {
    expect(accruedCents(Number.NaN, HOUR)).toBe(0);
    expect(accruedCents(5, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("elapsedRunningMs — started_at → now", () => {
  it("returns the forward delta", () => {
    expect(elapsedRunningMs(1_000, 1_000 + HOUR)).toBe(HOUR);
  });

  it("clamps a future started_at (or equal) to zero", () => {
    expect(elapsedRunningMs(5_000, 4_000)).toBe(0);
    expect(elapsedRunningMs(5_000, 5_000)).toBe(0);
  });

  it("non-finite bounds clamp to zero", () => {
    expect(elapsedRunningMs(Number.NaN, 10)).toBe(0);
    expect(elapsedRunningMs(10, Number.NaN)).toBe(0);
  });
});

describe("formatUsd — display rounding at the cent, only here", () => {
  it("renders whole and fractional cents to two decimals", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(5)).toBe("$0.05");
    expect(formatUsd(250)).toBe("$2.50");
  });

  it("rounds a sub-cent accrual DOWN to $0.00 (honest: not yet a cent)", () => {
    expect(formatUsd(accruedCents(5, 60_000))).toBe("$0.00");
  });

  it("crosses to $0.01 once a full cent has accrued", () => {
    // 5¢/h reaches 1 cent at 12 minutes (720_000ms).
    expect(formatUsd(accruedCents(5, 720_000))).toBe("$0.01");
  });

  it("negative / non-finite reads $0.00", () => {
    expect(formatUsd(-3)).toBe("$0.00");
    expect(formatUsd(Number.NaN)).toBe("$0.00");
  });
});

describe("formatHourlyRate + accruedUsdLabel — the ticker's rendered strings", () => {
  it("formats the per-hour rate with a /hr suffix", () => {
    expect(formatHourlyRate(5)).toBe("$0.05/hr");
    expect(formatHourlyRate(250)).toBe("$2.50/hr");
    expect(formatHourlyRate(0)).toBe("$0.00/hr");
  });

  it("accruedUsdLabel composes accrual + format in one call", () => {
    expect(accruedUsdLabel(5, HOUR)).toBe("$0.05");
    expect(accruedUsdLabel(250, 2 * HOUR)).toBe("$5.00");
    expect(accruedUsdLabel(5, 0)).toBe("$0.00");
  });
});
