"use client";

/**
 * generation-state-chrome.tsx — four-state chrome row for the Generation
 * Sandbox, on the LOCKED identity (Phase 62 / SURF-05/06).
 *
 * States (derived by the pure `deriveGenerationState`, D-04):
 *   (a) in_progress → Loader2 animate-spin + "Generating…" (D-02 honesty)
 *   (b) fallback    → an ERROR IS A STATE, and law 1 is explicit: madder
 *                     means "irreversible", never errors. The row is ink on
 *                     a hairline rule; the glyph carries the role.
 *                     (role="alert" — overrides aria-live)
 *   (c) cache_hit   → quiet chrome chip — a cache hit is plumbing news, not
 *                     a tier claim, so it earns no hue
 *   (d) cold        → quiet chrome chip
 *
 * aria-live="polite" on the container; role="alert" for the fallback kind.
 */

import React from "react";
import { Loader2, AlertTriangle } from "lucide-react";

import { deriveGenerationState } from "@polytoken/genui/studio";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GenerationStateChromeProps {
  /** True while the tRPC query is in-flight (q.isFetching). */
  readonly isPending: boolean;
  /** Outcome from genui.generate — undefined when no generation has completed. */
  readonly outcome?: "ok" | "fallback" | "escalated";
  /** True when the spec was served from the server-side cache. */
  readonly cacheHit?: boolean;
  /** Friendly, non-leaking reason — present only when outcome="fallback". */
  readonly reason?: string;
}

/** The quiet chrome chip — one recipe for every status word this row says. */
function StatusChip({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <span className="tabular inline-flex items-center rounded-sm border border-rule bg-bright px-1.5 py-0.5 text-2xs font-semibold text-faded">
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * GenerationStateChrome — renders a shrink-0 chrome row above the
 * render/JSON split. NOT rendered in the empty state.
 */
export function GenerationStateChrome({
  isPending,
  outcome,
  cacheHit,
  reason,
}: GenerationStateChromeProps): React.ReactElement {
  const state = deriveGenerationState({
    isPending,
    outcome,
    cacheHit,
    reason,
  });

  // (b) fallback — ink on a rule; the glyph carries the role (law 1).
  if (state.kind === "fallback") {
    return (
      <div
        role="alert"
        className="flex shrink-0 flex-col gap-1 border-b border-rule bg-leaf px-4 py-2"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0 text-ink" aria-hidden />
          <span className="text-sm font-semibold text-ink">
            Validation failed — showing a safe fallback
          </span>
        </div>
        {state.reason !== undefined && (
          <p className="truncate pl-6 text-xs text-faded">{state.reason}</p>
        )}
      </div>
    );
  }

  // (a) in_progress — Loader2 animate-spin + "Generating…" (NOT "Streaming")
  if (state.kind === "in_progress") {
    return (
      <div
        aria-live="polite"
        className="flex shrink-0 items-center gap-2 border-b border-hair bg-leaf px-4 py-2"
      >
        <Loader2
          className="size-4 animate-spin text-faded motion-reduce:animate-none"
          aria-hidden
        />
        <span className="text-sm text-faded">Generating…</span>
      </div>
    );
  }

  // (c) cache_hit — plumbing news in chrome's own quiet voice.
  if (state.kind === "cache_hit") {
    return (
      <div
        aria-live="polite"
        className="flex shrink-0 items-center gap-2 border-b border-hair bg-leaf px-4 py-2"
      >
        <StatusChip>Cache hit · 0 LLM cost</StatusChip>
      </div>
    );
  }

  // (d) cold — "Cold · escalated to Sonnet" when escalated (D-03d)
  return (
    <div
      aria-live="polite"
      className="flex shrink-0 items-center gap-2 border-b border-hair bg-leaf px-4 py-2"
    >
      <StatusChip>
        {state.escalated ? "Cold · escalated to Sonnet" : "Cold generation"}
      </StatusChip>
    </div>
  );
}
