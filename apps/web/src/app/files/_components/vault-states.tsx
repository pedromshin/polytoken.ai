"use client";

import * as React from "react";
import { CloudUpload, TriangleAlert } from "lucide-react";

import { Button } from "@polytoken/ui/button";

/**
 * vault-states.tsx — the SURF-06 bar for /files (Phase 66 Plan 03, FVLT-04).
 *
 * Empty, loading, and error as DESIGNED states, not first-draft placeholders.
 * All three are ink on the ground ladder; not one of them wears a hue.
 *
 * Copy is verbatim from D-66-11 and it is design material, not decoration:
 * active voice, sentence case, one job each. Errors don't apologize and are
 * never vague about what happened.
 */

// ---------------------------------------------------------------------------

/**
 * VaultEmpty — the onboarding.
 *
 * The empty state teaches the gesture the user will use forever, which is
 * exactly why the copy says "anywhere" rather than pointing at the button:
 * the PANE this sits in IS the drop target that Plan 04 lights up.
 *
 * NOT WRAPPED IN A CARD. The pane is already the sheet; a bordered, shadowed
 * box centred in it is anti-generic tell #1 — the default-shadcn empty
 * silhouette — and our elevation is the ground ladder, never a shadow.
 *
 * EXACTLY ONE BUTTON. Taste item 8 only holds if nothing competes with the
 * next action; `vault-states.test.tsx` counts them.
 */
export function VaultEmpty({
  atRoot,
  onUpload,
}: {
  readonly atRoot: boolean;
  readonly onUpload: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-20 text-center">
      <CloudUpload className="size-8 text-faded" aria-hidden />

      <p className="max-w-sm text-base text-ink">
        {atRoot
          ? "Drop a file anywhere to start your vault"
          : "This folder is empty. Drop a file anywhere to fill it."}
      </p>

      {/* `shadow-none` kills the primitive's `shadow` — the swept surfaces'
          established move (composer.tsx). D-58-01's elevation is the ground
          ladder (shelf -> leaf -> bright); there are no shadows in this
          identity, and the kit's default variant ships one.
          `bg-primary` is hueless by construction: `--primary: var(--ink)`. */}
      <Button type="button" onClick={onUpload} className="shadow-none">
        Upload files
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** How many skeleton rows to draw. Enough to read as a list, not as a page. */
const SKELETON_ROWS = 5;

/**
 * VaultLoading — skeleton ROWS, not a spinner.
 *
 * A spinner says "something is happening". Skeleton rows say "a list is about
 * to be here", which is the true statement and the more useful one.
 *
 * THE GEOMETRY IS COPIED FROM `vault-row.tsx`, deliberately: same `px-row-x
 * py-row-y`, same `size-4` glyph box, same `gap-3`, and — since the v2.1
 * provenance line — the same two-line name column (name bar over a shorter
 * text-xs-height provenance bar). A skeleton drawn from imagination rather
 * than from the row is a layout shift the moment content lands — and that
 * jump is the tell that nobody compared them.
 */
export function VaultLoading(): React.ReactElement {
  return (
    <ul aria-busy="true" aria-label="Loading your files" className="flex flex-col">
      {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
        <li
          key={index}
          data-slot="vault-skeleton-row"
          className="flex items-center gap-3 border-b border-hair px-row-x py-row-y last:border-b-0"
        >
          <div className="size-4 shrink-0 rounded-sm bg-shade motion-safe:animate-pulse" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div
              className="h-4 rounded-sm bg-shade motion-safe:animate-pulse"
              // Staggered widths so the block reads as a list of names rather
              // than as a bar chart. Inline style, not a class: these are
              // per-index values, and Tailwind v4 purges non-literal class
              // strings SILENTLY — `w-[${n}%]` would emit nothing at all.
              style={{ maxWidth: `${[42, 68, 30, 55, 48][index] ?? 50}%` }}
            />
            {/* The provenance bar — text-xs line height, narrower than the
                name above it, same stagger so the two read as one column. */}
            <div
              className="h-3 rounded-sm bg-shade motion-safe:animate-pulse"
              style={{ maxWidth: `${[28, 34, 22, 31, 26][index] ?? 28}%` }}
            />
          </div>
          <div className="h-4 w-12 shrink-0 rounded-sm bg-shade motion-safe:animate-pulse" />
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------

/**
 * VaultLoadMore — the listing's foot when the folder has more than one page
 * (v2.1 hardening: the 500-entry cap became a page, not a truncation).
 *
 * Renders NOTHING for the common folder (one page, no failure) — the foot of
 * an ordinary listing is silence, not chrome.
 *
 * The action keeps its name through the flow: "Show more" -> "Loading more…"
 * (D-66-11's naming rule). A failed page is a STATUS — ink, glyph carries the
 * role, `role="alert"` — NEVER madder (law 1), and it keeps the rows already
 * on screen: replacing a loaded listing with a full-pane error because page
 * two failed would be the interface punishing the user for scrolling.
 */
export function VaultLoadMore({
  hasMore,
  isLoadingMore,
  failed,
  onMore,
  onRetry,
}: {
  readonly hasMore: boolean;
  readonly isLoadingMore: boolean;
  /** A page fetch failed while rows are already showing. */
  readonly failed: boolean;
  readonly onMore: () => void;
  readonly onRetry: () => void;
}): React.ReactElement | null {
  if (failed) {
    return (
      <div
        role="alert"
        data-slot="vault-load-more-error"
        className="flex items-center justify-center gap-3 border-t border-hair px-row-x py-3"
      >
        <TriangleAlert className="size-4 shrink-0 text-faded" aria-hidden />
        <span className="text-sm text-ink">Couldn&apos;t load the rest of this folder.</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="border-rule bg-leaf text-ink shadow-none hover:bg-shade pointer-coarse:touch-target"
        >
          Try again
        </Button>
      </div>
    );
  }

  if (!hasMore) return null;

  return (
    <div className="flex justify-center border-t border-hair py-3">
      <Button
        type="button"
        variant="outline"
        data-slot="vault-load-more"
        onClick={onMore}
        disabled={isLoadingMore}
        className="border-rule bg-leaf text-ink shadow-none hover:bg-shade pointer-coarse:touch-target"
      >
        {isLoadingMore ? "Loading more…" : "Show more"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * VaultError — a STATUS, and therefore ink.
 *
 * NO MADDER. Law 1: madder means "irreversible — this cannot be undone", and
 * D-58-01 spends it on "destructive buttons only. Never errors, never
 * warnings." A failed load is the most natural place in this whole surface to
 * reach for red, which is why `vault-states.test.tsx` asserts on every
 * descendant's className rather than trusting this comment.
 *
 * The GLYPH carries the role instead of a hue — that is law 3's move, and it
 * survives greyscale and colour-blindness, which a red border does not.
 */
export function VaultError({
  onRetry,
}: {
  readonly onRetry: () => void;
}): React.ReactElement {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-4 px-6 py-20 text-center"
    >
      <TriangleAlert className="size-8 text-faded" aria-hidden />

      <p className="max-w-sm text-base text-ink">Couldn&apos;t load this folder.</p>

      <Button
        type="button"
        variant="outline"
        onClick={onRetry}
        // `border-rule`/`bg-leaf` rather than the outline variant's unswept
        // `border-input`/`bg-background` aliases; `shadow-none` per above.
        className="border-rule bg-leaf text-ink shadow-none hover:bg-shade"
      >
        Try again
      </Button>
    </div>
  );
}
