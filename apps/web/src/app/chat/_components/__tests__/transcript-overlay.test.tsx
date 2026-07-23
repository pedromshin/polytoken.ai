/**
 * transcript-overlay.test.tsx — criterion 4's gate, and the layout-destruction
 * regression test that comes with it (61-07, SURF-07, backlog 999.17).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE STAKES, NAMED — because the most important assertion in this file guards
 * a bug that would otherwise ship silently and green.
 *
 * `chat.saveCanvasLayout` UPSERTS THE WHOLE `chat_canvas_layouts` ROW.
 * `CanvasSnapshotSchema` requires `nodes` and `edges`; there is no partial-save
 * path. `scheduleSave` snapshots `latestStateRef.{nodes,edges,viewport}` at
 * fire time — whatever the host handed `useCanvasPersistence`.
 *
 * So a `TranscriptPanelHost` wired the obvious way —
 *     useCanvasPersistence({ conversationId, nodes: [], edges: [], viewport: null })
 * — DELETES EVERY NODE AND EDGE THE USER EVER PLACED on that conversation's
 * canvas, the first time a panel writes an overlay from the transcript. From a
 * phone, where the canvas cannot even be reached. On a re-theme. And it passes
 * every other test in this repository, because until this file nothing asserted
 * that a save PRESERVES the layout.
 *
 * `it("...round-trips the persisted layout...")` below is that assertion. It
 * was red-proven against the naive version before this file was committed: with
 * empty nodes/edges wired in, it fails with `snapshot.nodes` = `[]`. If it ever
 * stops observing the real `saveCanvasLayout` payload, it stops being evidence
 * — fix the test, never weaken it.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The rest of the file gates criterion 4 itself: a panel re-themed or
 * regenerated ON THE CANVAS renders that way in the DOCKED transcript of the
 * same conversation, plus the three trees `MessageTurn` renders in.
 *
 * Conventions borrowed, not invented: `use-canvas-persistence-save-error.test.tsx`
 * for the tRPC mock + fake-timer debounce control, `panel-overlay-context.test.tsx`
 * for the raw react-dom/client + act mount (no @testing-library in this package),
 * `retheme-apply-integration.test.tsx` for reading a resolved pack back off the
 * themed wrapper's inline style.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReactFlowProvider } from "@xyflow/react";

import { DEFAULT_PACK_ID, getStylePack } from "@polytoken/genui/theme";

interface SaveMutationCallbacks {
  readonly onSuccess?: () => void;
  readonly onError?: (error: unknown) => void;
}

/** The persisted `chat.getCanvasLayout` row this mount should see. Set per
 * test BEFORE mounting (the mock reads it at render time). */
let layoutRow: unknown = null;
const saveSpy = vi.fn((_input: unknown, _opts?: SaveMutationCallbacks) => undefined);

vi.mock("~/trpc/react", () => ({
  api: {
    chat: {
      getCanvasLayout: { useQuery: () => ({ data: layoutRow, isPending: false }) },
      saveCanvasLayout: { useMutation: () => ({ mutate: saveSpy }) },
      // ChatNode's own title query (the three-trees case (b) mounts a real one).
      listConversations: {
        useQuery: () => ({ data: [{ id: CONVERSATION_ID, title: "Fixture chat" }] }),
      },
      // 61-08: `RegenerateControl` reads the turn's history row to rebuild its
      // prompt. Reached because the docked host now mounts the REAL
      // `PanelActionsToolbar` — see the note on `genui` below.
      getHistory: { useQuery: () => ({ data: [] }) },
      // CH-01: the real ChatNode now mounts a Composer with ComposerAttachments
      // (useSendTo + chip rail). Additive stubs — this suite asserts overlay
      // resolution, not attach.
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
    // ────────────────────────────────────────────────────────────────────
    // 61-08 — THIS BLOCK IS EVIDENCE, NOT A CHORE.
    //
    // 61-07's mock needed only `chat.*`, because the docked transcript
    // rendered a panel and nothing that could EDIT one. These four procedures
    // are here because `TranscriptGenuiPanel` now mounts the real toolbar on
    // this host's marker, so the real `EditParamsControl` /
    // `RegenerateControl` / `RethemeControl` really call them. Without them the
    // suite dies on `Cannot read properties of undefined (reading
    // 'applyPanelEdit')` — which is the mount proving itself: the same shape as
    // 61-07's own `chat-mobile-feed.test.tsx` mock having to learn
    // `getCanvasLayout` when the host first genuinely queried it.
    //
    // Mirrors `_canvas/__tests__/genui-panel-node-toolbar.test.tsx`'s mock
    // verbatim rather than inventing a second convention — it is the same
    // toolbar, and the two suites should fail the same way when it changes.
    // ────────────────────────────────────────────────────────────────────
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
import { ChatControllerProvider } from "../../_canvas/chat-node";
import { ChatNode } from "../../_canvas/chat-node";
import { createCanvasStore } from "../../_canvas/canvas-store";
import { appendVersion, setPack, type PanelOverlay } from "../../_canvas/panel-overlay";
import {
  CanvasPersistenceProvider,
  usePanelOverlay,
  type CanvasPersistenceContextValue,
} from "../../_canvas/panel-overlay-context";
import { NODE_REGISTRY_VERSION } from "../../_canvas/node-registry-version";
import {
  TranscriptPanelHost,
  useIsTranscriptPanelHost,
} from "../../_canvas/transcript-panel-host";
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

/** The SAME pure function `reconcileNodesFromHistory` builds the canvas node's
 * id with — which is the entire reason the two surfaces agree on panel identity
 * without a convention anyone has to maintain. Computed here, never hardcoded:
 * a literal would still pass if the scheme changed under it. */
const PANEL_ID = genuiPanelNodeId(MESSAGE_ID, PART_INDEX);

const BASE_TEXT = "BASE PANEL CONTENT";
const VERSION_TEXT = "REGENERATED PANEL CONTENT";

/**
 * The base spec carries NO `style_pack_id`, deliberately.
 *
 * `SpecRenderer` wraps its output in its OWN `ThemedRoot` when the spec has a
 * pack (spec-renderer.tsx:150), and CSS custom properties resolve from the
 * NEAREST ancestor that sets them — so an inner `ThemedRoot` would re-set
 * `--primary` underneath `PanelThemeScope` and the pack assertions below would
 * be reading a var the rendered content does not actually use. That is a
 * VACUOUS assertion of exactly the shape 61-06's negative proof caught in its
 * own gate. No spec pack here means `PanelThemeScope` is the only themed
 * wrapper, so what the assertion reads is what the content resolves.
 * (`retheme-apply-integration.test.tsx` — the canvas's mirror of this test —
 * uses a pack-less spec for the same reason.)
 */
const BASE_SPEC = { v: 1, root: { type: "text", content: BASE_TEXT } } as const;
const BASE_SPEC_JSON = JSON.stringify(BASE_SPEC);
const VERSION_SPEC_JSON = JSON.stringify({ v: 1, root: { type: "text", content: VERSION_TEXT } });

const OVERRIDE_PACK_ID = "playful-rounded" as const;
const OVERRIDE_PRIMARY = getStylePack(OVERRIDE_PACK_ID).resolvedVars.primary;
const DEFAULT_PRIMARY = getStylePack(DEFAULT_PACK_ID).resolvedVars.primary;

/** A REAL layout — the thing a transcript-side save must not destroy. Three
 * nodes at hand-picked positions, a data edge between two of them, and a
 * viewport the user panned/zoomed to. */
const SEEDED_NODES = [
  {
    id: `chat:${CONVERSATION_ID}`,
    type: "chat",
    position: { x: 10, y: 20 },
    data: { conversationId: CONVERSATION_ID },
  },
  {
    id: PANEL_ID,
    type: "genui-panel",
    position: { x: 420, y: 260 },
    data: {
      provenance: { messageId: MESSAGE_ID, partIndex: PART_INDEX, runId: null },
      turnIndex: 1,
    },
  },
  {
    id: "email-thread:22222222-2222-2222-2222-222222222222",
    type: "email-thread",
    position: { x: 900, y: 40 },
    data: { threadId: "22222222-2222-2222-2222-222222222222" },
  },
];

const SEEDED_EDGES = [
  {
    id: "data-edge:chat:genui-panel:answer",
    source: `chat:${CONVERSATION_ID}`,
    target: PANEL_ID,
    data: { sourcePath: "shared.selectedThread", targetKey: "answer" },
  },
];

const SEEDED_VIEWPORT = { x: -140, y: -55, zoom: 0.75 };

/** A `chat.getCanvasLayout` row carrying the seeded layout plus `overlay` (if
 * any) at this panel's `shared.panelOverlays.{panelId}` path — i.e. exactly
 * what the CANVAS would have persisted after a re-theme/regenerate there. */
function rowWith(overlay?: unknown): unknown {
  return {
    nodes: SEEDED_NODES,
    edges: SEEDED_EDGES,
    viewport: SEEDED_VIEWPORT,
    sharedState:
      overlay === undefined ? {} : { shared: { panelOverlays: { [PANEL_ID]: overlay } } },
    nodeRegistryVersion: NODE_REGISTRY_VERSION,
  };
}

function genuiPart(): MessagePart {
  return { type: "genui_spec", spec: BASE_SPEC } as unknown as MessagePart;
}

function streamingGenuiPart(): MessagePart {
  return { type: "genui_spec_streaming", partialJson: BASE_SPEC_JSON } as unknown as MessagePart;
}

function transcript(): React.ReactElement {
  return (
    <MessageTurn
      messageId={MESSAGE_ID}
      role="assistant"
      parts={[genuiPart()]}
      status="completed"
    />
  );
}

// ---------------------------------------------------------------------------
// Mount harness
// ---------------------------------------------------------------------------

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

beforeEach(() => {
  layoutRow = null;
  saveSpy.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => {
    for (const r of roots) r.unmount();
  });
  for (const c of containers) c.remove();
  roots = [];
  containers = [];
  vi.useRealTimers();
});

/** Drives the REAL write path a panel control takes — `usePanelOverlay`'s
 * `writeOverlay`, which mutates `shared.panelOverlays.{panelId}` and schedules
 * a persist. This is precisely what Plan 61-08's toolbar will call from inside
 * this same host, which is what makes the T-61-21 test below a test of the
 * shipping path and not of a mock. */
function OverlayWriterInner({
  panelId,
  writeRef,
}: {
  readonly panelId: string;
  readonly writeRef: { current: ((next: PanelOverlay) => void) | null };
}): null {
  const { writeOverlay } = usePanelOverlay(panelId);
  writeRef.current = writeOverlay;
  return null;
}

/**
 * The mount shape a panel control MUST use inside this host, and the reason is
 * not style: `TranscriptPanelHost` renders its children UNWRAPPED until the
 * layout restores, and `usePanelOverlay` THROWS without a persistence provider.
 * An ungated writer therefore dies on the pre-restore render — which is every
 * mount's first render. This test found that live (the first run of the T-61-21
 * case threw "usePanelOverlay must be used inside a CanvasPersistenceProvider"),
 * which is why the host exposes `useIsTranscriptPanelHost()` and why 61-08's
 * toolbar gates on it. The hook lives in the CHILD, so the gate is a
 * conditional render, never a conditional hook call.
 */
function OverlayWriter({
  panelId,
  writeRef,
}: {
  readonly panelId: string;
  readonly writeRef: { current: ((next: PanelOverlay) => void) | null };
}): React.ReactElement | null {
  const isHost = useIsTranscriptPanelHost();
  if (!isHost) return null;
  return <OverlayWriterInner panelId={panelId} writeRef={writeRef} />;
}

/** The one themed wrapper's resolved `--primary`, read off its inline style —
 * `retheme-apply-integration.test.tsx`'s idiom. Returns undefined when nothing
 * themed rendered at all. */
function resolvedPrimary(container: HTMLElement): string | undefined {
  const themed = Array.from(container.querySelectorAll<HTMLElement>("[style]")).find((el) =>
    el.getAttribute("style")?.includes("--primary:"),
  );
  const style = themed?.getAttribute("style") ?? "";
  return style
    .split(";")
    .find((decl) => decl.trim().startsWith("--primary:"))
    ?.trim();
}

// ---------------------------------------------------------------------------
// Criterion 4 — the overlay crosses to the transcript
// ---------------------------------------------------------------------------

describe("criterion 4 — the docked transcript reflects the canvas's panel overlays", () => {
  it("FIXTURE PRECONDITION: the override pack and the default pack disagree about --primary", () => {
    // Without this, every pack assertion below would pass for free. 61-06's
    // negative proof found exactly this shape: a gate that was green and about
    // nothing.
    expect(OVERRIDE_PRIMARY).not.toBe(DEFAULT_PRIMARY);
  });

  it("a RETHEME made on the canvas crosses: the transcript resolves the OVERRIDE pack, not the base spec's", async () => {
    layoutRow = rowWith(setPack(undefined, OVERRIDE_PACK_ID));

    const container = await mount(
      <TranscriptPanelHost conversationId={CONVERSATION_ID}>{transcript()}</TranscriptPanelHost>,
    );

    expect(resolvedPrimary(container)).toBe(`--primary: hsl(${OVERRIDE_PRIMARY})`);
    expect(resolvedPrimary(container)).not.toBe(`--primary: hsl(${DEFAULT_PRIMARY})`);
  });

  it("a REGENERATED version crosses: the transcript renders the ACTIVE version's spec, not the base", async () => {
    // Built with the real mutator, never hand-shaped — a literal that drifts
    // from PanelOverlaySchema would test a fiction (and `parseOverlay` would
    // degrade it to `undefined`, making this pass for the wrong reason).
    layoutRow = rowWith(
      appendVersion(undefined, { generatedBy: "regenerate", specJson: VERSION_SPEC_JSON }),
    );

    const container = await mount(
      <TranscriptPanelHost conversationId={CONVERSATION_ID}>{transcript()}</TranscriptPanelHost>,
    );

    expect(container.textContent).toContain(VERSION_TEXT);
    expect(container.textContent).not.toContain(BASE_TEXT);
  });

  it("NO overlay renders the base spec — the common case, and the one a regression breaks first", async () => {
    layoutRow = rowWith();

    const container = await mount(
      <TranscriptPanelHost conversationId={CONVERSATION_ID}>{transcript()}</TranscriptPanelHost>,
    );

    expect(container.textContent).toContain(BASE_TEXT);
    expect(resolvedPrimary(container)).toBe(`--primary: hsl(${DEFAULT_PRIMARY})`);
  });

  it("NO canvas row at all renders the base spec immediately — the transcript never blocks on a layout query", async () => {
    layoutRow = null;

    const container = await mount(
      <TranscriptPanelHost conversationId={CONVERSATION_ID}>{transcript()}</TranscriptPanelHost>,
    );

    // The overwhelming majority of conversations have never been opened on the
    // canvas. Their transcript must render, not skeleton.
    expect(container.textContent).toContain(BASE_TEXT);
  });

  it("an INVALID stored overlay degrades to the base spec and never throws (T-61-22)", async () => {
    // Schema-invalid on two axes at once: activeVersionId is a number, versions
    // is not an array. `parseOverlay` must degrade this to `undefined` rather
    // than trusting it or throwing — the transcript inherits that posture by
    // using it, and must never "improve" it into a throw.
    layoutRow = rowWith({ activeVersionId: 12345, versions: "not-an-array" });

    const container = await mount(
      <TranscriptPanelHost conversationId={CONVERSATION_ID}>{transcript()}</TranscriptPanelHost>,
    );

    expect(container.textContent).toContain(BASE_TEXT);
  });

  it("STREAMING forces the base spec verbatim even with an active version stored (T-61-24)", async () => {
    layoutRow = rowWith(
      appendVersion(undefined, { generatedBy: "regenerate", specJson: VERSION_SPEC_JSON }),
    );

    const container = await mount(
      <TranscriptPanelHost conversationId={CONVERSATION_ID}>
        <MessageTurn
          messageId={MESSAGE_ID}
          role="assistant"
          parts={[streamingGenuiPart()]}
          isStreamingTurn
        />
      </TranscriptPanelHost>,
    );

    // A stored overlay must never swap a turn's content out from under a
    // generation still in flight.
    expect(container.textContent).toContain(BASE_TEXT);
    expect(container.textContent).not.toContain(VERSION_TEXT);
  });
});

// ---------------------------------------------------------------------------
// The three trees (§D) — the change's real regression surface
// ---------------------------------------------------------------------------

describe("the three trees MessageTurn renders in", () => {
  it("(a) DOCKED, inside TranscriptPanelHost — resolves the overlay", async () => {
    layoutRow = rowWith(
      appendVersion(undefined, { generatedBy: "retheme", specJson: VERSION_SPEC_JSON }),
    );

    const container = await mount(
      <TranscriptPanelHost conversationId={CONVERSATION_ID}>{transcript()}</TranscriptPanelHost>,
    );

    expect(container.textContent).toContain(VERSION_TEXT);
  });

  it("(b) ON THE CANVAS, inside a real ChatNode — resolves from the CANVAS's own store, with no second host", async () => {
    // The case that is easy to ASSUME and easy to break. A ChatNode is a node
    // on the board whose body is a MessageList — already inside chat-canvas's
    // provider stack — so the same optional read must resolve against the
    // canvas's live store. Verified with a real ChatNode rather than argued.
    const store = createCanvasStore({
      shared: {
        panelOverlays: {
          [PANEL_ID]: appendVersion(undefined, {
            generatedBy: "regenerate",
            specJson: VERSION_SPEC_JSON,
          }),
        },
      },
    });
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

    expect(container.textContent).toContain(VERSION_TEXT);
    expect(container.textContent).not.toContain(BASE_TEXT);
  });

  it("(c) BARE, with no providers at all — renders the base spec and does NOT throw", async () => {
    // This is what protects the pre-existing chat suites. If the overlay read
    // ever throws on a missing provider, every bare MessageTurn mount in the
    // repo dies with it.
    const container = await mount(transcript());

    expect(container.textContent).toContain(BASE_TEXT);
  });
});

// ---------------------------------------------------------------------------
// The host marker — 61-08 mounts its editing toolbar on this
// ---------------------------------------------------------------------------

describe("useIsTranscriptPanelHost — the marker a panel control mounts on", () => {
  function MarkerProbe({ reportTo }: { readonly reportTo: (v: boolean) => void }): null {
    reportTo(useIsTranscriptPanelHost());
    return null;
  }

  it("is TRUE inside a ready TranscriptPanelHost", async () => {
    layoutRow = rowWith();
    let seen: boolean | undefined;
    await mount(
      <TranscriptPanelHost conversationId={CONVERSATION_ID}>
        <MarkerProbe reportTo={(v) => (seen = v)} />
      </TranscriptPanelHost>,
    );
    expect(seen).toBe(true);
  });

  it("is FALSE inside the CANVAS's own providers — the board grows no second toolbar", async () => {
    // The assertion store presence CANNOT make: a ChatNode's transcript has a
    // store AND a persistence context, so anything gating on those would mount
    // a duplicate toolbar inside a node on the board, beside the real one.
    const store = createCanvasStore({});
    let seen: boolean | undefined;
    await mount(
      <CanvasStoreProvider store={store}>
        <CanvasPersistenceProvider
          value={{ scheduleSave: vi.fn(), conversationId: CONVERSATION_ID }}
        >
          <MarkerProbe reportTo={(v) => (seen = v)} />
        </CanvasPersistenceProvider>
      </CanvasStoreProvider>,
    );
    expect(seen).toBe(false);
  });

  it("is FALSE with no providers at all", async () => {
    let seen: boolean | undefined;
    await mount(<MarkerProbe reportTo={(v) => (seen = v)} />);
    expect(seen).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T-61-21 — THE REGRESSION TEST. See this file's header for the stakes.
// ---------------------------------------------------------------------------

describe("T-61-21 — a transcript-scheduled save must never destroy the canvas layout", () => {
  it("round-trips the persisted layout: the save payload still carries every seeded node, edge and the viewport", async () => {
    layoutRow = rowWith();

    const writeRef: { current: ((next: PanelOverlay) => void) | null } = { current: null };

    await mount(
      <TranscriptPanelHost conversationId={CONVERSATION_ID}>
        <OverlayWriter panelId={PANEL_ID} writeRef={writeRef} />
        {transcript()}
      </TranscriptPanelHost>,
    );

    // The host must have provided a persistence context at all — otherwise the
    // assertions below would pass vacuously (no save, nothing to be wrong).
    expect(writeRef.current).not.toBeNull();

    // THE MOBILE RE-THEME. Exactly the path PackSwitcher takes today on the
    // canvas and Plan 61-08's toolbar will take here.
    await act(async () => {
      writeRef.current?.(setPack(undefined, OVERRIDE_PACK_ID));
    });

    // Let the ~800ms debounce fire.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const [payload] = saveSpy.mock.calls[0] as [
      { readonly conversationId: string; readonly snapshot: Record<string, unknown> },
    ];

    // ── THE ASSERTION THIS WHOLE FILE EXISTS FOR ──────────────────────────
    // The naive host (nodes: [], edges: []) makes every one of these fail with
    // an empty array. Positions are compared EXACTLY (D-06: a saved node is
    // restored at its exact saved position — a save that moves them is the same
    // bug in a milder key).
    expect(payload.snapshot.nodes).toEqual(SEEDED_NODES);
    expect(payload.snapshot.edges).toEqual(SEEDED_EDGES);
    expect(payload.snapshot.viewport).toEqual(SEEDED_VIEWPORT);
    // ──────────────────────────────────────────────────────────────────────

    // ...and the write the user actually made is in the same payload — the
    // round-trip preserves the layout WITHOUT dropping the thing it was saving.
    const sharedState = payload.snapshot.sharedState as {
      shared: { panelOverlays: Record<string, { stylePackId: string }> };
    };
    expect(sharedState.shared.panelOverlays[PANEL_ID]?.stylePackId).toBe(OVERRIDE_PACK_ID);
    expect(payload.conversationId).toBe(CONVERSATION_ID);
  });

  it("round-trips a layout it did not write: an overlay written over an EXISTING overlay still preserves every node", async () => {
    // The likelier real-world shape — the user already re-themed on the canvas,
    // then re-themes again from their phone. Guards against a fix that only
    // works when sharedState starts empty.
    layoutRow = rowWith(
      appendVersion(undefined, { generatedBy: "regenerate", specJson: VERSION_SPEC_JSON }),
    );

    const writeRef: { current: ((next: PanelOverlay) => void) | null } = { current: null };

    await mount(
      <TranscriptPanelHost conversationId={CONVERSATION_ID}>
        <OverlayWriter panelId={PANEL_ID} writeRef={writeRef} />
        {transcript()}
      </TranscriptPanelHost>,
    );

    await act(async () => {
      writeRef.current?.(setPack(undefined, OVERRIDE_PACK_ID));
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const [payload] = saveSpy.mock.calls[0] as [{ readonly snapshot: Record<string, unknown> }];
    expect(payload.snapshot.nodes).toEqual(SEEDED_NODES);
    expect(payload.snapshot.edges).toEqual(SEEDED_EDGES);
  });
});
