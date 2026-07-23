/**
 * circle-pack-zoom.test.ts — TM-01 zoom/navigation state machine (the exact
 * catalog contract: arrow = sibling, Enter = zoom in, Esc = zoom out). Pure
 * reducer, no rendering.
 */

import { describe, expect, it } from "vitest";

import { packCircles, type CircleDatum } from "../circle-pack/circle-pack-layout";
import {
  CIRCLE_PACK_ROOT_ID,
  circlePackNavReducer,
  createCircleNavIndex,
  initialCirclePackNavState,
} from "../circle-pack/circle-pack-zoom";

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
