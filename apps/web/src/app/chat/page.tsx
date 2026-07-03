"use client";

import { useCallback, useState } from "react";
import { PanelLeft, PanelLeftClose } from "lucide-react";

import { Button } from "@nauta/ui/button";

import { api } from "~/trpc/react";

import { ChatHomeEmptyState } from "./_components/chat-home-empty-state";
import { ConversationRail } from "./_components/conversation-rail";

/**
 * /chat — client page rendering the two-state layout (D-13) inside the
 * existing root SidebarInset slot (apps/web/src/app/layout.tsx). The
 * conversation rail (D-11) is always mounted; only the main column swaps
 * between the home empty-state and the (placeholder-for-now, 22-08 builds
 * the real thing) conversation view.
 *
 * The rail-collapse toggle lives in this top bar — outside the rail's own
 * 0px-collapsed width — so it stays reachable even when the rail is fully
 * hidden (D-11/UI-SPEC: rail collapses to 0px, not an icon-rail).
 */
export default function ChatPage(): React.ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(false);

  const utils = api.useUtils();
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

        <div className="min-w-0 flex-1 overflow-y-auto">
          {selectedId ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Conversation view arrives in a later plan (22-08).
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
