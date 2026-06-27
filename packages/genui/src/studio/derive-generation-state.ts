/**
 * studio/derive-generation-state.ts
 *
 * Pure helper that maps the tRPC GenerateOutput signal tuple
 * (isPending, outcome, cacheHit, reason) to a discriminated
 * GenerationState value for studio UI rendering.
 *
 * §9 State Transition Summary (15-UI-SPEC):
 *
 *   isPending=true           → { kind:"in_progress", escalated:false }
 *   outcome:"fallback"       → { kind:"fallback",    escalated:false, reason? }
 *   outcome:"ok"+cacheHit    → { kind:"cache_hit",   escalated:false }
 *   outcome:"ok"+!cacheHit   → { kind:"cold",        escalated:false }
 *   outcome:"escalated"      → { kind:"cold",        escalated:true  }
 *
 * Design constraints:
 *   - D-05 ADDITIVE ONLY — no generation/cache/renderer logic here.
 *   - Pure function: no side effects, no I/O, no React/Next imports.
 *   - CLAUDE.md: immutable — always returns a NEW object.
 *   - Named exports exclusively.
 */

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

/** Signals produced by the tRPC genui.generate procedure. */
export type GenerationSignals = {
  /**
   * True while a generation request is in-flight (e.g. tRPC query isLoading).
   * Highest priority: if true, state is always "in_progress" regardless of
   * other signals.
   */
  readonly isPending: boolean;
  /**
   * Outcome reported by FastAPI, forwarded through the tRPC envelope.
   * May be overridden to "fallback" by SpecRootSchema.safeParse (D-08/D-15).
   * Defaults to "ok" when omitted.
   */
  readonly outcome?: "ok" | "fallback" | "escalated";
  /**
   * True when the spec was served from the server-side generation cache (D-14).
   * Defaults to false when omitted.
   */
  readonly cacheHit?: boolean;
  /**
   * Friendly, non-leaking reason string — present only when outcome="fallback".
   */
  readonly reason?: string;
};

// ---------------------------------------------------------------------------
// Output type (discriminated union on `kind`)
// ---------------------------------------------------------------------------

export type InProgressState = {
  readonly kind: "in_progress";
  readonly escalated: false;
  readonly reason?: undefined;
};

export type FallbackState = {
  readonly kind: "fallback";
  readonly escalated: false;
  readonly reason?: string;
};

export type CacheHitState = {
  readonly kind: "cache_hit";
  readonly escalated: false;
  readonly reason?: undefined;
};

export type ColdState = {
  readonly kind: "cold";
  /** True when outcome="escalated" (D-03d: escalated is a sub-flavor of cold). */
  readonly escalated: boolean;
  readonly reason?: undefined;
};

export type GenerationState =
  | InProgressState
  | FallbackState
  | CacheHitState
  | ColdState;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Maps a generation signal tuple to a discriminated GenerationState value.
 *
 * Returns a NEW object on every call (CLAUDE.md: immutable).
 * Never throws — all inputs are treated as safe defaults.
 */
export const deriveGenerationState = (
  signals: GenerationSignals,
): GenerationState => {
  const { isPending, outcome = "ok", cacheHit = false, reason } = signals;

  // Rule 1 (highest priority): in-flight request → in_progress
  if (isPending) {
    return { kind: "in_progress", escalated: false };
  }

  // Rule 2: fallback outcome
  if (outcome === "fallback") {
    return { kind: "fallback", escalated: false, ...(reason !== undefined ? { reason } : {}) };
  }

  // Rule 3: cache hit (D-14: only ok outcomes are ever cached)
  if (outcome === "ok" && cacheHit) {
    return { kind: "cache_hit", escalated: false };
  }

  // Rule 4: escalated — cold sub-flavor (D-03d)
  if (outcome === "escalated") {
    return { kind: "cold", escalated: true };
  }

  // Rule 5: default — cold, not escalated (ok + !cacheHit)
  return { kind: "cold", escalated: false };
};
