/**
 * renderer/use-declared-state.ts — Declared state hook for the trusted interpreter.
 *
 * useDeclaredState materializes a SpecRoot's `state` array into a live React
 * state object via useReducer. Mutations are constrained to 5 known operations:
 * toggle / set / reset / increment / decrement (D-11, SPEC-04, SPEC-05).
 *
 * Security: no eval, no Function, no dangerouslySetInnerHTML (GR-01).
 * Immutability: all reducer branches return new objects via spread (CLAUDE.md).
 */

import * as React from "react";
import type { StateDeclaration } from "../schema/spec-schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeclaredStateResult {
  readonly state: Record<string, unknown>;
  readonly dispatch: (actionName: string, value?: unknown) => void;
}

interface ReducerAction {
  readonly name: string;
  readonly value?: unknown;
}

// ---------------------------------------------------------------------------
// Reducer — pure function; all branches return new state object
// ---------------------------------------------------------------------------

function stateReducer(
  declarations: readonly StateDeclaration[],
): (s: Record<string, unknown>, action: ReducerAction) => Record<string, unknown> {
  return (
    s: Record<string, unknown>,
    action: ReducerAction,
  ): Record<string, unknown> => {
    for (const decl of declarations) {
      const actionDef = decl.actions?.find((a) => a.name === action.name);
      if (actionDef === undefined) continue;

      const current = s[decl.name];
      let next: unknown;

      switch (actionDef.mutation) {
        case "toggle":
          next = !current;
          break;
        case "set":
          next = action.value ?? actionDef.value;
          break;
        case "reset":
          next = decl.initial;
          break;
        case "increment":
          next = (typeof current === "number" ? current : 0) + 1;
          break;
        case "decrement":
          next = (typeof current === "number" ? current : 0) - 1;
          break;
      }

      // Immutable update — spread creates new object (CLAUDE.md)
      return { ...s, [decl.name]: next };
    }

    // Unknown action — return same reference (no-op, no allocations)
    return s;
  };
}

// ---------------------------------------------------------------------------
// useDeclaredState hook
// ---------------------------------------------------------------------------

/**
 * Materializes the spec's `state` array into a React-managed state object
 * with a stable dispatch function.
 *
 * @param declarations - The `state` array from SpecRoot (may be empty/undefined)
 * @returns `{ state, dispatch }` — immutable state snapshot + typed dispatch
 *
 * Mutation semantics (D-11):
 * - `toggle`    — boolean NOT on current value
 * - `set`       — set to `dispatch(name, value)` arg or actionDef.value
 * - `reset`     — restore StateDeclaration.initial
 * - `increment` — current + 1 (coerces non-number to 0 first)
 * - `decrement` — current - 1 (coerces non-number to 0 first)
 *
 * Unknown action names are silently ignored (same state reference returned).
 */
export function useDeclaredState(
  declarations: readonly StateDeclaration[] = [],
): DeclaredStateResult {
  // Compute initial state from declarations (once at mount)
  const initial = React.useMemo(
    () => Object.fromEntries(declarations.map((d) => [d.name, d.initial])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Declarations are expected to be stable spec data; we intentionally
    // ignore deep-equality of `declarations` to avoid re-materializing state
    // on every parent render. If spec changes identity, parent should remount.
    [],
  );

  // Stable reducer function — close over `declarations` reference at mount
  const reducer = React.useMemo(
    () => stateReducer(declarations),
    // Same stability intent as `initial` above
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [state, dispatchRaw] = React.useReducer(reducer, initial);

  const dispatch = React.useCallback(
    (name: string, value?: unknown) => dispatchRaw({ name, value }),
    [dispatchRaw],
  );

  return { state, dispatch };
}
