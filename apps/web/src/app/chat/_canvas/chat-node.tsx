"use client";

/**
 * chat-node.tsx — ChatNode: the canvas's `chat` custom React Flow node
 * (CANVAS-01, D-02).
 *
 * Reuses Phase 22's `MessageList` + `GeneratingIndicator` + `Composer`
 * wholesale (NOT reimplemented) driven by the SAME `ConversationController`
 * instance the docked view uses — the canvas host (`ChatCanvas`, Task 3)
 * provides it via `ChatControllerProvider`, so switching Chat <-> Canvas
 * never re-instantiates streaming state and never interrupts an in-flight
 * generation (D-02). `ChatNode` itself never calls
 * `useConversationController` — it only ever reads the shared instance
 * through context.
 *
 * Chrome per 23-UI-SPEC.md: `h-9 node-drag-handle` header (`bg-muted/60
 * border-border/60`, intentionally the SAME neutral treatment as
 * `GenuiPanelNode` — "never special-case chat"), `min-w-[400px]
 * min-h-[320px]` body with internal scroll (`MessageList`'s own
 * `ScrollArea`), `ring-2 ring-primary ring-offset-1` selection idiom.
 */

import * as React from "react";
import { createContext, memo, useContext } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";

import { api } from "~/trpc/react";

import { Composer } from "../_components/composer";
import { GeneratingIndicator, MessageList } from "../_components/message-list";
import type { ConversationController } from "../_hooks/use-conversation-controller";
import type { ChatNodeData } from "./node-data-schemas";

export type ChatNodeType = Node<ChatNodeData, "chat">;

// ---------------------------------------------------------------------------
// ChatControllerContext — the D-02 seam. React Flow's NodeProps only ever
// carries {data, selected, ...} for a given node — there is no channel to
// pass an arbitrary extra prop (like a shared controller instance) straight
// into a node component, so the canvas host threads it through context
// instead (mirrors CanvasSpecContext's seam shape from 23-02).
// ---------------------------------------------------------------------------

const ChatControllerContext = createContext<ConversationController | null>(null);

export interface ChatControllerProviderProps {
  readonly children: React.ReactNode;
  readonly controller: ConversationController;
}

/** Wraps the canvas tree (Task 3's `ChatCanvas`) so `ChatNode` reads the
 * SAME controller instance the docked view drives — never a second one. */
export function ChatControllerProvider({
  children,
  controller,
}: ChatControllerProviderProps): React.ReactElement {
  return (
    <ChatControllerContext.Provider value={controller}>
      {children}
    </ChatControllerContext.Provider>
  );
}

/** A missing provider is a HOST WIRING bug (the canvas can never legitimately
 * mount a `chat` node without a controller instance to drive it) — this is
 * deliberately NOT a degrade-gracefully case like an unrecognized node type
 * (CANVAS-03 governs registry misses, not internal wiring mistakes), so it
 * throws rather than silently rendering an inert shell. */
function useChatController(): ConversationController {
  const ctx = useContext(ChatControllerContext);
  if (ctx === null) {
    throw new Error(
      "ChatNode must be rendered inside a ChatControllerProvider (canvas host wiring — see chat-canvas.tsx)",
    );
  }
  return ctx;
}

/** Non-throwing accessor for the shared controller — returns null when no
 * provider wraps the tree. Used by `GenuiPanelNodeBody` (Task 4, D-08) to
 * read the SAME widget surface the transcript drives, so a click in either
 * surface updates both; a genui-panel node in a test/degraded mount with no
 * controller renders read-only rather than throwing. */
export function useOptionalChatController(): ConversationController | null {
  return useContext(ChatControllerContext);
}

const SELECTED_RING = "ring-2 ring-primary ring-offset-1";

/**
 * ChatNodeBody — the HEAVY content (title query + full message list +
 * composer), split out of the node shell so dragging stays smooth: React Flow
 * feeds changing position props (positionAbsoluteX/Y, dragging) into the node
 * component on EVERY drag tick, defeating its memo — but this body's only
 * prop is the stable conversationId, so its memo holds and the message
 * list/markdown never re-render mid-drag (CANVAS-04; found live 2026-07-04).
 */
const ChatNodeBody = memo(function ChatNodeBody({
  conversationId,
}: {
  readonly conversationId: string;
}) {
  const controller = useChatController();
  const { data: conversations } = api.chat.listConversations.useQuery({});
  const title =
    conversations?.find((conversation) => conversation.id === conversationId)
      ?.title ?? "Chat";

  return (
    <>
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center gap-2 border-b border-border/60 bg-muted/60 px-3 active:cursor-grabbing">
        <span className="truncate text-sm font-semibold text-foreground">
          {title}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
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
    </>
  );
});

export const ChatNode = memo(function ChatNode({
  data,
  selected,
}: NodeProps<ChatNodeType>) {
  return (
    <div
      className={`flex h-full min-h-[320px] w-full min-w-[400px] flex-col overflow-hidden rounded-lg border border-border/60 bg-background shadow-sm transition-shadow duration-150${selected ? ` ${SELECTED_RING}` : ""}`}
    >
      <Handle type="target" position={Position.Left} />
      <ChatNodeBody conversationId={data.conversationId} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
