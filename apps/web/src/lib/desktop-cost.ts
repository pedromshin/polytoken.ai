/**
 * desktop-cost.ts — the pure cost-accrual math for a running cloud desktop
 * (E5 / RFC §5.3). A cloud desktop is the second capability class after deep
 * research that burns real money on one user action, and UNLIKE a research run
 * it burns CONTINUOUSLY while it runs (RFC §5.3). This module turns the two
 * facts the control plane owns — the row's `hourly_rate_cents` and how long the
 * session has been running (started_at → now) — into an accrued-cents figure
 * and its display strings.
 *
 * PURE + honest: no `Date.now()` here, no interval, no React. The caller passes
 * `elapsedMs` (the live ticker re-derives it each tick); this file does only
 * rate×time arithmetic and formatting. That split is deliberate — it keeps the
 * money math unit-testable to the cent and the ticking a thin render wrapper
 * (the component owns the clock, this owns the arithmetic).
 *
 * COST VISIBILITY, not billing: this is an on-screen ESTIMATE from the row's
 * declared ceiling rate × wall-clock runtime. The authoritative per-runtime-hour
 * ledger + monthly reconciliation is a separate control-plane seam (RFC §5.3
 * layer 3 / CD-4); nothing here charges a card.
 */

const MS_PER_HOUR = 3_600_000;

/**
 * accruedCents — money burned so far: the row's cents-per-hour rate prorated
 * over the elapsed running time. Fractional cents are PRESERVED (a 5¢/h desktop
 * earns fractions of a cent per second); rounding happens only at display time
 * ({@link formatUsd}), so a long-running total never accumulates rounding drift.
 * A non-finite / non-positive rate or elapsed clamps to 0 — a tampered row or a
 * backwards clock must never invent a negative bill.
 */
export function accruedCents(hourlyRateCents: number, elapsedMs: number): number {
  if (!Number.isFinite(hourlyRateCents) || hourlyRateCents <= 0) return 0;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return (hourlyRateCents * elapsedMs) / MS_PER_HOUR;
}

/**
 * elapsedRunningMs — how long the session has been accruing, started_at → now
 * (both epoch ms). Never negative: a future/ skewed started_at clamps to 0, so
 * the ticker reads $0.00 rather than counting backwards.
 */
export function elapsedRunningMs(startedAtMs: number, nowMs: number): number {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return 0;
  const delta = nowMs - startedAtMs;
  return delta > 0 ? delta : 0;
}

/**
 * formatUsd — cents (possibly fractional) rendered as a "$0.42" money string.
 * Rounds to the cent at DISPLAY only (banker-neutral `toFixed`), never in the
 * accrual math. A non-finite / negative input reads "$0.00".
 */
export function formatUsd(cents: number): string {
  const safe = Number.isFinite(cents) && cents > 0 ? cents : 0;
  return `$${(safe / 100).toFixed(2)}`;
}

/**
 * formatHourlyRate — the declared per-hour rate as "$0.05/hr" — the subordinate
 * chrome shown beside the live accrued total so the burn is legible at a glance.
 */
export function formatHourlyRate(hourlyRateCents: number): string {
  return `${formatUsd(Number.isFinite(hourlyRateCents) && hourlyRateCents > 0 ? hourlyRateCents : 0)}/hr`;
}

/**
 * accruedUsdLabel — the one-call convenience the ticker renders: rate + elapsed
 * → "$0.42". Pure composition of {@link accruedCents} + {@link formatUsd}.
 */
export function accruedUsdLabel(hourlyRateCents: number, elapsedMs: number): string {
  return formatUsd(accruedCents(hourlyRateCents, elapsedMs));
}
