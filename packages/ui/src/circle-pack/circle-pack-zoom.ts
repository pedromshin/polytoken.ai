/**
 * circle-pack-zoom.ts — the pure zoom/navigation state machine for the shared
 * `CirclePack` primitive (FEATURE-CATALOG TM-01).
 *
 * Two cursors, no DOM:
 *   - `focusId`  — the circle the viewport is zoomed to (the "you are here"
 *                  frame). Always a container (root or an internal node); the
 *                  renderer interpolates its `[x, y, 2r]` into the SVG viewBox,
 *                  à la Bostock's zoomable circle packing.
 *   - `cursorId` — the keyboard-highlighted circle (may be a leaf). Arrow keys
 *                  move it; Enter zooms the viewport to it; Esc zooms out.
 *
 * Kept pure and framework-free so the state transitions are unit-testable in
 * jsdom (a real reducer, not behaviour tangled into a component) and so the
 * keyboard contract the catalog specifies — "arrow = sibling, Enter = zoom in,
 * Esc = zoom out" — is provable without rendering anything.
 */

import type { PackedCircle } from "./circle-pack-layout";

export const CIRCLE_PACK_ROOT_ID = "0";

/** A flat, id-keyed index over a packed layout — the reducer's read model. */
export interface CircleNavIndex {
  /** id → parent id (null for the root). */
  readonly parentOf: ReadonlyMap<string, string | null>;
  /** id → ordered child ids (empty for leaves). */
  readonly childrenOf: ReadonlyMap<string, readonly string[]>;
  /** id → is-leaf. */
  readonly isLeaf: ReadonlyMap<string, boolean>;
  /** Every id that exists in the layout. */
  readonly ids: ReadonlySet<string>;
}

export interface CirclePackNavState {
  readonly focusId: string;
  readonly cursorId: string;
}

export type CirclePackNavAction =
  /** Point the cursor (and, when sensible, the zoom) at an explicit id — a click. */
  | { readonly type: "focus"; readonly id: string }
  /** Enter: zoom the viewport into the cursor (or its parent if the cursor is a leaf). */
  | { readonly type: "zoomIn" }
  /** Esc / back / double-tap / pinch-out: zoom out to the current focus's parent. */
  | { readonly type: "zoomOut" }
  /** Reset control / breadcrumb "root": zoom the viewport all the way back out. */
  | { readonly type: "reset" }
  /** ArrowLeft/ArrowRight: move the cursor among its siblings. */
  | { readonly type: "sibling"; readonly dir: "next" | "prev" }
  /** ArrowDown: move the cursor to its first child. */
  | { readonly type: "child" }
  /** ArrowUp: move the cursor to its parent. */
  | { readonly type: "parent" };

/** Build the reducer's read model from a packed layout. */
export function createCircleNavIndex<TLeaf>(
  circles: readonly PackedCircle<TLeaf>[],
): CircleNavIndex {
  const parentOf = new Map<string, string | null>();
  const childrenOf = new Map<string, readonly string[]>();
  const isLeaf = new Map<string, boolean>();
  const ids = new Set<string>();
  for (const c of circles) {
    parentOf.set(c.id, c.parentId);
    childrenOf.set(c.id, c.childIds);
    isLeaf.set(c.id, c.isLeaf);
    ids.add(c.id);
  }
  return { parentOf, childrenOf, isLeaf, ids };
}

/** The state a fresh CirclePack opens in: focused and cursored on the root. */
export function initialCirclePackNavState(): CirclePackNavState {
  return { focusId: CIRCLE_PACK_ROOT_ID, cursorId: CIRCLE_PACK_ROOT_ID };
}

function parentOrSelf(index: CircleNavIndex, id: string): string {
  const parent = index.parentOf.get(id) ?? null;
  return parent ?? id;
}

/**
 * clampFocusId — the min/max ZOOM CLAMP as a pure function. The viewport can
 * only ever frame a CONTAINER: the root is the fully-zoomed-OUT extent (it fills
 * the box) and an internal node is as far IN as the frame goes. A leaf is never
 * a valid focus — you cannot zoom "past" it — so a leaf clamps to its parent,
 * and an unknown id clamps to the root. This guarantees the interpolated viewBox
 * never overshoots the root outward or a leaf inward.
 */
export function clampFocusId(index: CircleNavIndex, id: string): string {
  if (!index.ids.has(id)) return CIRCLE_PACK_ROOT_ID;
  const leaf = index.isLeaf.get(id) ?? true;
  return leaf ? parentOrSelf(index, id) : id;
}

/**
 * ancestorsOf — the drill PATH from the root down to `id` inclusive
 * (`[root, …, id]`), the model behind the clickable breadcrumb. An unknown id
 * yields an empty path. Guards against a malformed (cyclic) index by bounding
 * the walk to the number of known ids.
 */
export function ancestorsOf(index: CircleNavIndex, id: string): string[] {
  if (!index.ids.has(id)) return [];
  const path: string[] = [];
  let cur: string | null = id;
  let guard = index.ids.size + 1;
  while (cur !== null && guard-- > 0) {
    path.push(cur);
    cur = index.parentOf.get(cur) ?? null;
  }
  path.reverse();
  return path;
}

/**
 * circlePackNavReducer — the whole navigation contract as a pure function.
 * Never throws and never lands on a non-existent id: an action referencing an
 * unknown id (a stale event against a re-laid-out hierarchy) is a no-op.
 */
export function circlePackNavReducer(
  state: CirclePackNavState,
  action: CirclePackNavAction,
  index: CircleNavIndex,
): CirclePackNavState {
  switch (action.type) {
    case "focus": {
      if (!index.ids.has(action.id)) return state;
      // A leaf can't be zoomed INTO — the viewport frames its parent (the clamp)
      // while the cursor lands on the leaf (so a click both highlights it and
      // reveals it).
      const focusId = clampFocusId(index, action.id);
      return { focusId, cursorId: action.id };
    }
    case "zoomIn": {
      const { cursorId } = state;
      if (!index.ids.has(cursorId)) return state;
      const focusId = clampFocusId(index, cursorId);
      if (focusId === state.focusId) return state;
      return { focusId, cursorId };
    }
    case "zoomOut": {
      const parent = index.parentOf.get(state.focusId) ?? null;
      if (parent === null) return state; // clamped at the root — no overshoot
      return { focusId: parent, cursorId: parent };
    }
    case "reset": {
      if (state.focusId === CIRCLE_PACK_ROOT_ID && state.cursorId === CIRCLE_PACK_ROOT_ID) {
        return state; // already home
      }
      return initialCirclePackNavState();
    }
    case "sibling": {
      const parent = index.parentOf.get(state.cursorId) ?? null;
      if (parent === null) return state; // root has no siblings
      const siblings = index.childrenOf.get(parent) ?? [];
      const at = siblings.indexOf(state.cursorId);
      if (at < 0 || siblings.length === 0) return state;
      const delta = action.dir === "next" ? 1 : -1;
      const nextIndex = (at + delta + siblings.length) % siblings.length;
      const next = siblings[nextIndex]!;
      return { ...state, cursorId: next };
    }
    case "child": {
      const children = index.childrenOf.get(state.cursorId) ?? [];
      if (children.length === 0) return state;
      return { ...state, cursorId: children[0]! };
    }
    case "parent": {
      const parent = index.parentOf.get(state.cursorId) ?? null;
      if (parent === null) return state;
      return { ...state, cursorId: parent };
    }
    default:
      return state;
  }
}
