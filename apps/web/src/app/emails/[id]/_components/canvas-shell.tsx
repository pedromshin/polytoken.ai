"use client";

// Explicit React import required: vitest's classic-runtime JSX transform
// needs `React` in scope even though Next.js's SWC automatic runtime does
// not (documented gotcha, see genui-panel-node.tsx / 53-03-SUMMARY.md).
import * as React from "react";
import { useState } from "react";
import type { ReactNode } from "react";

import { Sheet, SheetContent, SheetTitle } from "@polytoken/ui/sheet";

import { CanvasToolbar } from "./canvas-toolbar";

import type { CanvasMode } from "./canvas-toolbar";
import type { CanvasState } from "./use-canvas-state";

interface CanvasShellProps {
  /** The canvas interaction state machine (tool mode, selection, active parent). */
  readonly state: CanvasState;

  // ---- Toolbar wiring (shell-level controls only; page/zoom live in the pane) ----
  readonly showRegions: boolean;
  readonly onShowRegionsChange: (show: boolean) => void;
  readonly showHistory: boolean;
  readonly onShowHistoryChange: (show: boolean) => void;
  readonly showUnrelated: boolean;
  readonly onShowUnrelatedChange: (show: boolean) => void;
  readonly onClose: () => void;

  // ---- Zone slots (the actual panels land in 09-09) ----
  /** LAYERS panel (256px). Empty by default until 09-09's LayersPanel plugs in. */
  readonly layers?: ReactNode;
  /** INSPECTOR panel (288px). Empty by default until 09-09's InspectorPanel plugs in. */
  readonly inspector?: ReactNode;
  /** SUMMARY panel (288px, rightmost). Document-wide extraction summary; optional. */
  readonly summary?: ReactNode;
  /** The center canvas content: PdfPreviewPane + OverlayLayer + DrawOverlay. */
  readonly canvas: ReactNode;
  /** Active-parent banner shown above the canvas when an entity is armed (D-10). */
  readonly banner?: ReactNode;
}

/**
 * CanvasShell — the four-zone editor frame (D-06, 09-UI-SPEC §Layout Shell).
 *
 *   ┌──────────────────────── TOOLBAR (h-11) ────────────────────────┐
 *   ├── LAYERS (w-64) ──┬──── CANVAS (flex-1) ────┬── INSPECTOR (w-72) ┤
 *   └───────────────────┴─────────────────────────┴────────────────────┘
 *
 * The shell owns no PDF state — it wires the toolbar (tool mode / view toggles)
 * to the canvas zone via props and `state` (use-canvas-state). Page navigation,
 * zoom, and Fit live on the PDF viewport (pdf-preview-pane), which owns the
 * page/scale state, so they are not duplicated in the shell toolbar (Bundle C).
 * The LAYERS/INSPECTOR contents and the full page wiring are composed in 09-09.
 * It renders inside the app-shell SidebarInset (09-06).
 *
 * Below `md` (53-UI-SPEC §5, Judgment Call #7): LAYERS/INSPECTOR/SUMMARY stop
 * being persistent flex siblings (`hidden md:flex`) — CANVAS becomes the sole
 * persistent `w-full flex-1` zone, and the SAME slot nodes render instead
 * inside a left/right `Sheet` each, opened from `CanvasToolbar`'s new
 * `onOpenLayers`/`onOpenInspector` triggers. Desktop (`>=md`) is unchanged.
 */
export function CanvasShell({
  state,
  showRegions,
  onShowRegionsChange,
  showHistory,
  onShowHistoryChange,
  showUnrelated,
  onShowUnrelatedChange,
  onClose,
  layers,
  inspector,
  summary,
  canvas,
  banner,
}: CanvasShellProps) {
  const handleModeChange = (mode: CanvasMode) => state.setMode(mode);

  // Below-md Sheet-collapse state (53-UI-SPEC §5) — the persistent LAYERS/
  // INSPECTOR/SUMMARY panels are hidden below md; these two Sheets render the
  // SAME slot nodes instead, opened from CanvasToolbar's mobile-only triggers.
  const [mobileLayersOpen, setMobileLayersOpen] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);

  return (
    <div className="flex flex-col h-full">
      {/* TOOLBAR — full width, 44px, border-b */}
      <CanvasToolbar
        mode={state.mode}
        onModeChange={handleModeChange}
        showRegions={showRegions}
        onShowRegionsChange={onShowRegionsChange}
        showHistory={showHistory}
        onShowHistoryChange={onShowHistoryChange}
        showUnrelated={showUnrelated}
        onShowUnrelatedChange={onShowUnrelatedChange}
        onClose={onClose}
        onOpenLayers={() => setMobileLayersOpen(true)}
        onOpenInspector={() => setMobileInspectorOpen(true)}
      />

      {/* Three-column body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* LAYERS — 256px, border-r, scroll. Persistent only >=md. */}
        <div className="hidden md:flex md:flex-col w-64 shrink-0 border-r overflow-hidden">
          {layers}
        </div>

        {/* CANVAS — flex-1, overflow-hidden, relative for overlay stacking.
            The sole persistent zone below md (53-UI-SPEC §5). */}
        <div className="flex-1 min-w-0 overflow-hidden relative bg-muted/40 flex flex-col">
          {/* Active-parent banner slot (D-10) */}
          {banner}
          <div className="flex-1 min-h-0 overflow-hidden relative">{canvas}</div>
        </div>

        {/* INSPECTOR — 288px, border-l, scroll. Persistent only >=md. */}
        <div className="hidden md:flex md:flex-col w-72 shrink-0 border-l overflow-hidden">
          {inspector}
        </div>

        {/* SUMMARY — 288px, rightmost, border-l, scroll (optional slot). Persistent only >=md. */}
        {summary ? (
          <div className="hidden md:flex md:flex-col w-72 shrink-0 border-l overflow-hidden">
            {summary}
          </div>
        ) : null}
      </div>

      {/* Mobile Sheet-collapsed LAYERS (side="left", 53-UI-SPEC §5) — same
          `layers` slot node, only its container differs below md. */}
      <Sheet open={mobileLayersOpen} onOpenChange={setMobileLayersOpen}>
        <SheetContent side="left" className="md:hidden w-64 sm:max-w-xs p-0">
          <SheetTitle className="sr-only">Layers</SheetTitle>
          <div className="flex h-full flex-col overflow-hidden">{layers}</div>
        </SheetContent>
      </Sheet>

      {/* Mobile Sheet-collapsed INSPECTOR + SUMMARY (side="right",
          53-UI-SPEC §5) — same slot node(s), only the container differs. */}
      <Sheet open={mobileInspectorOpen} onOpenChange={setMobileInspectorOpen}>
        <SheetContent side="right" className="md:hidden w-72 sm:max-w-xs p-0">
          <SheetTitle className="sr-only">Inspector</SheetTitle>
          <div className="flex h-full flex-col overflow-hidden">
            {inspector}
            {summary}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
