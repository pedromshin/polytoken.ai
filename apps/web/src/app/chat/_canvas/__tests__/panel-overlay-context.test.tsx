/**
 * panel-overlay-context.test.tsx — usePanelOverlay round-trips an overlay
 * through the REAL canvas store and persists it via a spied scheduleSave
 * (52-01-PLAN.md Task 3).
 *
 * Zero mocks beyond the scheduleSave spy — real `createCanvasStore`, real
 * `CanvasStoreProvider`, real `usePanelOverlay` (mirrors
 * panel-data-flow.test.tsx's zero-mock convention).
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCanvasStore, type CanvasStore } from "../canvas-store";
import { CanvasStoreProvider } from "../canvas-store-context";
import {
  CanvasPersistenceProvider,
  usePanelOverlay,
  type CanvasPersistenceContextValue,
} from "../panel-overlay-context";
import { appendVersion, type PanelOverlay } from "../panel-overlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface PanelHarnessProps {
  readonly panelId: string;
  readonly onOverlay: (overlay: PanelOverlay | undefined) => void;
  readonly writeRef: { current: ((next: PanelOverlay) => void) | null };
}

function PanelHarness({ panelId, onOverlay, writeRef }: PanelHarnessProps): React.ReactElement {
  const { overlay, writeOverlay } = usePanelOverlay(panelId);
  writeRef.current = writeOverlay;
  onOverlay(overlay);
  return <span data-testid={`overlay-${panelId}`}>{overlay ? "has-overlay" : "no-overlay"}</span>;
}

let containers: HTMLDivElement[] = [];

async function mount(element: React.ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return container;
}

afterEach(() => {
  for (const c of containers) {
    document.body.removeChild(c);
  }
  containers = [];
});

function makeHarness(store: CanvasStore, persistenceValue: CanvasPersistenceContextValue) {
  const panelAWrite = { current: null as ((next: PanelOverlay) => void) | null };
  const panelBWrite = { current: null as ((next: PanelOverlay) => void) | null };
  let panelAOverlay: PanelOverlay | undefined;
  let panelBOverlay: PanelOverlay | undefined;

  const element = (
    <CanvasStoreProvider store={store}>
      <CanvasPersistenceProvider value={persistenceValue}>
        <PanelHarness panelId="panel-a" onOverlay={(o) => (panelAOverlay = o)} writeRef={panelAWrite} />
        <PanelHarness panelId="panel-b" onOverlay={(o) => (panelBOverlay = o)} writeRef={panelBWrite} />
      </CanvasPersistenceProvider>
    </CanvasStoreProvider>
  );

  return { element, panelAWrite, panelBWrite, getPanelAOverlay: () => panelAOverlay, getPanelBOverlay: () => panelBOverlay };
}

describe("usePanelOverlay", () => {
  it("writeOverlay writes to shared.panelOverlays.{panelId} and calls scheduleSave exactly once", async () => {
    const store = createCanvasStore();
    const scheduleSave = vi.fn();
    const persistenceValue: CanvasPersistenceContextValue = {
      scheduleSave,
      conversationId: "11111111-1111-1111-1111-111111111111",
    };
    const { element, panelAWrite } = makeHarness(store, persistenceValue);

    const container = await mount(element);
    expect(container.querySelector('[data-testid="overlay-panel-a"]')?.textContent).toBe("no-overlay");

    const next = appendVersion(undefined, { generatedBy: "edit", specJson: "spec-v1" });
    await act(async () => {
      panelAWrite.current?.(next);
    });

    const values = store.getState().values as { shared?: { panelOverlays?: Record<string, unknown> } };
    expect(values.shared?.panelOverlays?.["panel-a"]).toEqual(next);
    expect(scheduleSave).toHaveBeenCalledTimes(1);
  });

  it("a second panel's overlay is unaffected by the first panel's write (disjoint path)", async () => {
    const store = createCanvasStore();
    const scheduleSave = vi.fn();
    const persistenceValue: CanvasPersistenceContextValue = {
      scheduleSave,
      conversationId: "11111111-1111-1111-1111-111111111111",
    };
    const { element, panelAWrite, getPanelBOverlay } = makeHarness(store, persistenceValue);

    await mount(element);
    const next = appendVersion(undefined, { generatedBy: "regenerate", specJson: "spec-v1" });
    await act(async () => {
      panelAWrite.current?.(next);
    });

    expect(getPanelBOverlay()).toBeUndefined();
    const values = store.getState().values as { shared?: { panelOverlays?: Record<string, unknown> } };
    expect(values.shared?.panelOverlays?.["panel-b"]).toBeUndefined();
  });

  it("reading back after a write returns the parsed overlay", async () => {
    const store = createCanvasStore();
    const scheduleSave = vi.fn();
    const persistenceValue: CanvasPersistenceContextValue = {
      scheduleSave,
      conversationId: "11111111-1111-1111-1111-111111111111",
    };
    const { element, panelAWrite, getPanelAOverlay } = makeHarness(store, persistenceValue);

    await mount(element);
    const next = appendVersion(undefined, { generatedBy: "retheme", specJson: "spec-v1" });
    await act(async () => {
      panelAWrite.current?.(next);
    });

    expect(getPanelAOverlay()).toEqual(next);
  });

  it("throws a clear wiring error when used outside CanvasPersistenceProvider", async () => {
    const store = createCanvasStore();
    const writeRef = { current: null as ((next: PanelOverlay) => void) | null };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      mount(
        <CanvasStoreProvider store={store}>
          <PanelHarness panelId="panel-a" onOverlay={() => undefined} writeRef={writeRef} />
        </CanvasStoreProvider>,
      ),
    ).rejects.toThrow(/CanvasPersistenceProvider/);

    consoleError.mockRestore();
  });
});
