"use client";

import { ArrowDown } from "lucide-react";

import { Button } from "@nauta/ui/button";

export interface JumpToBottomButtonProps {
  readonly onClick: () => void;
}

/**
 * JumpToBottomButton (CHAT-07) — floating icon-only button shown only when
 * the user has scrolled away from the bottom of the message list
 * (22-UI-SPEC.md Interaction Contracts). 44x44 hit area per the spacing
 * scale's touch-target exception.
 */
export function JumpToBottomButton({
  onClick,
}: JumpToBottomButtonProps): React.ReactElement {
  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      aria-label="Jump to latest message"
      className="absolute bottom-4 right-4 size-11 rounded-full shadow-md"
      onClick={onClick}
    >
      <ArrowDown className="size-4" aria-hidden />
    </Button>
  );
}
