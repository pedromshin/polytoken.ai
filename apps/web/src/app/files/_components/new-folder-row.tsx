"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Folder } from "lucide-react";

import { Input } from "@polytoken/ui/input";

import { VaultNameSchema } from "../../../../../../packages/api-client/src/router/files/vault-keys";

/**
 * new-folder-row.tsx — INLINE, never a modal (Phase 66 Plan 04, taste item 10,
 * D-66-10).
 *
 * "New folder" inserts a row AT THE TOP of the listing, in edit state, at the
 * exact geometry of a real row — so the folder appears where it will live,
 * rather than in a dialog that covers the thing it is about. The budget is
 * 1 click + type + Enter, and `vault-write.test.tsx` asserts no dialog opens in
 * between.
 *
 * A VALIDATION MESSAGE IS NEVER MADDER. It is a status (law 1, D-66-05) — ink
 * on the row, with the rule named.
 */
export function NewFolderRow({
  onCommit,
  onCancel,
  error,
}: {
  readonly onCommit: (name: string) => void;
  readonly onCancel: () => void;
  /** A server error (e.g. duplicate name), surfaced without wiping the input. */
  readonly error?: string;
}): React.ReactElement {
  const [value, setValue] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Autofocus so the click and the typing are CONTINUOUS — no second click
    // between deciding to make a folder and naming it.
    inputRef.current?.focus();
  }, []);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      onCancel();
      return;
    }

    // The SAME schema the server runs (Plan 01), so the client cannot teach
    // the user a name the server will reject a moment later.
    const parsed = VaultNameSchema.safeParse(trimmed);
    if (!parsed.success) {
      setLocalError(parsed.error.issues[0]?.message ?? "That name isn't allowed.");
      return;
    }

    setLocalError(null);
    onCommit(trimmed);
  };

  const message = localError ?? error;

  return (
    <li className="border-b border-hair last:border-b-0">
      {/* Row geometry copied from vault-row.tsx — same px-row-x/py-row-y, same
          size-4 glyph box, same gap-3 — so the row does not jump when it turns
          into a real one. */}
      <div className="flex items-center gap-3 px-row-x py-row-y">
        <Folder className="size-4 shrink-0 text-faded" aria-hidden />

        <Input
          ref={inputRef}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (localError) setLocalError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
          // BLUR CANCELS, NEVER COMMITS. A click elsewhere must not create a
          // folder the user did not finish naming.
          onBlur={() => {
            // Not while an error is showing: the message would vanish with the
            // row and the user would never learn why nothing happened.
            if (!message) onCancel();
          }}
          aria-label="New folder name"
          aria-invalid={message ? true : undefined}
          placeholder="Folder name"
          className="h-8 flex-1 border-rule bg-bright text-base text-ink shadow-none placeholder:text-pencil"
        />
      </div>

      {message ? (
        <p
          role="alert"
          // INK, not madder — a validation message is a status. The rule is
          // named rather than "invalid name", so the user knows what to change.
          className="px-row-x pb-2 pl-12 text-xs text-ink"
        >
          {message}
        </p>
      ) : null}
    </li>
  );
}
