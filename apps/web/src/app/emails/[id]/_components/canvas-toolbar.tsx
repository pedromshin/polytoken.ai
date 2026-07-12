"use client";

// Explicit React import required: vitest's classic-runtime JSX transform
// needs `React` in scope even though Next.js's SWC automatic runtime does
// not (documented gotcha, see genui-panel-node.tsx / 53-03-SUMMARY.md).
import * as React from "react";
import { useEffect } from "react";
import { Layers, MousePointer2, PanelRight, Pencil, X } from "lucide-react";

import { Button } from "@polytoken/ui/button";
import { Separator } from "@polytoken/ui/separator";
import { Switch } from "@polytoken/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@polytoken/ui/tooltip";

/** Tool mode (D-08): default is select; drag-on-empty draws regardless. */
export type CanvasMode = "select" | "draw";

interface CanvasToolbarProps {
  // ---- Tool mode (D-08) ----
  readonly mode: CanvasMode;
  readonly onModeChange: (mode: CanvasMode) => void;

  // ---- View toggles (D-05/D-12) ----
  readonly showRegions: boolean;
  readonly onShowRegionsChange: (show: boolean) => void;
  readonly showHistory: boolean;
  readonly onShowHistoryChange: (show: boolean) => void;
  /** D-12: Unrelated default OFF (anti-bloat). */
  readonly showUnrelated: boolean;
  readonly onShowUnrelatedChange: (show: boolean) => void;

  // ---- Right group ----
  readonly onClose: () => void;
  /** Opens the mobile LAYERS Sheet (53-UI-SPEC §5). Omit on desktop-only call sites. */
  readonly onOpenLayers?: () => void;
  /** Opens the mobile INSPECTOR/SUMMARY Sheet (53-UI-SPEC §5). Omit on desktop-only call sites. */
  readonly onOpenInspector?: () => void;

  /** When false, the global keybinding listener is not installed. */
  readonly keybindingsEnabled?: boolean;
}

/** Armed (active) tool-mode button indicator (09-UI-SPEC §Toolbar / §Color). */
const ARMED_CLASS = "bg-primary/10 text-primary border border-primary/30";

/**
 * CanvasToolbar — the editor's top toolbar (09-UI-SPEC §Toolbar). h-11 full-width
 * bar with the controls that operate at the shell level: the tool-mode toggle
 * (Select/Draw) and the view toggles (Regions / History / Unrelated), plus a
 * right-aligned close button.
 *
 * Page navigation, zoom, and Fit live on the PDF viewport itself
 * (pdf-preview-pane's own toolbar), which owns the page/scale state — so those
 * controls are NOT duplicated here (Bundle C: zero dead/no-op controls). The
 * Regions toggle is the single source of truth for on-PDF overlay visibility,
 * driven down into the pane.
 *
 * Keybindings (D-07/D-08): V/S = Select, D = Draw. Zoom keys (Cmd/Ctrl +/-/0,
 * Cmd/Ctrl+Shift+W/F) live on the canvas viewport (pdf-preview-pane) so they only
 * fire when the canvas is focused; this toolbar owns the tool-mode shortcuts.
 */
export function CanvasToolbar({
  mode,
  onModeChange,
  showRegions,
  onShowRegionsChange,
  showHistory,
  onShowHistoryChange,
  showUnrelated,
  onShowUnrelatedChange,
  onClose,
  onOpenLayers,
  onOpenInspector,
  keybindingsEnabled = true,
}: CanvasToolbarProps) {
  // Tool-mode keybindings (V/S = select, D = draw). Ignore when a form control
  // is focused so typing in the inspector never flips the tool.
  useEffect(() => {
    if (!keybindingsEnabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (e.key === "v" || e.key === "V" || e.key === "s" || e.key === "S") {
        onModeChange("select");
      } else if (e.key === "d" || e.key === "D") {
        onModeChange("draw");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keybindingsEnabled, onModeChange]);

  return (
    <TooltipProvider>
      <div
        role="toolbar"
        aria-label="Canvas tools"
        className="h-11 flex items-center gap-2 border-b px-3 bg-background shrink-0"
      >
        {/* Tool mode group (D-08) */}
        <div className="flex items-center gap-1" role="group" aria-label="Tool mode">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Select tool (V)"
                aria-pressed={mode === "select"}
                aria-keyshortcuts="v s"
                className={mode === "select" ? ARMED_CLASS : "text-muted-foreground"}
                onClick={() => onModeChange("select")}
              >
                <MousePointer2 className="h-4 w-4" />
                <span className="ml-1.5 text-sm font-semibold">Select</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Select tool (V)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Draw tool (D)"
                aria-pressed={mode === "draw"}
                aria-keyshortcuts="d"
                className={mode === "draw" ? ARMED_CLASS : "text-muted-foreground"}
                onClick={() => onModeChange("draw")}
              >
                <Pencil className="h-4 w-4" />
                <span className="ml-1.5 text-sm font-semibold">Draw</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Draw tool (D)</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="h-6" />

        {/* View toggles (D-05/D-12) */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <Switch
              checked={showRegions}
              onCheckedChange={onShowRegionsChange}
              aria-label="Show region overlays"
            />
            <span>Regions</span>
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <Switch
              checked={showHistory}
              onCheckedChange={onShowHistoryChange}
              aria-label="Show rejected / superseded regions"
            />
            <span>History</span>
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <Switch
              checked={showUnrelated}
              onCheckedChange={onShowUnrelatedChange}
              aria-label="Show unrelated regions (D-12)"
            />
            <span>Unrelated</span>
          </label>
        </div>

        {/* Right group — mobile Sheet triggers (md:hidden, 53-UI-SPEC §5) + close */}
        <div className="ml-auto flex items-center gap-1">
          {onOpenLayers ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onOpenLayers}
                  aria-label="Show layers"
                  className="md:hidden size-11 text-muted-foreground"
                >
                  <Layers className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Show layers</TooltipContent>
            </Tooltip>
          ) : null}
          {onOpenInspector ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onOpenInspector}
                  aria-label="Show inspector"
                  className="md:hidden size-11 text-muted-foreground"
                >
                  <PanelRight className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Show inspector</TooltipContent>
            </Tooltip>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close document preview"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}
