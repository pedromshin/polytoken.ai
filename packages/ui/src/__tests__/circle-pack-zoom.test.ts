/**
 * circle-pack-zoom.test.ts — TM-01 zoom/navigation state machine (the exact
 * catalog contract: arrow = sibling, Enter = zoom in, Esc = zoom out). Pure
 * reducer, no rendering.
 */

import { describe, expect, it } from "vitest";

import { packCircles, type CircleDatum } from "../circle-pack/circle-pack-layout";
import {
  ancestorsOf,
  clampFocusId,
  CIRCLE_PACK_ROOT_ID,
  circlePackNavReducer,
  createCircleNavIndex,
  initialCirclePackNavState,
} from "../circle-pack/circle-pack-zoom";
import {
  isDoubleTap,
  isPinchOut,
  touchSpan,
  DOUBLE_TAP_MS,
  DOUBLE_TAP_SLOP,
  PINCH_OUT_THRESHOLD,
} from "../circle-pack/circle-pack-gestures";

const SAMPLE: CircleDatum = {
  name: "root",
  children: [
    { name: "alice", children: [{ name: "t1", value: 3 }, { name: "t2", value: 1 }] },
    { name: "bob", children: [{ name: "t3", value: 4 }] },
  ],
};

function makeIndex() {
  return createCircleNavIndex(packCircles(SAMPLE, { width: 200, height: 200 }));
}

describe("initial state", () => {
  it("opens focused and cursored on the root", () => {
    const s = initialCirclePackNavState();
    expect(s.focusId).toBe(CIRCLE_PACK_ROOT_ID);
    expect(s.cursorId).toBe(CIRCLE_PACK_ROOT_ID);
  });
});

describe("Enter = zoom in", () => {
  it("zooms the viewport into a container the cursor is on", () => {
    const index = makeIndex();
    // move cursor down to first child (a sender), then Enter
    let s = circlePackNavReducer(initialCirclePackNavState(), { type: "child" }, index);
    expect(index.parentOf.get(s.cursorId)).toBe("0");
    s = circlePackNavReducer(s, { type: "zoomIn" }, index);
    expect(s.focusId).toBe(s.cursorId);
    expect(index.isLeaf.get(s.focusId)).toBe(false);
  });

  it("zooming into a LEAF frames its parent, not the leaf", () => {
    const index = makeIndex();
    // cursor: root -> first sender -> first leaf
    let s = circlePackNavReducer(initialCirclePackNavState(), { type: "child" }, index);
    s = circlePackNavReducer(s, { type: "child" }, index);
    expect(index.isLeaf.get(s.cursorId)).toBe(true);
    const leafParent = index.parentOf.get(s.cursorId)!;
    s = circlePackNavReducer(s, { type: "zoomIn" }, index);
    expect(s.focusId).toBe(leafParent);
  });
});

describe("Esc = zoom out", () => {
  it("zooms out to the focus's parent, and is a no-op at the root", () => {
    const index = makeIndex();
    let s = circlePackNavReducer(initialCirclePackNavState(), { type: "child" }, index);
    s = circlePackNavReducer(s, { type: "zoomIn" }, index); // focus a sender
    const sender = s.focusId;
    s = circlePackNavReducer(s, { type: "zoomOut" }, index);
    expect(s.focusId).toBe(index.parentOf.get(sender));
    // already root now — zoomOut is a no-op
    const atRoot = circlePackNavReducer(s, { type: "zoomOut" }, index);
    expect(atRoot).toEqual(s);
  });
});

describe("Arrow = sibling / parent / child", () => {
  it("cycles the cursor across siblings (wrapping both ways)", () => {
    const index = makeIndex();
    let s = circlePackNavReducer(initialCirclePackNavState(), { type: "child" }, index);
    const first = s.cursorId;
    s = circlePackNavReducer(s, { type: "sibling", dir: "next" }, index);
    const second = s.cursorId;
    expect(second).not.toBe(first);
    s = circlePackNavReducer(s, { type: "sibling", dir: "next" }, index);
    expect(s.cursorId).toBe(first); // wrapped around (2 senders)
    s = circlePackNavReducer(s, { type: "sibling", dir: "prev" }, index);
    expect(s.cursorId).toBe(second);
  });

  it("root has no siblings — sibling is a no-op there", () => {
    const index = makeIndex();
    const s = circlePackNavReducer(initialCirclePackNavState(), { type: "sibling", dir: "next" }, index);
    expect(s.cursorId).toBe(CIRCLE_PACK_ROOT_ID);
  });

  it("parent/child move the cursor up and down the tree", () => {
    const index = makeIndex();
    let s = circlePackNavReducer(initialCirclePackNavState(), { type: "child" }, index);
    const sender = s.cursorId;
    s = circlePackNavReducer(s, { type: "child" }, index);
    expect(index.parentOf.get(s.cursorId)).toBe(sender); // on a leaf
    s = circlePackNavReducer(s, { type: "parent" }, index);
    expect(s.cursorId).toBe(sender);
  });
});

describe("zoom clamp (never past root or past a leaf)", () => {
  it("clampFocusId maps a leaf to its parent and an unknown id to the root", () => {
    const index = makeIndex();
    expect(index.isLeaf.get("0/0/0")).toBe(true);
    expect(clampFocusId(index, "0/0/0")).toBe("0/0"); // leaf → parent
    expect(clampFocusId(index, "0/0")).toBe("0/0"); // container → itself
    expect(clampFocusId(index, CIRCLE_PACK_ROOT_ID)).toBe(CIRCLE_PACK_ROOT_ID);
    expect(clampFocusId(index, "9/9/9")).toBe(CIRCLE_PACK_ROOT_ID); // unknown → root
  });

  it("zoomOut can never overshoot the root (idempotent once home)", () => {
    const index = makeIndex();
    let s = circlePackNavReducer(initialCirclePackNavState(), { type: "focus", id: "0/0" }, index);
    s = circlePackNavReducer(s, { type: "zoomOut" }, index); // back to root
    expect(s.focusId).toBe(CIRCLE_PACK_ROOT_ID);
    const again = circlePackNavReducer(s, { type: "zoomOut" }, index);
    expect(again).toEqual(s); // clamped — no overshoot below the root
  });

  it("a leaf is never a valid focus (cannot zoom past a leaf)", () => {
    const index = makeIndex();
    const s = circlePackNavReducer(initialCirclePackNavState(), { type: "focus", id: "0/0/0" }, index);
    expect(index.isLeaf.get(s.focusId)).toBe(false); // framed the parent, not the leaf
  });
});

describe("reset to root", () => {
  it("returns focus and cursor to the root from any depth", () => {
    const index = makeIndex();
    let s = circlePackNavReducer(initialCirclePackNavState(), { type: "focus", id: "0/0/0" }, index);
    expect(s.focusId).not.toBe(CIRCLE_PACK_ROOT_ID);
    s = circlePackNavReducer(s, { type: "reset" }, index);
    expect(s).toEqual(initialCirclePackNavState());
  });

  it("is a no-op (stable reference) when already at the root", () => {
    const index = makeIndex();
    const home = initialCirclePackNavState();
    const s = circlePackNavReducer(home, { type: "reset" }, index);
    expect(s).toBe(home);
  });
});

describe("breadcrumb path (ancestorsOf)", () => {
  it("returns root → … → id inclusive, in drill order", () => {
    const index = makeIndex();
    expect(ancestorsOf(index, CIRCLE_PACK_ROOT_ID)).toEqual(["0"]);
    expect(ancestorsOf(index, "0/0")).toEqual(["0", "0/0"]);
    expect(ancestorsOf(index, "0/0/0")).toEqual(["0", "0/0", "0/0/0"]);
  });

  it("is empty for an unknown id", () => {
    const index = makeIndex();
    expect(ancestorsOf(index, "9/9/9")).toEqual([]);
  });
});

describe("touch zoom-out gestures", () => {
  it("isDoubleTap: two quick, close taps register; slow or far ones don't", () => {
    expect(isDoubleTap(null, { time: 100, x: 10, y: 10 })).toBe(false); // first tap
    expect(
      isDoubleTap({ time: 100, x: 10, y: 10 }, { time: 100 + DOUBLE_TAP_MS - 1, x: 12, y: 12 }),
    ).toBe(true);
    expect(
      isDoubleTap({ time: 100, x: 10, y: 10 }, { time: 100 + DOUBLE_TAP_MS + 50, x: 10, y: 10 }),
    ).toBe(false); // too slow
    expect(
      isDoubleTap({ time: 100, x: 10, y: 10 }, { time: 150, x: 10 + DOUBLE_TAP_SLOP + 5, y: 10 }),
    ).toBe(false); // too far
  });

  it("isPinchOut: a spreading two-finger span past the threshold registers", () => {
    const start = touchSpan({ clientX: 0, clientY: 0 }, { clientX: 20, clientY: 0 });
    expect(start).toBe(20);
    expect(isPinchOut(start, start + PINCH_OUT_THRESHOLD)).toBe(true);
    expect(isPinchOut(start, start + PINCH_OUT_THRESHOLD - 1)).toBe(false); // below threshold
    expect(isPinchOut(start, start - 40)).toBe(false); // pinch-IN is not pinch-out
  });
});

describe("robustness", () => {
  it("ignores actions referencing an unknown id (never throws)", () => {
    const index = makeIndex();
    const s = circlePackNavReducer(initialCirclePackNavState(), { type: "focus", id: "9/9/9" }, index);
    expect(s).toEqual(initialCirclePackNavState());
  });

  it("focus on a container zooms into it; focus on a leaf frames its parent", () => {
    const index = makeIndex();
    const container = circlePackNavReducer(initialCirclePackNavState(), { type: "focus", id: "0/0" }, index);
    expect(container.focusId).toBe("0/0");
    expect(container.cursorId).toBe("0/0");
    const leaf = circlePackNavReducer(initialCirclePackNavState(), { type: "focus", id: "0/0/0" }, index);
    expect(leaf.cursorId).toBe("0/0/0");
    expect(leaf.focusId).toBe("0/0");
  });
});
