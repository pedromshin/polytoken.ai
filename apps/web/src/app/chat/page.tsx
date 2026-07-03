"use client";

import { useCallback, useState } from "react";
import { PanelLeft, PanelLeftClose } from "lucide-react";

import { Button } from "@nauta/ui/button";

import { api } from "~/trpc/react";

import { ChatHomeEmptyState } from "./_components/chat-home-empty-state";
import { Composer } from "./_components/composer";
import { ConversationRail } from "./_components/conversation-rail";
import {
  GeneratingIndicator,
  MessageList,
  type MessageListItem,
} from "./_components/message-list";
import {
  useChatStream,
  type MessagePart,
  type StreamState,
} from "./_hooks/use-chat-stream";

const STREAMING_TURN_ID = "__streaming-turn__";
const OPTIMISTIC_USER_TURN_ID = "__optimistic-user-turn__";

// Visually-hidden aria-live announcer copy (22-UI-SPEC.md Accessibility) —
// announces STATE TRANSITIONS only, never the growing delta text itself
// (that would spam screen readers on every streamed token).
function liveAnnouncementFor(state: StreamState): string {
  switch (state) {
    case "streaming":
      return "Generating response";
    case "completed":
      return "Response complete";
    case "stopped":
      return "Response stopped by user";
    case "failed":
      return "Response failed";
    case "cost_capped":
      return "Cost limit reached";
    default:
      return "";
  }
}

interface ConversationViewProps {
  readonly conversationId: string;
  readonly modelId: string;
}

/**
 * ConversationView — the /chat main column once a conversation is selected
 * (CHAT-01/03/06/07, STREAM-01). Merges persisted history (chat.getHistory)
 * with the live streaming turn from useChatStream. The optimistic user
 * message renders immediately on submit — before the assistant stream even
 * starts — and both transient turns are dropped once the turn settles and
 * chat.getHistory is invalidated (the persisted row takes over).
 */
function ConversationView({
  conversationId,
  modelId,
}: ConversationViewProps): React.ReactElement {
  const utils = api.useUtils();
  const { data: historyRows } = api.chat.getHistory.useQuery({
    conversationId,
  });
  const [optimisticUserText, setOptimisticUserText] = useState<string | null>(
    null,
  );

  const handleTerminal = useCallback(() => {
    // Every terminal branch persists whatever streamed so far (D-15) — the
    // persisted row is now authoritative, so replace the transient turns.
    void utils.chat.getHistory.invalidate({ conversationId });
    setOptimisticUserText(null);
  }, [conversationId, utils]);

  const chatStream = useChatStream({ conversationId, onTerminal: handleTerminal });

  const handleSubmit = useCallback(
    (text: string) => {
      setOptimisticUserText(text);
      chatStream.send(text, modelId);
    },
    [chatStream, modelId],
  );

  const historyTurns: MessageListItem[] = (historyRows ?? [])
    .filter((row) => row.isActive)
    .map((row) => ({
      id: row.id,
      role: row.role as MessageListItem["role"],
      parts: (row.parts as MessagePart[] | null) ?? [],
    }));

  const turns: MessageListItem[] = [...historyTurns];
  if (optimisticUserText !== null && chatStream.state !== "idle") {
    turns.push({
      id: OPTIMISTIC_USER_TURN_ID,
      role: "user",
      parts: [{ type: "text", text: optimisticUserText }],
    });
  }
  if (chatStream.state !== "idle" && chatStream.parts.length > 0) {
    turns.push({
      id: STREAMING_TURN_ID,
      role: "assistant",
      parts: chatStream.parts,
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <span className="sr-only" aria-live="polite">
        {liveAnnouncementFor(chatStream.state)}
      </span>
      <MessageList turns={turns} streamingTurnId={STREAMING_TURN_ID} />
      <GeneratingIndicator state={chatStream.state} />
      <Composer
        isStreaming={chatStream.state === "streaming"}
        onSubmit={handleSubmit}
        onStop={chatStream.stop}
      />
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
          onClick={() => setRailCollapsed((prev) => !prev)}
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
          onNewChat={handleNewChat}
          creatingConversation={createConversation.isPending}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selectedId && selectedConversation ? (
            <ConversationView
              key={selectedId}
              conversationId={selectedId}
              modelId={selectedConversation.modelId}
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
