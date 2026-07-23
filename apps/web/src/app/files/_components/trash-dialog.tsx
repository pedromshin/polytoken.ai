"use client";

import * as React from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@polytoken/ui/dialog";
import { Button } from "@polytoken/ui/button";
import { cn } from "@polytoken/ui";

import { vaultApi } from "../_lib/vault-api";
import { formatBytes, formatVaultDate } from "../_lib/vault-format";

const inkButton = cn(
  "border-rule bg-leaf text-ink shadow-none hover:bg-shade",
  "outline-solid focus-visible:outline-2 focus-visible:outline-ink",
  "pointer-coarse:touch-target",
);

/**
 * trash-dialog.tsx — DR-02 restore-from-trash.
 *
 * Soft-deleted items live here until their retention expires. Restore moves the
 * blob back to its original path and clears the trash record — reversible, so
 * ink, no confirm. The listing invalidates on restore so the row leaves trash
 * and reappears in the vault.
 */
export function TrashDialog({
  open,
  onOpenChange,
  currentPath,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The folder to re-read after a restore, so a restored item shows up if it landed here. */
  readonly currentPath: readonly string[];
}): React.ReactElement | null {
  const utils = vaultApi.useUtils();

  const trash = vaultApi.files.listTrash.useQuery(undefined, {
    enabled: open,
    retry: false,
  });

  const restore = vaultApi.files.restoreFromTrash.useMutation({
    onSuccess: () => {
      toast("Restored from trash.");
      void utils.files.listTrash.invalidate();
      void utils.files.list.invalidate({ path: [...currentPath] });
    },
    onError: () => toast("Couldn't restore that item."),
  });

  if (!open) return null;

  const rows = trash.data ?? [];

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent data-slot="trash-dialog">
        <DialogHeader>
          <DialogTitle>Trash</DialogTitle>
          <DialogDescription>
            Deleted items are kept here for a while — restore one to put it back.
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <p className="py-4 text-sm text-pencil">Trash is empty.</p>
        ) : (
          <ul className="flex flex-col">
            {rows.map((item) => (
              <li
                key={item.id}
                data-slot="trash-row"
                className="flex items-center justify-between gap-3 border-b border-hair py-2 last:border-b-0"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="min-w-0 truncate text-sm text-ink">{item.name}</span>
                  <span className="tabular min-w-0 truncate text-xs text-pencil">
                    {item.objectPath} · {formatBytes(item.sizeBytes)} ·{" "}
                    {formatVaultDate(item.createdAt.toISOString())}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  data-slot="trash-restore"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate({ id: item.id })}
                  className={inkButton}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
