"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { cn } from "@nauta/ui";
import { Button } from "@nauta/ui/button";
import { Collapsible, CollapsibleContent } from "@nauta/ui/collapsible";
import { ScrollArea } from "@nauta/ui/scroll-area";
import { Skeleton } from "@nauta/ui/skeleton";

import { api } from "~/trpc/react";

import { ConversationRow, type ConversationSummary } from "./conversation-row";
import { DeleteConversationDialog } from "./delete-conversation-dialog";

const COLLAPSE_STORAGE_KEY = "chat:rail:collapsed";

interface ConversationRailProps {
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onDeleted: (deletedId: string) => void;
  readonly collapsed: boolean;
  readonly onCollapsedChange: (collapsed: boolean) => void;
  readonly onNewChat: () => void;
  readonly creatingConversation: boolean;
}

function RailSkeleton(): React.ReactElement {
  return (
    <div
      aria-busy="true"
      aria-label="Loading conversations…"
      className="space-y-2 p-2"
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-md" />
      ))}
    </div>
  );
}

/**
 * ConversationRail (D-11) — own collapsible rail nested inside /chat, built
 * from @nauta/ui/collapsible (Radix Collapsible) rather than a second
 * app-shell-style sidebar provider — reusing that provider would collide
 * with the app shell's shared `sidebar:state` cookie. Collapse state persists
 * to `localStorage["chat:rail:collapsed"]`, independent of that cookie; the
 * boolean itself is controlled by the parent (/chat/page.tsx) so a top-bar
 * toggle can reach it even while the rail is visually 0px wide.
 *
 * Owns the inline-rename (D-12) and hard-delete-confirm (D-14) interaction
 * state for its rows: which row is currently renaming, and which
 * conversation the single `DeleteConversationDialog` instance targets.
 */
export function ConversationRail({
  selectedId,
  onSelect,
  onDeleted,
  collapsed,
  onCollapsedChange,
  onNewChat,
  creatingConversation,
}: ConversationRailProps): React.ReactElement {
  // Hydrate the persisted collapse preference once on mount.
  useEffect(() => {
    const stored = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
    if (stored === "true") {
      onCollapsedChange(true);
    }
    // Intentionally run once on mount only — hydration read, not a sync loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist every change back to the same key.
  useEffect(() => {
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  const utils = api.useUtils();
  const { data: conversations, isLoading } =
    api.chat.listConversations.useQuery({});

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deletingConversation, setDeletingConversation] =
    useState<ConversationSummary | null>(null);

  const renameConversation = api.chat.renameConversation.useMutation({
    onSuccess: async () => {
      await utils.chat.listConversations.invalidate();
      setRenamingId(null);
    },
  });

  const deleteConversation = api.chat.deleteConversation.useMutation({
    onSuccess: async (_result, variables) => {
      await utils.chat.listConversations.invalidate();
      onDeleted(variables.id);
      setDeletingConversation(null);
    },
  });

  return (
    <>
      <Collapsible
        open={!collapsed}
        onOpenChange={(open) => onCollapsedChange(!open)}
      >
        <div
          className={cn(
            "h-full shrink-0 overflow-hidden border-r border-border/50 bg-background/70 backdrop-blur-md",
            "motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-in-out",
            collapsed ? "w-0" : "w-[280px]",
          )}
        >
          <CollapsibleContent forceMount className="h-full w-[280px]">
            <div className="flex h-full w-[280px] flex-col">
              <div className="shrink-0 p-2">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="w-full gap-2"
                  onClick={onNewChat}
                  disabled={creatingConversation}
                >
                  <Plus className="size-4" aria-hidden />
                  New chat
                </Button>
              </div>

              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-1 p-2 pt-0">
                  {isLoading ? (
                    <RailSkeleton />
                  ) : conversations && conversations.length > 0 ? (
                    conversations.map((conversation) => (
                      <ConversationRow
                        key={conversation.id}
                        conversation={conversation}
                        isActive={conversation.id === selectedId}
                        isRenaming={renamingId === conversation.id}
                        onSelect={onSelect}
                        onRequestRename={setRenamingId}
                        onRequestDelete={setDeletingConversation}
                        onRenameCommit={(id, title) =>
                          renameConversation.mutate({ id, title })
                        }
                        onRenameCancel={() => setRenamingId(null)}
                      />
                    ))
                  ) : (
                    <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                      No conversations yet.
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      <DeleteConversationDialog
        conversationTitle={deletingConversation?.title ?? null}
        open={deletingConversation !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingConversation(null);
        }}
        onConfirm={() => {
          if (deletingConversation) {
            deleteConversation.mutate({ id: deletingConversation.id });
          }
        }}
        isDeleting={deleteConversation.isPending}
      />
    </>
  );
}
