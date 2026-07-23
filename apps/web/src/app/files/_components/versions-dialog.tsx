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

import type { VaultEntry } from "../../../../../../packages/api-client/src/router/files/vault-types";
import { vaultApi } from "../_lib/vault-api";
import { formatBytes, formatVaultDate } from "../_lib/vault-format";

const inkButton = cn(
  "border-rule bg-leaf text-ink shadow-none hover:bg-shade",
  "outline-solid focus-visible:outline-2 focus-visible:outline-ink",
  "pointer-coarse:touch-target",
);

/**
 * versions-dialog.tsx — DR-02 version history + restore.
 *
 * Lists the prior copies `requestUpload` snapshotted on each overwrite, newest
 * first. RESTORE IS REVERSIBLE (the server snapshots the current content into a
 * fresh version before it swaps in the chosen one), so every control here is
 * ink — no madder, no confirm. A restore fires and the list re-reads.
 */
export function VersionsDialog({
  entry,
  path,
  onOpenChange,
}: {
  readonly entry: VaultEntry | null;
  readonly path: readonly string[];
  readonly onOpenChange: (open: boolean) => void;
}): React.ReactElement | null {
  const utils = vaultApi.useUtils();
  const isOpen = Boolean(entry) && !entry?.isFolder;

  const versions = vaultApi.files.listVersions.useQuery(
    { path: [...path], name: entry?.name ?? "" },
    { enabled: isOpen, retry: false },
  );

  const restore = vaultApi.files.restoreVersion.useMutation({
    onSuccess: () => {
      toast("Restored that version.");
      void utils.files.list.invalidate({ path: [...path] });
      if (entry) {
        void utils.files.listVersions.invalidate({ path: [...path], name: entry.name });
      }
    },
    onError: () => toast("Couldn't restore that version."),
  });

  if (!isOpen || !entry) return null;

  const rows = versions.data ?? [];

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent data-slot="versions-dialog">
        <DialogHeader>
          <DialogTitle>Version history · {entry.name}</DialogTitle>
          <DialogDescription>
            Earlier copies, kept each time this file was replaced.
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <p className="py-4 text-sm text-pencil">No earlier versions yet.</p>
        ) : (
          <ul className="flex flex-col">
            {rows.map((version) => (
              <li
                key={version.id}
                data-slot="version-row"
                className="flex items-center justify-between gap-3 border-b border-hair py-2 last:border-b-0"
              >
                <span className="tabular min-w-0 truncate text-sm text-ink">
                  {formatVaultDate(version.createdAt.toISOString())} ·{" "}
                  {formatBytes(version.sizeBytes)}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  data-slot="version-restore"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate({ id: version.id })}
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
