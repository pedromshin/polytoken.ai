"use client";

import * as React from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@polytoken/ui/alert-dialog";
import { buttonVariants } from "@polytoken/ui/button";
import { cn } from "@polytoken/ui";

import type { VaultEntry } from "../../../../../../packages/api-client/src/router/files/vault-types";

/**
 * delete-dialog.tsx — THE ONE MODAL, AND THE ONE MADDER, ON THIS SURFACE
 * (Phase 66 Plan 04, FVLT-03, D-66-05/D-66-10).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY A CONFIRM IS CORRECT HERE AND NOWHERE ELSE ON /files
 * ────────────────────────────────────────────────────────────────────────────
 * Taste item 2: reversible actions never confirm — they fire with an undo
 * toast. Confirm modals and madder share exactly ONE scope: the irreversible.
 *
 * There is no trash in this vault (`trash/undelete` is OUT — 66-CONTEXT
 * <domain>). So delete IS irreversible: undo is not available to offer, and
 * the confirm is the honest instrument rather than a reflex. That single fact
 * is what earns both the modal and the madder fill on its confirm button.
 *
 * Upload is additive. Folder creation is additive. Neither confirms. That
 * leaves exactly one modal and exactly one madder control on the whole
 * surface — which is the story the surface tells about itself, and it is
 * checkable in a screenshot. `files-law.test.ts` counts the madder to exactly
 * this file.
 *
 * SHAPE copied from `emails/[id]/_components/reject-dialog.tsx` — its
 * MECHANICS, not its judgement. taste §2 flags that component as a standing
 * violation precisely because it confirms a REVERSIBLE action. Ours is the
 * opposite case.
 *
 * The TRIGGER that opens this dialog stays INK (vault-row.tsx): opening a
 * dialog is cancellable, so it has earned no colour. Only the button that
 * actually ends the file wears madder.
 */
export function DeleteDialog({
  entry,
  onOpenChange,
  onConfirm,
}: {
  /** The entry under threat, or null when the dialog is closed. */
  readonly entry: VaultEntry | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: (entry: VaultEntry) => void;
}): React.ReactElement | null {
  if (!entry) return null;

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {entry.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {/* The recursive delete (Plan 01) is the single most destructive
                act in this phase. The copy must not hide it behind the word
                "folder" — the user is owed the consequence in words before
                they are asked to accept it. */}
            {entry.isFolder
              ? "This folder and everything in it. This can't be undone."
              : "This can't be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel
            className={cn(
              "border-rule bg-leaf text-ink shadow-none hover:bg-shade",
              // Radix ships its own focus styles here; `outline-solid` is what
              // evicts an inherited `outline-none` that would otherwise win
              // against `outline-2` through tailwind-merge.
              "outline-solid focus-visible:outline-2 focus-visible:outline-ink",
              "pointer-coarse:touch-target",
            )}
          >
            Cancel
          </AlertDialogCancel>

          <AlertDialogAction
            data-slot="delete-confirm"
            onClick={() => onConfirm(entry)}
            className={cn(
              // THE ONE MADDER CONTROL. A FILL, which is the treatment law 1
              // earns: madder text or a madder border would be a state
              // talking, and this is an action.
              buttonVariants({ variant: "destructive" }),
              "shadow-none",
              "outline-solid focus-visible:outline-2 focus-visible:outline-ink",
              "pointer-coarse:touch-target",
            )}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
