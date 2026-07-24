"use client";

/**
 * circle-pack.tsx — the shared, reusable `CirclePack` primitive (FEATURE-CATALOG
 * TM-01): a zoomable circle-packing view rendered with React + SVG over the pure
 * `d3.pack()` layout in `circle-pack-layout.ts`. Both the email view (TM-02) and
 * the drive view (TM-04) consume THIS — build once.
 *
 * WHAT IT OWNS
 *   - packed-circle layout (via `packCircles`, layout-only d3-hierarchy math)
 *   - click-to-zoom with an animated viewBox focus transition (Bostock's
 *     zoomable-circle-packing interaction, ported — NOT d3-zoom, which would
 *     fight a host's own pan/zoom)
 *   - a hover card (default: name + value; overridable via `renderHoverCard`)
 *   - a LEAF RENDERER SLOT (`renderLeaf`) — callers supply the SVG content that
 *     goes inside each leaf circle (a type shape, an initial, an icon …)
 *   - keyboard navigation: Arrow = sibling / parent / child, Enter = zoom in,
 *     Esc = zoom out (the exact contract the catalog specifies)
 *
 * DESIGN LAW (theme-aware, D-58-01)
 *   Chrome is monochrome (law 1): circles are ink washes and hairline rules, the
 *   cursor/selection ring is INK, never a hue. A leaf's `tint` (recency/unread)
 *   is a MONOCHROME ink-alpha ramp, not a colour scale — a landscape heatmap
 *   that stays chrome. Every value resolves through a `var(--token)` so both
 *   themes are honoured by the host's token ladder; the component itself commits
 *   to no literal colour.
 */

import * as React from "react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ChevronRight, CornerLeftUp, House } from "lucide-react";

import { cn } from "@polytoken/ui";

import {
  packCircles,
  type CircleDatum,
  type PackedCircle,
  type PackOptions,
} from "./circle-pack-layout";
import {
  ancestorsOf,
  CIRCLE_PACK_ROOT_ID,
  circlePackNavReducer,
  createCircleNavIndex,
  initialCirclePackNavState,
  type CirclePackNavState,
} from "./circle-pack-zoom";
import {
  isDoubleTap,
  isPinchOut,
  touchSpan,
  type TapRecord,
} from "./circle-pack-gestures";

export type { CircleDatum, PackedCircle } from "./circle-pack-layout";

/** Args handed to the leaf render-prop for one leaf circle. */
export interface CirclePackLeafRenderArgs<TLeaf> {
  readonly circle: PackedCircle<TLeaf>;
  readonly focused: boolean;
  readonly hovered: boolean;
}

export interface CirclePackProps<TLeaf = unknown> {
  readonly data: CircleDatum<TLeaf>;
  readonly width: number;
  readonly height: number;
  readonly padding?: number;
  /** SVG content rendered inside each LEAF circle, centred at the circle. The
   * caller owns this slot; omit for bare circles. */
  readonly renderLeaf?: (args: CirclePackLeafRenderArgs<TLeaf>) => React.ReactNode;
  /** Overrides the default hover card (name + value). */
  readonly renderHoverCard?: (circle: PackedCircle<TLeaf>) => React.ReactNode;
  /** Fired when a LEAF circle is clicked or activated with Enter. */
  readonly onLeafActivate?: (circle: PackedCircle<TLeaf>) => void;
  /** Accessible name for the whole view. */
  readonly ariaLabel?: string;
  readonly className?: string;
}

/** Clamp a tint into [0,1]; absent ⇒ a mid wash so a leaf is always visible. */
function clampTint(tint: number | undefined): number {
  if (tint === undefined || Number.isNaN(tint)) return 0.5;
  return Math.min(1, Math.max(0, tint));
}

/** The animated viewport frame: centre + radius, in layout user units. */
interface ViewFrame {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

function frameOf(circle: PackedCircle<unknown> | undefined, fallbackR: number): ViewFrame {
  if (!circle) return { cx: fallbackR, cy: fallbackR, r: fallbackR };
  return { cx: circle.x, cy: circle.y, r: circle.r };
}

/**
 * CirclePack — the primitive. Generic over the opaque leaf payload `TLeaf`.
 */
export function CirclePack<TLeaf = unknown>({
  data,
  width,
  height,
  padding = 3,
  renderLeaf,
  renderHoverCard,
  onLeafActivate,
  ariaLabel = "Circle-pack view",
  className,
}: CirclePackProps<TLeaf>): React.ReactElement {
  const opts: PackOptions = useMemo(
    () => ({ width, height, padding }),
    [width, height, padding],
  );
  const circles = useMemo(() => packCircles<TLeaf>(data, opts), [data, opts]);
  const index = useMemo(() => createCircleNavIndex(circles), [circles]);
  const byId = useMemo(() => {
    const m = new Map<string, PackedCircle<TLeaf>>();
    for (const c of circles) m.set(c.id, c);
    return m;
  }, [circles]);

  const [nav, dispatch] = useReducer(
    (state: CirclePackNavState, action: Parameters<typeof circlePackNavReducer>[1]) =>
      circlePackNavReducer(state, action, index),
    undefined,
    initialCirclePackNavState,
  );

  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // ── animated zoom: interpolate the viewBox toward the focus circle ────────
  const focusCircle = byId.get(nav.focusId);
  const targetFrame = frameOf(focusCircle, Math.min(width, height) / 2);
  const [frame, setFrame] = useState<ViewFrame>(targetFrame);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = frameRef.current;
    const to = targetFrame;
    // jsdom / reduced-motion / no rAF: jump straight to the target so the view
    // is always correct even where animation can't run.
    const prefersReduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (typeof requestAnimationFrame !== "function" || prefersReduced) {
      setFrame(to);
      return;
    }
    const start = Date.now();
    const DURATION = 420;
    const tick = (): void => {
      const t = Math.min(1, (Date.now() - start) / DURATION);
      // easeInOutCubic
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      setFrame({
        cx: from.cx + (to.cx - from.cx) * e,
        cy: from.cy + (to.cy - from.cy) * e,
        r: from.r + (to.r - from.r) * e,
      });
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.focusId]);

  // Keep the viewBox correct when the CONTAINER RESIZES (no animation). The
  // layout re-packs to the new width/height, and targetFrame's radius is
  // min(width, height) / 2 — but the animation effect above only re-runs on a
  // focus change, so without this the frame stays sized for the previous box
  // and the circle mis-scales / drifts off-centre. This bit on mobile: the SSR
  // fallback (720×560) then the ResizeObserver's real size, and every mobile
  // address-bar show/hide, are pure size changes with no focus change. Snap the
  // frame to the freshly-derived target so the pack always fills its box.
  useEffect(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    setFrame(frameOf(byId.get(nav.focusId), Math.min(width, height) / 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  const viewMinX = frame.cx - frame.r;
  const viewMinY = frame.cy - frame.r;
  const viewSize = frame.r * 2;

  // ── touch zoom-OUT gestures (touch has no Esc key / mouse-wheel) ───────────
  // A double-tap and a pinch-out are the two finger idioms for "back out". They
  // are recognized by the pure predicates in circle-pack-gestures.ts and both
  // dispatch the SAME `zoomOut` — one zoom implementation, no fork. When a
  // gesture fires we set `suppressClickRef` so the browser-synthesized click
  // that trails a tap does not also re-drill.
  const lastTapRef = useRef<TapRecord | null>(null);
  const pinchStartRef = useRef<number | null>(null);
  const pinchFiredRef = useRef(false);
  const multiTouchRef = useRef(false);
  const suppressClickRef = useRef(false);

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length >= 2) {
      multiTouchRef.current = true;
      pinchFiredRef.current = false;
      pinchStartRef.current = touchSpan(event.touches[0]!, event.touches[1]!);
    }
  }, []);

  const handleTouchMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (
      event.touches.length >= 2 &&
      pinchStartRef.current !== null &&
      !pinchFiredRef.current &&
      isPinchOut(pinchStartRef.current, touchSpan(event.touches[0]!, event.touches[1]!))
    ) {
      pinchFiredRef.current = true;
      suppressClickRef.current = true;
      dispatch({ type: "zoomOut" });
    }
  }, []);

  const handleTouchEnd = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length > 0) return; // fingers still down — gesture ongoing
    const wasMultiTouch = multiTouchRef.current;
    multiTouchRef.current = false;
    pinchStartRef.current = null;
    pinchFiredRef.current = false;
    // A two-finger gesture never counts as a tap toward a double-tap.
    if (wasMultiTouch) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const rec: TapRecord = { time: Date.now(), x: touch.clientX, y: touch.clientY };
    if (isDoubleTap(lastTapRef.current, rec)) {
      lastTapRef.current = null;
      suppressClickRef.current = true; // swallow the second tap's drill-in click
      dispatch({ type: "zoomOut" });
    } else {
      lastTapRef.current = rec;
    }
  }, []);

  const handleCircleClick = useCallback(
    (circle: PackedCircle<TLeaf>) => {
      // A gesture (double-tap / pinch-out) already handled this touch as a
      // zoom-OUT — swallow the trailing synthesized click so it doesn't re-drill.
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      // Tapping the circle you are already zoomed to zooms OUT to its parent
      // (Bostock's convention). Without this — and with Escape being the only
      // other zoom-out — touch users had no way back up the hierarchy.
      if (!circle.isLeaf && circle.id === nav.focusId) {
        dispatch({ type: "zoomOut" });
        return;
      }
      dispatch({ type: "focus", id: circle.id });
      if (circle.isLeaf) onLeafActivate?.(circle);
    },
    [onLeafActivate, nav.focusId],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          dispatch({ type: "sibling", dir: "next" });
          break;
        case "ArrowLeft":
          event.preventDefault();
          dispatch({ type: "sibling", dir: "prev" });
          break;
        case "ArrowDown":
          event.preventDefault();
          dispatch({ type: "child" });
          break;
        case "ArrowUp":
          event.preventDefault();
          dispatch({ type: "parent" });
          break;
        case "Enter": {
          event.preventDefault();
          const cursor = byId.get(nav.cursorId);
          if (cursor?.isLeaf) onLeafActivate?.(cursor);
          dispatch({ type: "zoomIn" });
          break;
        }
        case "Escape":
          event.preventDefault();
          dispatch({ type: "zoomOut" });
          break;
        default:
          break;
      }
    },
    [byId, nav.cursorId, onLeafActivate],
  );

  // Map a layout point to a screen offset within the container (for the card).
  const toScreen = useCallback(
    (cx: number, cy: number): { left: number; top: number } => ({
      left: ((cx - viewMinX) / viewSize) * width,
      top: ((cy - viewMinY) / viewSize) * height,
    }),
    [viewMinX, viewMinY, viewSize, width, height],
  );

  const hovered = hoveredId ? byId.get(hoveredId) : undefined;

  // The drill path root → … → focus, as clickable crumbs. Empty at the root
  // (nothing to trail back through), so the whole nav bar hides at full zoom-out.
  const trail = useMemo(
    () =>
      ancestorsOf(index, nav.focusId)
        .map((id) => byId.get(id))
        .filter((c): c is PackedCircle<TLeaf> => c !== undefined),
    [index, nav.focusId, byId],
  );
  const zoomedIn = nav.focusId !== CIRCLE_PACK_ROOT_ID;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      data-testid="circle-pack"
      className={cn(
        "relative select-none overflow-hidden rounded-card bg-bright outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
        className,
      )}
      style={{ width, height }}
    >
      <svg
        width={width}
        height={height}
        viewBox={`${viewMinX} ${viewMinY} ${viewSize} ${viewSize}`}
        preserveAspectRatio="xMidYMid meet"
        role="presentation"
      >
        {circles.map((circle) => {
          const isCursor = circle.id === nav.cursorId;
          const isHovered = circle.id === hoveredId;
          const isFocus = circle.id === nav.focusId;
          const tint = clampTint(circle.datum.tint);
          // Leaves: an ink wash whose alpha encodes tint (recency/unread).
          // Containers: near-transparent so descendants read through them.
          const fillOpacity = circle.isLeaf ? 0.12 + tint * 0.5 : 0.03;
          return (
            <g
              key={circle.id}
              data-circle-id={circle.id}
              data-leaf={circle.isLeaf ? "true" : "false"}
              transform={`translate(${circle.x},${circle.y})`}
              onClick={(event) => {
                event.stopPropagation();
                handleCircleClick(circle);
              }}
              onMouseEnter={() => setHoveredId(circle.id)}
              onMouseLeave={() =>
                setHoveredId((prev) => (prev === circle.id ? null : prev))
              }
              className="cursor-pointer"
            >
              <circle
                r={circle.r}
                fill="var(--ink)"
                fillOpacity={fillOpacity}
                stroke={isCursor || isHovered ? "var(--ink)" : "var(--rule)"}
                strokeOpacity={isCursor || isHovered ? 1 : 0.6}
                strokeWidth={
                  (isCursor ? 2 : 1) / (viewSize / Math.min(width, height))
                }
                vectorEffect="non-scaling-stroke"
              />
              {circle.isLeaf && renderLeaf
                ? renderLeaf({ circle, focused: isFocus, hovered: isHovered })
                : null}
            </g>
          );
        })}
      </svg>

      {/* Zoom-OUT chrome — only while drilled in (so the root view stays clean).
          BACK steps up one level; the BREADCRUMB jumps to any ancestor; RESET
          (home) returns to the root. All three are just `zoomOut` / `focus` /
          `reset` on the one nav reducer — no second zoom implementation. */}
      {zoomedIn ? (
        <div
          data-testid="circle-pack-nav"
          className="pointer-events-none absolute inset-x-2 top-2 z-10 flex items-center gap-1.5"
        >
          <button
            type="button"
            data-testid="circle-pack-zoom-out"
            aria-label="Zoom out"
            title="Back (up one level)"
            onClick={() => dispatch({ type: "zoomOut" })}
            className="pointer-events-auto flex size-9 shrink-0 items-center justify-center rounded-full border border-rule bg-bright text-ink transition-colors hover:bg-ink-08 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
          >
            <CornerLeftUp className="size-4" aria-hidden />
          </button>

          <nav
            aria-label="Breadcrumb"
            data-testid="circle-pack-breadcrumb"
            className="pointer-events-auto flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden rounded-full border border-rule bg-bright px-2 py-1"
          >
            {trail.map((circle, i) => {
              const isLast = i === trail.length - 1;
              const isRoot = circle.id === CIRCLE_PACK_ROOT_ID;
              return (
                <React.Fragment key={circle.id}>
                  {i > 0 ? (
                    <ChevronRight className="size-3 shrink-0 text-faded" aria-hidden />
                  ) : null}
                  <button
                    type="button"
                    data-testid="circle-pack-crumb"
                    data-crumb-id={circle.id}
                    aria-current={isLast ? "location" : undefined}
                    disabled={isLast}
                    onClick={() =>
                      dispatch(
                        isRoot
                          ? { type: "reset" }
                          : { type: "focus", id: circle.id },
                      )
                    }
                    className={cn(
                      "max-w-[9rem] shrink-0 truncate rounded-sm px-1 text-xs transition-colors",
                      isLast
                        ? "font-medium text-ink"
                        : "text-faded hover:text-ink hover:underline",
                    )}
                  >
                    {circle.datum.name}
                  </button>
                </React.Fragment>
              );
            })}
          </nav>

          <button
            type="button"
            data-testid="circle-pack-reset"
            aria-label="Reset to root"
            title="Reset to root"
            onClick={() => dispatch({ type: "reset" })}
            className="pointer-events-auto flex size-9 shrink-0 items-center justify-center rounded-full border border-rule bg-bright text-ink transition-colors hover:bg-ink-08 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
          >
            <House className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}

      {hovered ? (
        <div
          data-testid="circle-pack-hover-card"
          role="tooltip"
          className="pointer-events-none absolute z-10 max-w-[220px] -translate-x-1/2 -translate-y-full rounded-md border border-rule bg-bright px-chip-x py-chip-y text-xs text-ink shadow-none"
          style={{
            left: toScreen(hovered.x, hovered.y - hovered.r).left,
            top: toScreen(hovered.x, hovered.y - hovered.r).top,
          }}
        >
          {renderHoverCard ? (
            renderHoverCard(hovered)
          ) : (
            <span className="flex flex-col gap-0.5">
              <span className="truncate font-medium text-ink">{hovered.datum.name}</span>
              <span className="tabular text-faded">
                {hovered.value.toLocaleString()}
                {hovered.isLeaf ? "" : " total"}
              </span>
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
