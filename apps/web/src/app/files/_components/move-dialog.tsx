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
import {
  parseVaultPath,
  VaultPathSchema,
} from "../../../../../../packages/api-client/src/router/files/vault-keys";

/**
 * move-dialog.tsx — DR-01 move (single or bulk).
 *
 * The destination is a FOLDER PATH the user types (e.g. `archive/2026`),
 * validated with the SAME `VaultPathSchema` the server runs, then parsed to
 * relative segments — the client never sends a key, only validated segments
 * (the vault's whole input rule). Blank means the vault root.
 *
 * A tree PICKER is the nicer version and the recorded next step; a validated
 * path field is the honest one-screen move today, and it reuses the exact
 * schema the URL bar already trusts (`parseVaultPath`).
 */
export function MoveDialog({
  entries,
  onOpenChange,
  onSubmit,
}: {
  /** The rows being moved — empty/null closes the dialog. */
  readonly entries: readonly VaultEntry[] | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (entries: readonly VaultEntry[], toPath: readonly string[]) => void;
}): React.ReactElement | null {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue("");
    setError(null);
  }, [entries]);

  if (!entries || entries.length === 0) return null;

  const commit = () => {
    const toPath = parseVaultPath(value);
    // `parseVaultPath` collapses junk to [] (the vault ROOT, itself a valid
    // path) — so VaultPathSchema.safeParse can never fail and a typo like
    // ".trash" or "../x" would silently move items to the root. Guard first:
    // a NON-EMPTY input that parses to no segments is a genuinely bad path.
    if (value.trim() !== "" && toPath.length === 0) {
      setError("That destination folder isn't valid.");
      return;
    }
    const parsed = VaultPathSchema.safeParse(toPath);
    if (!parsed.success) {
      setError("That destination folder isn't valid.");
      return;
    }
    onSubmit(entries, parsed.data);
  };

  const label =
    entries.length === 1 ? `Move ${entries[0]!.name}` : `Move ${entries.length} items`;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent data-slot="move-dialog">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            Type the destination folder — leave blank for the top level.
          </DialogDescription>
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
          aria-label="Destination folder"
          aria-invalid={error ? true : undefined}
          placeholder="archive/2026"
          className="border-rule bg-bright text-base text-ink shadow-none placeholder:text-pencil"
        />

        {error ? (
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
            data-slot="move-confirm"
            onClick={commit}
            className="shadow-none pointer-coarse:touch-target"
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
