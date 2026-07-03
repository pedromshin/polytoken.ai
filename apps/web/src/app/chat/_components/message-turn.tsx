"use client";

import type { MessagePart } from "../_hooks/use-chat-stream";
import { MarkdownRenderer } from "./markdown-renderer";

export interface MessageTurnProps {
  readonly role: "user" | "assistant" | "system";
  readonly parts: readonly MessagePart[];
  /** True only for the single, currently-streaming turn (drives the
   * blinking tail caret — 22-UI-SPEC.md generating indicator). */
  readonly isStreamingTurn?: boolean;
}

/**
 * MessageTurn (D-18) — renders one turn's canonical interleaved parts
 * (text | genui_spec) in emission order, no per-part bubble; all parts
 * share the turn's outer spacing (22-UI-SPEC.md Interleaved typed parts).
 * User turns render as a bg-muted bubble; assistant turns render plain on
 * the background (Color contract). The genui_spec placeholder here is a
 * bordered Card — the real GenuiPartBoundary (schema-validated progressive
 * rendering, D-17) arrives in 22-09.
 */
export function MessageTurn({
  role,
  parts,
  isStreamingTurn = false,
}: MessageTurnProps): React.ReactElement {
  const isUser = role === "user";
  const lastIndex = parts.length - 1;

  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          isUser
            ? "max-w-[85%] rounded-lg bg-muted px-4 py-2"
            : "w-full max-w-full"
        }
      >
        <div className="space-y-2">
          {parts.map((part, index) => {
            const isLastPart = index === lastIndex;

            if (part.type === "genui_spec") {
              return (
                <div
                  key={index}
                  className="my-2 rounded-lg border border-border bg-card p-4"
                >
                  <p className="text-xs text-muted-foreground">
                    Interactive widget — renders here in a later plan (22-09)
                  </p>
                </div>
              );
            }

            return (
              <div key={index}>
                <MarkdownRenderer content={part.text} />
                {isStreamingTurn && isLastPart && (
                  <span
                    aria-hidden
                    className="ml-0.5 inline-block align-middle text-foreground motion-safe:animate-pulse"
                  >
                    ▍
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
