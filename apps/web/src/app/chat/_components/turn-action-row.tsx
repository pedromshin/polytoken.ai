"use client";

import { useCallback, useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";

import type { MessagePart } from "../_hooks/use-chat-stream";
import { SiblingNav } from "./sibling-nav";

const COPIED_RESET_MS = 1500;

function textForCopy(parts: readonly MessagePart[]): string {
  return parts
    .filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
}

export interface TurnActionRowProps {
  readonly parts: readonly MessagePart[];
  readonly onRegenerate?: () => void;
  readonly regenerateDisabled?: boolean;
  readonly siblings?: readonly string[];
  readonly activeSiblingIndex?: number;
  readonly onNavigateSibling?: (index: number) => void;
}

/**
 * TurnActionRow (CHAT-04, D-16) — always-visible (not hover-only, per
 * 22-UI-SPEC.md Accessibility "no hover-only affordances") icon row under an
 * assistant turn: copy the turn's text content, and regenerate the response
 * as a new sibling version. Renders SiblingNav (`‹ N/M ›`) inline once the
 * turn has more than one version.
 */
export function TurnActionRow({
  parts,
  onRegenerate,
  regenerateDisabled = false,
  siblings,
  activeSiblingIndex = 0,
  onNavigateSibling,
}: TurnActionRowProps): React.ReactElement {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text = textForCopy(parts);
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_RESET_MS);
    });
  }, [parts]);

  return (
    <div className="mt-1 flex items-center gap-2 text-muted-foreground">
      <button
        type="button"
        aria-label="Copy response"
        onClick={handleCopy}
        className="rounded-md p-1 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        {copied ? (
          <Check className="size-3.5" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
      </button>
      {onRegenerate && (
        <button
          type="button"
          aria-label="Regenerate response"
          disabled={regenerateDisabled}
          onClick={onRegenerate}
          className="rounded-md p-1 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-30"
        >
          <RefreshCw className="size-3.5" aria-hidden />
        </button>
      )}
      {siblings && onNavigateSibling && (
        <SiblingNav
          siblings={siblings}
          activeIndex={activeSiblingIndex}
          onNavigate={onNavigateSibling}
        />
      )}
    </div>
  );
}
