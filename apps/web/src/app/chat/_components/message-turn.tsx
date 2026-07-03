"use client";

import type { MessagePart } from "../_hooks/use-chat-stream";
import { CostCapBlockedCard } from "./cost-cap-blocked-card";
import { InlineErrorCard } from "./inline-error-card";
import { MarkdownRenderer } from "./markdown-renderer";
import { TurnActionRow } from "./turn-action-row";
import { TurnStatusBadge } from "./turn-status-badge";

/** Terminal turn status (mirrors chat_messages.status, D-15/D-19/D-21/D-25)
 * plus a client-only sentinel: 'cost_capped_pre_turn' marks the LIVE
 * streaming pseudo-turn when the pre-turn fail-closed gate blocked the turn
 * before any content ever streamed (zero parts) — this status never comes
 * from a persisted row (a pre-turn block never inserts a chat_messages row
 * at all), so it only ever appears on the transient in-flight turn. */
export type TurnStatus =
  | "streaming"
  | "completed"
  | "stopped"
  | "failed"
  | "cost_capped"
  | "cost_capped_pre_turn"
  | "interrupted";

export interface MessageTurnProps {
  readonly role: "user" | "assistant" | "system";
  readonly parts: readonly MessagePart[];
  /** True only for the single, currently-streaming turn (drives the
   * blinking tail caret — 22-UI-SPEC.md generating indicator). */
  readonly isStreamingTurn?: boolean;
  /** Terminal status for a settled assistant turn — undefined for a user
   * turn or a still-streaming/completed-with-no-marker assistant turn. */
  readonly status?: TurnStatus;
  /** Sibling message ids for this turn's regenerate group, version order
   * (D-16) — omitted/length<=1 hides SiblingNav. */
  readonly siblings?: readonly string[];
  readonly activeSiblingIndex?: number;
  /** Regenerate AND inline-error Retry both resolve to the same operation —
   * re-running the turn as a new sibling version (CHAT-04/CHAT-05). */
  readonly onRegenerate?: () => void;
  readonly regenerateDisabled?: boolean;
  readonly onNavigateSibling?: (index: number) => void;
}

/**
 * MessageTurn (D-18) — renders one turn's canonical interleaved parts
 * (text | genui_spec) in emission order, no per-part bubble; all parts
 * share the turn's outer spacing (22-UI-SPEC.md Interleaved typed parts).
 * User turns render as a bg-muted bubble; assistant turns render plain on
 * the background (Color contract). The genui_spec placeholder here is a
 * bordered Card — the real GenuiPartBoundary (schema-validated progressive
 * rendering, D-17) arrives in 22-09.
 *
 * Assistant turns get a TurnActionRow (copy/regenerate/SiblingNav, CHAT-04)
 * — always-visible per the UI-SPEC's no-hover-only-affordances rule.
 */
export function MessageTurn({
  role,
  parts,
  isStreamingTurn = false,
  status,
  siblings,
  activeSiblingIndex,
  onRegenerate,
  regenerateDisabled = false,
  onNavigateSibling,
}: MessageTurnProps): React.ReactElement {
  const isUser = role === "user";
  const isAssistant = role === "assistant";
  const lastIndex = parts.length - 1;

  // D-19/CHAT-05: a failed turn's content is fully REPLACED by the inline
  // retryable error card — same position, same turn, draft untouched.
  const isFailed = isAssistant && status === "failed";
  // D-21: the pre-turn fail-closed block never streamed any content — its
  // own dedicated no-retry card replaces the (empty) turn content entirely.
  const isCostCapBlocked = isAssistant && status === "cost_capped_pre_turn";
  // The action row only makes sense once a turn has settled with real
  // content — never mid-stream, and never for the two dedicated cards above
  // (nothing to copy/regenerate/navigate there — Retry already covers it).
  const showActionRow =
    isAssistant &&
    status !== undefined &&
    status !== "streaming" &&
    !isFailed &&
    !isCostCapBlocked;
  // D-15/D-21: mutually exclusive neutral marker — one slot, never both.
  const showStatusBadge =
    isAssistant && (status === "stopped" || status === "interrupted" || status === "cost_capped");

  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          isUser
            ? "max-w-[85%] rounded-lg bg-muted px-4 py-2"
            : "w-full max-w-full"
        }
      >
        {isCostCapBlocked ? (
          <CostCapBlockedCard />
        ) : isFailed ? (
          <InlineErrorCard onRetry={onRegenerate ?? (() => {})} />
        ) : (
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

              if (part.type === "genui_spec_streaming") {
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
        )}
        {showStatusBadge && status && (
          <div className="mt-1">
            <TurnStatusBadge status={status} />
          </div>
        )}
        {showActionRow && (
          <TurnActionRow
            parts={parts}
            onRegenerate={onRegenerate}
            regenerateDisabled={regenerateDisabled}
            siblings={siblings}
            activeSiblingIndex={activeSiblingIndex ?? 0}
            onNavigateSibling={onNavigateSibling}
          />
        )}
      </div>
    </div>
  );
}
