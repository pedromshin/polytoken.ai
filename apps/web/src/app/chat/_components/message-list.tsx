"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { ScrollArea } from "@nauta/ui/scroll-area";

import type { MessagePart, StreamState } from "../_hooks/use-chat-stream";
import { JumpToBottomButton } from "./jump-to-bottom-button";
import { MessageTurn } from "./message-turn";

// Distance-from-bottom (px) under which the list is considered "pinned" —
// new content auto-scrolls it the rest of the way (22-UI-SPEC.md auto-scroll
// contract: stick to bottom unless the user has scrolled up).
const NEAR_BOTTOM_THRESHOLD_PX = 80;

export interface MessageListItem {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly parts: readonly MessagePart[];
}

export interface MessageListProps {
  readonly turns: readonly MessageListItem[];
  /** id of the single turn currently streaming (drives the tail caret) —
   * null when nothing is streaming. */
  readonly streamingTurnId: string | null;
}

/**
 * MessageList (CHAT-07) — scrollable turn list in a max-w-3xl reading
 * column (22-UI-SPEC.md Layout). Sticks to the bottom while new content
 * streams in unless the user has scrolled up, in which case a
 * JumpToBottomButton appears instead of forcing the view back down.
 *
 * Reads the Radix ScrollArea's underlying scrollable viewport via its
 * `data-radix-scroll-area-viewport` attribute (set internally by
 * @radix-ui/react-scroll-area) — the wrapping @nauta/ui/scroll-area only
 * forwards a ref to the non-scrolling Root element, so the viewport itself
 * has to be queried once mounted.
 */
export function MessageList({
  turns,
  streamingTurnId,
}: MessageListProps): React.ReactElement {
  const scrollAreaRootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);

  useEffect(() => {
    viewportRef.current =
      scrollAreaRootRef.current?.querySelector<HTMLDivElement>(
        "[data-radix-scroll-area-viewport]",
      ) ?? null;
  }, []);

  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const distanceFromBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    setIsPinnedToBottom(distanceFromBottom < NEAR_BOTTOM_THRESHOLD_PX);
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.addEventListener("scroll", handleScroll);
    return () => viewport.removeEventListener("scroll", handleScroll);
    // Re-attach once the viewport ref resolves (first render has no node yet).
  }, [handleScroll, turns.length]);

  // Stick to bottom as new content arrives, unless the user scrolled away.
  useEffect(() => {
    if (!isPinnedToBottom) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [turns, isPinnedToBottom]);

  const scrollToBottom = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    setIsPinnedToBottom(true);
  }, []);

  return (
    <div className="relative min-h-0 flex-1">
      <ScrollArea ref={scrollAreaRootRef} className="h-full">
        <div className="mx-auto max-w-3xl space-y-8 px-4 py-6">
          {turns.map((turn) => (
            <MessageTurn
              key={turn.id}
              role={turn.role}
              parts={turn.parts}
              isStreamingTurn={turn.id === streamingTurnId}
            />
          ))}
        </div>
      </ScrollArea>
      {!isPinnedToBottom && <JumpToBottomButton onClick={scrollToBottom} />}
    </div>
  );
}

export interface GeneratingIndicatorProps {
  readonly state: StreamState;
}

/**
 * GeneratingIndicator — reuses generation-state-chrome.tsx's Loader2 + text
 * idiom (22-UI-SPEC.md Interaction Contracts) rather than inventing a new
 * motif. Rendered above the composer only while state === 'streaming';
 * disappears on any terminal state.
 */
export function GeneratingIndicator({
  state,
}: GeneratingIndicatorProps): React.ReactElement | null {
  if (state !== "streaming") {
    return null;
  }
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-border/50 px-4 py-2">
      <Loader2
        className="size-4 animate-spin text-muted-foreground"
        aria-hidden
      />
      <span className="text-sm text-muted-foreground">Generating…</span>
    </div>
  );
}
