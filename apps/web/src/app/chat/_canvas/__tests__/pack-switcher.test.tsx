/**
 * pack-switcher.test.tsx — PackSwitcher (PANL-01, 52-02-PLAN.md Task 2, TDD):
 * optimistic apply, persist via writeOverlay/scheduleSave, revert-on-failure
 * + toast.error with a Retry action, and isLocked disabling.
 *
 * Real `createCanvasStore` + `CanvasStoreProvider` + `CanvasPersistenceProvider`
 * (mirrors panel-overlay-context.test.tsx's zero-mock convention) — only
 * `sonner`'s `toast` is mocked (no precedent for a real toast host in this
 * test package).
 *
 * Radix `Select` renders its items into a hidden `DocumentFragment`-backed
 * portal even while closed (so the trigger can show the selected item's
 * label without ever opening the dropdown) and into `document.body` once
 * open. jsdom does not implement `scrollIntoView` — Select's open/highlight
 * effects call it unconditionally — polyfilled as a no-op below.
 * `ResizeObserver` is confirmed unused on this component's `position="popper"`
 * path (no `Arrow` subcomponent rendered, and `@floating-ui/dom`'s
 * `autoUpdate` guards its resize-tracking behind
 * `typeof ResizeObserver === "function"`), so no polyfill is needed there.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

import { createCanvasStore } from "../canvas-store";
import { CanvasStoreProvider } from "../canvas-store-context";
import {
  CanvasPersistenceProvider,
  type CanvasPersistenceContextValue,
} from "../panel-overlay-context";
import { PackSwitcher } from "../controls/pack-switcher";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {
    /* jsdom does not implement this — no-op polyfill for Radix Select. */
  };
}

let containers: HTMLDivElement[] = [];
let roots: Root[] = [];

async function mount(element: React.ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(element);
  });
  return container;
}

afterEach(async () => {
  for (const root of roots) {
    await act(async () => {
      root.unmount();
    });
  }
  for (const c of containers) c.remove();
  containers = [];
  roots = [];
  toastError.mockClear();
});

function getTrigger(container: HTMLDivElement): HTMLButtonElement {
  const trigger = container.querySelector('[aria-label="Style pack"]');
  expect(trigger).not.toBeNull();
  return trigger as HTMLButtonElement;
}

async function openSelect(container: HTMLDivElement): Promise<void> {
  await act(async () => {
    getTrigger(container).click();
  });
}

function getOption(label: string): HTMLElement {
  const options = Array.from(document.body.querySelectorAll('[role="option"]'));
  const match = options.find((o) => o.textContent === label);
  expect(match).not.toBeUndefined();
  return match as HTMLElement;
}

function makeHarness(scheduleSave: () => void) {
  const store = createCanvasStore();
  const persistenceValue: CanvasPersistenceContextValue = {
    scheduleSave,
    conversationId: "11111111-1111-1111-1111-111111111111",
  };
  return { store, persistenceValue };
}

describe("PackSwitcher", () => {
  // Test 1
  it("shows the resolved current pack as the Select's visible value", async () => {
    const { store, persistenceValue } = makeHarness(vi.fn());
    const container = await mount(
      <CanvasStoreProvider store={store}>
        <CanvasPersistenceProvider value={persistenceValue}>
          <PackSwitcher
            panelId="panel-a"
            resolvedPackId="linear-clean"
            isLocked={false}
            onBusyChange={vi.fn()}
          />
        </CanvasPersistenceProvider>
      </CanvasStoreProvider>,
    );

    expect(getTrigger(container).textContent).toBe("Linear Clean");
  });

  // Test 2
  it("selecting a new pack writes stylePackId to the overlay, schedules a persist, and updates the visible value optimistically", async () => {
    const scheduleSave = vi.fn();
    const { store, persistenceValue } = makeHarness(scheduleSave);
    const onBusyChange = vi.fn();
    const container = await mount(
      <CanvasStoreProvider store={store}>
        <CanvasPersistenceProvider value={persistenceValue}>
          <PackSwitcher
            panelId="panel-a"
            resolvedPackId="polytoken-teal"
            isLocked={false}
            onBusyChange={onBusyChange}
          />
        </CanvasPersistenceProvider>
      </CanvasStoreProvider>,
    );

    await openSelect(container);
    await act(async () => {
      getOption("Playful Rounded").click();
    });

    expect(getTrigger(container).textContent).toBe("Playful Rounded");
    const values = store.getState().values as {
      shared?: { panelOverlays?: Record<string, { stylePackId?: string }> };
    };
    expect(values.shared?.panelOverlays?.["panel-a"]?.stylePackId).toBe("playful-rounded");
    expect(scheduleSave).toHaveBeenCalledTimes(1);
    expect(onBusyChange).toHaveBeenCalledWith(true);
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  // Test 3
  it("a persist failure reverts the Select to the prior pack and shows the exact toast.error copy with a Retry action", async () => {
    const scheduleSave = vi.fn(() => {
      throw new Error("simulated persist failure");
    });
    const { store, persistenceValue } = makeHarness(scheduleSave);
    const container = await mount(
      <CanvasStoreProvider store={store}>
        <CanvasPersistenceProvider value={persistenceValue}>
          <PackSwitcher
            panelId="panel-a"
            resolvedPackId="polytoken-teal"
            isLocked={false}
            onBusyChange={vi.fn()}
          />
        </CanvasPersistenceProvider>
      </CanvasStoreProvider>,
    );

    await openSelect(container);
    await act(async () => {
      getOption("Brutalist").click();
    });

    expect(getTrigger(container).textContent).toBe("Polytoken Teal");
    expect(toastError).toHaveBeenCalledTimes(1);
    const [message, options] = toastError.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe("Couldn't switch style — try again.");
    expect(options.action.label).toBe("Retry");
    expect(typeof options.action.onClick).toBe("function");
  });

  // Test 4
  it("a REAL async persist failure (scheduleSave's onError callback, not a synchronous throw) reverts the Select and shows the toast", async () => {
    let capturedOnError: (() => void) | undefined;
    const scheduleSave = vi.fn((onError?: () => void) => {
      capturedOnError = onError;
    });
    const { store, persistenceValue } = makeHarness(scheduleSave);
    const container = await mount(
      <CanvasStoreProvider store={store}>
        <CanvasPersistenceProvider value={persistenceValue}>
          <PackSwitcher
            panelId="panel-a"
            resolvedPackId="polytoken-teal"
            isLocked={false}
            onBusyChange={vi.fn()}
          />
        </CanvasPersistenceProvider>
      </CanvasStoreProvider>,
    );

    await openSelect(container);
    await act(async () => {
      getOption("Brutalist").click();
    });

    // Optimistic apply lands immediately — no revert/toast yet, the write
    // hasn't genuinely failed, it's just not confirmed durable.
    expect(getTrigger(container).textContent).toBe("Brutalist");
    expect(toastError).not.toHaveBeenCalled();
    expect(capturedOnError).toBeDefined();

    // The REAL debounced save later fails (network hiccup) — scheduleSave's
    // own onError callback fires, asynchronously, well after the click.
    await act(async () => {
      capturedOnError?.();
    });

    expect(getTrigger(container).textContent).toBe("Polytoken Teal");
    expect(toastError).toHaveBeenCalledTimes(1);
    const [message, options] = toastError.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe("Couldn't switch style — try again.");
    expect(options.action.label).toBe("Retry");
    expect(typeof options.action.onClick).toBe("function");
  });

  // Test 5
  it("is disabled while isLocked", async () => {
    const { store, persistenceValue } = makeHarness(vi.fn());
    const container = await mount(
      <CanvasStoreProvider store={store}>
        <CanvasPersistenceProvider value={persistenceValue}>
          <PackSwitcher
            panelId="panel-a"
            resolvedPackId="polytoken-teal"
            isLocked={true}
            onBusyChange={vi.fn()}
          />
        </CanvasPersistenceProvider>
      </CanvasStoreProvider>,
    );

    expect(getTrigger(container).disabled).toBe(true);
  });
});
