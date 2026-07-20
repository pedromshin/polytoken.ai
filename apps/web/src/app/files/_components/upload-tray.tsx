"use client";

import * as React from "react";
import { CircleCheck, File as FileGlyph, TriangleAlert, X } from "lucide-react";

import { cn } from "@polytoken/ui";
import { Progress } from "@polytoken/ui/progress";

import type { VaultUpload } from "../_lib/use-vault-upload";

/**
 * upload-tray.tsx — per-file progress, cancel, and failure (Phase 66 Plan 04).
 *
 * Docked at the pane's foot on `bg-bright` — the sheet you are working on.
 *
 * A FAILURE HERE IS NEVER MADDER. An upload that did not land is a STATUS, and
 * law 1 spends madder only on the irreversible (D-58-01: "Never errors, never
 * warnings"). The glyph carries the role; the copy names the reason; the row
 * offers the way BACK (Retry — v2.1 hardening, the recovery 66-04 deferred)
 * and the way out (dismiss). The one madder control on this entire surface is
 * `delete-dialog.tsx`'s confirm button, and `files-law.test.ts` counts it.
 */
export function UploadTray({
  uploads,
  onCancel,
  onDismiss,
  onRetry,
}: {
  readonly uploads: readonly VaultUpload[];
  readonly onCancel: (id: string) => void;
  readonly onDismiss: (id: string) => void;
  readonly onRetry: (id: string) => void;
}): React.ReactElement | null {
  if (uploads.length === 0) return null;

  return (
    <ul
      data-slot="upload-tray"
      aria-label="Uploads"
      className="border-t border-rule bg-bright"
    >
      {uploads.map((upload) => (
        <UploadRow
          key={upload.id}
          upload={upload}
          onCancel={onCancel}
          onDismiss={onDismiss}
          onRetry={onRetry}
        />
      ))}
    </ul>
  );
}

function UploadRow({
  upload,
  onCancel,
  onDismiss,
  onRetry,
}: {
  readonly upload: VaultUpload;
  readonly onCancel: (id: string) => void;
  readonly onDismiss: (id: string) => void;
  readonly onRetry: (id: string) => void;
}): React.ReactElement {
  const failed = upload.status === "error";
  const done = upload.status === "done";

  return (
    <li
      data-slot="upload-tray-row"
      data-status={upload.status}
      // `role="alert"` only on failure — announcing every progress row would
      // make a 20-file drop shout twenty times.
      role={failed ? "alert" : undefined}
      className="flex items-center gap-3 border-b border-hair px-row-x py-2 last:border-b-0"
    >
      {failed ? (
        <TriangleAlert className="size-4 shrink-0 text-faded" aria-hidden />
      ) : done ? (
        <CircleCheck className="size-4 shrink-0 text-faded" aria-hidden />
      ) : (
        <FileGlyph className="size-4 shrink-0 text-faded" aria-hidden />
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm text-ink">{upload.name}</span>

        {failed ? (
          // "Upload failed — {reason}." Errors don't apologize and are never
          // vague: the reason is named, not hidden behind "something went
          // wrong".
          <span className="text-xs text-faded">Upload failed — {upload.error}</span>
        ) : done ? (
          // The action keeps its name through the flow: "Upload files" ->
          // "Uploading…" -> "Uploaded".
          <span className="text-xs text-faded">Uploaded</span>
        ) : (
          <Progress
            value={upload.progress}
            aria-label={`Uploading ${upload.name}`}
            className="h-1"
          />
        )}
      </div>

      {failed ? (
        // THE WAY BACK, WITH A WORD ON IT — not a circular-arrow glyph the
        // user has to decode (anti-generic tell #4). Ink: retrying is
        // additive and cancellable, so it has earned no colour.
        <button
          type="button"
          data-slot="upload-retry"
          onClick={() => onRetry(upload.id)}
          aria-label={`Retry upload of ${upload.name}`}
          className={cn(
            "shrink-0 rounded-md px-2 py-1 text-sm text-ink",
            "transition-colors hover:bg-shade",
            "outline-solid focus-visible:outline-2 focus-visible:outline-ink",
            "pointer-coarse:touch-target",
          )}
        >
          Retry
        </button>
      ) : null}

      {!done ? (
        <button
          type="button"
          data-slot={failed ? "upload-dismiss" : "upload-cancel"}
          onClick={() => (failed ? onDismiss(upload.id) : onCancel(upload.id))}
          aria-label={
            failed
              ? `Dismiss failed upload of ${upload.name}`
              : `Cancel upload of ${upload.name}`
          }
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md p-2",
            "text-faded transition-colors hover:bg-shade hover:text-ink",
            "outline-solid focus-visible:outline-2 focus-visible:outline-ink",
            "pointer-coarse:touch-target",
          )}
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </li>
  );
}

/**
 * Done rows auto-dismiss on a ~4s timer (use-vault-upload.ts); ERROR ROWS
 * PERSIST until dismissed. An error that vanishes on a timer is an error the
 * user never read — and the one thing worse than a failed upload is a failed
 * upload nobody mentioned.
 */
