"use client";

/**
 * canvas-empty-state.tsx — CanvasEmptyState: informational-only state shown
 * inside the canvas pane before any node exists (23-UI-SPEC.md Layout &
 * Structure "Empty-canvas state"). NOT a React Flow node — a plain
 * absolutely-centered div, same technique as /knowledge's
 * GraphNoSchemaState. No button: the remedy (send a message) lives on the
 * chat node's own composer / the docked Chat view, not here — this is a
 * transient/defensive state (the chat node is always present once a
 * conversation exists, D-02), not the primary first-run experience.
 *
 * Thin wrapper (FIX-11, 26-UI-SPEC.md § "FIX-11") around the shared
 * EmptyState primitive — centered/muted/compact, no action.
 */

import { LayoutGrid } from "lucide-react";

import { EmptyState } from "~/components/empty-state";

export function CanvasEmptyState(): React.ReactElement {
  return (
    <EmptyState
      icon={LayoutGrid}
      heading="Panels will appear here"
      body="Switch to Chat view and ask something — any interactive results will land here as panels."
      layout="centered"
      tone="muted"
      size="compact"
    />
  );
}
