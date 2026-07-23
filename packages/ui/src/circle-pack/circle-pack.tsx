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

import { cn } from "@polytoken/ui";

import {
  packCircles,
  type CircleDatum,
  type PackedCircle,
  type PackOptions,
} from "./circle-pack-layout";
import {
  circlePackNavReducer,
  createCircleNavIndex,
  initialCirclePackNavState,
  type CirclePackNavState,
} from "./circle-pack-zoom";

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

  const handleCircleClick = useCallback(
    (circle: PackedCircle<TLeaf>) => {
      dispatch({ type: "focus", id: circle.id });
      if (circle.isLeaf) onLeafActivate?.(circle);
    },
    [onLeafActivate],
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

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={handleKeyDown}
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
