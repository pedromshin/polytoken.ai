"use client";

import * as React from "react";

import { cn } from "@polytoken/ui";

/**
 * vault-drop-layer.tsx — THE SIGNATURE (Phase 66 Plan 04, D-66-11).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE PAPER ACCEPTS THE DOCUMENT.
 * ────────────────────────────────────────────────────────────────────────────
 * This is the one place this surface spends boldness, and it is spent on the
 * drag-accept: dragging a file anywhere over the vault makes the SHEET ITSELF
 * RISE to meet it.
 *
 *   idle      pane = bg-leaf   border-rule
 *   dragging  pane = bg-bright border-ink     ← the sheet rises
 *             + one line: "Drop to upload to {folder}"
 *             + the rows below stay PERFECTLY STILL
 *
 * The elevation IS the ground ladder (`--leaf` -> `--bright`), because that is
 * this identity's ONLY elevation device (D-58-01). Never a shadow, never a
 * dashed blue box, never a frosted overlay, never a new hue — a dashed blue
 * box is what every other uploader does, and it is also exactly anti-generic
 * tell #2 (status carried by hue).
 *
 * A filing cabinet, not a web uploader. Which is what a self-cloud vault is.
 *
 * THIS WRAPS THE PANE'S CHILDREN; IT IS NOT AN OVERLAY OVER THEM. An overlay
 * would dim or blur the rows, and the rows holding still is the whole effect:
 * the ground moves, the content does not.
 */
export function VaultDropLayer({
  isDragging,
  folderName,
  dropProps,
  children,
}: {
  readonly isDragging: boolean;
  readonly folderName: string;
  readonly dropProps: {
    readonly onDragEnter: (e: React.DragEvent) => void;
    readonly onDragLeave: (e: React.DragEvent) => void;
    readonly onDragOver: (e: React.DragEvent) => void;
    readonly onDrop: (e: React.DragEvent) => void;
  };
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      data-slot="vault-drop-pane"
      data-dragging={isDragging ? "true" : "false"}
      {...dropProps}
      className={cn(
        "rounded-card border",
        // `motion-safe:` so a reduced-motion preference gets the state change
        // without the crossfade. The state must still be legible instantly —
        // the accept is information, not decoration.
        "motion-safe:transition-colors motion-safe:duration-150",
        isDragging
          ? "border-ink bg-bright"
          : "border-rule bg-leaf",
      )}
    >
      {isDragging ? (
        <p
          // aria-hidden: the drag state is announced by the tray as uploads
          // begin, and by the rows arriving. A live region firing on every
          // dragenter would be noise, not access.
          aria-hidden
          className="border-b border-hair px-row-x py-2 text-sm text-ink"
        >
          Drop to upload to {folderName}
        </p>
      ) : null}

      {children}
    </div>
  );
}
