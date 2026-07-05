/**
 * panel-action-bridge.test.ts — unit tests for the STATE-01 write bridge
 * (23-06 Task 2): buildPanelActionRegistry routes a spec-authored `setState`
 * action into the canvas store's bounded 5-mutation grammar, and ONLY that
 * grammar — never an arbitrary reducer, never a raw store escape hatch.
 *
 * Pure unit tests — vi.fn() deps, no React render (mirrors canvas-store.test.ts style).
 */

import { describe, expect, it, vi } from "vitest";

import { buildPanelActionRegistry } from "../panel-action-bridge";

function makeDeps() {
  return {
    dispatchPanel: vi.fn(),
    mutateShared: vi.fn(),
  };
}

describe("buildPanelActionRegistry", () => {
  it("returns a frozen registry whose ONLY key is setState", () => {
    const deps = makeDeps();
    const registry = buildPanelActionRegistry(deps);

    expect(Object.keys(registry)).toEqual(["setState"]);
    expect(Object.isFrozen(registry)).toBe(true);
  });

  it("routes a plain key to dispatchPanel('set', key, value) and never touches mutateShared", () => {
    const deps = makeDeps();
    const registry = buildPanelActionRegistry(deps);

    registry.setState?.({ type: "setState", key: "choice", value: "B7" });

    expect(deps.dispatchPanel).toHaveBeenCalledTimes(1);
    expect(deps.dispatchPanel).toHaveBeenCalledWith("set", "choice", "B7");
    expect(deps.mutateShared).not.toHaveBeenCalled();
  });

  it("routes a shared.-prefixed key to mutateShared('set', path, value) and never touches dispatchPanel", () => {
    const deps = makeDeps();
    const registry = buildPanelActionRegistry(deps);

    registry.setState?.({ type: "setState", key: "shared.theme", value: "dark" });

    expect(deps.mutateShared).toHaveBeenCalledTimes(1);
    expect(deps.mutateShared).toHaveBeenCalledWith("set", "shared.theme", "dark");
    expect(deps.dispatchPanel).not.toHaveBeenCalled();
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a bare string", "not-an-object"],
    ["an object with no key", {}],
    ["an object with an empty-string key", { key: "" }],
    ["an object with a non-string key", { key: 42 }],
  ])("malformed payload (%s) calls NEITHER dep and never throws", (_label, payload) => {
    const deps = makeDeps();
    const registry = buildPanelActionRegistry(deps);

    expect(() => registry.setState?.(payload)).not.toThrow();
    expect(deps.dispatchPanel).not.toHaveBeenCalled();
    expect(deps.mutateShared).not.toHaveBeenCalled();
  });

  it("the mutation name passed to either dep is always the literal 'set' — never an arbitrary reducer", () => {
    const deps = makeDeps();
    const registry = buildPanelActionRegistry(deps);

    registry.setState?.({ type: "setState", key: "count", value: 5 });
    registry.setState?.({ type: "setState", key: "shared.count", value: 5 });

    expect(deps.dispatchPanel.mock.calls[0]?.[0]).toBe("set");
    expect(deps.mutateShared.mock.calls[0]?.[0]).toBe("set");
  });
});
