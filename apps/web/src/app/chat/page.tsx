"use client";

// Explicit React import — Next.js's SWC automatic JSX runtime tolerates its
// absence, but vitest's classic-runtime esbuild JSX transform needs `React`
// in scope for any suite that mounts this file directly (documented gotcha,
// see genui-panel-node.tsx / 53-03 / 53-04's identical fix).
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PanelLeft, PanelLeftClose } from "lucide-react";

import { Button } from "@polytoken/ui/button";

import { api } from "~/trpc/react";

import { ChatHomeEmptyState } from "./_components/chat-home-empty-state";
import { ChatQuickActionsFab } from "./_components/chat-quick-actions-fab";
import { Composer } from "./_components/composer";
import { ConversationRail } from "./_components/conversation-rail";
import { CostMeter } from "./_components/cost-meter";
import { GeneratingIndicator, MessageList } from "./_components/message-list";
import { ModelPicker } from "./_components/model-picker";
import { ThreadClusterIndicator } from "./_components/thread-cluster-indicator";
import { ChatCanvasIsland } from "./_canvas/chat-canvas-island";
import {
  ChatCanvasViewToggle,
  readStoredViewMode,
  type ChatCanvasViewMode,
} from "./_canvas/chat-canvas-view-toggle";
import { SaveStatusIndicator } from "./_canvas/save-status-indicator";
import { TranscriptPanelHost } from "./_canvas/transcript-panel-host";
import type { SaveStatus } from "./_canvas/use-canvas-persistence";
import { useConversationController } from "./_hooks/use-conversation-controller";
import {
  useModelSettings,
  type UseModelSettingsResult,
} from "./_hooks/use-model-settings";
import { useWebllmEngine, type UseWebllmEngineResult } from "./_hooks/use-webllm-engine";
import { reconcileSelectedConversation } from "./reconcile-selection";

/**
 * ChatHeaderRule (61-03) — the frame's ONE header rule.
 *
 * Until 61-03 the frame stacked TWO `h-11` bars: ChatPage's own ("Chat" + the
 * rail toggle) and ConversationView's (view toggle, model picker, save status,
 * cost meter). That is 88px of chrome at a 900px viewport, 44px of it spent
 * saying "Chat" — a word the app's nav rail already says, next to a rail whose
 * every row is a chat. The sketch's own Chat frame (direction-final.html
 * `#chat`, lines 992-1032) has no page-title bar at all: the rail runs the full
 * height of the frame and the column beside it is turns + composer. So there is
 * one rule here now, it lives in the MAIN COLUMN beside the full-height rail
 * (never spanning it — that is what made the old page bar read as a third
 * stacked bar), and it carries the rail toggle and the conversation's controls
 * together.
 *
 * `h-11 shrink-0` is the height budget the rest of the column hangs off: the
 * body below is `min-h-0 flex-1`. `shrink-0` is load-bearing — a header allowed
 * to shrink would let the body claim more than the viewport and the document
 * would scroll (`npm run test:geometry`).
 *
 * Chrome sits on the page ground (`--shelf`, this app's frame ground) under a
 * `--hair` rule; the reading column below lifts to `--bright`. That tone step
 * is the sketch's own layering (frame `--leaf` -> `.chatcol` `--bright`),
 * mapped onto this app's ground.
 */
function ChatHeaderRule({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-hair px-2">
      {children}
    </div>
  );
}

interface ConversationViewProps {
  readonly conversationId: string;
  readonly modelId: string;
  /** Single top-level useWebllmEngine() instance (ChatPage) — threaded down
   * so switching conversations never re-instantiates or re-downloads the
   * WebLLM engine (D-08). */
  readonly webllm: UseWebllmEngineResult;
  /** The rail-collapse toggle, CONSTRUCTED BY ChatPage (which owns
   * `railCollapsed`/`mobileRailOpen`) and rendered into this view's header rule
   * — the 61-03 frame merge. It stays OUTSIDE the rail's own subtree, so it is
   * still reachable when the rail is 0px wide (D-11: the rail collapses to 0px,
   * not to an icon-rail). ChatPage renders the same element into the same rule
   * on its empty/loading branches, so the toggle never disappears with the
   * conversation. */
  readonly railToggle: React.ReactNode;
  /** CLUS-01/CLUS-02 (54-04): EmailThreadNode's "Attach chat" action creates
   * + attaches a new conversation to the thread and needs to switch the app
   * to it — mirrors the rail's own "New chat" open UX (handleNewChat below).
   * Threaded through to ChatCanvasIsland -> ChatCanvas ->
   * CanvasPersistenceContext. */
  readonly onOpenConversation: (conversationId: string) => void;
  /** The open conversation's reasoning dials (mode + effort), the SAME object
   * ChatPage hands the FAB — threaded into the controller so send/regenerate
   * carry them in the model-call body (write-through, not a UI-only knob). */
  readonly modelSettings: UseModelSettingsResult;
}

/**
 * ConversationView — the /chat main column once a conversation is selected
 * (CHAT-01/03/06/07, STREAM-01, CANVAS-01). Instantiates ONE
 * useConversationController (D-02) — the SAME instance drives both the
 * docked Chat body and the Canvas island, so the ChatCanvasViewToggle can
 * switch between them without ever interrupting an in-flight generation.
 * Merges persisted history (chat.getHistory) with the live streaming turn
 * from EITHER useChatStream (server-locus, SSE) or useWebllmEngine
 * (browser-locus, local — D-08/D-09); the send handler branches purely on
 * the selected model's registry execution_locus — never a hardcoded
 * per-model special case.
 */
function ConversationView({
  conversationId,
  modelId,
  webllm,
  railToggle,
  onOpenConversation,
  modelSettings,
}: ConversationViewProps): React.ReactElement {
  const controller = useConversationController({
    conversationId,
    modelId,
    webllm,
    modelSettings: modelSettings.settings,
  });
  const [viewMode, setViewMode] = useState<ChatCanvasViewMode>(() =>
    readStoredViewMode(conversationId),
  );
  // MOBL / "I NEED CANVAS ON MOBILE" — the canvas mounts on EVERY viewport
  // now. The old `isMobile ? "chat" : viewMode` coercion force-mounted chat
  // below `md`, so the React Flow board (and every editing control that only
  // exists on it) was unreachable on a phone. The route is sized
  // `h-[calc(100svh-var(--app-tabbar-h))]`, so the board fills the mobile
  // viewport; ChatCanvasIsland is `dynamic(ssr:false)` and mounts fine on
  // phones. The persisted/stored `viewMode` now drives the render on all
  // widths, and the toggle (below) is shown everywhere so the user can switch
  // chat <-> canvas on mobile.
  const effectiveViewMode: ChatCanvasViewMode = viewMode;
  // Canvas-only ambient save feedback (D-06, 23-UI-SPEC.md "toolbar right
  // zone") — reset to idle whenever the canvas isn't mounted, so switching
  // back to Chat never leaves a stale "Saved"/"retrying" label lingering.
  const [canvasSaveStatus, setCanvasSaveStatus] = useState<SaveStatus>("idle");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <span className="sr-only" aria-live="polite">
        {controller.liveAnnouncement}
      </span>
      {/* ONE rule (61-03) — the rail toggle and the conversation's controls
          share it. ChatPage's separate "Chat" title bar above this one is
          gone; see ChatHeaderRule. */}
      <ChatHeaderRule>
        {railToggle}
        <ChatCanvasViewToggle
          conversationId={conversationId}
          value={viewMode}
          onChange={setViewMode}
        />
        <ModelPicker
          conversationId={conversationId}
          currentModelId={modelId}
          onSelectBrowserModel={controller.handleSelectBrowserModel}
          webllm={{
            supported: webllm.supported,
            status: webllm.status,
            progress: webllm.progress,
            progressText: webllm.progressText,
          }}
        />
        {/* `ml-auto` rather than a `justify-between` pair of wrappers: the
            left zone is now three independent children (toggle, view toggle,
            model picker) whose middle one is conditional, and an empty
            wrapper div still consumes a `gap`. */}
        <div className="ml-auto flex items-center gap-3">
          {effectiveViewMode === "canvas" && (
            <SaveStatusIndicator status={canvasSaveStatus} />
          )}
          {/* CLUS-02/CLUS-06 (54-06): ambient, additive-only — renders
              nothing for the overwhelming majority of conversations that
              aren't thread-linked (54-UI-SPEC.md Component 3). */}
          <ThreadClusterIndicator conversationId={conversationId} />
          <CostMeter conversationId={conversationId} />
        </div>
      </ChatHeaderRule>
      <div className="min-h-0 flex-1">
        {effectiveViewMode === "canvas" ? (
          <ChatCanvasIsland
            conversationId={conversationId}
            controller={controller}
            historyRows={controller.historyRows}
            onSaveStatusChange={setCanvasSaveStatus}
            onOpenConversation={onOpenConversation}
          />
        ) : (
          // The sketch's `.chatcol` (direction-final.html:409) — turns +
          // composer as ONE surface, lifted a tone step above the page ground
          // (`--bright` against the header's/rail's `--shelf`). Until 61-03 the
          // rail and this column were the SAME colour, separated only by a
          // rule, which is a large part of why the frame read as stacked chrome
          // rather than a registry beside a reading column. The composer inside
          // it deliberately declares NO background of its own (61-03 Task 2) —
          // it is part of this surface, divided from the transcript by a
          // hairline rule, exactly as `.composer` is.
          // TranscriptPanelHost (61-07, criterion 4 / backlog 999.17's read
          // half) — the provider seam that lets THIS transcript's genui panels
          // see the overlays the canvas writes, so a panel re-themed or
          // regenerated on the board renders that way here too. It mounts no
          // React Flow and renders its children unwrapped until the layout
          // restores, so a conversation that has never been opened on the
          // canvas (the common case) is not delayed by a query for a row that
          // does not exist.
          //
          // IT WRAPS THIS BRANCH ONLY, AND THAT IS THE INVARIANT THE WHOLE
          // DESIGN RESTS ON. The `effectiveViewMode === "canvas"` branch above
          // already has the real host's providers, so wrapping both would put
          // TWO stores on one conversation — the drift criterion 4 exists to
          // end. The two branches are MUTUALLY EXCLUSIVE, which makes "never
          // two hosts" true BY CONSTRUCTION rather than by discipline. Do not
          // hoist this wrapper out of the ternary to "simplify" it, and do not
          // reach for it to fix a hydration hiccup.
          <TranscriptPanelHost conversationId={conversationId}>
            <div className="flex h-full min-h-0 flex-col bg-bright">
              <MessageList
                turns={controller.turns}
                streamingTurnId={controller.streamingTurnId}
                regenerateDisabled={controller.regenerateDisabled}
                onNavigateSibling={controller.handleNavigateSibling}
                onRegenerate={controller.onRegenerateTurn}
                widgets={controller.widgets}
              />
              <GeneratingIndicator state={controller.activeStreamState} />
              <Composer
                isStreaming={controller.activeStreamState === "streaming"}
                onSubmit={controller.handleSubmit}
                onStop={controller.handleStop}
                conversationId={conversationId}
              />
            </div>
          </TranscriptPanelHost>
        )}
      </div>
    </div>
  );
}

/**
 * /chat — client page rendering the two-state layout (D-13) inside the
 * existing root SidebarInset slot (apps/web/src/app/layout.tsx). The
 * conversation rail (D-11) is always mounted; the main column swaps between
 * the home empty-state and the streamed ConversationView (22-08 replaces
 * 22-05's placeholder).
 *
 * The rail-collapse toggle is built here and rendered into the single header
 * rule (ChatHeaderRule) by whichever branch is live — outside the rail's own
 * 0px-collapsed width, so it stays reachable even when the rail is fully hidden
 * (D-11/UI-SPEC: rail collapses to 0px, not an icon-rail).
 */
export default function ChatPage(): React.ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(false);
  // MOBL-01 (53-UI-SPEC.md Judgment Call #3) — the rail becomes a left
  // overlay Sheet below `md`; this is a SEPARATE boolean from `railCollapsed`
  // (which defaults to rail-VISIBLE) and defaults CLOSED, so a phone's first
  // paint never shows the overlay unprompted. The existing top-bar toggle
  // button below flips BOTH booleans on every click — only one is ever
  // visually relevant per viewport (desktop reads `railCollapsed`, mobile
  // reads `mobileRailOpen`; CSS alone, not a second useIsMobileViewport()
  // read, decides which — 53-UI-SPEC's "only 2 consumers this phase" rule).
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  // ONE top-level engine instance (D-08) — never re-instantiated when the
  // selected conversation changes, so switching conversations never
  // re-downloads the (large, first-run-only) WebLLM model weights.
  const webllm = useWebllmEngine();

  // The open conversation's reasoning dials (mode + effort). Lifted HERE (not
  // inside ConversationView) so the SAME instance drives both the model-call
  // send path (ConversationView -> controller) and the FAB's dial menus — one
  // source of truth, keyed per conversation (use-model-settings.ts). Re-keys
  // to the newly-selected conversation automatically; null (empty state)
  // yields defaults + no-op setters.
  const modelSettings = useModelSettings(selectedId);

  const utils = api.useUtils();
  const { data: conversations } = api.chat.listConversations.useQuery({});
  const createConversation = api.chat.createConversation.useMutation({
    onSuccess: async (result) => {
      await utils.chat.listConversations.invalidate();
      setSelectedId(result.id);
    },
  });

  const handleNewChat = useCallback(() => {
    createConversation.mutate({});
  }, [createConversation]);

  // CLUS-01/CLUS-02 (54-04): EmailThreadNode's "Attach chat" action already
  // created + attached the new conversation itself (chat.createConversation +
  // chat.attachConversationToThread) — this just switches the visible
  // conversation to it, mirroring handleNewChat's own onSuccess shape
  // (invalidate the rail's list, then select).
  const handleOpenConversation = useCallback(
    (id: string) => {
      void utils.chat.listConversations.invalidate();
      setSelectedId(id);
    },
    [utils],
  );

  // T-22-18-adjacent UX: de-select if the conversation currently open is the
  // one that just got hard-deleted (D-14), otherwise the main column would
  // keep pointing at a conversation id that no longer exists.
  const handleConversationDeleted = useCallback((deletedId: string) => {
    setSelectedId((current) => (current === deletedId ? null : current));
  }, []);

  const selectedConversation =
    conversations?.find((conversation) => conversation.id === selectedId) ??
    null;

  // AUTO-OPEN (task #18): land on the most-recent conversation instead of the
  // empty state. listConversations is updatedAt-desc (conversations.ts), so
  // conversations[0] IS the most recent. Fires AT MOST ONCE per mount — the
  // ref latches as soon as any selection exists (auto or user-made), so
  // deleting the open conversation (handleConversationDeleted → null) shows
  // the empty state rather than bouncing to the next row uninvited.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (selectedId !== null) {
      // A selection already happened by other means (e.g. New chat raced the
      // list query) — never auto-open later in this mount.
      autoOpenedRef.current = true;
      return;
    }
    const mostRecent = conversations?.[0];
    if (!mostRecent) return;
    autoOpenedRef.current = true;
    setSelectedId(mostRecent.id);
  }, [conversations, selectedId]);

  // RECONCILE-STALE-SELECTION (task #4, criterion c) — a selected conversation
  // that vanishes from the list (hard-deleted in another tab, or an id that is
  // no longer accessible to this user) must NEVER strand the main column on a
  // permanent "Loading conversation…" (the `selectedId && !selectedConversation`
  // branch). When the id we point at is gone AND we had previously seen it in a
  // loaded list, fall back to the newest-available conversation, or the empty
  // state (a fresh chat) if none remain.
  //
  // The "had previously seen it" guard is load-bearing: createConversation /
  // duplicate set selectedId to a brand-new id BEFORE the invalidated
  // listConversations refetch includes it, so that id is legitimately absent
  // for one render — we must NOT bounce away from it. Only an id that was in a
  // list and later disappeared is treated as stale.
  const seenConversationIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (conversations === undefined) return;
    // Snapshot "seen before this list" BEFORE folding in the current ids, so a
    // freshly-created id (present now, absent from the prior seen set) is not
    // mistaken for a vanished one.
    const seenBefore = new Set(seenConversationIdsRef.current);
    for (const conversation of conversations) {
      seenConversationIdsRef.current.add(conversation.id);
    }
    const action = reconcileSelectedConversation({
      selectedId,
      conversationIds: conversations.map((conversation) => conversation.id),
      seenIds: seenBefore,
    });
    if (action) setSelectedId(action.nextSelectedId);
  }, [conversations, selectedId]);

  // Constructed HERE (this component owns both booleans) and rendered into the
  // single header rule by whichever branch is live — ConversationView's, or the
  // empty/loading branch's. One element, one definition, one aria contract, and
  // it lives outside the rail's own subtree so it survives the rail collapsing
  // to 0px (D-11).
  //
  // The aria-label strings are load-bearing beyond a11y: 61-01's geometry gate
  // drives the mobile rail open with
  // `getByRole("button", { name: "Collapse conversation list" })`
  // (surface-geometry.spec.ts:242). Keyed on the accessible name, not a class —
  // so a restyle cannot silently repoint it, but a re-WORD would break it.
  const railToggle = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={
        railCollapsed ? "Expand conversation list" : "Collapse conversation list"
      }
      // Ink chrome, stated (law 1): `faded` at rest, `ink` on the `--shade`
      // hover well, ink focus ring. `variant="ghost"` already resolves to those
      // through --accent/--ring, which is the §E trap — compliant by accident of
      // an indirection rather than by design. Say it.
      className="size-11 shrink-0 text-faded hover:bg-shade hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1"
      onClick={() => {
        setRailCollapsed((prev) => !prev);
        setMobileRailOpen((prev) => !prev);
      }}
    >
      {railCollapsed ? (
        <PanelLeft className="size-4" aria-hidden />
      ) : (
        <PanelLeftClose className="size-4" aria-hidden />
      )}
    </Button>
  );

  return (
    // Height budget (originally found by the 61-01 rendered-geometry gate): this route must
    // never claim viewport the shell owns. The MOBL-02 shell replaced the old 44px hamburger
    // top bar with a fixed BOTTOM tab bar whose height layout.tsx publishes as
    // `--app-tabbar-h` (3.5rem + safe-area below `md`, 0px at `md`+), so ONE calc covers both
    // worlds: subtracting the var yields exactly `h-svh` on desktop and exactly
    // viewport-minus-tab-bar on a phone. The geometry gate re-measures this — a bad calc is
    // invalid CSS a browser drops SILENTLY, so the proof is the measured scrollHeight, never
    // the class string.
    <div className="flex h-[calc(100svh-var(--app-tabbar-h))] flex-col">
      {/* The rail is now a FULL-HEIGHT sibling of the column, as in the
          sketch's frame — no bar spans across the top of both. This wrapper is
          the root's only flex child, so it is the whole `h-svh` budget, and it
          is what the rail's own `h-full` chain resolves against. */}
      <div className="flex min-h-0 flex-1">
        <ConversationRail
          selectedId={selectedId}
          onSelect={setSelectedId}
          onDeleted={handleConversationDeleted}
          collapsed={railCollapsed}
          onCollapsedChange={setRailCollapsed}
          mobileOpen={mobileRailOpen}
          onMobileOpenChange={setMobileRailOpen}
          onNewChat={handleNewChat}
          creatingConversation={createConversation.isPending}
        />

        {/* `relative` anchors ChatQuickActionsFab's absolute bottom-right
            position to THIS column (never over the rail). */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {selectedId && selectedConversation ? (
            <ConversationView
              key={selectedId}
              conversationId={selectedId}
              modelId={selectedConversation.modelId}
              webllm={webllm}
              railToggle={railToggle}
              onOpenConversation={handleOpenConversation}
              modelSettings={modelSettings}
            />
          ) : (
            <>
              {/* The same rule, the same toggle element — so collapsing the
                  rail with no conversation open is still reachable, and the
                  header does not appear/disappear as conversations are
                  selected and deleted. */}
              <ChatHeaderRule>{railToggle}</ChatHeaderRule>
              {/* HEIGHT CHAIN: both branches below are `h-full` children
                  (EmptyState's "centered" layout is
                  `flex h-full flex-col items-center justify-center`,
                  empty-state.tsx:129). Before 61-03 they were the ONLY child of
                  the column, so `h-full` meant "the column". Now a 44px header
                  sits above them, and an unwrapped `h-full` here would resolve
                  to the FULL column height — 44px + 100% — and scroll the
                  document by exactly the header's height. This
                  `min-h-0 flex-1` box is what they resolve against instead; it
                  mirrors ConversationView's own body wrapper. */}
              <div className="min-h-0 flex-1">
                {selectedId ? (
                  <div className="flex h-full items-center justify-center text-sm text-faded">
                    Loading conversation…
                  </div>
                ) : (
                  <ChatHomeEmptyState
                    onNewChat={handleNewChat}
                    creating={createConversation.isPending}
                  />
                )}
              </div>
            </>
          )}
          {/* Quick-actions FAB — a SIBLING of both branches (not inside the
              ternary), so it survives conversation switches/deletes and is
              present on the empty state too; conversation-scoped items
              disable themselves while selectedConversation is null. */}
          <ChatQuickActionsFab
            selectedConversation={selectedConversation}
            onNewChat={handleNewChat}
            onOpenConversation={handleOpenConversation}
            modelSettings={modelSettings.settings}
            onSetMode={modelSettings.setMode}
            onSetEffort={modelSettings.setEffort}
            onSelectBrowserModel={async () => {
              // Same 22-11 gate as useConversationController's
              // handleSelectBrowserModel: ensure the engine/weights before
              // persisting a browser-locus pick.
              await webllm.ensureLoaded();
            }}
            webllm={{
              supported: webllm.supported,
              status: webllm.status,
              progress: webllm.progress,
              progressText: webllm.progressText,
            }}
          />
        </div>
      </div>
    </div>
  );
}
