/**
 * panel-data-flow.test.tsx — end-to-end proof that VERIFICATION.md's missing item 2
 * (23-06 Task 3) is closed: a real panel interaction populates the canvas store, the
 * EdgeCreationPicker's OWN field-discovery function lists it as a source option, and a
 * data-carrying edge live-feeds the target panel across successive writes.
 *
 * Zero mocks anywhere in the chain: real `createCanvasStore`, real `usePanelData`, real
 * `usePanelActionRegistry` bridge, real `GenuiPartBoundary`/`SpecRenderer`/`ButtonComponent`,
 * and the picker's own exported `panelFieldOptions`.
 *
 * Uses the repo's createRoot-in-jsdom + `act` convention (see button-action.test.tsx / this
 * plan's explicit instruction) — React 18.3 exports `act` from "react".
 */

import * as React from "react";
import { act } from "react";
import { describe, expect, it } from "vitest";

import { createCanvasStore } from "../canvas-store";
import { CanvasStoreProvider, usePanelData, type IncomingDataEdge } from "../canvas-store-context";
import { usePanelActionRegistry } from "../panel-action-bridge";
import { panelFieldOptions } from "../edge-creation-picker";
import { GenuiPartBoundary } from "../../_components/genui-part-boundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOURCE_SPEC_JSON = JSON.stringify({
  v: 1,
  root: {
    type: "stack",
    children: [
      {
        type: "button",
        label: "Pick B7",
        "aria-label": "Pick B7",
        onClick: { type: "setState", key: "choice", value: "B7" },
      },
      {
        type: "button",
        label: "Pick C2",
        "aria-label": "Pick C2",
        onClick: { type: "setState", key: "choice", value: "C2" },
      },
    ],
  },
});

const INCOMING_EDGES: readonly IncomingDataEdge[] = [
  { sourcePath: "panels.panel-a.choice", targetKey: "input" },
];

/** Mirrors GenuiPanelNodeBody's exact production wiring (that component is module-private
 * and its shell needs React Flow context, so this test-local harness reproduces the seam
 * directly: usePanelData -> usePanelActionRegistry -> GenuiPartBoundary's data + actions). */
function SourcePanelHarness(): React.ReactElement {
  const { data, dispatch } = usePanelData("panel-a");
  const actions = usePanelActionRegistry(dispatch);
  return (
    <GenuiPartBoundary specJson={SOURCE_SPEC_JSON} isStreaming={false} data={data} actions={actions} />
  );
}

/** The STATE-02 live-edge overlay side: a target panel with one incoming data-carrying edge
 * from panel-a's `choice` field into its own `input` key. */
function TargetPanelHarness(): React.ReactElement {
  const { data } = usePanelData("panel-b", INCOMING_EDGES);
  return <span data-testid="target-input">{String(data.input)}</span>;
}

describe("panel write -> store -> picker field discovery -> live edge resolution (23-06 Task 3)", () => {
  it("proves the full end-to-end chain with zero mocks", async () => {
    const store = createCanvasStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = (await import("react-dom/client")).createRoot(container);

    await act(async () => {
      root.render(
        <CanvasStoreProvider store={store}>
          <SourcePanelHarness />
          <TargetPanelHarness />
        </CanvasStoreProvider>,
      );
    });

    // Baseline (the gap's original symptom): before any click, the picker's own field
    // discovery reports no compatible fields for panel-a.
    expect(panelFieldOptions(store.getState().values, "panel-a")).toEqual([]);

    const pickB7 = container.querySelector('[aria-label="Pick B7"]') as HTMLButtonElement | null;
    if (pickB7 === null) throw new Error('button [aria-label="Pick B7"] not found');

    await act(async () => {
      pickB7.click();
    });

    // Interaction -> store write.
    expect(store.getState().read("panels.panel-a.choice")).toBe("B7");

    // The picker's OWN exported field-discovery function now lists exactly one source option.
    expect(panelFieldOptions(store.getState().values, "panel-a")).toEqual([
      "panels.panel-a.choice",
    ]);

    // The live-subscribed target panel resolves the edge with no remount/refresh.
    const targetSpan = container.querySelector('[data-testid="target-input"]');
    expect(targetSpan?.textContent).toBe("B7");

    const pickC2 = container.querySelector('[aria-label="Pick C2"]') as HTMLButtonElement | null;
    if (pickC2 === null) throw new Error('button [aria-label="Pick C2"] not found');

    await act(async () => {
      pickC2.click();
    });

    // A SECOND write re-resolves the SAME target span — proving a live subscription, not a
    // one-shot snapshot.
    expect(store.getState().read("panels.panel-a.choice")).toBe("C2");
    expect(container.querySelector('[data-testid="target-input"]')?.textContent).toBe("C2");

    root.unmount();
    document.body.removeChild(container);
  });
});
