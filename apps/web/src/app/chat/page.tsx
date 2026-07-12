"use client";

// Explicit React import — Next.js's SWC automatic JSX runtime tolerates its
// absence, but vitest's classic-runtime esbuild JSX transform needs `React`
// in scope for any suite that mounts this file directly (documented gotcha,
// see genui-panel-node.tsx / 53-03 / 53-04's identical fix).
import * as React from "react";
import { useCallback, useState } from "react";
import { PanelLeft, PanelLeftClose } from "lucide-react";

import { Button } from "@polytoken/ui/button";

import { useIsMobileViewport } from "~/hooks/use-is-mobile-viewport";
import { api } from "~/trpc/react";

import { ChatHomeEmptyState } from "./_components/chat-home-empty-state";
import { Composer } from "./_components/composer";
import { ConversationRail } from "./_components/conversation-rail";
import { CostMeter } from "./_components/cost-meter";
import { GeneratingIndicator, MessageList } from "./_components/message-list";
import { ModelPicker } from "./_components/model-picker";
import { ChatCanvasIsland } from "./_canvas/chat-canvas-island";
import {
  ChatCanvasViewToggle,
  readStoredViewMode,
  type ChatCanvasViewMode,
} from "./_canvas/chat-canvas-view-toggle";
import { SaveStatusIndicator } from "./_canvas/save-status-indicator";
import type { SaveStatus } from "./_canvas/use-canvas-persistence";
import { useConversationController } from "./_hooks/use-conversation-controller";
import { useWebllmEngine, type UseWebllmEngineResult } from "./_hooks/use-webllm-engine";

interface ConversationViewProps {
  readonly conversationId: string;
  readonly modelId: string;
  /** Single top-level useWebllmEngine() instance (ChatPage) — threaded down
   * so switching conversations never re-instantiates or re-downloads the
   * WebLLM engine (D-08). */
  readonly webllm: UseWebllmEngineResult;
  /** CLUS-01/CLUS-02 (54-04): EmailThreadNode's "Attach chat" action creates
   * + attaches a new conversation to the thread and needs to switch the app
   * to it — mirrors the rail's own "New chat" open UX (handleNewChat below).
   * Threaded through to ChatCanvasIsland -> ChatCanvas ->
   * CanvasPersistenceContext. */
  readonly onOpenConversation: (conversationId: string) => void;
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
  onOpenConversation,
}: ConversationViewProps): React.ReactElement {
  const controller = useConversationController({ conversationId, modelId, webllm });
  const [viewMode, setViewMode] = useState<ChatCanvasViewMode>(() =>
    readStoredViewMode(conversationId),
  );
  // MOBL-01 (53-UI-SPEC.md "Breakpoint & Mount Contract" + Component
  // Inventory §2) — below `md`, the effective mode is ALWAYS "chat"
  // regardless of the persisted/stored `viewMode`: `readStoredViewMode` is
  // still READ above (so returning to desktop restores the prior choice),
  // it's just never allowed to drive the render while mobile-forced, and
  // never overwritten (writeStoredViewMode only fires from the toggle's own
  // onChange, which is unreachable below `md` since the toggle isn't
  // rendered there at all — see below).
  const isMobile = useIsMobileViewport();
  const effectiveViewMode: ChatCanvasViewMode = isMobile ? "chat" : viewMode;
  // Canvas-only ambient save feedback (D-06, 23-UI-SPEC.md "toolbar right
  // zone") — reset to idle whenever the canvas isn't mounted, so switching
  // back to Chat never leaves a stale "Saved"/"retrying" label lingering.
  const [canvasSaveStatus, setCanvasSaveStatus] = useState<SaveStatus>("idle");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <span className="sr-only" aria-live="polite">
        {controller.liveAnnouncement}
      </span>
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border/50 bg-background/95 px-4">
        <div className="flex items-center gap-2">
          {!isMobile && (
            <ChatCanvasViewToggle
              conversationId={conversationId}
              value={viewMode}
              onChange={setViewMode}
            />
          )}
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
        </div>
        <div className="flex items-center gap-3">
          {effectiveViewMode === "canvas" && (
            <SaveStatusIndicator status={canvasSaveStatus} />
          )}
          <CostMeter conversationId={conversationId} />
        </div>
      </div>
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
          <div className="flex h-full min-h-0 flex-col">
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
            />
          </div>
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
 * The rail-collapse toggle lives in this top bar — outside the rail's own
 * 0px-collapsed width — so it stays reachable even when the rail is fully
 * hidden (D-11/UI-SPEC: rail collapses to 0px, not an icon-rail).
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

  return (
    <div className="flex h-svh flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/50 px-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={
            railCollapsed ? "Expand conversation list" : "Collapse conversation list"
          }
          className="size-11"
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
        <span className="text-base font-semibold text-foreground">Chat</span>
      </div>

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

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selectedId && selectedConversation ? (
            <ConversationView
              key={selectedId}
              conversationId={selectedId}
              modelId={selectedConversation.modelId}
              webllm={webllm}
              onOpenConversation={handleOpenConversation}
            />
          ) : selectedId ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading conversation…
            </div>
          ) : (
            <ChatHomeEmptyState
              onNewChat={handleNewChat}
              creating={createConversation.isPending}
            />
          )}
        </div>
      </div>
    </div>
  );
}
