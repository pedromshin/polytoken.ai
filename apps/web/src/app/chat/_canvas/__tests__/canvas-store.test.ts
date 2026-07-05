/**
 * canvas-store.test.ts — unit tests for the per-conversation canvas store
 * (STATE-01, FOUND-4): the bounded 5-mutation enum, panels.* vs shared.*
 * namespace isolation, the FORBIDDEN_KEYS read guard, and reset-to-initial.
 */

import { describe, expect, it } from "vitest";

import { CANVAS_STORE_MUTATIONS, createCanvasStore } from "../canvas-store";

describe("CANVAS_STORE_MUTATIONS", () => {
  it("enumerates exactly toggle/set/reset/increment/decrement — no arbitrary reducer path", () => {
    expect([...CANVAS_STORE_MUTATIONS].sort()).toEqual(
      ["decrement", "increment", "reset", "set", "toggle"].sort(),
    );
  });
});

describe("createCanvasStore — bounded mutation enum", () => {
  it("applies set/toggle/increment/decrement", () => {
    const store = createCanvasStore();

    store.getState().mutate("set", "panels.abc.count", 5);
    expect(store.getState().read("panels.abc.count")).toBe(5);

    store.getState().mutate("increment", "panels.abc.count");
    expect(store.getState().read("panels.abc.count")).toBe(6);

    store.getState().mutate("decrement", "panels.abc.count");
    expect(store.getState().read("panels.abc.count")).toBe(5);

    store.getState().mutate("toggle", "panels.abc.flag");
    expect(store.getState().read("panels.abc.flag")).toBe(true);
    store.getState().mutate("toggle", "panels.abc.flag");
    expect(store.getState().read("panels.abc.flag")).toBe(false);
  });

  it("increment/decrement coerce a non-number current value to 0 first (mirrors useDeclaredState)", () => {
    const store = createCanvasStore();
    store.getState().mutate("increment", "panels.abc.missing");
    expect(store.getState().read("panels.abc.missing")).toBe(1);

    store.getState().mutate("set", "panels.abc.text", "hi");
    store.getState().mutate("decrement", "panels.abc.text");
    expect(store.getState().read("panels.abc.text")).toBe(-1);
  });

  it("an unrecognized mutation name is a no-op — never an arbitrary reducer", () => {
    const store = createCanvasStore();
    store.getState().mutate("set", "panels.abc.count", 5);
    const valuesBeforeNoOp = store.getState().values;

    store.getState().mutate("explode", "panels.abc.count", 999);

    expect(store.getState().read("panels.abc.count")).toBe(5);
    // Same reference — no allocation happened for the unknown mutation.
    expect(store.getState().values).toBe(valuesBeforeNoOp);
  });
});

describe("createCanvasStore — namespace isolation (panels.* vs shared.*)", () => {
  it("a write to panels.abc.count is readable there and does not leak into panels.def.* or shared.*", () => {
    const store = createCanvasStore();
    store.getState().mutate("set", "panels.abc.count", 1);
    store.getState().mutate("set", "shared.theme", "dark");

    expect(store.getState().read("panels.abc.count")).toBe(1);
    expect(store.getState().read("shared.theme")).toBe("dark");
    expect(store.getState().read("panels.def.count")).toBeUndefined();
    expect(store.getState().read("shared.count")).toBeUndefined();
  });

  it("two separate createCanvasStore() instances never share state (per-conversation isolation)", () => {
    const storeA = createCanvasStore();
    const storeB = createCanvasStore();
    storeA.getState().mutate("set", "panels.abc.count", 1);
    expect(storeB.getState().read("panels.abc.count")).toBeUndefined();
  });
});

describe("createCanvasStore — FORBIDDEN_KEYS read guard", () => {
  it("reading a path containing __proto__/constructor/prototype returns undefined", () => {
    const store = createCanvasStore();
    expect(store.getState().read("panels.__proto__.polluted")).toBeUndefined();
    expect(store.getState().read("panels.abc.constructor")).toBeUndefined();
    expect(store.getState().read("shared.prototype.x")).toBeUndefined();
  });

  it("a mutate() targeting a forbidden path segment is a no-op and never pollutes Object.prototype", () => {
    const store = createCanvasStore();
    store.getState().mutate("set", "shared.__proto__.polluted", "x");

    expect(store.getState().read("shared.__proto__.polluted")).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("createCanvasStore — reset restores the declared initial for that path", () => {
  it("reset restores the value the store was seeded with", () => {
    const store = createCanvasStore({ panels: { abc: { count: 10 } } });
    expect(store.getState().read("panels.abc.count")).toBe(10);

    store.getState().mutate("set", "panels.abc.count", 999);
    expect(store.getState().read("panels.abc.count")).toBe(999);

    store.getState().mutate("reset", "panels.abc.count");
    expect(store.getState().read("panels.abc.count")).toBe(10);
  });

  it("reset on a path with no seeded initial restores to undefined (never throws)", () => {
    const store = createCanvasStore();
    store.getState().mutate("set", "panels.abc.newField", "temp");

    expect(() => store.getState().mutate("reset", "panels.abc.newField")).not.toThrow();
    expect(store.getState().read("panels.abc.newField")).toBeUndefined();
  });

  it("seeds BOTH panels.* and shared.* from the constructor arg (D-10 hydration contract)", () => {
    const store = createCanvasStore({
      panels: { abc: { count: 3 } },
      shared: { theme: "dark" },
    });
    expect(store.getState().read("panels.abc.count")).toBe(3);
    expect(store.getState().read("shared.theme")).toBe("dark");
  });
});

describe("createCanvasStore — immutability", () => {
  it("mutate() never mutates the previous values object in place (CLAUDE.md)", () => {
    const store = createCanvasStore();
    store.getState().mutate("set", "panels.abc.count", 1);
    const before = store.getState().values;

    store.getState().mutate("set", "panels.abc.count", 2);
    const after = store.getState().values;

    expect(before).not.toBe(after);
    // The old snapshot's own copy is untouched by the later write.
    expect((before as { panels: { abc: { count: number } } }).panels.abc.count).toBe(1);
  });
});
