"use client";

/**
 * graph-states.tsx — error + empty states for the /knowledge surface
 * (Phase 62 / SURF-06, production-grade on the locked identity).
 *
 * GraphErrorState — an error is a STATE, and law 1 is explicit: madder means
 * "irreversible", never errors. So the frame is a rule, the words are ink,
 * the glyph carries the role. One retry action.
 *
 * GraphNoSchemaState — the empty state TEACHES (taste checklist item 8): the
 * board fills from facts the user confirms, so the one prominent control
 * points at the inbox, where confirming happens. No stock illustration, no
 * grey paragraph floating in dead space — a framed panel on the ground
 * ladder.
 *
 * No font-medium (500) — only font-normal / font-semibold.
 */

import Link from "next/link";
import { AlertCircle, Shapes } from "lucide-react";

import { Button } from "@polytoken/ui/button";

// ---------------------------------------------------------------------------
// GraphErrorState
// ---------------------------------------------------------------------------

export function GraphErrorState(): React.ReactElement {
  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div
        role="alert"
        className="flex w-full max-w-sm flex-col items-center gap-3 rounded-card border border-rule bg-leaf p-panel text-center"
      >
        <AlertCircle className="size-6 text-ink" aria-hidden />
        <div className="space-y-1">
          <p className="text-base font-semibold text-ink">
            Could not load the knowledge graph.
          </p>
          <p className="text-sm text-faded">
            The board will come back with the data — try again.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => window.location.reload()}
        >
          Refresh page
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GraphNoSchemaState — the empty state teaches (taste §3: "/knowledge")
// ---------------------------------------------------------------------------

export function GraphNoSchemaState(): React.ReactElement {
  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-card border border-rule bg-leaf p-panel text-center">
        <Shapes className="size-6 text-faded" aria-hidden />
        <div className="space-y-1">
          <p className="text-base font-semibold text-ink">
            Nothing on the board yet.
          </p>
          <p className="text-sm text-faded">
            This graph is built from facts you confirm. Confirm your first
            extraction in the inbox — it lands here.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/">Open the inbox</Link>
        </Button>
      </div>
    </div>
  );
}
