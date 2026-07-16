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
 * CHROME (61-06, on 58-IDENTITY.md's locked laws — supersedes 23-UI-SPEC.md
 * and 26-UI-SPEC.md FIX-04's chrome clauses):
 *
 * The shell is the sketch's flat `.card` via `canvasNodeShellClass` — one
 * recipe shared with every other node kind. What makes this node a CHAT node is
 * its left rule's WEIGHT, taken from `CANVAS_NODE_KIND_GEOMETRY.chat` (law 3:
 * kind is shape, never hue). FIX-04's `border-l-2 border-l-primary` had the
 * right IDEA — a left rule saying "this is the conversation" — and the wrong
 * spelling: `--primary` resolves to ink, so the stripe was already hueless on
 * screen while still READING as an accent to anyone editing the file. The idea
 * survives; the indirection does not.
 *
 * FIX-04 also gave this header `bg-muted/60` against every other node's
 * `bg-muted/40` — a "neutral tonal shift" invented when the system had nothing
 * else to differentiate node kinds with. It has geometry now, so both fills are
 * gone: the header is the sketch's `.ch`, a `--hair` bottom rule on the card's
 * own ground, and the kind is legible from the rule weight instead of from two
 * shades of the same grey.
 *
 * LAW 2 — THE TITLE STAYS SANS, and this is the deliberate half of a pair with
 * `email-thread-node.tsx`'s opposite call. Law 2's test is "where did the words
 * come from?", not "which element holds them". A conversation title is
 * user-authored or polytoken-generated — it is NOT the user's mail — and the
 * `?? "Chat"` fallback is unambiguously polytoken's own word. So it is chrome,
 * and chrome speaks sans. The sketch's serif `.ct2` sits on cards whose titles
 * ARE the mail's own words (a thread subject, a source title); this is not one.
 *
 * `min-w-[400px] min-h-[320px]` body with internal scroll (`MessageList`'s own
 * `ScrollArea`). Selection is an ink outline (see `canvas-node-shell-class.ts`).
 */

import * as React from "react";
import { createContext, memo, useContext } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { MessageSquare } from "lucide-react";

import { api } from "~/trpc/react";

import { Composer } from "../_components/composer";
import { GeneratingIndicator, MessageList } from "../_components/message-list";
import type { ConversationController } from "../_hooks/use-conversation-controller";
import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";
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
      {/* The sketch's `.ch`: a --hair bottom rule, a --faded icon, no fill.
          The icon is faded on EVERY kind — it is not the differentiator, the
          geometry is (law 3, and .ch svg{color:var(--faded)} verbatim). */}
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center gap-2 border-b border-hair px-3 active:cursor-grabbing">
        <MessageSquare className="size-3 shrink-0 text-faded" aria-hidden />
        {/* SANS — a conversation title is polytoken's/the user's word for this
            chat, never the mail's own words. See the file header's law-2 note. */}
        <span className="truncate text-xs font-semibold text-ink">{title}</span>
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
      className={`h-full min-h-[320px] w-full min-w-[400px] ${canvasNodeShellClass(CANVAS_NODE_KIND_GEOMETRY.chat, selected === true)}`}
    >
      <Handle type="target" position={Position.Left} />
      <ChatNodeBody conversationId={data.conversationId} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
