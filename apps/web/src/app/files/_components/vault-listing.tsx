"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { VaultEntry } from "../../../../../../packages/api-client/src/router/files/vault-types";
import { VaultRow } from "./vault-row";

interface VaultListingProps {
  readonly entries: readonly VaultEntry[];
  readonly onOpenFolder: (name: string) => void;
  readonly onDownload: (entry: VaultEntry) => void;
  readonly onDelete: (entry: VaultEntry) => void;
}

/**
 * VaultListing — the registry, and its keyboard (Phase 66 Plan 03 Task 3).
 *
 * D-66-10's budget, made real:
 *   scan the vault  -> 0 clicks (ArrowUp/ArrowDown)
 *   act on the row  -> 1 keystroke (Enter) or 1 click (the row body)
 *   delete          -> 1 keystroke (Delete) or 1 click (the row's trigger)
 * No menu stands between the user and any of it.
 *
 * ROVING TABINDEX, not 500 tab stops. `focusedIndex` names the one row in the
 * tab order; arrows move DOM focus imperatively. The alternative — every row
 * tabbable — is the accessibility failure this pattern exists to prevent.
 *
 * The list SCROLLS WITH THE PAGE. No Radix ScrollArea (D-66-05): its Viewport
 * shrink-wraps via `display:table` (D-61-06). Sidestepped by construction.
 */
export function VaultListing({
  entries,
  onOpenFolder,
  onDownload,
  onDelete,
}: VaultListingProps): React.ReactElement {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  // Whether the last focus move came from the keyboard. Prevents stealing
  // focus on mount: a page that grabs focus into a list on arrival fights
  // anyone who arrived intending to type somewhere else.
  const shouldFocusRef = useRef(false);

  /**
   * Reset when the FOLDER changes. Keyed on the entries' identity rather than
   * their length: walking from a 5-row folder into another 5-row folder must
   * still return focus to the top, and a length check would not notice.
   */
  useEffect(() => {
    setFocusedIndex(0);
    shouldFocusRef.current = false;
  }, [entries]);

  /** Move DOM focus to the row the state names — only for keyboard moves. */
  useEffect(() => {
    if (!shouldFocusRef.current) return;
    const rows = listRef.current?.querySelectorAll<HTMLButtonElement>(
      "[data-slot='vault-row-primary']",
    );
    rows?.[focusedIndex]?.focus();
  }, [focusedIndex]);

  const move = useCallback((next: number) => {
    shouldFocusRef.current = true;
    setFocusedIndex(next);
  }, []);

  const activate = useCallback(
    (entry: VaultEntry) => {
      if (entry.isFolder) onOpenFolder(entry.name);
      else onDownload(entry);
    },
    [onOpenFolder, onDownload],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLUListElement>) => {
      const last = entries.length - 1;
      const current = entries[focusedIndex];

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          // CLAMPED, NOT WRAPPED. Wrapping teleports the user from the bottom
          // of a file list to the top, which reads as a bug.
          move(Math.min(focusedIndex + 1, last));
          break;
        case "ArrowUp":
          event.preventDefault();
          move(Math.max(focusedIndex - 1, 0));
          break;
        case "Home":
          event.preventDefault();
          move(0);
          break;
        case "End":
          event.preventDefault();
          move(last);
          break;
        case "Enter":
          if (current) {
            event.preventDefault();
            activate(current);
          }
          break;
        case "Delete":
          if (current) {
            event.preventDefault();
            onDelete(current);
          }
          break;
        default:
          break;
      }
    },
    [entries, focusedIndex, move, activate, onDelete],
  );

  return (
    <ul
      ref={listRef}
      data-slot="vault-listing"
      onKeyDown={handleKeyDown}
      className="flex flex-col"
    >
      {entries.map((entry, index) => (
        <VaultRow
          key={entry.name}
          entry={entry}
          isFocused={index === focusedIndex}
          onActivate={activate}
          onDelete={onDelete}
          // Clicking or tabbing to a row makes it the roving row, so the
          // keyboard picks up from wherever the mouse left off rather than
          // jumping back to a position the user has forgotten about.
          onFocus={() => setFocusedIndex(index)}
        />
      ))}
    </ul>
  );
}
