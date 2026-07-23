"use client";

/**
 * send-to-menu.tsx — the ONE universal "Send to chat / Send to canvas"
 * affordance (FEATURE-CATALOG AI-04). Drop `<SendToMenu object={…} />` on any
 * object surface (a knowledge node, a document, …) and it offers, per the
 * object's KIND, to attach it as durable chat context and/or drop it on a
 * conversation's canvas. The rails live in `useSendTo`; this file is only the
 * menu chrome.
 *
 * Target conversation: the DEFAULT (most-recent) conversation is one click on
 * "Send to chat" / "Send to canvas". When the caller owns more than one
 * conversation, a "…in <conversation>" submenu picks another target. Only the
 * caller's OWN conversations are ever listed (listConversations is
 * user-scoped) and only channels the kind supports render (a document has no
 * chat-context rail, so it shows "Send to canvas" alone).
 *
 * SECURITY: conversation titles are DB-origin strings rendered as plain
 * escaped React text children — never interpolated into a class/style/href.
 */

import * as React from "react";
import { LayoutDashboard, MessageSquarePlus, Send } from "lucide-react";

import { cn } from "@polytoken/ui";
import { Button } from "@polytoken/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@polytoken/ui/dropdown-menu";

import {
  supportsChannel,
  useSendTo,
  type SendableObject,
  type SendChannel,
} from "./use-send-to";

interface SendToMenuProps {
  /** The typed object this menu acts on — its `kind` gates the channels. */
  readonly object: SendableObject;
  /**
   * Human name of the object, for the trigger's aria-label ("Send <name> to a
   * conversation"). NOT rendered visually — the trigger is icon-only.
   */
  readonly objectName?: string;
  /** Dropdown alignment against the trigger (default "end"). */
  readonly align?: "start" | "center" | "end";
  /** Extra classes for the trigger button (e.g. reveal-on-hover on a row). */
  readonly triggerClassName?: string;
}

const CHANNEL_LABEL: Record<SendChannel, string> = {
  chat: "Send to chat",
  canvas: "Send to canvas",
};

function ChannelIcon({ channel }: { readonly channel: SendChannel }): React.ReactElement {
  return channel === "chat" ? (
    <MessageSquarePlus className="mr-2 size-4" aria-hidden />
  ) : (
    <LayoutDashboard className="mr-2 size-4" aria-hidden />
  );
}

export function SendToMenu({
  object,
  objectName,
  align = "end",
  triggerClassName,
}: SendToMenuProps): React.ReactElement | null {
  const { conversations, defaultConversationId, sendToChat, sendToCanvas, isSending } =
    useSendTo();

  const send = React.useCallback(
    (channel: SendChannel, conversationId: string) => {
      if (channel === "chat") sendToChat(object, conversationId);
      else sendToCanvas(object, conversationId);
    },
    [object, sendToChat, sendToCanvas],
  );

  const channels: SendChannel[] = (["chat", "canvas"] as const).filter((channel) =>
    supportsChannel(object.kind, channel),
  );

  // A kind with no rail at all renders nothing rather than an empty menu.
  if (channels.length === 0) return null;

  const hasPicker = conversations.length > 1;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={
            objectName !== undefined
              ? `Send ${objectName} to a conversation`
              : "Send to a conversation"
          }
          aria-busy={isSending || undefined}
          className={cn(
            "size-7 shrink-0 text-faded hover:bg-shade hover:text-ink",
            "focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1",
            triggerClassName,
          )}
        >
          <Send className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align={align} className="min-w-52">
        {defaultConversationId === null ? (
          <DropdownMenuItem disabled>
            Start a chat first to send this
          </DropdownMenuItem>
        ) : (
          channels.map((channel) => (
            <React.Fragment key={channel}>
              {/* One click -> the most-recent conversation (the default). */}
              <DropdownMenuItem
                onClick={() => send(channel, defaultConversationId)}
              >
                <ChannelIcon channel={channel} />
                {CHANNEL_LABEL[channel]}
              </DropdownMenuItem>

              {/* …or pick another owned conversation. */}
              {hasPicker && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger inset>
                    {CHANNEL_LABEL[channel]} in…
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                    <DropdownMenuLabel className="text-2xs text-pencil uppercase">
                      Choose conversation
                    </DropdownMenuLabel>
                    {conversations.map((conversation, index) => (
                      <DropdownMenuItem
                        key={conversation.id}
                        onClick={() => send(channel, conversation.id)}
                      >
                        <span className="truncate">{conversation.title}</span>
                        {index === 0 && (
                          <span className="ml-2 shrink-0 text-2xs text-pencil">
                            current
                          </span>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}

              {channel !== channels[channels.length - 1] && <DropdownMenuSeparator />}
            </React.Fragment>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
