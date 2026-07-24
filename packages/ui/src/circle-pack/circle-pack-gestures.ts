/**
 * circle-pack-gestures.ts — the pure touch-gesture recognizers for the shared
 * `CirclePack` primitive (FEATURE-CATALOG TM-01).
 *
 * Touch has no Escape key and no mouse-wheel, so the two ways a finger asks to
 * back OUT of a drilled-in pack — a DOUBLE-TAP and a PINCH-OUT (two fingers
 * spreading apart) — are recognized here as framework-free predicates. Kept DOM-
 * free so the recognition thresholds are unit-testable in jsdom (which fires no
 * real TouchEvents and does no layout) — the component only wires these to
 * `onTouch*` and dispatches `zoomOut` when they fire.
 */

/** A single tap's timestamp (ms) and screen position. */
export interface TapRecord {
  readonly time: number;
  readonly x: number;
  readonly y: number;
}

/** Max gap between two taps for a double-tap (ms). */
export const DOUBLE_TAP_MS = 300;
/** Max travel between two taps for a double-tap (px) — a fat-finger tolerance. */
export const DOUBLE_TAP_SLOP = 30;
/**
 * How much two fingers must SPREAD (px of the pinch span) for a pinch-out to
 * register. Small enough to feel responsive, large enough that a resting
 * two-finger touch isn't mistaken for a gesture.
 */
export const PINCH_OUT_THRESHOLD = 24;

/**
 * isDoubleTap — did `next` land close enough, soon enough, after `prev` to be
 * the second tap of a double-tap? A missing `prev` (the first tap ever) is never
 * a double-tap.
 */
export function isDoubleTap(
  prev: TapRecord | null,
  next: TapRecord,
  windowMs: number = DOUBLE_TAP_MS,
  slop: number = DOUBLE_TAP_SLOP,
): boolean {
  if (prev === null) return false;
  const dt = next.time - prev.time;
  if (dt < 0 || dt > windowMs) return false;
  return Math.hypot(next.x - prev.x, next.y - prev.y) <= slop;
}

/** Euclidean distance between two touch points (the "pinch span"). */
export function touchSpan(
  a: { readonly clientX: number; readonly clientY: number },
  b: { readonly clientX: number; readonly clientY: number },
): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * isPinchOut — has the two-finger span grown by at least `threshold` since the
 * gesture began? A pinch-out (fingers spreading) is the touch idiom for "zoom
 * out" of a drilled-in view. Shrinking or holding steady is not a pinch-out.
 */
export function isPinchOut(
  startSpan: number,
  currentSpan: number,
  threshold: number = PINCH_OUT_THRESHOLD,
): boolean {
  return currentSpan - startSpan >= threshold;
}
