/**
 * canvas-publish.test.ts — Phase 73 Wave B (LCAN-03). The source-node publish
 * port's bounded projection: a published value is a glanceable SUMMARY, never
 * the raw dataset, so it can never blow the size-capped `sharedState` blob.
 */

import { describe, expect, it } from "vitest";

import { projectForPublish, publishedNodePath, PUBLISH_NAMESPACE } from "../canvas-publish";

describe("publishedNodePath", () => {
  it("roots a node's projection under shared.published.{nodeId}", () => {
    expect(publishedNodePath("agent:sheet")).toBe("shared.published.agent:sheet");
    expect(PUBLISH_NAMESPACE).toBe("shared.published");
  });
});

describe("projectForPublish — bounds", () => {
  it("passes a small JSON object through unchanged", () => {
    const value = { total: 1234.5, currency: "USD", count: 3 };
    expect(projectForPublish(value)).toEqual(value);
  });

  it("passes scalars through", () => {
    expect(projectForPublish(42)).toBe(42);
    expect(projectForPublish("hi")).toBe("hi");
    expect(projectForPublish(true)).toBe(true);
    expect(projectForPublish(null)).toBe(null);
  });

  it("caps an array to 20 items", () => {
    const out = projectForPublish(Array.from({ length: 100 }, (_, i) => i)) as unknown[];
    expect(out).toHaveLength(20);
  });

  it("caps object keys to 30", () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 100; i++) big[`k${i}`] = i;
    const out = projectForPublish(big) as Record<string, unknown>;
    expect(Object.keys(out).length).toBe(30);
  });

  it("truncates a long string to 2000 chars", () => {
    const out = projectForPublish("x".repeat(5000)) as string;
    expect(out.length).toBe(2000);
  });

  it("drops functions, symbols and undefined fields", () => {
    const out = projectForPublish({
      keep: 1,
      fn: () => 1,
      sym: Symbol("s"),
      undef: undefined,
    }) as Record<string, unknown>;
    expect(out).toEqual({ keep: 1 });
  });

  it("drops a non-finite number at the root (returns undefined)", () => {
    expect(projectForPublish(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(projectForPublish(Number.NaN)).toBeUndefined();
  });

  it("drops a non-finite number nested (prunes the key)", () => {
    const out = projectForPublish({ ok: 1, bad: Number.NaN }) as Record<string, unknown>;
    expect(out).toEqual({ ok: 1 });
  });

  it("guards prototype-pollution keys", () => {
    const poisoned = JSON.parse('{"__proto__": {"x": 1}, "safe": 2}') as Record<string, unknown>;
    const out = projectForPublish(poisoned) as Record<string, unknown>;
    expect(out).toEqual({ safe: 2 });
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it("prunes branches deeper than the depth cap", () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const out = projectForPublish(deep) as Record<string, unknown>;
    // a(1) b(2) c(3) then d at depth 4 is pruned to undefined -> c becomes {}
    expect(out).toEqual({ a: { b: { c: {} } } });
  });

  it("serializes a Date to an ISO string", () => {
    const out = projectForPublish({ at: new Date("2026-07-25T00:00:00.000Z") }) as Record<
      string,
      unknown
    >;
    expect(out.at).toBe("2026-07-25T00:00:00.000Z");
  });

  it("rejects an oversize projection wholesale (returns undefined)", () => {
    // 30 keys each with a 2000-char string >> 8192-byte cap
    const big: Record<string, string> = {};
    for (let i = 0; i < 30; i++) big[`k${i}`] = "y".repeat(2000);
    expect(projectForPublish(big)).toBeUndefined();
  });
});
