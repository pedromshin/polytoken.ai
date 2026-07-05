/**
 * __tests__/button-action.test.tsx — proves ButtonComponent onClick/action dispatch
 * (23-06 Task 1 / STATE-01 trigger half).
 *
 * Exercises the REAL production path end-to-end: a SpecRootSchema-valid button node ->
 * SpecRenderer -> the catalog's ButtonComponent -> ActionRegistryContext lookup -> the
 * caller-supplied handler. No mocks of the renderer, schema, or catalog — only the
 * ActionRegistry handlers themselves are test doubles (mirrors form-component.tsx's own
 * registry[action.type]?.(action) contract).
 *
 * Uses the repo's existing createRoot-in-jsdom convention (render-node.test.tsx Block 5),
 * wrapped in `act` per this plan's explicit instruction (React 18.3 exports `act` from
 * "react"). Native `.click()` on the rendered DOM button exercises React 18's root-level
 * event delegation.
 */

import * as React from "react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { SpecRenderer } from "../renderer/spec-renderer";
import type { ActionRegistry } from "../renderer/action-registry-context";
import type { SpecRoot } from "../schema/spec-schema";

// React 18.3's `act` requires this flag set before any act() call in a non-test-runner
// environment that doesn't already set it (vitest + jsdom does not set it by default here).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function buildButtonSpec(buttonProps: Record<string, unknown>): SpecRoot {
  return {
    v: 1,
    root: { type: "button", ...buttonProps },
  } as unknown as SpecRoot;
}

async function mountSpec(
  spec: SpecRoot,
  actions?: ActionRegistry,
): Promise<{ container: HTMLDivElement; cleanup: () => void }> {
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(SpecRenderer, { spec, actions }));
  });

  return {
    container,
    cleanup: () => {
      root.unmount();
      document.body.removeChild(container);
    },
  };
}

async function clickButton(container: HTMLDivElement, ariaLabel: string): Promise<void> {
  const button = container.querySelector(`[aria-label="${ariaLabel}"]`) as HTMLButtonElement | null;
  if (button === null) {
    throw new Error(`button with aria-label="${ariaLabel}" not found in rendered tree`);
  }
  await act(async () => {
    button.click();
  });
}

describe("ButtonComponent action dispatch (23-06 Task 1)", () => {
  it("Test 1 — fires the ActionRegistry setState handler with the FULL onClick action object", async () => {
    const spy = vi.fn();
    const spec = buildButtonSpec({
      label: "Pick B7",
      "aria-label": "Pick B7",
      onClick: { type: "setState", key: "choice", value: "B7" },
    });

    const { container, cleanup } = await mountSpec(spec, { setState: spy });
    await clickButton(container, "Pick B7");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ type: "setState", key: "choice", value: "B7" });
    cleanup();
  });

  it("Test 2 — fires the legacy string `action` ActionRegistry key handler", async () => {
    const spy = vi.fn();
    const spec = buildButtonSpec({
      label: "Do thing",
      "aria-label": "Do thing",
      action: "customKey",
    });

    const { container, cleanup } = await mountSpec(spec, { customKey: spy });
    await clickButton(container, "Do thing");

    expect(spy).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("Test 3 — precedence: BOTH onClick and action present fires ONLY the onClick path", async () => {
    const setStateSpy = vi.fn();
    const customKeySpy = vi.fn();
    const spec = buildButtonSpec({
      label: "Both",
      "aria-label": "Both",
      onClick: { type: "setState", key: "choice", value: "B7" },
      action: "customKey",
    });

    const { container, cleanup } = await mountSpec(spec, {
      setState: setStateSpy,
      customKey: customKeySpy,
    });
    await clickButton(container, "Both");

    expect(setStateSpy).toHaveBeenCalledTimes(1);
    expect(customKeySpy).not.toHaveBeenCalled();
    cleanup();
  });

  it("Test 4a — safe default: no `actions` prop (default empty context) does not throw on click", async () => {
    const spec = buildButtonSpec({
      label: "No actions",
      "aria-label": "No actions",
      onClick: { type: "setState", key: "choice", value: "B7" },
    });

    const { container, cleanup } = await mountSpec(spec);

    await expect(clickButton(container, "No actions")).resolves.not.toThrow();
    cleanup();
  });

  it("Test 4b — safe default: a throwing handler does not crash the click", async () => {
    const spec = buildButtonSpec({
      label: "Boom",
      "aria-label": "Boom",
      onClick: { type: "setState", key: "choice", value: "B7" },
    });

    const { container, cleanup } = await mountSpec(spec, {
      setState: () => {
        throw new Error("boom");
      },
    });

    await expect(clickButton(container, "Boom")).resolves.not.toThrow();
    cleanup();
  });
});
