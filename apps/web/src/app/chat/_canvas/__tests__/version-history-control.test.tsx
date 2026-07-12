/**
 * version-history-control.test.tsx — VersionHistoryControl (PANL-03,
 * 52-04-PLAN.md Task 2): an empty overlay renders the empty-state copy plus
 * only the "Current" row; an overlay with two prior versions renders both
 * with the correct verb label and a Restore button each; clicking Restore
 * calls `writeOverlay` with a `restoreVersion` result (a NEW active
 * version — versions array grows, none removed) and fires the success
 * toast; a persist failure (mirrors `pack-switcher.test.tsx`'s injectable
 * throwing `scheduleSave` seam) fires the exact error toast + Retry and
 * keeps the popover open; the trigger is disabled while `isLocked`.
 *
 * Real `createCanvasStore` + `CanvasStoreProvider` + `CanvasPersistenceProvider`
 * (mirrors `pack-switcher.test.tsx`'s zero-mock convention — no tRPC call in
 * this control at all) — only `sonner`'s `toast` is mocked. `PopoverContent`
 * renders through a Radix Portal to `document.body`, not inside the mounted
 * container (mirrors `edit-params-control.test.tsx`).
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

import { TooltipProvider } from "@polytoken/ui/tooltip";

import { createCanvasStore } from "../canvas-store";
import { CanvasStoreProvider } from "../canvas-store-context";
import {
  CanvasPersistenceProvider,
  type CanvasPersistenceContextValue,
} from "../panel-overlay-context";
import { VersionHistoryControl } from "../controls/version-history-control";
import type { PanelVersion } from "../panel-overlay";
import type { Provenance } from "../node-data-schemas";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROVENANCE: Provenance = {
  messageId: "00000000-0000-0000-0000-0000000000b2",
  partIndex: 0,
  runId: null,
};

const CONVERSATION_ID = "11111111-1111-1111-1111-111111111111";

const V1: PanelVersion = {
  id: "10000000-0000-0000-0000-000000000001",
  generatedBy: "regenerate",
  parentVersionId: null,
  createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  specJson: JSON.stringify({ v: 1, root: { type: "text", content: "v1" } }),
};

const V2: PanelVersion = {
  id: "10000000-0000-0000-0000-000000000002",
  generatedBy: "edit",
  parentVersionId: V1.id,
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  specJson: JSON.stringify({ v: 1, root: { type: "text", content: "v2" } }),
};

const V3_ACTIVE: PanelVersion = {
  id: "10000000-0000-0000-0000-000000000003",
  generatedBy: "retheme",
  parentVersionId: V2.id,
  createdAt: new Date().toISOString(),
  specJson: JSON.stringify({ v: 1, root: { type: "text", content: "v3 (active)" } }),
};

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

function makeHarness(scheduleSave: () => void = vi.fn()) {
  const store = createCanvasStore({
    shared: {
      panelOverlays: {
        "panel-a": { activeVersionId: V3_ACTIVE.id, versions: [V1, V2, V3_ACTIVE] },
      },
    },
  });
  const persistenceValue: CanvasPersistenceContextValue = {
    scheduleSave,
    conversationId: CONVERSATION_ID,
  };
  return { store, persistenceValue };
}

function makeEmptyHarness(scheduleSave: () => void = vi.fn()) {
  const store = createCanvasStore();
  const persistenceValue: CanvasPersistenceContextValue = {
    scheduleSave,
    conversationId: CONVERSATION_ID,
  };
  return { store, persistenceValue };
}

function renderControl(
  store: ReturnType<typeof createCanvasStore>,
  persistenceValue: CanvasPersistenceContextValue,
  isLocked = false,
): React.ReactElement {
  return (
    <CanvasStoreProvider store={store}>
      <CanvasPersistenceProvider value={persistenceValue}>
        <TooltipProvider delayDuration={300}>
          <VersionHistoryControl
            panelId="panel-a"
            provenance={PROVENANCE}
            activeSpecJson={V3_ACTIVE.specJson}
            resolvedPackId="polytoken-teal"
            isLocked={isLocked}
            onBusyChange={vi.fn()}
            onGeneratingChange={vi.fn()}
          />
        </TooltipProvider>
      </CanvasPersistenceProvider>
    </CanvasStoreProvider>
  );
}

async function openPopover(container: HTMLDivElement): Promise<void> {
  const trigger = container.querySelector('[aria-label="Version history"]');
  expect(trigger).not.toBeNull();
  await act(async () => {
    (trigger as HTMLButtonElement).click();
  });
}

function findButton(text: string): HTMLButtonElement | null {
  const buttons = Array.from(document.body.querySelectorAll("button"));
  return (buttons.find((b) => b.textContent === text) as HTMLButtonElement) ?? null;
}

function overlayVersions(store: ReturnType<typeof createCanvasStore>): { id: string }[] {
  const values = store.getState().values as {
    shared?: { panelOverlays?: Record<string, { versions?: { id: string }[] }> };
  };
  return values.shared?.panelOverlays?.["panel-a"]?.versions ?? [];
}

beforeEach(() => {
  toastError.mockClear();
  toastSuccess.mockClear();
});

afterEach(async () => {
  for (const root of roots) {
    await act(async () => {
      root.unmount();
    });
  }
  for (const c of containers) c.remove();
  containers = [];
  roots = [];
});

describe("VersionHistoryControl", () => {
  // Test 1
  it("an empty overlay renders the empty-state copy plus only the Current row", async () => {
    const { store, persistenceValue } = makeEmptyHarness();
    const container = await mount(renderControl(store, persistenceValue));
    await openPopover(container);

    expect(document.body.textContent).toContain(
      "No earlier versions yet — changes will appear here.",
    );
    // Current row present, no Restore buttons for a version.
    expect(document.body.textContent).toContain("Current");
    expect(findButton("Restore version")).toBeNull();
  });

  // Test 2
  it("an overlay with two prior versions renders both with the correct verb label and a Restore button each", async () => {
    const { store, persistenceValue } = makeHarness();
    const container = await mount(renderControl(store, persistenceValue));
    await openPopover(container);

    expect(document.body.textContent).toContain("Regenerated");
    expect(document.body.textContent).toContain("Edited");
    // V3_ACTIVE is the active version — never listed as a prior row.
    expect(document.body.textContent).not.toContain("Re-themed");

    const restoreButtons = Array.from(document.body.querySelectorAll("button")).filter(
      (b) => b.textContent === "Restore version",
    );
    expect(restoreButtons).toHaveLength(2);
  });

  // Test 3
  it("clicking Restore appends a NEW active version (versions array grows, none removed), closes the popover, and shows the success toast", async () => {
    const { store, persistenceValue } = makeHarness();
    const container = await mount(renderControl(store, persistenceValue));
    await openPopover(container);

    expect(overlayVersions(store)).toHaveLength(3);

    const restoreButtons = Array.from(document.body.querySelectorAll("button")).filter(
      (b) => b.textContent === "Restore version",
    );
    await act(async () => {
      restoreButtons[0]?.click();
    });

    const versionsAfter = overlayVersions(store);
    expect(versionsAfter).toHaveLength(4);
    // None of the original three ids were removed — supersede-never-mutate.
    expect(versionsAfter.map((v) => v.id)).toEqual(
      expect.arrayContaining([V1.id, V2.id, V3_ACTIVE.id]),
    );

    expect(toastSuccess).toHaveBeenCalledWith("Restored to an earlier version");
    expect(toastError).not.toHaveBeenCalled();

    // Popover closed — portaled content unmounted.
    expect(document.body.querySelector('[aria-label="Panel versions"]')).toBeNull();
  });

  // Test 4
  it("a persist failure fires the exact toast.error copy with a Retry action and keeps the popover open", async () => {
    const scheduleSave = vi.fn(() => {
      throw new Error("simulated persist failure");
    });
    const { store, persistenceValue } = makeHarness(scheduleSave);
    const container = await mount(renderControl(store, persistenceValue));
    await openPopover(container);

    const restoreButtons = Array.from(document.body.querySelectorAll("button")).filter(
      (b) => b.textContent === "Restore version",
    );
    await act(async () => {
      restoreButtons[0]?.click();
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    const [message, options] = toastError.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe("Couldn't restore that version — try again.");
    expect(options.action.label).toBe("Retry");
    expect(typeof options.action.onClick).toBe("function");

    // Popover stays open — portaled content still present.
    expect(document.body.querySelector('[aria-label="Panel versions"]')).not.toBeNull();
  });

  // Test 5
  it("the trigger is disabled while isLocked", async () => {
    const { store, persistenceValue } = makeHarness();
    const container = await mount(renderControl(store, persistenceValue, true));

    const trigger = container.querySelector('[aria-label="Version history"]') as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
  });
});
