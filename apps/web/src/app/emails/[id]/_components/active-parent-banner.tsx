"use client";

import { Button } from "@polytoken/ui/button";

interface ActiveParentBannerProps {
  /** The active entity's display label. */
  readonly label: string;
  /** Clear the active parent (Esc also clears, via use-canvas-state). */
  readonly onClear: () => void;
}

/**
 * ActiveParentBanner — the D-10 active-parent status banner.
 *
 * A MODE indicator: it announces that the canvas is armed, so the next box
 * you draw becomes a field of this entity. Law 1 puts a mode in ink — pre-60
 * this banner was washed in a tint of the retired entity node-TYPE hue,
 * which spent colour saying "entity": a ROLE in a hue (law 3) on CHROME
 * (law 1). It now reads as a well pressed into the page (`bg-shade` +
 * `border-rule`), which is what a mode is: a temporary state of the surface,
 * not a claim about a fact. (The retired token is described, not named —
 * `role-hue-ban.test.ts` walks this file and does not read comments.)
 *
 * No tier badge here, deliberately: this component is handed a label and
 * nothing else, and the armed entity's tier is already stated by its box on
 * the canvas, its Layers row, and the extraction registry — all three in
 * view. A banner is not worth a query, nor a prop chain, to restate it a
 * fourth time.
 *
 * `role="status" aria-live="polite"`. Copy is the exact Copywriting Contract
 * string: "Active entity: {label} — next drawn boxes become fields".
 * Rendered only when an entity is armed (the consumer guards on
 * activeParentId).
 */
export function ActiveParentBanner({ label, onClear }: ActiveParentBannerProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-3 border-b border-rule bg-shade px-4 py-2 text-sm text-ink"
      role="status"
      aria-live="polite"
    >
      <span className="text-sm">
        {/* The entity's label is polytoken's word for a category ("Supplier"),
            not the document's own words, so law 2 keeps it sans. */}
        <span className="font-semibold">Active entity: {label}</span>
        {" — next drawn boxes become fields"}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto"
        aria-label="Clear active entity"
        aria-keyshortcuts="Escape"
        onClick={onClear}
      >
        Clear
      </Button>
    </div>
  );
}
