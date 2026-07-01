/**
 * repair-loop.ts — the pure state machine driving the v0-style repair pipeline:
 *   validate → autofix → run → (on error) heal ≤N → safe-placeholder fallback.
 *
 * This module is framework-free and side-effect-free so the whole control flow is unit-testable
 * without a browser. The host component performs the two effectful steps — rendering `state.code`
 * in the sandboxed frame, and awaiting an injected `heal(code, error)` — and feeds the outcomes
 * back through these transitions.
 *
 * Security invariant: any code with allowlist violations is REJECTED (never run, never healed),
 * including code returned by the heal step, which is re-validated before it can run.
 * Heal budget defaults to 2 (research: self-debugging decays after 1-2 iterations).
 */

import { autofixIslandCode } from "./autofix-island-code";
import { validateIslandCode, type IslandViolation } from "./validate-island-code";

export type IslandPhase =
  | "running" // code is ready to render / rendering in the frame
  | "healing" // a runtime error occurred; host should call heal() then onHealed()
  | "rendered" // ran successfully on the first attempt
  | "healed" // ran successfully after ≥1 heal
  | "rejected" // blocked by the allowlist (security) — never ran
  | "fallback"; // exhausted heal budget / heal returned nothing — safe placeholder

export interface IslandState {
  readonly phase: IslandPhase;
  /** Code to render in the frame. Empty string when rejected/fallback. */
  readonly code: string;
  /** Heal attempts consumed so far. */
  readonly attempts: number;
  readonly maxAttempts: number;
  /** Allowlist violations (populated only when phase === "rejected"). */
  readonly violations: readonly IslandViolation[];
  readonly syntaxErrors: readonly string[];
  /** Last runtime error message (populated on healing/fallback). */
  readonly lastError: string | null;
  /** Autofix transform ids applied to the current code. */
  readonly autofixApplied: readonly string[];
}

const DEFAULT_MAX_ATTEMPTS = 2;

export interface StartIslandOptions {
  readonly maxAttempts?: number;
}

/** True once no further transition is possible. */
export function isTerminal(phase: IslandPhase): boolean {
  return phase === "rendered" || phase === "healed" || phase === "rejected" || phase === "fallback";
}

function prepare(
  code: string,
  attempts: number,
  maxAttempts: number,
): IslandState {
  const validation = validateIslandCode(code);
  if (!validation.ok) {
    return {
      phase: "rejected",
      code: "",
      attempts,
      maxAttempts,
      violations: validation.violations,
      syntaxErrors: validation.syntaxErrors,
      lastError: null,
      autofixApplied: [],
    };
  }
  const fixed = autofixIslandCode(code);
  return {
    phase: "running",
    code: fixed.code,
    attempts,
    maxAttempts,
    violations: [],
    syntaxErrors: validation.syntaxErrors,
    lastError: null,
    autofixApplied: fixed.applied,
  };
}

/** Begin the pipeline: validate + autofix the initial code. */
export function startIsland(code: string, options: StartIslandOptions = {}): IslandState {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  return prepare(code, 0, maxAttempts);
}

/** The frame reported the code ran without error. */
export function onRunSuccess(state: IslandState): IslandState {
  if (state.phase !== "running") return state;
  return { ...state, phase: state.attempts > 0 ? "healed" : "rendered" };
}

/** The frame reported a runtime error. Route to heal, or fall back if the budget is spent. */
export function onRuntimeError(state: IslandState, errorMessage: string): IslandState {
  if (state.phase !== "running") return state;
  if (state.attempts >= state.maxAttempts) {
    return { ...state, phase: "fallback", lastError: errorMessage };
  }
  return { ...state, phase: "healing", lastError: errorMessage };
}

/**
 * The host's `heal(code, error)` resolved. `healedCode == null` means the healer gave up.
 * Healed code is re-validated (security) before it may run; a violating heal is rejected.
 */
export function onHealed(state: IslandState, healedCode: string | null): IslandState {
  if (state.phase !== "healing") return state;
  if (healedCode == null || healedCode.trim().length === 0) {
    return { ...state, phase: "fallback" };
  }
  const next = prepare(healedCode, state.attempts + 1, state.maxAttempts);
  // Carry the prior error forward for context if the healed code was rejected.
  return next.phase === "rejected" ? { ...next, lastError: state.lastError } : next;
}
