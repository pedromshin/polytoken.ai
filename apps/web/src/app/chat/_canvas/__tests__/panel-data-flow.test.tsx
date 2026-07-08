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
import { beforeEach, describe, expect, it, vi } from "vitest";

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

// ---------------------------------------------------------------------------
// Phase 33 (BIND-01) — useDataBindings wiring into GenuiPanelNodeBody's merge
// order (`{ ...panelData, ...liveBindingData }`, live keys win on collision).
//
// `~/trpc/react`'s `api.useQueries` is mocked with the SAME fake-`t`-proxy
// convention as `use-data-bindings.test.tsx` (a real tRPC/QueryClient isn't
// mounted anywhere in this test package). GenuiPanelNodeBody itself is
// module-private and needs React Flow context (see file header) — this
// harness reproduces its ACTUAL production wiring (usePanelData ->
// useDataBindings -> merge -> GenuiPartBoundary's data prop) directly, the
// same pattern this file's first describe block already established.
// ---------------------------------------------------------------------------

interface FakeQueryOptions {
  readonly queryKey: readonly [string, string];
  readonly __input: unknown;
  readonly enabled?: boolean;
  readonly staleTime?: number;
}

interface FakeQueryResult {
  readonly data: unknown;
  readonly isLoading: boolean;
  readonly isError: boolean;
}

let BINDING_RESULTS: Record<string, FakeQueryResult> = {};

function makeProcedureCall(router: string, procedure: string) {
  return (
    input: unknown,
    opts?: { enabled?: boolean; staleTime?: number },
  ): FakeQueryOptions => ({
    queryKey: [router, procedure],
    __input: input,
    ...opts,
  });
}

const FAKE_T = {
  entities: {
    byId: makeProcedureCall("entities", "byId"),
    list: makeProcedureCall("entities", "list"),
  },
  emails: {
    detail: makeProcedureCall("emails", "detail"),
  },
  knowledge: {
    byId: makeProcedureCall("knowledge", "byId"),
    graph: makeProcedureCall("knowledge", "graph"),
  },
};

const useQueriesMock = vi.fn((callback: (t: typeof FAKE_T) => unknown[]) => {
  const queries = callback(FAKE_T) as FakeQueryOptions[];
  return queries.map((q) => {
    if (q.enabled === false) {
      return { data: undefined, isLoading: false, isError: false };
    }
    const key = q.queryKey.join(".");
    return BINDING_RESULTS[key] ?? { data: undefined, isLoading: true, isError: false };
  });
});

vi.mock("~/trpc/react", () => ({
  api: {
    useQueries: (cb: (t: typeof FAKE_T) => unknown[]) => useQueriesMock(cb),
  },
}));

import { useDataBindings } from "../use-data-bindings";

/** Reproduces GenuiPanelNodeBody's ACTUAL merge order over the real
 * usePanelData/useDataBindings/GenuiPartBoundary seam. */
function BoundPanelHarness({
  panelId,
  specJson,
}: {
  readonly panelId: string;
  readonly specJson: string;
}): React.ReactElement {
  const { data: panelData, dispatch } = usePanelData(panelId);
  const actions = usePanelActionRegistry(dispatch);
  const liveBindingData = useDataBindings({ specJson, isStreaming: false, panelData });
  return (
    <GenuiPartBoundary
      specJson={specJson}
      isStreaming={false}
      data={{ ...panelData, ...liveBindingData }}
      actions={actions}
    />
  );
}

/** A `conditional` spec node whose `then`/`else` render distinguishable text —
 * lets assertions observe exactly which value `data.{dataKey}` resolved to
 * without needing a `dataRef`-capable leaf node (only `list`/`conditional`
 * read `dataRef`, per render-node.tsx). */
function conditionalSpecJson(
  dataKey: string,
  matchValue: string,
  bindings?: Record<string, unknown>,
): string {
  return JSON.stringify({
    v: 1,
    ...(bindings !== undefined ? { bindings } : {}),
    root: {
      type: "conditional",
      condition: { dataRef: `data.${dataKey}`, operator: "eq", value: matchValue },
      then: { type: "text", content: "MATCHED" },
      else: { type: "text", content: "NO_MATCH" },
    },
  });
}

describe("useDataBindings wiring into GenuiPanelNodeBody's merged data (Phase 33 BIND-01)", () => {
  beforeEach(() => {
    BINDING_RESULTS = {};
    useQueriesMock.mockClear();
  });

  it("merges live binding data over panelData, with the live value winning on key collision", async () => {
    const store = createCanvasStore({
      panels: { "panel-bound": { sharedKey: "fromPanelData", selectedNodeId: "node-live-1" } },
    });
    BINDING_RESULTS["knowledge.byId"] = { data: "fromBinding", isLoading: false, isError: false };

    const specJson = conditionalSpecJson("sharedKey", "fromBinding", {
      sharedKey: { procedure: "knowledge.byId", params: {} },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = (await import("react-dom/client")).createRoot(container);

    await act(async () => {
      root.render(
        <CanvasStoreProvider store={store}>
          <BoundPanelHarness panelId="panel-bound" specJson={specJson} />
        </CanvasStoreProvider>,
      );
    });

    // panelData.sharedKey === "fromPanelData" but the live binding resolves
    // "fromBinding" for the SAME key — {...panelData, ...liveBindingData}
    // means the live value must win.
    expect(container.textContent).toBe("MATCHED");

    root.unmount();
    document.body.removeChild(container);
  });

  it("renders identically to plain panelData when useDataBindings resolves to {} (no bindings declared)", async () => {
    const store = createCanvasStore({
      panels: { "panel-plain": { sharedKey: "onlyPanelData" } },
    });

    // No top-level `bindings` field at all — extractBindings degrades to {},
    // so the merged data must equal panelData exactly (no key stripping).
    const specJson = conditionalSpecJson("sharedKey", "onlyPanelData");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = (await import("react-dom/client")).createRoot(container);

    await act(async () => {
      root.render(
        <CanvasStoreProvider store={store}>
          <BoundPanelHarness panelId="panel-plain" specJson={specJson} />
        </CanvasStoreProvider>,
      );
    });

    expect(container.textContent).toBe("MATCHED");

    root.unmount();
    document.body.removeChild(container);
  });
});
