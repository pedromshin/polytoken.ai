"use client";

/**
 * panel-overlay-context.tsx — the read/write/persist plumbing every editable
 * canvas panel builds against (52-01-PLAN.md Task 3, PANL-01..04).
 *
 * Two seams:
 *   (a) `CanvasPersistenceProvider`/`useCanvasPersistenceContext()` — exposes
 *       `scheduleSave` (bound to the conversation's canvas store) and
 *       `conversationId` to any panel, mirroring `canvas-store-context.tsx`'s
 *       own `CanvasStoreProvider`/`useCanvasStoreContext` shape (a thin
 *       context passthrough that throws a clear canvas-wiring error if a
 *       panel somehow renders outside `chat-canvas.tsx`'s provider tree).
 *   (b) `usePanelOverlay(panelId)` — the STATE-01-shaped read/write hook:
 *       reads `shared.panelOverlays.{panelId}` (parsed + degrade-not-throw
 *       via `parseOverlay`, T-52-01-01) and `writeOverlay(next)` commits a
 *       new overlay through the store's bounded 5-mutation grammar then
 *       schedules a persist — so every overlay write is durable across a
 *       reload (D-10) without any panel needing to know about
 *       `chat.saveCanvasLayout` directly.
 *
 * `usePanelActionLock` + `PanelActionControlProps`/`PanelActionId` are the
 * shared per-panel mutual-exclusion contract 52-UI-SPEC.md's toolbar
 * mandates ("while any one of the 4 actions is pending for this panel, the
 * Select and all 4 buttons are disabled except the one actually in
 * flight") — the toolbar (Plan 02) owns the actual `useState`, this module
 * only exports the shape so every control component agrees on it.
 */

// Explicit React import (not just named hook imports) — this file's JSX
// (CanvasPersistenceContext.Provider) compiles fine under Next.js's SWC
// automatic JSX runtime, but vitest's plain esbuild transform defaults to
// the classic runtime (React.createElement) and needs `React` in scope
// whenever a test mounts these providers directly (mirrors
// canvas-store-context.tsx's identical note — found live, same failure mode).
import * as React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

import type { StylePackId } from "@polytoken/genui/theme";

import { resolveCanvasPath } from "./canvas-store";
import { useCanvasStore } from "./canvas-store-context";
import type { Provenance } from "./node-data-schemas";
import { parseOverlay, type PanelOverlay } from "./panel-overlay";

// ---------------------------------------------------------------------------
// CanvasPersistenceContext — scheduleSave + conversationId, reachable from
// any panel (chat-canvas.tsx is the sole provider — see its Task 3 edit).
// ---------------------------------------------------------------------------

export interface CanvasPersistenceContextValue {
  /** `onError` (optional) — invoked ONLY when the real, underlying
   * `chat.saveCanvasLayout` mutation for the debounce cycle this call
   * coalesces into genuinely fails (mirrors
   * `use-canvas-persistence.ts`'s `UseCanvasPersistenceResult.scheduleSave`
   * — this context wrapper is that same function pre-bound to the
   * conversation's canvas store, see `chat-canvas.tsx`). Never fires on
   * success, never fires synchronously. */
  readonly scheduleSave: (onError?: () => void) => void;
  readonly conversationId: string;
}

const CanvasPersistenceContext = createContext<CanvasPersistenceContextValue | null>(null);

export interface CanvasPersistenceProviderProps {
  readonly children: ReactNode;
  readonly value: CanvasPersistenceContextValue;
}

export function CanvasPersistenceProvider({
  children,
  value,
}: CanvasPersistenceProviderProps): ReactElement {
  return (
    <CanvasPersistenceContext.Provider value={value}>{children}</CanvasPersistenceContext.Provider>
  );
}

/** Mirrors `canvas-store-context.tsx`'s `useCanvasStoreContext` — throws a
 * clear canvas-wiring error if a panel renders outside `chat-canvas.tsx`'s
 * provider tree rather than silently degrading (an overlay write with no
 * persistence wired is a wiring bug, not a runtime edge case to tolerate). */
export function useCanvasPersistenceContext(): CanvasPersistenceContextValue {
  const ctx = useContext(CanvasPersistenceContext);
  if (ctx === null) {
    throw new Error(
      "usePanelOverlay must be used inside a CanvasPersistenceProvider (canvas host wiring — see chat-canvas.tsx)",
    );
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// usePanelOverlay — per-panel overlay read/write (STATE-01-shaped)
// ---------------------------------------------------------------------------

export interface UsePanelOverlayResult {
  readonly overlay: PanelOverlay | undefined;
  /** `onSaveError` (optional) — forwarded verbatim to `scheduleSave`, so it
   * fires ONLY when THIS write's debounce cycle genuinely fails to persist
   * (52-UI-REVIEW.md finding #1: a real network/DB failure, not the
   * synchronous-throw test seam). Callers like `PackSwitcher`/
   * `VersionHistoryControl` pass a revert + `toast.error` here to react to
   * an ACTUAL persistence failure rather than only their own optimistic
   * write ever silently landing. */
  readonly writeOverlay: (next: PanelOverlay, onSaveError?: () => void) => void;
}

/**
 * usePanelOverlay(panelId) — `overlay` is the parsed
 * `shared.panelOverlays.{panelId}` slice (`undefined` when nothing has been
 * written yet, or when a stored record fails schema validation — degrade,
 * never throw, T-52-01-01). The RAW store slice is read via `useShallow`
 * (reference-stable across renders unless THIS panel's own overlay path was
 * written — `canvas-store.ts`'s `setCanvasPath` never touches a sibling
 * key's reference); `parseOverlay` is then memoized on that raw reference so
 * repeated renders never re-parse into a fresh (shallow-unequal) object and
 * loop `useSyncExternalStore` (mirrors `usePanelData`'s own stability note).
 * `writeOverlay(next, onSaveError?)` commits through the store's bounded
 * `mutate("set", ...)` grammar (never a raw store escape hatch) and always
 * schedules a persist — every overlay write is durable across a reload.
 * `onSaveError` (optional) rides along to `scheduleSave` so the CALLER finds
 * out if the real persist for THIS write later fails, not just the ambient
 * `SaveStatusIndicator`.
 */
export function usePanelOverlay(panelId: string): UsePanelOverlayResult {
  const store = useCanvasStore();
  const { scheduleSave } = useCanvasPersistenceContext();

  const rawOverlay = useStore(
    store,
    useShallow((state) => resolveCanvasPath(state.values, `shared.panelOverlays.${panelId}`)),
  );
  const overlay = useMemo(() => parseOverlay(rawOverlay), [rawOverlay]);

  const mutate = useStore(store, (state) => state.mutate);

  const writeOverlay = useCallback(
    (next: PanelOverlay, onSaveError?: () => void) => {
      mutate("set", `shared.panelOverlays.${panelId}`, next);
      scheduleSave(onSaveError);
    },
    [mutate, panelId, scheduleSave],
  );

  return { overlay, writeOverlay };
}

// ---------------------------------------------------------------------------
// Per-panel action-lock contract (52-UI-SPEC.md's toolbar mutual-exclusion)
// ---------------------------------------------------------------------------

/** The 4 mutating toolbar actions + the (non-mutating but still
 * lock-relevant) history popover — matches 52-UI-SPEC.md's toolbar exactly. */
export type PanelActionId = "pack" | "edit" | "regenerate" | "retheme" | "history";

/** Shared prop contract every action control component (Plan 02/03/04)
 * implements — keeps the toolbar's mutual-exclusion wiring uniform across
 * all four controls instead of each re-deriving its own prop shape. */
export interface PanelActionControlProps {
  readonly panelId: string;
  readonly provenance: Provenance;
  readonly activeSpecJson: string;
  readonly resolvedPackId: StylePackId;
  readonly isLocked: boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onGeneratingChange: (on: boolean) => void;
}

export interface UsePanelActionLockResult {
  readonly busyAction: PanelActionId | null;
  readonly setBusyAction: (action: PanelActionId | null) => void;
}

/**
 * usePanelActionLock — a per-panel `useState<PanelActionId | null>`
 * (created by whichever component calls this, typically the toolbar owning
 * a single panel's chrome — never shared across panels). Exported here so
 * the shape is defined ONCE even though the toolbar (Plan 02) is the actual
 * owner of the state instance.
 */
export function usePanelActionLock(): UsePanelActionLockResult {
  const [busyAction, setBusyAction] = useState<PanelActionId | null>(null);
  return { busyAction, setBusyAction };
}
