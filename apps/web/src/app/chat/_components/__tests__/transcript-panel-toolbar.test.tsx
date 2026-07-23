/**
 * transcript-panel-toolbar.test.tsx — CRITERION 3's gate (61-08, SURF-07,
 * backlog 999.17's WRITE half).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PROVES, AND WHY IT IS A DIFFERENT CLAIM FROM 61-07's
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `PANL-01..04` shipped four real editing controls — pack switch, param edit,
 * regenerate, re-theme — and mounted every one of them inside `GenuiPanelNode`,
 * a React Flow node. `page.tsx`'s `effectiveViewMode = isMobile ? "chat"
 * : viewMode` means the canvas NEVER mounts below `md`. So on a phone those four
 * controls did not exist: not hidden, not cramped — absent. That is 999.17's
 * write half, open since Phase 52.
 *
 * 61-07 closed the READ half (a panel re-themed on the canvas renders re-themed
 * in the transcript) and built the seam. This gate covers the WRITE half: the
 * same four controls, mounted into that seam, reachable where the canvas cannot
 * go. **Zero new controls were built** — the only thing that was ever wrong is
 * where they lived, so this suite asserts on the REAL `PanelActionsToolbar` and
 * its REAL controls, never on a stand-in.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE ASSERTION THAT MATTERS MOST IS A NEGATIVE ONE
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `MessageTurn` renders in THREE trees (61-07 §D), and the trap is tree 2:
 *
 *   1. DOCKED, inside `TranscriptPanelHost`      -> toolbar. Criterion 3.
 *   2. ON CANVAS, inside a `ChatNode`            -> NO toolbar. The real
 *      `GenuiPanelNode` beside it on the same board already has one; two
 *      toolbars editing one overlay is a bug, not a feature.
 *   3. BARE (tests), no providers                -> NO toolbar, and no throw.
 *
 * Trees 1 and 2 BOTH have `CanvasStoreProvider` and `CanvasPersistenceProvider`
 * — the canvas's ChatNode transcript sits inside chat-canvas's own stack — so
 * `useOptionalPanelOverlay` resolves happily in both and **store presence cannot
 * tell them apart**. Gating on it grows a second toolbar inside a node on the
 * board. `useIsTranscriptPanelHost()` is provided by that host and nothing else.
 * The "(b) ON THE CANVAS" case below mounts a REAL `ChatNode` inside REAL canvas
 * providers and asserts ZERO toolbars — that is the assertion the naive wiring
 * fails, and it is why this file exists rather than a one-line grep.
 *
 * IT IS ALSO NOT A VIEWPORT CHECK, and this suite deliberately mocks no
 * `matchMedia`: criterion 3 says the user "can reach" the controls on a mobile
 * viewport — not "only on mobile". Mobile renders the SAME docked branch, the
 * same host, the same `MessageTurn`; there is no mobile-specific transcript
 * code (61-07's D-61-07-D). So a gate that mocked a 390px viewport would be
 * testing a mock, not the mechanism. What actually reaches the phone is proven
 * by `chat-mobile-feed.test.tsx` (the mobile docked branch really mounts this
 * host) plus the marker cases here — mechanism, stated honestly, rather than a
 * width-shaped fiction.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReactFlowProvider } from "@xyflow/react";

interface SaveMutationCallbacks {
  readonly onSuccess?: () => void;
  readonly onError?: (error: unknown) => void;
}

/** The persisted `chat.getCanvasLayout` row this mount should see. Set per test
 * BEFORE mounting (the mock reads it at render time). */
let layoutRow: unknown = null;
const saveSpy = vi.fn((_input: unknown, _opts?: SaveMutationCallbacks) => undefined);

/** Mirrors `transcript-overlay.test.tsx`'s mock plus the `genui` procedures the
 * REAL controls call — same convention as
 * `_canvas/__tests__/genui-panel-node-toolbar.test.tsx`, because it is the same
 * toolbar and the two suites should fail the same way when it changes. */
vi.mock("~/trpc/react", () => ({
  api: {
    chat: {
      getCanvasLayout: { useQuery: () => ({ data: layoutRow, isPending: false }) },
      saveCanvasLayout: { useMutation: () => ({ mutate: saveSpy }) },
      listConversations: {
        useQuery: () => ({ data: [{ id: CONVERSATION_ID, title: "Fixture chat" }] }),
      },
      getHistory: { useQuery: () => ({ data: [] }) },
      // CH-01: the real ChatNode mounts a Composer with ComposerAttachments —
      // additive stubs (this suite asserts the toolbar mounts once, not attach).
      listContextEdges: { useQuery: () => ({ data: [] }) },
      createContextEdge: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      addCanvasNode: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      removeContextEdge: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    useUtils: () => ({
      chat: {
        listContextEdges: {
          cancel: async () => undefined,
          getData: () => undefined,
          setData: () => undefined,
          invalidate: async () => undefined,
        },
        getCanvasLayout: {
          cancel: async () => undefined,
          getData: () => null,
          setData: () => undefined,
          invalidate: async () => undefined,
        },
      },
    }),
    files: {
      requestUpload: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      list: { useQuery: () => ({ data: { entries: [] }, isPending: false, isError: false }) },
    },
    genui: {
      applyPanelEdit: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      generate: { useQuery: () => ({ refetch: () => Promise.resolve({ data: undefined }) }) },
      resolveRetheme: {
        useQuery: () => ({ refetch: () => Promise.resolve({ data: undefined }) }),
      },
    },
  },
}));

import { CanvasStoreProvider } from "../../_canvas/canvas-store-context";
import { ChatControllerProvider, ChatNode } from "../../_canvas/chat-node";
import { createCanvasStore } from "../../_canvas/canvas-store";
import {
  CanvasPersistenceProvider,
  type CanvasPersistenceContextValue,
} from "../../_canvas/panel-overlay-context";
import { NODE_REGISTRY_VERSION } from "../../_canvas/node-registry-version";
import { TranscriptPanelHost } from "../../_canvas/transcript-panel-host";
import { genuiPanelNodeId } from "../../_canvas/use-canvas-persistence";
import type { ConversationController } from "../../_hooks/use-conversation-controller";
import type { MessagePart } from "../../_hooks/use-chat-stream";
import { MessageTurn } from "../message-turn";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const CONVERSATION_ID = "00000000-0000-0000-0000-0000000000a1";
const MESSAGE_ID = "11111111-1111-1111-1111-111111111111";
const PART_INDEX = 0;

/** Computed with the SAME pure function the canvas node's id is built from —
 * never hardcoded. A literal would still pass if the scheme changed under it. */
const PANEL_ID = genuiPanelNodeId(MESSAGE_ID, PART_INDEX);

const BASE_SPEC = { v: 1, root: { type: "text", content: "BASE PANEL CONTENT" } } as const;

/**
 * THE FOUR CONTROLS CRITERION 3 NAMES, by the accessible name a user actually
 * reaches them through. Asserting on `aria-label` rather than an icon or a class
 * is the point: "reachable" is a claim about a USER reaching a control, and a
 * button with no accessible name is not reachable by anyone using a screen
 * reader, however perfectly it renders.
 *
 * `history` is the toolbar's fifth control and NOT part of criterion 3 — it is
 * asserted below anyway, because the claim being made is "the existing toolbar
 * mounts", not "four hand-picked controls do".
 */
const CRITERION_3_CONTROLS = ["Style pack", "Edit parameters", "Regenerate", "Re-theme"] as const;

function genuiPart(): MessagePart {
  return { type: "genui_spec", spec: BASE_SPEC } as unknown as MessagePart;
}

/** A REAL clarify_widget part — its `declaration` shape borrowed verbatim from
 * `clarify-widget-boundary.test.tsx` rather than hand-shaped. A part the
 * boundary cannot render would make the no-toolbar assertion below pass for the
 * wrong reason (nothing rendered at all is not the same as "rendered, with no
 * toolbar"). */
function interactiveWidgetPart(): MessagePart {
  return {
    type: "interactive_widget",
    interactionId: "33333333-3333-3333-3333-333333333333",
    widgetKind: "clarify_widget",
    declaration: {
      title: "Tell us more",
      submitLabel: "Send response",
      fields: [{ name: "reason", label: "Reason", required: true }],
    },
  } as unknown as MessagePart;
}

function rowWith(overlay?: unknown): unknown {
  return {
    nodes: [
      {
        id: `chat:${CONVERSATION_ID}`,
        type: "chat",
        position: { x: 10, y: 20 },
        data: { conversationId: CONVERSATION_ID },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    sharedState:
      overlay === undefined ? {} : { shared: { panelOverlays: { [PANEL_ID]: overlay } } },
    nodeRegistryVersion: NODE_REGISTRY_VERSION,
  };
}

function transcript(parts: readonly MessagePart[] = [genuiPart()]): React.ReactElement {
  return (
    <MessageTurn messageId={MESSAGE_ID} role="assistant" parts={parts} status="completed" />
  );
}

// ---------------------------------------------------------------------------
// Mount harness (mirrors transcript-overlay.test.tsx)
// ---------------------------------------------------------------------------

let containers: HTMLDivElement[] = [];
let roots: Root[] = [];

async function mount(ui: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(ui);
  });
  return container;
}

function toolbars(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="toolbar"]'));
}

function controlNames(container: HTMLElement): string[] {
  const toolbar = container.querySelector('[role="toolbar"]');
  if (toolbar === null) return [];
  return Array.from(toolbar.querySelectorAll<HTMLElement>("[aria-label]")).map(
    (el) => el.getAttribute("aria-label") ?? "",
  );
}

beforeEach(() => {
  layoutRow = rowWith();
  saveSpy.mockClear();
});

afterEach(() => {
  act(() => {
    for (const r of roots) r.unmount();
  });
  for (const c of containers) c.remove();
  roots = [];
  containers = [];
});

// ---------------------------------------------------------------------------
// Criterion 3 — the four controls reach the docked transcript
// ---------------------------------------------------------------------------

describe("criterion 3 — the editable-panel toolbar is reachable in the docked transcript", () => {
  it("mounts the REAL PanelActionsToolbar, with its aria contract intact", async () => {
    const container = await mount(
      <TranscriptPanelHost conversationId={CONVERSATION_ID}>{transcript()}</TranscriptPanelHost>,
    );

    const found = toolbars(container);
    expect(found).toHaveLength(1);
    expect(found[0]?.getAttribute("aria-label")).toBe("Panel actions");
  });

  it.each(CRITERION_3_CONTROLS)(
    "the user can reach '%s' — the control criterion 3 names, in the transcript",
    async (label) => {
      const container = await mount(
        <TranscriptPanelHost conversationId={CONVERSATION_ID}>{transcript()}</TranscriptPanelHost>,
      );

      expect(controlNames(container)).toContain(label);
    },
  );

  it("mounts the whole existing toolbar — version history rides along, zero controls were built", async () => {
    const container = await mount(
      <TranscriptPanelHost conversationId={CONVERSATION_ID}>{transcript()}</TranscriptPanelHost>,
    );

    expect(controlNames(container)).toContain("Version history");
  });

  it("STREAMING force-locks every control — a stale edit must never race a live generation", async () => {
    // The toolbar's own `isStreaming` contract, threaded from the part type
    // rather than assumed (T-61-24). Mounted through the REAL streaming branch.
    const container = await mount(
      <TranscriptPanelHost conversationId={CONVERSATION_ID}>
        {transcript([
          {
            type: "genui_spec_streaming",
            partialJson: JSON.stringify(BASE_SPEC),
          } as unknown as MessagePart,
        ])}
      </TranscriptPanelHost>,
    );

    const toolbar = container.querySelector('[role="toolbar"]');
    expect(toolbar).not.toBeNull();

    const buttons = Array.from(toolbar!.querySelectorAll<HTMLButtonElement>("button"));
    expect(buttons.length).toBeGreaterThan(0);
    // Every control locked — none exempt. `disabled` is the toolbar's own
    // force-lock reaching the DOM, not a prop we are re-asserting.
    for (const button of buttons) {
      expect(button.disabled, `${button.getAttribute("aria-label")} must lock while streaming`).toBe(
        true,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The negative half — where the toolbar must NOT appear
// ---------------------------------------------------------------------------

describe("the three trees — the toolbar mounts in exactly ONE of them", () => {
  it("(b) ON THE CANVAS, inside a real ChatNode — grows NO second toolbar", async () => {
    // THE ASSERTION STORE PRESENCE CANNOT MAKE. This tree has a real store and
    // a real persistence context, so `useOptionalPanelOverlay` resolves here —
    // a naive `if (overlay !== undefined)` mounts a toolbar inside this node,
    // on a board where the real GenuiPanelNode beside it already has one.
    // Mounted with a REAL ChatNode inside REAL providers rather than argued.
    const store = createCanvasStore({});
    const persistenceValue: CanvasPersistenceContextValue = {
      scheduleSave: vi.fn(),
      conversationId: CONVERSATION_ID,
    };
    const controller = {
      turns: [
        {
          id: MESSAGE_ID,
          role: "assistant" as const,
          parts: [genuiPart()],
          status: "completed" as const,
        },
      ],
      streamingTurnId: null,
      regenerateDisabled: false,
      handleNavigateSibling: vi.fn(),
      onRegenerateTurn: vi.fn(),
      widgets: undefined,
      activeStreamState: "idle",
      handleSubmit: vi.fn(),
      handleStop: vi.fn(),
    } as unknown as ConversationController;

    const container = await mount(
      <ReactFlowProvider>
        <CanvasStoreProvider store={store}>
          <CanvasPersistenceProvider value={persistenceValue}>
            <ChatControllerProvider controller={controller}>
              <ChatNode
                {...({
                  id: `chat:${CONVERSATION_ID}`,
                  data: { conversationId: CONVERSATION_ID },
                  selected: false,
                  type: "chat",
                  dragging: false,
                  zIndex: 0,
                  selectable: true,
                  deletable: true,
                  draggable: true,
                  isConnectable: true,
                  positionAbsoluteX: 0,
                  positionAbsoluteY: 0,
                } as unknown as React.ComponentProps<typeof ChatNode>)}
              />
            </ChatControllerProvider>
          </CanvasPersistenceProvider>
        </CanvasStoreProvider>
      </ReactFlowProvider>,
    );

    expect(toolbars(container)).toHaveLength(0);
  });

  it("(c) BARE, with no providers at all — no toolbar, and no throw", async () => {
    // The toolbar's controls write through the THROWING `usePanelOverlay` (a
    // write with nothing wired to persist it IS a wiring bug). If the marker
    // ever went true here, every bare MessageTurn mount in the repo would die.
    const container = await mount(transcript());

    expect(toolbars(container)).toHaveLength(0);
    expect(container.textContent).toContain("BASE PANEL CONTENT");
  });

  it("an interactive_widget part gets NO toolbar, in the docked host — same exclusion as the canvas", async () => {
    // `GenuiPanelNode` gates its toolbar on `!isInteractiveWidget` (PANL's own
    // scoping). The transcript honours the same exclusion STRUCTURALLY rather
    // than with a flag: an interactive_widget part routes to
    // `InteractiveWidgetBoundary`, a different branch of the part switch that
    // never reaches `TranscriptGenuiPanel` at all. Asserted because "it cannot
    // happen by construction" is exactly the claim that rots silently when
    // someone adds a branch.
    const container = await mount(
      <TranscriptPanelHost conversationId={CONVERSATION_ID}>
        {transcript([interactiveWidgetPart()])}
      </TranscriptPanelHost>,
    );

    // The widget really rendered — otherwise "no toolbar" would be true of an
    // empty container and this gate would be about nothing.
    expect(container.textContent).toContain("Tell us more");
    expect(toolbars(container)).toHaveLength(0);
  });
});
