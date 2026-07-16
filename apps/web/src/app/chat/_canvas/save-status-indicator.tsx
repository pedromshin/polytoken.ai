"use client";

/**
 * save-status-indicator.tsx — SaveStatusIndicator: ambient, toolbar-adjacent
 * feedback for the debounced canvas-layout save (D-06, 23-UI-SPEC.md
 * Copywriting Contract). Same subtle visual register as `CostMeter`
 * (`text-xs text-muted-foreground`) — never a toast, never a modal, never
 * blocking.
 *
 * "Saved" appears for ~2s after a successful save (motion-safe fade-in on
 * appearance; disappearance is a plain unmount in both motion modes — see
 * the module doc in use-canvas-persistence.ts for why an animated exit was
 * out of proportion for this ambient label). "Not saved — retrying…" stays
 * visible for the whole error window: the debounce timer auto-retries on the
 * NEXT change, so there is deliberately no retry button (local/sandbox
 * single-user data, matches REQUIREMENTS' "no CRDT/multiplayer" posture).
 * Renders nothing while idle/saving — no chrome for the common in-flight
 * case.
 */

import { useEffect, useState } from "react";

import type { SaveStatus } from "./use-canvas-persistence";

const SAVED_VISIBLE_MS = 2000;

export interface SaveStatusIndicatorProps {
  readonly status: SaveStatus;
}

export function SaveStatusIndicator({
  status,
}: SaveStatusIndicatorProps): React.ReactElement | null {
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (status !== "saved") {
      setShowSaved(false);
      return;
    }
    setShowSaved(true);
    const timer = setTimeout(() => setShowSaved(false), SAVED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [status]);

  if (status === "error") {
    // INK, not madder and not pencil (61-05). Law 1: madder means
    // "irreversible — this cannot be undone", never an error or a status, and
    // a save that failed is neither (the debounce auto-retries on the next
    // change). But it is not bookkeeping either, so it does NOT drop to the
    // pencil the "Saved" label wears: ink is one step up, which reads as more
    // important without spending the identity's loudest colour. Same reasoning
    // as D-61-04-E's errored tool round.
    return (
      <span role="status" className="text-2xs text-ink">
        Not saved — retrying…
      </span>
    );
  }

  if (status === "saved" && showSaved) {
    // The sketch's `.savestatus`: 11.5px in `--pencil` (direction-final.html:
    // 452-457), i.e. the micro step. `text-xs text-muted-foreground` was 12px
    // in `--faded` — a step louder than the sketch asks for a label whose whole
    // job is to be ambient. Pencil is legal on this bar's ground (never on
    // `--shade`).
    return (
      <span
        role="status"
        className="text-2xs text-pencil motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
      >
        Saved
      </span>
    );
  }

  return null;
}
