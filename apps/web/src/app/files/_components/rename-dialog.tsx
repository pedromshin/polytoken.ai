"use client";

import * as React from "react";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@polytoken/ui/dialog";
import { Button } from "@polytoken/ui/button";
import { Input } from "@polytoken/ui/input";
import { cn } from "@polytoken/ui";

import type { VaultEntry } from "../../../../../../packages/api-client/src/router/files/vault-types";
import { VaultNameSchema } from "../../../../../../packages/api-client/src/router/files/vault-keys";

/**
 * rename-dialog.tsx — DR-01 rename.
 *
 * A small modal, not madder: rename is reversible (rename back), so this is
 * plain ink chrome. The input validates with the SAME `VaultNameSchema` the
 * server runs, so the client never teaches a name the server will reject a
 * moment later — the new-folder row's own discipline.
 */
export function RenameDialog({
  entry,
  onOpenChange,
  onSubmit,
}: {
  readonly entry: VaultEntry | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (entry: VaultEntry, newName: string) => void;
}): React.ReactElement | null {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(entry?.name ?? "");
    setError(null);
  }, [entry]);

  if (!entry) return null;

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed === entry.name) {
      onOpenChange(false);
      return;
    }
    const parsed = VaultNameSchema.safeParse(trimmed);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "That name isn't allowed.");
      return;
    }
    onSubmit(entry, trimmed);
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent data-slot="rename-dialog">
        <DialogHeader>
          <DialogTitle>Rename {entry.name}</DialogTitle>
          <DialogDescription>Give it a new name.</DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
          aria-label="New name"
          aria-invalid={error ? true : undefined}
          className="border-rule bg-bright text-base text-ink shadow-none placeholder:text-pencil"
        />

        {error ? (
          // A validation message is a STATUS — ink, never madder (law 1).
          <p role="alert" className="text-xs text-ink">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className={cn(
              "border-rule bg-leaf text-ink shadow-none hover:bg-shade",
              "outline-solid focus-visible:outline-2 focus-visible:outline-ink",
              "pointer-coarse:touch-target",
            )}
          >
            Cancel
          </Button>
          <Button
            type="button"
            data-slot="rename-confirm"
            onClick={commit}
            className="shadow-none pointer-coarse:touch-target"
          >
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
