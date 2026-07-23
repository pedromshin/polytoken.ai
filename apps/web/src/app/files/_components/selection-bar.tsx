"use client";

import * as React from "react";
import { FolderInput, Trash2, X } from "lucide-react";

import { Button } from "@polytoken/ui/button";
import { cn } from "@polytoken/ui";

/**
 * selection-bar.tsx — the DR-01 bulk-action bar.
 *
 * Appears only when a selection exists; it is the one place bulk Move and bulk
 * Delete live. Both are INK: bulk delete is the soft-delete-to-trash path
 * (DR-02), which is REVERSIBLE, so it fires with a toast and earns no madder
 * (taste item 2 — the one madder control stays the single-row delete confirm).
 *
 * The count leads, because "I have 5 things selected" is the fact the bar
 * exists to state; the actions follow it.
 */
export function SelectionBar({
  count,
  onMove,
  onDelete,
  onClear,
}: {
  readonly count: number;
  readonly onMove: () => void;
  readonly onDelete: () => void;
  readonly onClear: () => void;
}): React.ReactElement | null {
  if (count === 0) return null;

  const inkButton = cn(
    "border-rule bg-leaf text-ink shadow-none hover:bg-shade",
    "outline-solid focus-visible:outline-2 focus-visible:outline-ink",
    "pointer-coarse:touch-target",
  );

  return (
    <div
      data-slot="vault-selection-bar"
      role="toolbar"
      aria-label={`${count} selected`}
      className="flex flex-wrap items-center gap-2 rounded-md border border-rule bg-leaf px-row-x py-2"
    >
      <span className="tabular mr-1 text-sm text-ink">{count} selected</span>

      <Button type="button" variant="outline" onClick={onMove} className={inkButton}>
        <FolderInput className="mr-2 size-4 text-faded" aria-hidden />
        Move to…
      </Button>

      <Button
        type="button"
        variant="outline"
        data-slot="vault-bulk-delete"
        onClick={onDelete}
        className={inkButton}
      >
        <Trash2 className="mr-2 size-4 text-faded" aria-hidden />
        Delete
      </Button>

      <Button
        type="button"
        variant="outline"
        onClick={onClear}
        aria-label="Clear selection"
        className={cn(inkButton, "ml-auto")}
      >
        <X className="size-4 text-faded" aria-hidden />
      </Button>
    </div>
  );
}
