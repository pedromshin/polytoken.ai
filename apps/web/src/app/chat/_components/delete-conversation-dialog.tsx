"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@nauta/ui/alert-dialog";

interface DeleteConversationDialogProps {
  readonly conversationTitle: string | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
  readonly isDeleting?: boolean;
}

/**
 * DeleteConversationDialog (D-14) — hard-delete confirm, mirroring
 * unmerge-dialog.tsx's AlertDialog + destructive-styled confirm-action
 * pattern (Cancel="Keep conversation" / Confirm="Delete", per the UI-SPEC
 * Copywriting Contract). Rendered once at the rail level and fully
 * controlled via `open`/`onOpenChange` — it is never nested inside a row's
 * overflow DropdownMenu, avoiding portal/focus conflicts between the two
 * Radix primitives.
 */
export function DeleteConversationDialog({
  conversationTitle,
  open,
  onOpenChange,
  onConfirm,
  isDeleting = false,
}: DeleteConversationDialogProps): React.ReactElement {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes all messages in &quot;
            {conversationTitle ?? ""}&quot;. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep conversation</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isDeleting}
            aria-label="Confirm conversation delete"
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
