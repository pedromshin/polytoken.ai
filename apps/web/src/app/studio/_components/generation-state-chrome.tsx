"use client";

/**
 * generation-state-chrome.tsx — Four-state chrome row for the Generation Sandbox.
 *
 * Derives the current GenerationState from `deriveGenerationState` (15-01, @nauta/genui/studio)
 * and renders the appropriate visual treatment per 15-UI-SPEC §9:
 *
 *   (a) in_progress → Loader2 animate-spin + "Generating…"  (NOT "Streaming" — D-02 honesty)
 *   (b) fallback    → destructive-tinted banner + reason     (role="alert" — overrides aria-live)
 *   (c) cache_hit   → teal "Cache hit · 0 LLM cost" Badge
 *   (d) cold        → muted "Cold generation" / "Cold · escalated to Sonnet" Badge
 *
 * All four kinds are rendered from the pure `deriveGenerationState` helper — no inline ternaries
 * for the state mapping (D-04: deterministic, testable helper owns the mapping).
 *
 * aria-live="polite" on the container; role="alert" override for the fallback kind.
 * No new design tokens — uses only existing shadcn tokens (D-13).
 * No eval / Function / dangerouslySetInnerHTML (D-15 / T-15-10).
 */

import React from "react";
import { Loader2, AlertTriangle } from "lucide-react";

import { Badge } from "@nauta/ui/badge";
import { deriveGenerationState } from "@nauta/genui/studio";

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * GenerationStateChrome — renders a shrink-0 chrome row above the render/JSON split.
 *
 * Call site: GenerationSandboxIsland, rendered after first generation or while pending.
 * NOT rendered in the empty state (no generation started yet).
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

  // (b) fallback state — destructive tint, role="alert" overrides aria-live
  if (state.kind === "fallback") {
    return (
      <div
        role="alert"
        className="flex shrink-0 flex-col gap-1 border-b border-destructive/30 bg-destructive/5 px-4 py-2"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
          <span className="text-sm font-medium text-destructive">
            Validation failed — showing a safe fallback
          </span>
        </div>
        {state.reason !== undefined && (
          <p className="truncate text-xs text-muted-foreground pl-6">
            {state.reason}
          </p>
        )}
      </div>
    );
  }

  // (a) in_progress state — Loader2 animate-spin + "Generating…" (NOT "Streaming" — D-02)
  if (state.kind === "in_progress") {
    return (
      <div
        aria-live="polite"
        className="flex shrink-0 items-center gap-2 border-b border-border/50 px-4 py-2"
      >
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
        <span className="text-sm text-muted-foreground">Generating…</span>
      </div>
    );
  }

  // (c) cache_hit state — teal Badge "Cache hit · 0 LLM cost" (U+00B7 middle dot)
  if (state.kind === "cache_hit") {
    return (
      <div
        aria-live="polite"
        className="flex shrink-0 items-center gap-2 border-b border-border/50 px-4 py-2"
      >
        <Badge className="border border-primary/30 bg-primary/10 text-xs font-medium text-primary">
          Cache hit · 0 LLM cost
        </Badge>
      </div>
    );
  }

  // (d) cold state — muted Badge; "Cold · escalated to Sonnet" when escalated (D-03d)
  return (
    <div
      aria-live="polite"
      className="flex shrink-0 items-center gap-2 border-b border-border/50 px-4 py-2"
    >
      <Badge variant="secondary" className="text-xs">
        {state.escalated ? "Cold · escalated to Sonnet" : "Cold generation"}
      </Badge>
    </div>
  );
}
