"use client";

import { useCallback, useRef, useState } from "react";
import { Send, Square } from "lucide-react";

import { Button } from "@nauta/ui/button";
import { Textarea } from "@nauta/ui/textarea";

// max-h-52 (13 lines @ 16px line-height) — 22-UI-SPEC.md Spacing Scale.
const MAX_TEXTAREA_HEIGHT_PX = 208;

export interface ComposerProps {
  /** True exactly while the active turn is streaming (CHAT-06). */
  readonly isStreaming: boolean;
  /** Called with the trimmed, non-empty submitted text. */
  readonly onSubmit: (text: string) => void;
  readonly onStop: () => void;
}

/**
 * Composer (CHAT-03, CHAT-06) — multi-line textarea (44px min-height,
 * auto-grows to max-h-52 then scrolls internally), Enter submits /
 * Shift+Enter inserts a newline, disabled while the active turn streams.
 * The Send button morphs into Stop IN THE SAME SLOT while streaming (one
 * button element, icon/variant swap only — no layout-shifting branch),
 * per 22-UI-SPEC.md Interaction Contracts + Accessibility (focus stays on
 * one tab-stop across the morph).
 */
export function Composer({
  isStreaming,
  onSubmit,
  onStop,
}: ComposerProps): React.ReactElement {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`;
  }, []);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(event.target.value);
      resizeTextarea();
    },
    [resizeTextarea],
  );

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    onSubmit(trimmed);
    setValue("");
    // Focus management (UI-SPEC Accessibility): submitting never moves
    // focus away from the composer.
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      resizeTextarea();
    });
  }, [value, isStreaming, onSubmit, resizeTextarea]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    },
    [submit],
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl shrink-0 items-end gap-2 px-4 py-4">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={isStreaming}
        placeholder="Ask the agent anything…"
        rows={1}
        className="max-h-52 min-h-[44px] resize-none overflow-y-auto"
      />
      <Button
        type="button"
        variant={isStreaming ? "secondary" : "default"}
        size="icon"
        className="size-11 shrink-0"
        aria-label={isStreaming ? "Stop generating" : "Send message"}
        onClick={isStreaming ? onStop : submit}
        disabled={!isStreaming && value.trim().length === 0}
      >
        {isStreaming ? (
          <Square className="size-4" aria-hidden />
        ) : (
          <Send className="size-4" aria-hidden />
        )}
      </Button>
    </div>
  );
}
