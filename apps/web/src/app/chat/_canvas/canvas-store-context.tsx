"use client";

/**
 * canvas-store-context.tsx — the STATE-01/STATE-02 seam: ONE `createCanvasStore`
 * instance per conversationId (a fresh store the moment the conversation
 * changes), hydrated from the persisted `chat_canvas_layouts.sharedState`
 * snapshot on mount (D-10). `usePanelData(panelId, incomingEdges?)` is the
 * per-panel read/write hook `GenuiPanelNode` uses to feed a store slice
 * (overlaid with any live data-carrying edges targeting it) into the
 * UNMODIFIED `SpecRenderer`'s `data` prop (via `GenuiPartBoundary`) — the
 * renderer itself never changes (D-09).
 *
 * `useCanvasStoreInstance` is called by `chat-canvas.tsx` itself (NOT inside
 * `CanvasStoreProvider`) so the SAME store instance is available both to
 * `CanvasStoreProvider` (context for panels) AND to `useCanvasPersistence`'s
 * debounced save (reads `store.getState().values` at fire time to persist
 * `sharedState`, D-10) — a single source of truth, never two stores.
 */

// Explicit React import (not just named hook imports) — this file's JSX
// (CanvasStoreContext.Provider / CanvasEdgesContext.Provider) compiles fine under Next.js's
// SWC automatic JSX runtime, but vitest's plain esbuild transform defaults to the classic
// runtime (React.createElement) and needs `React` in scope whenever a test mounts these
// providers directly (23-06 Task 3 — found live: "React is not defined" mounting
// CanvasStoreProvider in panel-data-flow.test.tsx).
import * as React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

import {
  createCanvasStore,
  resolveCanvasPath,
  type CanvasStore,
  type CanvasStoreSeed,
} from "./canvas-store";

// ---------------------------------------------------------------------------
// toCanvasStoreSeed — narrows an arbitrary persisted JSON record (the
// `chat_canvas_layouts.sharedState` column) into a `CanvasStoreSeed`. A
// `panels`/`shared` key that isn't itself a plain object is dropped rather
// than trusted (never throws; mirrors `validateSavedRow`'s degrade-instead-
// of-trust posture in use-canvas-persistence.ts, T-23-09).
// ---------------------------------------------------------------------------

export function toCanvasStoreSeed(raw: Record<string, unknown> | undefined): CanvasStoreSeed {
  if (raw === undefined) return {};
  const { panels, shared } = raw;
  return {
    panels: panels !== null && typeof panels === "object" ? (panels as Record<string, unknown>) : undefined,
    shared: shared !== null && typeof shared === "object" ? (shared as Record<string, unknown>) : undefined,
  };
}

// ---------------------------------------------------------------------------
// useCanvasStoreInstance — lazily creates ONE store per conversationId, but
// ONLY once `ready` (restore has resolved, so `seed` reflects the REAL
// persisted sharedState rather than an empty placeholder) — creating it
// eagerly on the first (pre-restore) render would permanently bake in an
// empty seed, since the ref-based "create once" pattern never re-seeds an
// already-built store.
// ---------------------------------------------------------------------------

interface CanvasStoreRef {
  readonly conversationId: string;
  readonly store: CanvasStore;
}

export function useCanvasStoreInstance(
  conversationId: string,
  seed: CanvasStoreSeed,
  ready: boolean,
): CanvasStore | null {
  const ref = useRef<CanvasStoreRef | null>(null);

  if (ready && (ref.current === null || ref.current.conversationId !== conversationId)) {
    ref.current = { conversationId, store: createCanvasStore(seed) };
  }
  if (!ready) return null;

  return ref.current?.store ?? null;
}

// ---------------------------------------------------------------------------
// CanvasStoreProvider — thin context passthrough for an externally-created
// store (see useCanvasStoreInstance above).
// ---------------------------------------------------------------------------

interface CanvasStoreContextValue {
  readonly store: CanvasStore;
}

const CanvasStoreContext = createContext<CanvasStoreContextValue | null>(null);

export interface CanvasStoreProviderProps {
  readonly children: ReactNode;
  readonly store: CanvasStore;
}

export function CanvasStoreProvider({
  children,
  store,
}: CanvasStoreProviderProps): ReactElement {
  const value = useMemo<CanvasStoreContextValue>(() => ({ store }), [store]);

  return (
    <CanvasStoreContext.Provider value={value}>{children}</CanvasStoreContext.Provider>
  );
}

function useCanvasStoreContext(): CanvasStoreContextValue {
  const ctx = useContext(CanvasStoreContext);
  if (ctx === null) {
    throw new Error(
      "usePanelData must be used inside a CanvasStoreProvider (canvas host wiring — see chat-canvas.tsx)",
    );
  }
  return ctx;
}

/** Exposes the raw store for callers that need direct access outside a
 * single panel's slice (e.g. the `EdgeCreationPicker`'s field discovery). */
export function useCanvasStore(): CanvasStore {
  return useCanvasStoreContext().store;
}

/**
 * Non-throwing accessor for the store — `null` when no provider wraps the
 * tree (61-07). The split mirrors `useOptionalChatController` (chat-node.tsx)
 * and `useIncomingEdgesForPanel` above, and the reason is the same one both of
 * them state: a MISSING provider is a host-wiring bug for a component that can
 * only legitimately exist inside the canvas host (so `useCanvasStore` throws),
 * but a degraded/standalone mount of a SHARED component is a real case (so this
 * returns null).
 *
 * Its caller is `useOptionalPanelOverlay` (panel-overlay-context.tsx), read by
 * `MessageTurn` — which renders in three different trees: the docked transcript
 * (inside `TranscriptPanelHost`), a ChatNode ON the canvas (inside this host's
 * own providers), and bare in unit tests (no providers at all). Read-only by
 * construction: this returns the store, and the WRITE path (`usePanelOverlay`)
 * still goes through `useCanvasStore` and still throws, because a write with no
 * persistence wired IS a wiring bug.
 */
export function useOptionalCanvasStore(): CanvasStore | null {
  return useContext(CanvasStoreContext)?.store ?? null;
}

// ---------------------------------------------------------------------------
// CanvasEdgesContext — the STATE-02 seam: maps a target panelId to its
// currently-wired incoming data-carrying edges. React Flow's `NodeProps`
// only ever carries `{id, data, selected, ...}` for a custom node — there is
// no channel to pass a computed "edges targeting me" list as a prop, so the
// canvas host (chat-canvas.tsx) threads it through context instead (mirrors
// `CanvasSpecContext`'s own seam shape).
// ---------------------------------------------------------------------------

export interface IncomingDataEdge {
  readonly sourcePath: string;
  readonly targetKey: string;
}

interface CanvasEdgesContextValue {
  readonly edgesByTarget: ReadonlyMap<string, readonly IncomingDataEdge[]>;
}

const CanvasEdgesContext = createContext<CanvasEdgesContextValue | null>(null);

export interface DataCarryingEdge extends IncomingDataEdge {
  readonly target: string;
}

export interface CanvasEdgesProviderProps {
  readonly children: ReactNode;
  readonly edges: ReadonlyArray<DataCarryingEdge>;
}

/** Wraps the canvas tree with a live `target panelId -> incoming edges[]`
 * lookup, recomputed whenever the canvas's `edges` array changes (add/
 * remove/re-pick) — never touches `panels.*`/`shared.*` itself; resolution
 * of the actual VALUES happens per-subscriber in `usePanelData` below. */
export function CanvasEdgesProvider({
  children,
  edges,
}: CanvasEdgesProviderProps): ReactElement {
  const edgesByTarget = useMemo(() => {
    const map = new Map<string, IncomingDataEdge[]>();
    for (const edge of edges) {
      const existing = map.get(edge.target) ?? [];
      existing.push({ sourcePath: edge.sourcePath, targetKey: edge.targetKey });
      map.set(edge.target, existing);
    }
    return map as ReadonlyMap<string, readonly IncomingDataEdge[]>;
  }, [edges]);

  const value = useMemo<CanvasEdgesContextValue>(() => ({ edgesByTarget }), [edgesByTarget]);

  return (
    <CanvasEdgesContext.Provider value={value}>{children}</CanvasEdgesContext.Provider>
  );
}

const EMPTY_INCOMING_EDGES: readonly IncomingDataEdge[] = [];

/**
 * Stable empty-object fallback for a panel's own slice when it has never written anything to
 * `panels.{panelId}.*` yet. Using `?? {}` inline would allocate a NEW object literal on every
 * selector invocation — `useSyncExternalStore` (which `useStore` is built on) requires a
 * snapshot getter to return a REFERENCE-STABLE value when nothing has changed, or it re-renders
 * in an infinite loop (found live, 23-06 Task 3: mounting a never-written panel threw "Maximum
 * update depth exceeded" / "getSnapshot should be cached").
 */
const EMPTY_PANEL_DATA: Record<string, unknown> = {};

/** Returns the CURRENT list of data-carrying edges targeting `panelId` — a
 * missing provider (e.g. a standalone test render) degrades to an empty
 * list rather than throwing (mirrors `useCanvasSpec`'s degrade posture). */
export function useIncomingEdgesForPanel(panelId: string): readonly IncomingDataEdge[] {
  const ctx = useContext(CanvasEdgesContext);
  if (ctx === null) return EMPTY_INCOMING_EDGES;
  return ctx.edgesByTarget.get(panelId) ?? EMPTY_INCOMING_EDGES;
}

// ---------------------------------------------------------------------------
// usePanelData — per-panel read/write into the canvas store
// ---------------------------------------------------------------------------

export interface UsePanelDataResult {
  readonly data: Record<string, unknown>;
  readonly dispatch: (mutation: string, key: string, value?: unknown) => void;
}

/**
 * usePanelData(panelId, incomingEdges?) — `data` is the panel's own
 * `panels.{panelId}.*` slice, overlaid with any `incomingEdges`' resolved
 * source values at their `targetKey` (STATE-02's live data-edge
 * subscription — re-resolves whenever the store changes, since the selector
 * reads the CURRENT `state.values` on every store update — D-09).
 * `dispatch(mutation, key, value)` mutates `panels.{panelId}.{key}` through
 * the store's own bounded mutation enum.
 */
export function usePanelData(
  panelId: string,
  incomingEdges: readonly IncomingDataEdge[] = EMPTY_INCOMING_EDGES,
): UsePanelDataResult {
  const { store } = useCanvasStoreContext();

  // `useShallow` (zustand v5's replacement for the deprecated 3-arg useStore equality-fn form)
  // is REQUIRED here, not cosmetic: the overlay branch below always allocates a brand-new
  // `{ ...own, ...overlay }` object, so without a shallow-equality wrapper
  // useSyncExternalStore would see a "changed" snapshot on every single render (even when
  // nothing actually changed) and loop forever ("Maximum update depth exceeded" — found live,
  // 23-06 Task 3, mounting a target panel with a live incoming edge). useShallow caches the
  // previous shallow-equal result and returns THAT reference instead, so a genuine source-value
  // change (STATE-02's live edge resolution) still re-renders, but a no-op re-computation does not.
  const data = useStore(
    store,
    useShallow((state) => {
      const panels = state.values.panels as Record<string, unknown> | undefined;
      const own = (panels?.[panelId] as Record<string, unknown> | undefined) ?? EMPTY_PANEL_DATA;
      if (incomingEdges.length === 0) return own;

      const overlay: Record<string, unknown> = {};
      for (const edge of incomingEdges) {
        overlay[edge.targetKey] = resolveCanvasPath(state.values, edge.sourcePath);
      }
      return { ...own, ...overlay };
    }),
  );

  const mutate = useStore(store, (state) => state.mutate);

  const dispatch = useCallback(
    (mutation: string, key: string, value?: unknown) => {
      mutate(mutation, `panels.${panelId}.${key}`, value);
    },
    [mutate, panelId],
  );

  return { data, dispatch };
}
