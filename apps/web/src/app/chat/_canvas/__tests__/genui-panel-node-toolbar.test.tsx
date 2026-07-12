/**
 * genui-panel-node-toolbar.test.tsx — GenuiPanelNode's PANL-01 wiring
 * (52-02-PLAN.md Task 3): the toolbar row mounts for a genui_spec panel and
 * NOT for an interactive_widget panel, and the rendered content is themed by
 * the pack an overlay resolves to (proves rehydration on reload themes the
 * panel end-to-end).
 *
 * Mirrors `panel-data-flow.test.tsx`/`interactive-widget-canvas.test.tsx`'s
 * zero-mock createRoot-in-jsdom harness, mounting the REAL `GenuiPanelNode`
 * (needs `ReactFlowProvider` for `<Handle>`, mirrors
 * `knowledge-preview-node.test.tsx`'s convention) over the real
 * `CanvasStoreProvider`/`CanvasPersistenceProvider`/`CanvasSpecProvider`
 * seams. `~/trpc/react`'s `api.useQueries` is mocked with the SAME fake-`t`-
 * proxy convention `panel-data-flow.test.tsx` uses for `useDataBindings`
 * (no live tRPC/QueryClient mounted in this test package).
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReactFlowProvider } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";

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
  return queries.map((q): FakeQueryResult => {
    if (q.enabled === false) {
      return { data: undefined, isLoading: false, isError: false };
    }
    return { data: undefined, isLoading: true, isError: false };
  });
});

// 52-03-PLAN.md Task 3: EditParamsControl (mounted for real inside the
// toolbar this suite renders, no longer an inert skeleton) calls
// `api.genui.applyPanelEdit.useMutation()` — stubbed inert here since this
// suite only exercises toolbar/theming wiring, not the edit-params flow
// itself (covered by edit-params-control.test.tsx).
vi.mock("~/trpc/react", () => ({
  api: {
    useQueries: (cb: (t: typeof FAKE_T) => unknown[]) => useQueriesMock(cb),
    genui: {
      applyPanelEdit: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {
    /* jsdom does not implement this — no-op polyfill for Radix Select. */
  };
}

import { createCanvasStore } from "../canvas-store";
import { CanvasStoreProvider } from "../canvas-store-context";
import { CanvasPersistenceProvider, type CanvasPersistenceContextValue } from "../panel-overlay-context";
import { CanvasSpecProvider } from "../canvas-spec-context";
import { GenuiPanelNode, type GenuiPanelNodeType } from "../genui-panel-node";
import type { MessagePart } from "../../_hooks/use-chat-stream";
import type { Provenance } from "../node-data-schemas";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GENUI_MESSAGE_ID = "00000000-0000-0000-0000-0000000000b2";
const WIDGET_MESSAGE_ID = "00000000-0000-0000-0000-0000000000c3";
const CONVERSATION_ID = "11111111-1111-1111-1111-111111111111";

const GENUI_PROVENANCE: Provenance = { messageId: GENUI_MESSAGE_ID, partIndex: 0, runId: null };
const WIDGET_PROVENANCE: Provenance = { messageId: WIDGET_MESSAGE_ID, partIndex: 0, runId: null };

const SPEC_JSON = JSON.stringify({ v: 1, root: { type: "text", content: "Hello panel" } });
const SPECS_MAP = new Map<string, string>([[`${GENUI_MESSAGE_ID}:0`, SPEC_JSON]]);

const WIDGET_PART: MessagePart = {
  type: "interactive_widget",
  interactionId: "22222222-2222-2222-2222-222222222222",
  widgetKind: "proposal_cards",
  declaration: {
    prompt: "Which plan?",
    options: [{ id: "opt-0", title: "Ship next week" }],
  },
};
const WIDGET_PARTS_MAP = new Map<string, MessagePart>([[`${WIDGET_MESSAGE_ID}:0`, WIDGET_PART]]);

function makeNodeProps(
  overrides: Partial<NodeProps<GenuiPanelNodeType>> = {},
): NodeProps<GenuiPanelNodeType> {
  return {
    id: "genui-panel:test-1",
    data: { provenance: GENUI_PROVENANCE, turnIndex: 1 },
    type: "genui-panel",
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: true,
    selected: false,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    ...overrides,
  } as NodeProps<GenuiPanelNodeType>;
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

beforeEach(() => {
  useQueriesMock.mockClear();
});

afterEach(() => {
  for (const c of containers) {
    document.body.removeChild(c);
  }
  containers = [];
});

function persistenceValue(): CanvasPersistenceContextValue {
  return { scheduleSave: vi.fn(), conversationId: CONVERSATION_ID };
}

describe("GenuiPanelNode toolbar wiring (PANL-01, 52-02-PLAN.md Task 3)", () => {
  it("a genui_spec panel renders the role=toolbar row", async () => {
    const store = createCanvasStore();
    const container = await mount(
      <ReactFlowProvider>
        <CanvasStoreProvider store={store}>
          <CanvasPersistenceProvider value={persistenceValue()}>
            <CanvasSpecProvider specsByProvenance={SPECS_MAP}>
              <GenuiPanelNode {...makeNodeProps()} />
            </CanvasSpecProvider>
          </CanvasPersistenceProvider>
        </CanvasStoreProvider>
      </ReactFlowProvider>,
    );

    const toolbar = container.querySelector('[role="toolbar"]');
    expect(toolbar).not.toBeNull();
    expect(toolbar?.getAttribute("aria-label")).toBe("Panel actions");
  });

  it("an interactive_widget panel renders NO toolbar row", async () => {
    const store = createCanvasStore();
    const container = await mount(
      <ReactFlowProvider>
        <CanvasStoreProvider store={store}>
          <CanvasPersistenceProvider value={persistenceValue()}>
            <CanvasSpecProvider specsByProvenance={new Map()} partsByProvenance={WIDGET_PARTS_MAP}>
              <GenuiPanelNode
                {...makeNodeProps({
                  id: "genui-panel:test-widget",
                  data: { provenance: WIDGET_PROVENANCE, turnIndex: 1 },
                })}
              />
            </CanvasSpecProvider>
          </CanvasPersistenceProvider>
        </CanvasStoreProvider>
      </ReactFlowProvider>,
    );

    expect(container.querySelector('[role="toolbar"]')).toBeNull();
  });

  it("rehydrates the pack an overlay resolves to — the rendered content is themed accordingly", async () => {
    const panelId = "genui-panel:test-themed";
    const store = createCanvasStore({
      shared: {
        panelOverlays: {
          [panelId]: { activeVersionId: null, stylePackId: "playful-rounded", versions: [] },
        },
      },
    });

    const container = await mount(
      <ReactFlowProvider>
        <CanvasStoreProvider store={store}>
          <CanvasPersistenceProvider value={persistenceValue()}>
            <CanvasSpecProvider specsByProvenance={SPECS_MAP}>
              <GenuiPanelNode {...makeNodeProps({ id: panelId })} />
            </CanvasSpecProvider>
          </CanvasPersistenceProvider>
        </CanvasStoreProvider>
      </ReactFlowProvider>,
    );

    // playful-rounded's resolved --primary CSS var (packages/genui/src/theme/packs.ts).
    const themed = Array.from(container.querySelectorAll<HTMLElement>("[style]")).find((el) =>
      el.getAttribute("style")?.includes("--primary:"),
    );
    expect(themed).not.toBeUndefined();
    expect(themed?.getAttribute("style")).toContain("262 83% 58%");
  });
});
