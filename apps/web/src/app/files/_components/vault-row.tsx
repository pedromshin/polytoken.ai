"use client";

// Explicit React import — vitest's classic-runtime esbuild JSX transform needs
// `React` in scope for any suite mounting this directly (documented gotcha).
import * as React from "react";
import { Trash2 } from "lucide-react";

import { cn } from "@polytoken/ui";

import type { VaultEntry } from "../../../../../../packages/api-client/src/router/files/vault-types";
import {
  formatBytes,
  formatVaultDate,
  KIND_GLYPH,
  KIND_LABEL,
} from "../_lib/vault-format";

interface VaultRowProps {
  readonly entry: VaultEntry;
  readonly isFocused: boolean;
  readonly onActivate: (entry: VaultEntry) => void;
  readonly onDelete: (entry: VaultEntry) => void;
  readonly onFocus: () => void;
}

/**
 * VaultRow — one line of the registry (Phase 66 Plan 03 Task 3).
 *
 *   [glyph]  Name of the thing            1.5 KB    12 Jul 2026   [trash]
 *    faded   sans / text-ink, truncate    tabular   tabular       hover
 *                                         pencil    pencil        /focus
 *
 * Folder rows: glyph=Folder, no size, primary action = walk in.
 * File rows:   glyph=kind,   size shown, primary action = download.
 *
 * LAW 2: the name is SANS. Nothing on this surface came out of the user's
 * mail, so nothing here is evidence — file names are METADATA/chrome
 * (D-66-05). No `font-serif`, no `pmark`, no `chip`, no `data-evidence`
 * anywhere under `files/`; `files-law.test.ts` (Plan 04) asserts their
 * absence, so the day a text-file preview arrives this goes red and forces the
 * re-decision rather than letting serif drift onto chrome silently.
 *
 * LAW 3: the kind glyph is GEOMETRY in `text-faded`. Never a hue.
 */
export function VaultRow({
  entry,
  isFocused,
  onActivate,
  onDelete,
  onFocus,
}: VaultRowProps): React.ReactElement {
  const Glyph = KIND_GLYPH[entry.kind];

  return (
    <li className="group border-b border-hair last:border-b-0">
      <div className="flex items-center">
        <button
          type="button"
          data-slot="vault-row-primary"
          // ROVING TABINDEX: exactly one row is in the tab order at a time.
          // Without this, a 500-file vault puts 500 stops between the
          // breadcrumb and anything after the list.
          tabIndex={isFocused ? 0 : -1}
          onFocus={onFocus}
          onClick={() => onActivate(entry)}
          aria-label={`${KIND_LABEL[entry.kind]}: ${entry.name}`}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 px-row-x py-row-y text-left",
            // Hover fill is `--shade`, the identity's well step.
            "transition-colors hover:bg-shade",
            // FOCUS IS AN OUTLINE, NEVER A RING. `--tw-ring-offset-color`
            // defaults to white, which paints a halo in dark (D-61-03-F —
            // globals.css says so in its own words). `outline-solid` is what
            // evicts any inherited `outline-none` that tailwind-merge would
            // otherwise let win against `outline-2`.
            "outline-solid focus-visible:outline-2 focus-visible:outline-ink",
            "pointer-coarse:touch-target",
          )}
        >
          <Glyph className="size-4 shrink-0 text-faded" aria-hidden />

          {/* A plain React text node — escaped by default. File names are
              attacker-controlled strings (T-66-06); they are never
              interpolated into a class, a style, or dangerouslySetInnerHTML. */}
          <span className="min-w-0 flex-1 truncate text-base text-ink">
            {entry.name}
          </span>

          {/* THE CONTRAST PAIR, AND IT IS A REAL BUG IF YOU SPLIT IT:
              `text-pencil` is legal on `--leaf`/`--bright` but NOT on
              `--shade` (4.23:1, below AA — brand-guide §3). The row's hover
              fill IS `bg-shade`, so the meta MUST step up to `text-faded` on
              hover. Change one of these two without the other and the size and
              date silently fail AA for as long as the pointer rests there. */}
          <span
            className={cn(
              "tabular shrink-0 text-sm text-pencil transition-colors",
              "group-hover:text-faded",
            )}
          >
            {formatBytes(entry.size)}
          </span>
          <span
            className={cn(
              "tabular hidden shrink-0 text-sm text-pencil transition-colors sm:block",
              "group-hover:text-faded",
            )}
          >
            {formatVaultDate(entry.updatedAt)}
          </span>
        </button>

        <button
          type="button"
          data-slot="vault-row-delete"
          onClick={() => onDelete(entry)}
          aria-label={`Delete ${entry.name}`}
          // Taste item 3 — the key is declared where the user can find it,
          // not buried in a changelog.
          aria-keyshortcuts="Delete"
          title={`Delete ${entry.name} · Del`}
          className={cn(
            "mr-2 flex shrink-0 items-center justify-center rounded-md p-2",
            // Revealed by hover OR focus-within, and ALWAYS in the DOM.
            // `opacity-0` — never `hidden`, never `{hovered && …}`: both put
            // the control out of reach of a keyboard and a screen reader.
            "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100",
            // On touch there is no hover, and a hidden action is simply gone.
            "pointer-coarse:opacity-100 pointer-coarse:touch-target",
            // INK, not madder. Opening a confirm is cancellable, so it has
            // earned no colour (D-66-05). The one madder control on this whole
            // surface is the dialog's own Delete button.
            "text-faded hover:bg-shade hover:text-ink",
            "outline-solid focus-visible:outline-2 focus-visible:outline-ink",
          )}
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>
    </li>
  );
}
