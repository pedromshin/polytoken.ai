"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { VaultEntry } from "../../../../../../packages/api-client/src/router/files/vault-types";
import type { SelectIntent } from "./vault-row";
import { VaultRow } from "./vault-row";

interface VaultListingProps {
  readonly entries: readonly VaultEntry[];
  readonly onOpenFolder: (name: string) => void;
  readonly onDownload: (entry: VaultEntry) => void;
  readonly onDelete: (entry: VaultEntry) => void;
  /**
   * An `<li>` rendered at the TOP of this list — Plan 04's inline new-folder
   * row (D-66-10: a folder is created where it will live, never in a modal).
   *
   * A SLOT rather than the caller wrapping this component: `VaultListing` owns
   * the `<ul>`, and a caller-side wrapper would nest `<ul>` inside `<ul>`
   * (invalid HTML) and, worse, would put the new row OUTSIDE the element
   * carrying the roving-tabindex key handler.
   */
  readonly leadingRow?: React.ReactNode;

  // ── DR-01: multi-select + row menu (all optional — a caller that passes
  // none gets the Phase 66 selection-unaware listing, unchanged) ────────────

  /**
   * Reports the CURRENT selection (row names) whenever it changes. Selection
   * STATE and the shift-range arithmetic live HERE, in the listing, because
   * only the listing knows the rows' order — the range from a shift-click is
   * anchor→target over THIS array. The surface consumes the names to drive its
   * bulk bar.
   */
  readonly onSelectionChange?: (names: readonly string[]) => void;
  /**
   * Bumping this clears the selection — the surface bumps it after a bulk
   * action lands or on a folder change, so a stale selection never survives the
   * rows it referred to.
   */
  readonly selectionResetKey?: unknown;
  readonly onRename?: (entry: VaultEntry) => void;
  readonly onMove?: (entry: VaultEntry) => void;
  readonly onShowVersions?: (entry: VaultEntry) => void;
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
  leadingRow,
  onSelectionChange,
  selectionResetKey,
  onRename,
  onMove,
  onShowVersions,
}: VaultListingProps): React.ReactElement {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // ── DR-01 selection: names, plus the anchor a shift-range extends from ────
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const anchorRef = useRef<number | null>(null);

  // Clear on an explicit reset (bulk action landed / folder changed). Keyed on
  // the caller's token rather than on `entries` so an APPEND ("Show more")
  // never wipes a selection the user built across pages.
  useEffect(() => {
    setSelected(new Set());
    anchorRef.current = null;
  }, [selectionResetKey]);

  const emitSelection = useCallback(
    (next: ReadonlySet<string>) => {
      setSelected(next);
      onSelectionChange?.([...next]);
    },
    [onSelectionChange],
  );

  const handleSelect = useCallback(
    (index: number, intent: SelectIntent) => {
      const next = new Set(selected);

      if (intent.range && anchorRef.current !== null) {
        // Shift-click: select the contiguous run anchor→target inclusive, added
        // to whatever was already chosen (web-list convention).
        const lo = Math.min(anchorRef.current, index);
        const hi = Math.max(anchorRef.current, index);
        for (let i = lo; i <= hi; i++) {
          const name = entries[i]?.name;
          if (name) next.add(name);
        }
      } else if (intent.toggle) {
        const name = entries[index]?.name;
        if (name) {
          if (next.has(name)) next.delete(name);
          else next.add(name);
        }
        anchorRef.current = index;
      } else {
        // A shift-click with no anchor yet, or a bare modifier: seed the anchor.
        const name = entries[index]?.name;
        if (name) next.add(name);
        anchorRef.current = index;
      }

      emitSelection(next);
    },
    [selected, entries, emitSelection],
  );
  // Whether the last focus move came from the keyboard. Prevents stealing
  // focus on mount: a page that grabs focus into a list on arrival fights
  // anyone who arrived intending to type somewhere else.
  const shouldFocusRef = useRef(false);

  /**
   * Reset when the CONTENTS change — but not when they merely GROW.
   *
   * Keyed on the entries' identity rather than their length: walking from a
   * 5-row folder into another 5-row folder must still return focus to the
   * top, and a length check would not notice.
   *
   * THE APPEND EXCEPTION (v2.1 pagination): "Show more" hands this component
   * the same rows plus a new page on the end. Resetting then would teleport
   * the roving row from the bottom of the list — exactly where the user was
   * reading — back to the top, on every page. An append is detected by name
   * prefix: the old first-and-last names still sitting at the same positions.
   * Cheap (two comparisons), and wrong only for a change that REPLACES rows
   * while preserving both sentinels and the count-prefix — where keeping the
   * user's position is a fine outcome anyway.
   */
  const previousNamesRef = useRef<readonly string[]>([]);
  useEffect(() => {
    const previous = previousNamesRef.current;
    previousNamesRef.current = entries.map((entry) => entry.name);

    const isAppend =
      previous.length > 0 &&
      entries.length >= previous.length &&
      entries[0]?.name === previous[0] &&
      entries[previous.length - 1]?.name === previous[previous.length - 1];

    if (isAppend) return;

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
      {leadingRow}

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
          selected={selected.has(entry.name)}
          onSelect={onSelectionChange ? (intent) => handleSelect(index, intent) : undefined}
          onRename={onRename}
          onMove={onMove}
          onShowVersions={onShowVersions}
        />
      ))}
    </ul>
  );
}
