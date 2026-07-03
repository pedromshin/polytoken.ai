"use client";

import { useEffect, useRef, useState } from "react";

import { Input } from "@nauta/ui/input";

interface InlineRenameFieldProps {
  readonly initialValue: string;
  readonly onCommit: (title: string) => void;
  readonly onCancel: () => void;
}

const UNTITLED_PLACEHOLDER = "Untitled conversation";

/**
 * InlineRenameField (D-12) — replaces a conversation row's title in place
 * (no dialog). Commits on blur or Enter (calling `onCommit` with the trimmed
 * title — `chat.renameConversation` is invoked by the caller), cancels
 * (reverts, no mutation) on Escape. `UNTITLED_PLACEHOLDER` is the input's
 * placeholder text for an empty snippet; commit itself is blocked while the
 * trimmed value is empty (mirrors `renameConversationInputSchema`'s
 * `title.min(1)` — cancelling instead of submitting an empty title).
 */
export function InlineRenameField({
  initialValue,
  onCommit,
  onCancel,
}: InlineRenameFieldProps): React.ReactElement {
  const [value, setValue] = useState(initialValue);
  const settledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function commit(): void {
    if (settledRef.current) return;
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      settledRef.current = true;
      onCancel();
      return;
    }
    settledRef.current = true;
    onCommit(trimmed);
  }

  function cancel(): void {
    if (settledRef.current) return;
    settledRef.current = true;
    onCancel();
  }

  return (
    <Input
      ref={inputRef}
      value={value}
      placeholder={UNTITLED_PLACEHOLDER}
      maxLength={200}
      aria-label="Conversation title"
      className="h-7 text-sm"
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
    />
  );
}
