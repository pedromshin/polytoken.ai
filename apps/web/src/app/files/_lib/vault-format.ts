/**
 * vault-format.ts — the /files surface's display vocabulary
 * (Phase 66 Plan 03, D-66-05).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE LAW THAT DECIDES THIS FILE'S SHAPE: A FILE KIND IS GEOMETRY, NEVER HUE.
 * ────────────────────────────────────────────────────────────────────────────
 * D-58-01 law 3 gives type and role to SHAPE so that tier can own the colour
 * budget outright — and shape survives greyscale and colour-blindness, which a
 * hue system does not. So this module maps kind -> GLYPH and kind -> WORD, and
 * it contains no colour of any sort. There is no `KIND_COLOR`, and adding one
 * is exactly the "colour-coded file types" anti-generic tell (#2). Every glyph
 * renders `text-faded` at its call site.
 *
 * This is the single most likely well-intentioned regression on this surface:
 * colouring file types feels helpful, reads as polish, and quietly teaches a
 * colour key that exists nowhere else in the product. `files-law.test.ts`
 * (Plan 04) is what makes it expensive.
 *
 * `tshape-*` is deliberately NOT used here. Those are ENTITY-type shapes
 * (supplier / person / amount / document / email) with an established meaning;
 * a file kind is not an entity type, and borrowing them would smuggle a second
 * meaning into a vocabulary the user has already learned.
 */

import type { LucideIcon } from "lucide-react";
import {
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Folder,
} from "lucide-react";

import type { VaultKind } from "../../../../../../packages/api-client/src/router/files/vault-types";

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * A human byte size, rendered `tabular` at the call site.
 *
 * Returns "" — not "0 B" — for a folder (`null`) and for a broken size. Both
 * are the same honest move: the cell declines to state a size it does not
 * have, rather than stating a wrong one. "0 B" on a folder is a lie about a
 * folder; "NaN B" on a corrupt row is a bug shown to the user.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "";
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes === 0) return "0 B";

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  // One decimal max, and never a trailing ".0": `Number()` drops it, so
  // 1024 reads "1 KB" rather than "1.0 KB". Bytes never take a decimal —
  // "1.5 B" is not a thing.
  const rounded = unit === 0 ? Math.round(value) : Number(value.toFixed(1));

  return `${rounded} ${BYTE_UNITS[unit]}`;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * Month names as a LITERAL TABLE rather than `toLocaleDateString`.
 *
 * `toLocaleDateString` depends on the host's ICU data and locale: the same
 * instant renders "12 Jul 2026" on one machine and "Jul 12, 2026" on another,
 * which makes the registry's rhythm a property of whoever's laptop is running
 * it. A table is deterministic and it is the rhythm we chose.
 */
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * An absolute date — "12 Jul 2026". Never relative (D-66-05).
 *
 * Relative time ("2 days ago") is a hydration-mismatch generator: the server
 * renders one string, the client renders another a moment later, and React
 * complains. It also reads worse in a registry, where the eye is scanning a
 * column rather than asking "how long ago".
 *
 * READS UTC PARTS DELIBERATELY. Local getters would render the same ISO
 * instant as two different dates either side of midnight depending on the
 * viewer's timezone — a listing that changes its dates when you fly.
 */
export function formatVaultDate(iso: string | null | undefined): string {
  if (!iso) return "";

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// ---------------------------------------------------------------------------
// Kind -> geometry, kind -> word. No third map, and never a colour.
// ---------------------------------------------------------------------------

/**
 * The CLOSED kind -> glyph lookup. `Record<VaultKind, …>` so a new kind
 * without a glyph is a compile error rather than an `undefined` that renders
 * as an invisible gap in the row.
 */
export const KIND_GLYPH: Record<VaultKind, LucideIcon> = {
  folder: Folder,
  text: FileText,
  image: FileImage,
  archive: FileArchive,
  audio: FileAudio,
  video: FileVideo,
  file: File,
};

/**
 * The accessible name for each kind.
 *
 * Exists so the glyph is never the only carrier of meaning (anti-generic tell
 * #4: no icon without a label). It lives in `aria-label` rather than in
 * visible chrome — the row already shows the file's name, and a visible "Text
 * file" beside "notes.txt" would be the interface reading aloud to someone who
 * can already see.
 */
export const KIND_LABEL: Record<VaultKind, string> = {
  folder: "Folder",
  text: "Text file",
  image: "Image",
  archive: "Archive",
  audio: "Audio file",
  video: "Video file",
  file: "File",
};
