"use client";

/**
 * build-tool-dialog.tsx — the intent prompt for the Phase 76 summon loop. This
 * is the headline gesture of "bespoke disposable apps": select ≥2 data nodes,
 * and DESCRIBE the tool you want ("build me a rent reconciler"). Until this, the
 * flow generated from a canned default intent; this closes that gap.
 *
 * Opened programmatically by the canvas host (via `requestOpenNonce`, the same
 * pattern the Add-node pickers use) once the selection is confirmed eligible —
 * so this dialog never has to re-derive the sources; it just shows which ones
 * will be wired and captures the user's words. On submit it hands the typed
 * intent back; an EMPTY field falls back to the auto-generated default intent
 * (the caller decides), so "just build something from these" still works.
 *
 * Chrome, not evidence (58-IDENTITY law 2): every label here is polytoken's own
 * UI, so sans — the only "material" is what the user types, which is a live
 * input, not a persisted artifact. Hairline, ink focus, zero shadow.
 */

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Boxes } from "lucide-react";

import { Button } from "@polytoken/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@polytoken/ui/dialog";
import { Label } from "@polytoken/ui/label";
import { Textarea } from "@polytoken/ui/textarea";

/** Matches the api-client `codeIslandGenerate` intent bound (max 4096); kept a
 * little tighter here since a tool brief is a sentence or two, not an essay. */
const MAX_INTENT_LEN = 2000;

export interface BuildToolDialogProps {
  /** A monotonically-changing nonce the host bumps to open the dialog once it
   * has confirmed ≥2 eligible sources. The initial value never auto-opens. */
  readonly requestOpenNonce?: number;
  /** Human labels of the sources that will be wired (for the "wiring:" line). */
  readonly sourceLabels: readonly string[];
  /** True while a build is already in flight — disables submit so a second
   * summon can't race the first. */
  readonly pending: boolean;
  /** Called with the typed intent on submit. Empty string ⇒ use the default. */
  readonly onBuild: (intent: string) => void;
}

export function BuildToolDialog({
  requestOpenNonce,
  sourceLabels,
  pending,
  onBuild,
}: BuildToolDialogProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState("");

  // Open when the host bumps the nonce (skip the initial mount value). Reset the
  // field each fresh open so a prior draft never leaks into a new tool.
  const lastNonceRef = useRef(requestOpenNonce);
  useEffect(() => {
    if (requestOpenNonce !== undefined && requestOpenNonce !== lastNonceRef.current) {
      lastNonceRef.current = requestOpenNonce;
      setIntent("");
      setOpen(true);
    }
  }, [requestOpenNonce]);

  function submit(): void {
    if (pending) return;
    onBuild(intent.trim());
    setOpen(false);
  }

  const wiring =
    sourceLabels.length > 0 ? sourceLabels.join(", ") : "the selected data";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="size-4 shrink-0 text-faded" aria-hidden />
            Build a tool from these
          </DialogTitle>
          <DialogDescription>
            Describe the tool you want. It&apos;s generated as a sandboxed
            mini-app wired to{" "}
            <span className="text-ink">{wiring}</span> — your data never leaves
            the frame.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="build-tool-intent" className="text-xs text-faded">
            What should it do?
          </Label>
          <Textarea
            id="build-tool-intent"
            value={intent}
            maxLength={MAX_INTENT_LEN}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="e.g. Reconcile the spreadsheet against the spend meter and flag any month over budget."
            rows={3}
            autoFocus
            // Cmd/Ctrl+Enter submits (a plain Enter inserts a newline in a
            // textarea, so the accelerator is the modified chord).
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
          <p className="text-2xs text-faded">
            Leave blank to let it decide from the wired sources.
          </p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? "Building…" : "Build"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
