"use client";

/**
 * pack-switcher.tsx — PackSwitcher: PANL-01's per-panel style-pack Select
 * (52-UI-SPEC.md Component 1's compact pack-switcher recipe, Judgment Call
 * #3 — a plain `Select` reusing `generation-sandbox-island.tsx`'s exact
 * precedent, no color-swatch `DropdownMenu`, 52-02-PLAN.md Task 2).
 *
 * Optimistic apply, no confirmation step (52-CONTEXT.md): `onValueChange`
 * immediately sets the local pending value AND writes the new pack through
 * `usePanelOverlay`'s `writeOverlay(setPack(overlay, id), onSaveError)`,
 * which persists via the canvas's existing `scheduleSave` debounce
 * (`use-canvas-persistence.ts` never resolves/rejects a promise this
 * component could await, so `onSaveError` is a callback, not a promise
 * rejection). Two distinct revert-on-failure signals both feed the SAME
 * `revertAndToast`:
 *   (a) `writeOverlay` itself throwing SYNCHRONOUSLY — the pre-existing
 *       injectable/spyable test seam (a test-supplied `scheduleSave` that
 *       throws) kept intact for the existing suite.
 *   (b) `onSaveError` firing LATER, asynchronously, when the debounced
 *       `chat.saveCanvasLayout` mutation genuinely fails over the network —
 *       the REAL failure path 52-UI-REVIEW.md's #1 finding closes: before
 *       this, a real persist failure was silent (no revert, no toast — only
 *       the ambient `SaveStatusIndicator` ever saw it).
 * (see `__tests__/pack-switcher.test.tsx`, both "persist failure" cases).
 */

import * as React from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@polytoken/ui/select";
import { STYLE_PACKS, STYLE_PACK_IDS } from "@polytoken/genui/theme";
import type { StylePackId } from "@polytoken/genui/theme";

import { setPack } from "../panel-overlay";
import { usePanelOverlay } from "../panel-overlay-context";

export interface PackSwitcherProps {
  readonly panelId: string;
  /** The pack `resolveActivePanel` currently resolves for this panel — the
   * seed for this Select's local optimistic value. */
  readonly resolvedPackId: StylePackId;
  readonly isLocked: boolean;
  readonly onBusyChange: (busy: boolean) => void;
}

const TRIGGER_CLASS =
  "h-6 w-28 shrink-0 gap-1 rounded-md border-none bg-transparent px-1.5 text-xs font-normal text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground focus:ring-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40";

export function PackSwitcher({
  panelId,
  resolvedPackId,
  isLocked,
  onBusyChange,
}: PackSwitcherProps): React.ReactElement {
  const { overlay, writeOverlay } = usePanelOverlay(panelId);
  const [pendingPackId, setPendingPackId] = useState<StylePackId>(resolvedPackId);
  const [isPending, setIsPending] = useState(false);

  // A rehydrated/externally-resolved pack (reload, or another surface's
  // write) is the source of truth whenever nothing is in-flight locally.
  useEffect(() => {
    if (!isPending) setPendingPackId(resolvedPackId);
  }, [resolvedPackId, isPending]);

  function applyPack(nextId: StylePackId, priorId: StylePackId): void {
    setPendingPackId(nextId);
    setIsPending(true);
    onBusyChange(true);

    function revertAndToast(): void {
      setPendingPackId(priorId);
      setIsPending(false);
      onBusyChange(false);
      toast.error("Couldn't switch style — try again.", {
        action: {
          label: "Retry",
          onClick: () => applyPack(nextId, priorId),
        },
      });
    }

    try {
      // `revertAndToast` doubles as the REAL async-failure handler: fires
      // later, only if this write's debounced save genuinely fails (see
      // module doc point (b)) — never on success, never synchronously.
      writeOverlay(setPack(overlay, nextId), revertAndToast);
      setIsPending(false);
      onBusyChange(false);
    } catch {
      // Synchronous persist-failure test seam (module doc point (a)).
      revertAndToast();
    }
  }

  function handleValueChange(nextId: string): void {
    applyPack(nextId as StylePackId, pendingPackId);
  }

  return (
    <Select
      value={pendingPackId}
      onValueChange={handleValueChange}
      disabled={isLocked || isPending}
    >
      <SelectTrigger aria-label="Style pack" aria-busy={isPending} className={TRIGGER_CLASS}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STYLE_PACK_IDS.map((id) => (
          <SelectItem key={id} value={id}>
            {STYLE_PACKS[id].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
