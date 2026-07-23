/**
 * circle-pack-layout.test.ts — TM-01 layout math (jsdom = behaviour only, no
 * visual claim). Asserts the d3.pack() hierarchy → positioned-circle contract:
 * one circle per node, containment (every child fully inside its parent), and
 * leaf-value summation up the tree.
 */

import { describe, expect, it } from "vitest";

import { packCircles, type CircleDatum } from "../circle-pack/circle-pack-layout";

const SAMPLE: CircleDatum = {
  name: "root",
  children: [
    {
      name: "alice",
      children: [
        { name: "t1", value: 3 },
        { name: "t2", value: 1 },
      ],
    },
    {
      name: "bob",
      children: [{ name: "t3", value: 4 }],
    },
  ],
};

describe("packCircles — hierarchy → circle count", () => {
  it("emits exactly one circle per node (root + 2 senders + 3 leaves = 6)", () => {
    const circles = packCircles(SAMPLE, { width: 200, height: 200 });
    expect(circles).toHaveLength(6);
    expect(circles.filter((c) => c.isLeaf)).toHaveLength(3);
    expect(circles.find((c) => c.id === "0")?.parentId).toBeNull();
  });

  it("assigns stable path ids and links parents to children", () => {
    const circles = packCircles(SAMPLE, { width: 200, height: 200 });
    const root = circles.find((c) => c.id === "0")!;
    expect(root.childIds).toHaveLength(2);
    for (const childId of root.childIds) {
      expect(circles.find((c) => c.id === childId)?.parentId).toBe("0");
    }
  });
});

describe("packCircles — containment (d3.pack guarantee, preserved)", () => {
  it("keeps every child circle fully inside its parent", () => {
    const circles = packCircles(SAMPLE, { width: 300, height: 300, padding: 2 });
    const byId = new Map(circles.map((c) => [c.id, c]));
    for (const c of circles) {
      if (c.parentId === null) continue;
      const parent = byId.get(c.parentId)!;
      const dist = Math.hypot(c.x - parent.x, c.y - parent.y);
      // child entirely within parent: centre distance + child radius <= parent radius
      expect(dist + c.r).toBeLessThanOrEqual(parent.r + 1e-6);
    }
  });

  it("keeps the root within the requested box", () => {
    const circles = packCircles(SAMPLE, { width: 240, height: 240 });
    const root = circles.find((c) => c.id === "0")!;
    expect(root.r).toBeGreaterThan(0);
    expect(root.r).toBeLessThanOrEqual(120 + 1e-6);
  });
});

describe("packCircles — leaf value summation", () => {
  it("sums leaf values into internal nodes and the root", () => {
    const circles = packCircles(SAMPLE, { width: 200, height: 200 });
    expect(circles.find((c) => c.id === "0")?.value).toBe(8); // 3+1+4
    // The larger sender (bob=4) packs to a bigger radius than the... actually
    // alice=4 (3+1) equals bob=4, so assert the total instead of ordering.
    const senders = circles.filter((c) => c.parentId === "0");
    expect(senders.reduce((n, c) => n + c.value, 0)).toBe(8);
  });

  it("treats negative/absent leaf values as zero (never negative radius)", () => {
    const circles = packCircles(
      { name: "r", children: [{ name: "a", value: -5 }, { name: "b", value: 2 }] },
      { width: 100, height: 100 },
    );
    for (const c of circles) expect(c.r).toBeGreaterThanOrEqual(0);
    expect(circles.find((c) => c.id === "0")?.value).toBe(2);
  });
});
