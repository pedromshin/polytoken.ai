"use client";

/**
 * cascade-highlight.ts — the ephemeral, non-persisted signal that drives the
 * Phase 75 (CPF-06) "correction sweep" repaint highlight.
 *
 * When a correction lands (a merge/reject confirm in `use-merge-review.ts`), the
 * touched entity ids are marked here; any mounted `EntityNode` for one of those
 * ids reads the mark via `useCascadeHighlight(id)` and paints a brief highlight
 * ring so the user SEES the correction cascade across the board — one click on
 * one node, and every card that changed lights up. The mark self-clears after
 * `HIGHLIGHT_MS`.
 *
 * DELIBERATELY module-level, NOT the canvas store. The canvas store persists
 * (last-write-wins `chat_canvas_layouts` row, shared by /chat and /home —
 * `use-canvas-persistence.ts` module doc), and 75-SPEC's "LWW canvas caveat"
 * forbids stuffing cascade results into node.data or rewriting node positions.
 * A highlight is transient UI owned by no row: a Set with per-id timers,
 * surfaced through `useSyncExternalStore` so it works wherever an `EntityNode`
 * mounts (chat canvas, home canvas) and degrades to nothing when none listens.
 * The boolean is all this module exposes — motion gating is the node's job
 * (motion-reduce), per CLAUDE.md design law.
 */

import { useSyncExternalStore } from "react";

/** How long a touched card stays lit. Long enough to notice, short enough to
 * feel like a sweep, not a persistent state. */
export const HIGHLIGHT_MS = 1800;

const active = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Mark the given entity ids as just-corrected — each lights up for
 * `HIGHLIGHT_MS`, then self-clears. Re-marking an already-lit id restarts its
 * timer (a rapid second correction re-lights rather than blinking off). Empty
 * / falsy ids are ignored. */
export function markCorrected(ids: readonly string[]): void {
  let changed = false;
  for (const id of ids) {
    if (!id) continue;
    if (!active.has(id)) {
      active.add(id);
      changed = true;
    }
    const existing = timers.get(id);
    if (existing !== undefined) clearTimeout(existing);
    timers.set(
      id,
      setTimeout(() => {
        active.delete(id);
        timers.delete(id);
        emit();
      }, HIGHLIGHT_MS),
    );
  }
  if (changed) emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe a component to whether `id` is currently highlighted. Primitive
 * boolean snapshot (Object.is-stable), so no tearing / render loops. SSR-safe:
 * never highlighted on the server. */
export function useCascadeHighlight(id: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => active.has(id),
    () => false,
  );
}

/** Test-only: clear all marks + timers so state never leaks between cases. */
export function __resetCascadeHighlightForTests(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  active.clear();
  emit();
}
