/**
 * canvas-store.ts — the per-conversation canvas store (STATE-01, FOUND-4).
 *
 * A SUPERSET of the v1.1 declared-state model
 * (packages/genui/src/renderer/use-declared-state.ts): the SAME bounded
 * 5-mutation enum (toggle/set/reset/increment/decrement — no arbitrary
 * reducers, ever) and the SAME "bail to undefined, never throw" dotted-path
 * grammar `render-node.tsx`'s `resolveDataRef` uses (FORBIDDEN_KEYS guard on
 * __proto__/constructor/prototype). One state system, never two.
 *
 * Values live in ONE flat bag addressed by dotted paths under two
 * namespaces: `panels.{panelId}.{key}` (a single panel's own declared
 * state) and `shared.{key}` (cross-panel shared state) — see D-08.
 *
 * `createCanvasStore` builds a vanilla Zustand store (`zustand/vanilla`) —
 * ONE instance per conversation, instantiated by `canvas-store-context.tsx`.
 * All state transitions are immutable (spread-only, CLAUDE.md) — `mutate`
 * never mutates the previous `values` object in place.
 */

import { createStore, type StoreApi } from "zustand/vanilla";

// ---------------------------------------------------------------------------
// CANVAS_STORE_MUTATIONS — the single source of truth for the bounded
// mutation enum (mirrors useDeclaredState's switch exactly).
// ---------------------------------------------------------------------------

export const CANVAS_STORE_MUTATIONS = [
  "toggle",
  "set",
  "reset",
  "increment",
  "decrement",
] as const;

export type CanvasStoreMutation = (typeof CANVAS_STORE_MUTATIONS)[number];

function isCanvasStoreMutation(value: string): value is CanvasStoreMutation {
  return (CANVAS_STORE_MUTATIONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// FORBIDDEN_KEYS — mirrors packages/genui/src/renderer/render-node.tsx's
// prototype-pollution guard verbatim (FOUND-6/D-12), applied to every
// dotted-path segment this store ever reads or writes.
// ---------------------------------------------------------------------------

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function hasForbiddenSegment(path: string): boolean {
  return path.split(".").some((segment) => FORBIDDEN_KEYS.has(segment));
}

// ---------------------------------------------------------------------------
// resolveCanvasPath — pure dotted-path read over an arbitrary `values` bag.
// Same "bail to undefined, never throw" contract as render-node.tsx's
// resolveDataRef, minus that function's hardcoded "data."/"state." root
// selection — canvas paths are already self-describing
// (`panels.{id}.{key}` / `shared.{key}`), so the FULL path is walked
// directly against `values`. Exported so Task 3's data-carrying edges can
// resolve a sourcePath through the exact same grammar a panel uses to read
// its own state.
// ---------------------------------------------------------------------------

export function resolveCanvasPath(
  values: Record<string, unknown>,
  path: string,
): unknown {
  if (!path || hasForbiddenSegment(path)) return undefined;

  let current: unknown = values;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

// ---------------------------------------------------------------------------
// setCanvasPath — pure, immutable dotted-path write. Spreads every ancestor
// object along the path (siblings are never touched, no in-place mutation
// anywhere — CLAUDE.md). Returns `root` unchanged for an empty/forbidden
// path.
// ---------------------------------------------------------------------------

function setCanvasPath(
  root: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const segments = path.split(".");
  if (segments.length === 0 || hasForbiddenSegment(path)) return root;

  function assign(node: unknown, index: number): unknown {
    const key = segments[index];
    if (key === undefined) return node;
    const base: Record<string, unknown> =
      node !== null && typeof node === "object" ? (node as Record<string, unknown>) : {};
    if (index === segments.length - 1) {
      return { ...base, [key]: value };
    }
    return { ...base, [key]: assign(base[key], index + 1) };
  }

  return assign(root, 0) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// CanvasStoreState — the vanilla Zustand store shape
// ---------------------------------------------------------------------------

export interface CanvasStoreState {
  /** Addressed by dotted paths: `panels.{panelId}.{key}` / `shared.{key}`. */
  readonly values: Record<string, unknown>;
  /**
   * Applies ONLY toggle/set/reset/increment/decrement
   * (`CANVAS_STORE_MUTATIONS`) — an unrecognized mutation name is a no-op,
   * never an arbitrary reducer (FOUND-4). A path crossing a FORBIDDEN_KEYS
   * segment is also a no-op.
   */
  readonly mutate: (mutation: string, path: string, value?: unknown) => void;
  /** Reads a dotted path via `resolveCanvasPath` (FORBIDDEN_KEYS-guarded). */
  readonly read: (path: string) => unknown;
}

export type CanvasStore = StoreApi<CanvasStoreState>;

export interface CanvasStoreSeed {
  readonly panels?: Record<string, unknown>;
  readonly shared?: Record<string, unknown>;
}

/**
 * createCanvasStore — ONE vanilla Zustand store instance per conversation
 * (`canvas-store-context.tsx` keys instantiation by conversationId). `seed`
 * hydrates BOTH the `panels.*` and `shared.*` namespaces from a persisted
 * `chat_canvas_layouts.sharedState` snapshot (D-10); it also doubles as the
 * "declared initial" that `reset` restores a path back to — mirroring
 * `useDeclaredState`'s `StateDeclaration.initial` semantics extended to an
 * unbounded, dynamically-addressed store (FOUND-4).
 */
export function createCanvasStore(seed: CanvasStoreSeed = {}): CanvasStore {
  const initialValues: Record<string, unknown> = {
    panels: { ...(seed.panels ?? {}) },
    shared: { ...(seed.shared ?? {}) },
  };

  return createStore<CanvasStoreState>((set, get) => ({
    values: initialValues,
    mutate: (mutation, path, value) => {
      if (!isCanvasStoreMutation(mutation)) return; // no-op — never an arbitrary reducer
      if (hasForbiddenSegment(path)) return;

      const { values } = get();
      const current = resolveCanvasPath(values, path);
      let next: unknown;

      switch (mutation) {
        case "toggle":
          next = !current;
          break;
        case "set":
          next = value;
          break;
        case "reset":
          next = resolveCanvasPath(initialValues, path);
          break;
        case "increment":
          next = (typeof current === "number" ? current : 0) + 1;
          break;
        case "decrement":
          next = (typeof current === "number" ? current : 0) - 1;
          break;
      }

      set({ values: setCanvasPath(values, path, next) });
    },
    read: (path) => resolveCanvasPath(get().values, path),
  }));
}
