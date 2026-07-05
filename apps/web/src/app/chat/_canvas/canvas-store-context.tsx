"use client";

/**
 * canvas-store-context.tsx — the STATE-01 seam: ONE `createCanvasStore`
 * instance per conversationId (a fresh store the moment the conversation
 * changes), hydrated from the persisted `chat_canvas_layouts.sharedState`
 * snapshot on mount (D-10). `usePanelData(panelId)` is the per-panel
 * read/write hook `GenuiPanelNode` uses to feed a store slice into the
 * UNMODIFIED `SpecRenderer`'s `data` prop (via `GenuiPartBoundary`) — the
 * renderer itself never changes (D-09).
 */

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

import {
  createCanvasStore,
  resolveCanvasPath,
  type CanvasStore,
  type CanvasStoreSeed,
} from "./canvas-store";

interface CanvasStoreContextValue {
  readonly conversationId: string;
  readonly store: CanvasStore;
}

const CanvasStoreContext = createContext<CanvasStoreContextValue | null>(null);

export interface CanvasStoreProviderProps {
  readonly children: ReactNode;
  readonly conversationId: string;
  /** The persisted `chat_canvas_layouts.sharedState` snapshot (or
   * `undefined` on a conversation's first-ever canvas visit) — hydrates
   * BOTH `panels.*` and `shared.*` on mount (D-10). Typed as a generic JSON
   * record (matching the DB column's Zod schema, `CanvasSnapshot["sharedState"]`)
   * rather than `CanvasStoreSeed` directly, since a legacy/malformed row
   * could carry a shape this session doesn't expect — `toCanvasStoreSeed`
   * degrades defensively instead of trusting it as-is. */
  readonly initialSharedState?: Record<string, unknown>;
}

/** Narrows an arbitrary persisted JSON record into a `CanvasStoreSeed` — a
 * `panels`/`shared` key that isn't itself a plain object is dropped rather
 * than trusted (never throws; mirrors `validateSavedRow`'s degrade-instead-
 * of-trust posture in use-canvas-persistence.ts, T-23-09). */
function toCanvasStoreSeed(raw: Record<string, unknown> | undefined): CanvasStoreSeed {
  if (raw === undefined) return {};
  const { panels, shared } = raw;
  return {
    panels: panels !== null && typeof panels === "object" ? (panels as Record<string, unknown>) : undefined,
    shared: shared !== null && typeof shared === "object" ? (shared as Record<string, unknown>) : undefined,
  };
}

/**
 * CanvasStoreProvider — mounts ONE store per `conversationId`; switching to
 * a different conversation creates a fresh store (conversations never leak
 * state into each other). Held in a ref so identity is stable across
 * re-renders of the SAME conversation — a new store on every render would
 * defeat every subscriber's own memoization.
 */
export function CanvasStoreProvider({
  children,
  conversationId,
  initialSharedState,
}: CanvasStoreProviderProps): ReactElement {
  const ref = useRef<CanvasStoreContextValue | null>(null);

  if (ref.current === null || ref.current.conversationId !== conversationId) {
    ref.current = {
      conversationId,
      store: createCanvasStore(toCanvasStoreSeed(initialSharedState)),
    };
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- identity is keyed on conversationId only; ref.current is read, not a dependency.
  const value = useMemo<CanvasStoreContextValue>(() => ref.current!, [conversationId]);

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
 * single panel's slice (e.g. Task 3's `buildSnapshot` reading the FULL
 * `values` bag at debounced-save time, D-10). */
export function useCanvasStore(): CanvasStore {
  return useCanvasStoreContext().store;
}

export interface IncomingDataEdge {
  readonly sourcePath: string;
  readonly targetKey: string;
}

export interface UsePanelDataResult {
  readonly data: Record<string, unknown>;
  readonly dispatch: (mutation: string, key: string, value?: unknown) => void;
}

/**
 * usePanelData(panelId, incomingEdges?) — `data` is the panel's own
 * `panels.{panelId}.*` slice, overlaid with any `incomingEdges`' resolved
 * source values at their `targetKey` (Task 3's live data-edge subscription
 * seam — empty by default; re-resolves whenever the store changes, since
 * the selector reads the CURRENT `state.values` on every store update).
 * `dispatch(mutation, key, value)` mutates `panels.{panelId}.{key}` through
 * the store's own bounded mutation enum.
 */
export function usePanelData(
  panelId: string,
  incomingEdges: readonly IncomingDataEdge[] = [],
): UsePanelDataResult {
  const { store } = useCanvasStoreContext();

  const data = useStore(store, (state) => {
    const panels = state.values.panels as Record<string, unknown> | undefined;
    const own = (panels?.[panelId] as Record<string, unknown> | undefined) ?? {};
    if (incomingEdges.length === 0) return own;

    const overlay: Record<string, unknown> = {};
    for (const edge of incomingEdges) {
      overlay[edge.targetKey] = resolveCanvasPath(state.values, edge.sourcePath);
    }
    return { ...own, ...overlay };
  });

  const mutate = useStore(store, (state) => state.mutate);

  const dispatch = useCallback(
    (mutation: string, key: string, value?: unknown) => {
      mutate(mutation, `panels.${panelId}.${key}`, value);
    },
    [mutate, panelId],
  );

  return { data, dispatch };
}
