/**
 * circle-pack-layout.ts — the pure d3-hierarchy layout math behind the shared
 * `CirclePack` primitive (FEATURE-CATALOG TM-01).
 *
 * This module is LAYOUT ONLY: it turns a containment hierarchy into positioned
 * circles (`x`, `y`, `r` per node) via `d3.pack()` and returns a flat, plain
 * array. It renders nothing and imports no React — the SVG rendering lives in
 * `circle-pack.tsx`, so the math stays unit-testable in jsdom (which does no
 * layout) and reusable by both the email view (TM-02) and the drive view
 * (TM-04) exactly as the ecosystem research prescribes ("d3-hierarchy as the
 * layout engine only … render the circles as React/SVG").
 *
 * `d3.pack()` guarantees CONTAINMENT: every child circle sits fully inside its
 * parent. `packCircles` preserves that guarantee and additionally assigns each
 * node a STABLE, path-derived id (`0`, `0/2`, `0/2/1`, …) so the React layer,
 * the zoom state machine (`circle-pack-zoom.ts`), and callers can key on a node
 * without relying on object identity across re-layouts.
 */

import { hierarchy, pack } from "d3-hierarchy";

/**
 * One node of the input hierarchy. Generic over an opaque `leaf` payload the
 * caller threads through to its leaf renderer / click handler (an email id, a
 * file id, an entity ref …) — the primitive never inspects it.
 */
export interface CircleDatum<TLeaf = unknown> {
  /** Human label for the node (used by the default hover card / a11y name). */
  readonly name: string;
  /** Leaf weight. Only meaningful on leaves; internal nodes derive their value
   * by summing descendants (`d3.hierarchy(...).sum`). Negative/absent ⇒ 0. */
  readonly value?: number;
  readonly children?: ReadonlyArray<CircleDatum<TLeaf>>;
  /** Opaque caller payload, surfaced back on the packed circle. */
  readonly leaf?: TLeaf;
  /**
   * A MONOCHROME intensity in [0,1] (e.g. recency or unread density). The
   * primitive maps it to an ink wash, never a hue — design law 1 ("colour is
   * earned"): a landscape heatmap is legible as an ink-alpha ramp and stays
   * chrome-monochrome. Out-of-range values are clamped by the renderer.
   */
  readonly tint?: number;
}

/** One positioned circle in the packed layout — a plain, serializable record. */
export interface PackedCircle<TLeaf = unknown> {
  /** Stable path id (`0` = root, `0/1` = second child of root, …). */
  readonly id: string;
  readonly datum: CircleDatum<TLeaf>;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly depth: number;
  readonly parentId: string | null;
  readonly isLeaf: boolean;
  /** Summed leaf value (own `value` for a leaf). */
  readonly value: number;
  readonly childIds: readonly string[];
}

export interface PackOptions {
  readonly width: number;
  readonly height: number;
  /** Gap between sibling circles (d3 `pack.padding`). Default 3. */
  readonly padding?: number;
}

/**
 * packCircles — lay a hierarchy out as packed circles.
 *
 * Pure: same input ⇒ same output, no DOM, no side effects. Leaves are summed
 * and siblings sorted largest-first (the conventional pack ordering) so the
 * layout is deterministic across renders.
 */
export function packCircles<TLeaf = unknown>(
  rootDatum: CircleDatum<TLeaf>,
  { width, height, padding = 3 }: PackOptions,
): PackedCircle<TLeaf>[] {
  const root = hierarchy<CircleDatum<TLeaf>>(
    rootDatum,
    (d) => d.children as CircleDatum<TLeaf>[] | undefined,
  )
    .sum((d) => Math.max(0, d.value ?? 0))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const layout = pack<CircleDatum<TLeaf>>()
    .size([Math.max(1, width), Math.max(1, height)])
    .padding(padding);

  const packed = layout(root);

  const out: PackedCircle<TLeaf>[] = [];
  const walk = (
    node: typeof packed,
    id: string,
    parentId: string | null,
  ): void => {
    const children = node.children ?? [];
    out.push({
      id,
      datum: node.data,
      x: node.x,
      y: node.y,
      r: node.r,
      depth: node.depth,
      parentId,
      isLeaf: children.length === 0,
      value: node.value ?? 0,
      childIds: children.map((_, i) => `${id}/${i}`),
    });
    children.forEach((child, i) => walk(child, `${id}/${i}`, id));
  };
  walk(packed, "0", null);
  return out;
}
