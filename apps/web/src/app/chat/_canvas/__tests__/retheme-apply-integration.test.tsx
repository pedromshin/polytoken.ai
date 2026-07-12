/**
 * retheme-apply-integration.test.tsx — proves the full PANL-04 client path at
 * the unit level: a `retheme` VERSION stored in a panel's overlay resolves
 * through `resolveActivePanel` -> `PanelThemeScope`, and the rendered
 * content's themed wrapper carries THAT version's own `tokenOverrides` (not
 * the base pack's own value) — the phase's theme-application integration
 * proof (52-06-PLAN.md Task 2).
 *
 * Mirrors `genui-panel-node-toolbar.test.tsx`'s zero-mock-overlay harness
 * (real `CanvasStoreProvider`/`CanvasPersistenceProvider`/`CanvasSpecProvider`,
 * real `GenuiPanelNode`), seeding the store directly with a `retheme` version
 * rather than driving the `RethemeControl` UI (that flow is covered by
 * `retheme-control.test.tsx`) — this test isolates the READ side:
 * `resolveActivePanel` -> `PanelThemeScope` applying the STORED version's
 * pack + overrides to a real rendered panel.
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

// Same catch-all inert stubs genui-panel-node-toolbar.test.tsx uses for the
// toolbar's OTHER now-real controls — this suite only exercises the
// READ/theming path (resolveActivePanel -> PanelThemeScope), not any
// control's own mutation flow (each control has its own dedicated test
// file: pack-switcher/edit-params-control/regenerate-control/
// version-history-control/retheme-control .test.tsx).
vi.mock("~/trpc/react", () => ({
  api: {
    useQueries: (cb: (t: typeof FAKE_T) => unknown[]) => useQueriesMock(cb),
    genui: {
      applyPanelEdit: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      generate: {
        useQuery: () => ({ refetch: () => Promise.resolve({ data: undefined }) }),
      },
      resolveRetheme: {
        useQuery: () => ({ refetch: () => Promise.resolve({ data: undefined }) }),
      },
    },
    chat: {
      getHistory: {
        useQuery: () => ({ data: [] }),
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
import {
  CanvasPersistenceProvider,
  type CanvasPersistenceContextValue,
} from "../panel-overlay-context";
import { CanvasSpecProvider } from "../canvas-spec-context";
import { GenuiPanelNode, type GenuiPanelNodeType } from "../genui-panel-node";
import type { Provenance } from "../node-data-schemas";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GENUI_MESSAGE_ID = "00000000-0000-0000-0000-0000000000b2";
const CONVERSATION_ID = "11111111-1111-1111-1111-111111111111";
const GENUI_PROVENANCE: Provenance = { messageId: GENUI_MESSAGE_ID, partIndex: 0, runId: null };

const SPEC_JSON = JSON.stringify({ v: 1, root: { type: "text", content: "Hello panel" } });
const SPECS_MAP = new Map<string, string>([[`${GENUI_MESSAGE_ID}:0`, SPEC_JSON]]);

const RETHEME_VERSION_ID = "30000000-0000-0000-0000-000000000001";
// playful-rounded's own base --primary is "262 83% 58%" (confirmed by
// genui-panel-node-toolbar.test.tsx's rehydration test) — this override
// deliberately differs, so a passing assertion proves PanelThemeScope
// applied the VERSION's own tokenOverrides on top, not just the pack's
// default resolvedVars.
const PRIMARY_OVERRIDE = "10 80% 50%";

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

function makeNodeProps(panelId: string): NodeProps<GenuiPanelNodeType> {
  return {
    id: panelId,
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
  } as NodeProps<GenuiPanelNodeType>;
}

function persistenceValue(): CanvasPersistenceContextValue {
  return { scheduleSave: vi.fn(), conversationId: CONVERSATION_ID };
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

describe("Retheme -> theme integration (PANL-04, 52-06-PLAN.md Task 2)", () => {
  it("a retheme version's resolved pack + tokenOverrides re-theme the rendered panel (overridden --primary, not the base pack value)", async () => {
    const panelId = "genui-panel:test-retheme";
    const store = createCanvasStore({
      shared: {
        panelOverlays: {
          [panelId]: {
            activeVersionId: RETHEME_VERSION_ID,
            stylePackId: null,
            versions: [
              {
                id: RETHEME_VERSION_ID,
                generatedBy: "retheme",
                parentVersionId: null,
                createdAt: new Date().toISOString(),
                specJson: SPEC_JSON,
                stylePackId: "playful-rounded",
                tokenOverrides: { primary: PRIMARY_OVERRIDE },
                instruction: "Make it feel warmer and bolder",
              },
            ],
          },
        },
      },
    });

    const container = await mount(
      <ReactFlowProvider>
        <CanvasStoreProvider store={store}>
          <CanvasPersistenceProvider value={persistenceValue()}>
            <CanvasSpecProvider specsByProvenance={SPECS_MAP}>
              <GenuiPanelNode {...makeNodeProps(panelId)} />
            </CanvasSpecProvider>
          </CanvasPersistenceProvider>
        </CanvasStoreProvider>
      </ReactFlowProvider>,
    );

    const themed = Array.from(container.querySelectorAll<HTMLElement>("[style]")).find((el) =>
      el.getAttribute("style")?.includes("--primary:"),
    );
    expect(themed).not.toBeUndefined();

    // Extract ONLY the --primary declaration (playful-rounded's OTHER vars,
    // e.g. --ring/--shadow-base, legitimately still carry its own base
    // "262 83% 58%" value — this assertion isolates the one var PANL-04's
    // override targets, proving the VERSION's tokenOverrides won there
    // specifically, not just that the substring appears somewhere).
    const style = themed?.getAttribute("style") ?? "";
    const primaryDeclaration = style.split(";").find((decl) => decl.trim().startsWith("--primary:"));
    expect(primaryDeclaration?.trim()).toBe(`--primary: ${PRIMARY_OVERRIDE}`);
  });
});
