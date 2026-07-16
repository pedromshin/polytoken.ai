"use client";

// Explicit React import — Next.js's SWC automatic JSX runtime tolerates its
// absence, but vitest's classic-runtime esbuild JSX transform needs `React`
// in scope for any suite that mounts this file directly (documented gotcha,
// see genui-panel-node.tsx / 53-03 / 53-04's identical fix).
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { ScrollArea } from "@polytoken/ui/scroll-area";

import type { MessagePart, StreamState } from "../_hooks/use-chat-stream";
import { JumpToBottomButton } from "./jump-to-bottom-button";
import {
  MessageTurn,
  type MessageTurnWidgets,
  type TurnStatus,
} from "./message-turn";

// Distance-from-bottom (px) under which the list is considered "pinned" —
// new content auto-scrolls it the rest of the way (22-UI-SPEC.md auto-scroll
// contract: stick to bottom unless the user has scrolled up).
const NEAR_BOTTOM_THRESHOLD_PX = 80;

export interface MessageListItem {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly parts: readonly MessagePart[];
  /** Terminal status for a settled assistant turn (CHAT-05, D-15/D-19/D-21). */
  readonly status?: TurnStatus;
  /** Sibling message ids for this turn's regenerate group, version order
   * (D-16) — length<=1 hides SiblingNav. Assistant turns only. */
  readonly siblings?: readonly string[];
  readonly activeSiblingIndex?: number;
  /** The server's currently-ACTIVE sibling id for this turn — the only
   * valid `assistant_message_id` regenerate()/retry can target (D-16). */
  readonly regenerateTargetId?: string;
}

export interface MessageListProps {
  readonly turns: readonly MessageListItem[];
  /** id of the single turn currently streaming (drives the tail caret) —
   * null when nothing is streaming. */
  readonly streamingTurnId: string | null;
  /** Regenerate a turn (CHAT-04) and retry a failed turn (CHAT-05) are the
   * SAME operation — re-running the turn as a new sibling version. */
  readonly onRegenerate?: (assistantMessageId: string) => void;
  /** True while another turn is actively streaming — disables regenerate to
   * prevent overlapping runs. */
  readonly regenerateDisabled?: boolean;
  readonly onNavigateSibling?: (siblingMessageId: string) => void;
  /** Widget render surface (keyed by interactionId) threaded to every turn's
   * interactive_widget parts (Task 4, D-08) — the same bundle for all turns;
   * each part looks up its own interactionId. */
  readonly widgets?: MessageTurnWidgets;
}

/**
 * MessageList (CHAT-07) — scrollable turn list in a max-w-3xl reading
 * column (22-UI-SPEC.md Layout). Sticks to the bottom while new content
 * streams in unless the user has scrolled up, in which case a
 * JumpToBottomButton appears instead of forcing the view back down.
 *
 * Reads the Radix ScrollArea's underlying scrollable viewport via its
 * `data-radix-scroll-area-viewport` attribute (set internally by
 * @radix-ui/react-scroll-area) — the wrapping @polytoken/ui/scroll-area only
 * forwards a ref to the non-scrolling Root element, so the viewport itself
 * has to be queried once mounted.
 */
export function MessageList({
  turns,
  streamingTurnId,
  onRegenerate,
  regenerateDisabled = false,
  onNavigateSibling,
  widgets,
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
        {/* THE SKETCH'S `.turns` (direction-final.html:415):
              flex; flex-direction:column; gap:16px; padding:20px 18px
            `space-y-8` (32px) spaced this like a DOCUMENT; `gap-4` (16px)
            spaces it like a conversation, which is what it is. The flex
            column is also what lets a turn place itself — `.uturn` is
            `align-self:flex-end` (message-turn.tsx's `self-end`) — instead of
            every turn carrying its own full-width `flex justify-*` wrapper.

            `px-4` IS A PAIR DECISION, NOT THE SKETCH'S 18px (D-61-04-A). The
            sketch pads `.turns` 18px and `.composer` 16px — it never had to
            align them, because its `.chatcol` is a fixed 388px box with no
            centred reading column in it. Ours are two `mx-auto max-w-3xl`
            columns stacked on each other, so 18-vs-16 would offset the
            composer's field from the prose directly above it by 2px, forever.
            The composer (61-03, committed) is `px-4 py-3.5`; alignment of the
            pair beats 2px of fidelity to a number the sketch never had to
            make true. `py-5` IS the sketch's 20px — it pairs with nothing.

            `w-full` IS LOAD-BEARING (D-61-06). Radix's ScrollArea Viewport
            wraps its children in an inline `{min-width:100%; display:table}`
            div, and `display:table` SHRINK-WRAPS TO CONTENT. `mx-auto`
            centres against that content box, so without `w-full` this column
            centres against whatever the widest turn happens to be rather than
            against the viewport. That wrapper is what put the conversation
            rail's Rename/Delete 144px off-screen (61-03-SUMMARY.md), and
            `npm run test:geometry` now measures `scrollWidth <= clientWidth`
            on this very viewport. */}
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5">
          {turns.map((turn) => (
            <MessageTurn
              key={turn.id}
              role={turn.role}
              parts={turn.parts}
              isStreamingTurn={turn.id === streamingTurnId}
              status={turn.status}
              siblings={turn.siblings}
              activeSiblingIndex={turn.activeSiblingIndex}
              regenerateDisabled={regenerateDisabled}
              onRegenerate={
                turn.regenerateTargetId && onRegenerate
                  ? () => onRegenerate(turn.regenerateTargetId!)
                  : undefined
              }
              onNavigateSibling={
                turn.siblings && onNavigateSibling
                  ? (index: number) => {
                      const targetId = turn.siblings?.[index];
                      if (targetId) onNavigateSibling(targetId);
                    }
                  : undefined
              }
              widgets={widgets}
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
 *
 * Same register as `ToolRoundActivityRow` (61-04): machine bookkeeping, so
 * `--pencil` at the small step, on a `--hair` rule. It carried
 * `border-border/50` + `text-muted-foreground` — a hairline stated as 50% of a
 * heavier rule, and a tone one step LOUDER than the sketch's status lines ask
 * for (`--muted-foreground` resolves to `--faded`, post-59). It sits directly
 * between the transcript and the composer's own `border-hair` dock, so the two
 * rules were visibly disagreeing about what a hairline is.
 *
 * `--pencil` IS LEGAL HERE, and that needed checking rather than assuming
 * (brand-guide §3): pencil is below the AA floor on `--shade` (4.23:1 light /
 * 4.02:1 dark) but fine on `--bright`, and this row renders in the chat column,
 * which page.tsx lifts to `bg-bright` (the sketch's `.chatcol`).
 */
export function GeneratingIndicator({
  state,
}: GeneratingIndicatorProps): React.ReactElement | null {
  if (state !== "streaming") {
    return null;
  }
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-hair px-4 py-2">
      {/* `motion-safe:` guarded, like every other spinner in this column
          (ToolRoundActivityRow, the composer). This one shipped unguarded, so
          two spinners a few pixels apart disagreed about honouring
          prefers-reduced-motion. */}
      <Loader2 className="size-4 text-pencil motion-safe:animate-spin" aria-hidden />
      <span className="text-sm text-pencil">Generating…</span>
    </div>
  );
}
