"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type * as React from "react";

/**
 * use-vault-drop.ts — pane-level drag state (Phase 66 Plan 04, D-66-09/D-66-11).
 *
 * Hand-rolled, ~30 lines, zero dependencies. `packages/ui`'s `Dropzone` is not
 * used and is not ours to fix: it renders a CARD-shaped drop area (which fights
 * "the entire content pane is the target") and its drag-active state is
 * `outline-none ring-1 ring-ring` — a stock accent (law 1) and the
 * outline-none/ring trap in one line. That finding is Lane A's to act on; the
 * vault simply does not import it.
 *
 * `react-dropzone` is likewise never imported: a pane-level "drop anywhere"
 * handler is ~30 lines, and adding a package would need an orchestrator-
 * reserved manifest change for no gain.
 */

export type VaultDropState = {
  readonly isDragging: boolean;
  readonly dropProps: {
    readonly onDragEnter: (e: React.DragEvent) => void;
    readonly onDragLeave: (e: React.DragEvent) => void;
    readonly onDragOver: (e: React.DragEvent) => void;
    readonly onDrop: (e: React.DragEvent) => void;
  };
};

/** Does this drag actually carry files? */
function carriesFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  // Dragging selected TEXT across the vault must not make the sheet rise —
  // the accept state is a promise that dropping will do something, and for a
  // text drag it would not.
  return Array.from(dataTransfer.types ?? []).includes("Files");
}

export function useVaultDrop(onFiles: (files: File[]) => void): VaultDropState {
  const [isDragging, setIsDragging] = useState(false);

  /**
   * A COUNTER, NOT A BOOLEAN. `dragleave` fires every time the pointer crosses
   * onto a CHILD element — every row, every glyph, every span. With a boolean,
   * the accept state strobes violently as the user moves across the listing.
   * This is the bug every hand-rolled dropzone ships first, and it is the one
   * `vault-write.test.tsx` gates with the dragenter/dragenter/dragleave
   * sequence.
   */
  const depth = useRef(0);

  /**
   * WINDOW-LEVEL GUARD. Without it, a near-miss drop — 10px outside the pane —
   * makes the BROWSER navigate to the file: the page is replaced by the raw
   * document, and any in-flight upload dies with it. The user's near-miss
   * should do nothing at all, which is what these two handlers buy.
   */
  useEffect(() => {
    const swallow = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return;
      event.preventDefault();
    };

    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);

    return () => {
      // Detached on unmount — a leaked global listener would silently swallow
      // drops on every other surface in the app (T-66-14).
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  const reset = useCallback(() => {
    depth.current = 0;
    setIsDragging(false);
  }, []);

  // A stuck counter leaves the sheet permanently risen. Reset on unmount too.
  useEffect(() => reset, [reset]);

  const onDragEnter = useCallback((event: React.DragEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    depth.current += 1;
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    depth.current -= 1;
    if (depth.current <= 0) {
      depth.current = 0;
      setIsDragging(false);
    }
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    // Without preventDefault on dragover, `drop` NEVER FIRES. The single most
    // common reason a hand-rolled dropzone silently does nothing.
    event.preventDefault();
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      reset();

      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) onFiles(files);
    },
    [onFiles, reset],
  );

  return {
    isDragging,
    dropProps: { onDragEnter, onDragLeave, onDragOver, onDrop },
  };
}
