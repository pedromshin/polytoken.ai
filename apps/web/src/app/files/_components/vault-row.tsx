"use client";

// Explicit React import — vitest's classic-runtime esbuild JSX transform needs
// `React` in scope for any suite mounting this directly (documented gotcha).
import * as React from "react";
import { FolderInput, History, Pencil, Trash2 } from "lucide-react";

import { cn } from "@polytoken/ui";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@polytoken/ui/context-menu";

import type { VaultEntry } from "../../../../../../packages/api-client/src/router/files/vault-types";
import {
  formatBytes,
  formatProvenance,
  KIND_GLYPH,
  KIND_LABEL,
} from "../_lib/vault-format";

/** How a modifier-click on a row's body is meant (DR-01 multi-select). */
export type SelectIntent = { readonly range: boolean; readonly toggle: boolean };

interface VaultRowProps {
  readonly entry: VaultEntry;
  readonly isFocused: boolean;
  readonly onActivate: (entry: VaultEntry) => void;
  readonly onDelete: (entry: VaultEntry) => void;
  readonly onFocus: () => void;
  /** DR-01: whether this row is part of the current selection. */
  readonly selected?: boolean;
  /**
   * DR-01: a MODIFIER-click on the row body (shift = range, cmd/ctrl = toggle).
   * When absent the row is selection-unaware and a plain click always
   * activates — the Phase 66 behaviour, unchanged.
   */
  readonly onSelect?: (intent: SelectIntent) => void;
  /** DR-01 row menu: rename in place. */
  readonly onRename?: (entry: VaultEntry) => void;
  /** DR-01 row menu: move to another folder. */
  readonly onMove?: (entry: VaultEntry) => void;
  /** DR-02 row menu: open this file's version history. */
  readonly onShowVersions?: (entry: VaultEntry) => void;
}

/**
 * VaultRow — one line of the registry (Phase 66 Plan 03; DR-01/02 row menu +
 * multi-select).
 *
 *   [glyph]  Name of the thing                        1.5 KB    [trash]
 *
 * MULTI-SELECT IS MODIFIER-CLICK, NOT A CHECKBOX (DR-01). A plain click still
 * opens/downloads in one move (D-66-10's budget, `vault-listing.test.tsx`'s
 * click-economy gate). Shift-click extends a range; cmd/ctrl-click toggles one
 * row. No permanent checkbox column — that would tax every scan with chrome the
 * common case never uses. Selection shows as the well fill (`--shade`), the
 * same ink language the hover already speaks.
 *
 * THE ROW MENU IS RIGHT-CLICK (DR-01/02), the vendored Radix ContextMenu. It is
 * PURELY ADDITIVE: every action it offers (rename, move, version history,
 * delete) also has a direct path, so the menu is a convenience, never the only
 * way — the "…-then-Open" two-step the click-economy gate forbids is still
 * forbidden. Its items are INK; the one madder control on this surface stays the
 * delete dialog's confirm.
 *
 * LAW 2/3 unchanged: the name is SANS (nothing here is evidence), the kind glyph
 * is GEOMETRY in `text-faded`, never a hue.
 */
export function VaultRow({
  entry,
  isFocused,
  onActivate,
  onDelete,
  onFocus,
  selected = false,
  onSelect,
  onRename,
  onMove,
  onShowVersions,
}: VaultRowProps): React.ReactElement {
  const Glyph = KIND_GLYPH[entry.kind];

  const handlePrimaryClick = (event: React.MouseEvent) => {
    // A modifier-click is a SELECTION gesture, not an open — intercept it before
    // activation so shift/cmd never accidentally walks into a folder.
    if (onSelect && (event.shiftKey || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSelect({ range: event.shiftKey, toggle: event.metaKey || event.ctrlKey });
      return;
    }
    onActivate(entry);
  };

  const hasMenu = Boolean(onRename || onMove || onShowVersions);

  const rowBody = (
    <div className="flex items-center" data-selected={selected ? "true" : "false"}>
      <button
        type="button"
        data-slot="vault-row-primary"
        // ROVING TABINDEX: exactly one row is in the tab order at a time.
        tabIndex={isFocused ? 0 : -1}
        aria-selected={onSelect ? selected : undefined}
        onFocus={onFocus}
        onClick={handlePrimaryClick}
        aria-label={`${KIND_LABEL[entry.kind]}: ${entry.name}`}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 px-row-x py-row-y text-left",
          // Selected persists the well fill; hover is the same step, so the two
          // read as one language rather than fighting.
          "transition-colors hover:bg-shade",
          selected && "bg-shade",
          // FOCUS IS AN OUTLINE, NEVER A RING (D-61-03-F). `outline-solid`
          // evicts any inherited `outline-none` tailwind-merge would let win.
          "outline-solid focus-visible:outline-2 focus-visible:outline-ink",
          "pointer-coarse:touch-target",
        )}
      >
        <Glyph className="size-4 shrink-0 text-faded" aria-hidden />

        <span className="flex min-w-0 flex-1 flex-col">
          {/* A plain React text node — escaped by default. File names are
              attacker-controlled strings (T-66-06); never interpolated into a
              class, a style, or dangerouslySetInnerHTML. */}
          <span className="min-w-0 truncate text-base text-ink">{entry.name}</span>

          {!entry.isFolder ? (
            <span
              data-slot="vault-row-provenance"
              className={cn(
                "tabular min-w-0 truncate text-xs text-pencil transition-colors",
                "group-hover:text-faded",
              )}
            >
              {formatProvenance(entry.updatedAt)}
            </span>
          ) : null}
        </span>

        {/* THE CONTRAST PAIR (see Phase 66): text-pencil is below AA on
            --shade, so the meta steps up to text-faded on hover. Selection also
            paints --shade, so it steps up when selected too. */}
        <span
          className={cn(
            "tabular shrink-0 text-sm text-pencil transition-colors",
            "group-hover:text-faded",
            selected && "text-faded",
          )}
        >
          {formatBytes(entry.size)}
        </span>
      </button>

      <button
        type="button"
        data-slot="vault-row-delete"
        onClick={() => onDelete(entry)}
        aria-label={`Delete ${entry.name}`}
        aria-keyshortcuts="Delete"
        title={`Delete ${entry.name} · Del`}
        className={cn(
          "mr-2 flex shrink-0 items-center justify-center rounded-md p-2",
          // Revealed by hover OR focus-within, and ALWAYS in the DOM.
          "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100",
          "pointer-coarse:opacity-100 pointer-coarse:touch-target",
          // INK, not madder — opening the confirm is cancellable.
          "text-faded hover:bg-shade hover:text-ink",
          "outline-solid focus-visible:outline-2 focus-visible:outline-ink",
        )}
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    </div>
  );

  return (
    <li className="group border-b border-hair last:border-b-0">
      {hasMenu ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{rowBody}</ContextMenuTrigger>
          <ContextMenuContent data-slot="vault-row-menu" className="w-48">
            {onRename ? (
              <ContextMenuItem data-slot="menu-rename" onSelect={() => onRename(entry)}>
                <Pencil className="mr-2 size-4 text-faded" aria-hidden />
                Rename
              </ContextMenuItem>
            ) : null}
            {onMove ? (
              <ContextMenuItem data-slot="menu-move" onSelect={() => onMove(entry)}>
                <FolderInput className="mr-2 size-4 text-faded" aria-hidden />
                Move to…
              </ContextMenuItem>
            ) : null}
            {onShowVersions && !entry.isFolder ? (
              <ContextMenuItem
                data-slot="menu-versions"
                onSelect={() => onShowVersions(entry)}
              >
                <History className="mr-2 size-4 text-faded" aria-hidden />
                Version history
              </ContextMenuItem>
            ) : null}
            <ContextMenuSeparator />
            <ContextMenuItem data-slot="menu-delete" onSelect={() => onDelete(entry)}>
              <Trash2 className="mr-2 size-4 text-faded" aria-hidden />
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        rowBody
      )}
    </li>
  );
}
