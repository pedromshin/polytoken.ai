/**
 * vault-format.test.ts — the vault's display vocabulary (Phase 66 Plan 03 Task 1).
 *
 * The exhaustiveness test at the bottom is the one that matters long-term: it
 * iterates a literal list of every `VaultKind` that this test file OWNS, so
 * adding a kind without a glyph is a red test rather than an `undefined` that
 * renders as nothing on a row.
 */

import { describe, expect, it } from "vitest";

import type { VaultKind } from "../../../../../../../packages/api-client/src/router/files/vault-types";
import {
  formatBytes,
  formatVaultDate,
  KIND_GLYPH,
  KIND_LABEL,
} from "../vault-format";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1, "1 B"],
    [512, "512 B"],
    [1023, "1023 B"],
    [1024, "1 KB"],
    [1536, "1.5 KB"],
    [1048576, "1 MB"],
    [1073741824, "1 GB"],
    // The cap, so the number the user sees at the limit is the number the
    // error will name back to them.
    [100 * 1024 * 1024, "100 MB"],
  ])("formats %i as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it("never renders a trailing .0 — '1 KB', not '1.0 KB'", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1048576)).toBe("1 MB");
  });

  it("keeps at most one decimal", () => {
    // 1honest.3 KB, not 1.333984375 KB.
    expect(formatBytes(1366)).toBe("1.3 KB");
    expect(formatBytes(1587)).toBe("1.5 KB");
  });

  it("renders nothing for a folder — the cell is EMPTY, never '0 B'", () => {
    // "0 B" on a folder is a lie about a folder: it states a size that does
    // not exist rather than declining to state one.
    expect(formatBytes(null)).toBe("");
  });

  it("renders nothing for a broken size, never 'NaN B'", () => {
    expect(formatBytes(Number.NaN)).toBe("");
    expect(formatBytes(-1)).toBe("");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("formatVaultDate", () => {
  it("formats absolute, never relative", () => {
    // D-66-05: absolute is the registry rhythm, and it sidesteps
    // relative-time's hydration-mismatch generator entirely.
    expect(formatVaultDate("2026-07-12T10:00:00Z")).toBe("12 Jul 2026");
  });

  it("is stable regardless of the machine's timezone", () => {
    // PINNED DELIBERATELY. A naive implementation using local getters renders
    // this instant as 31 Dec 2025 west of UTC and 1 Jan 2026 east of it — a
    // test that passes in CI and fails on a laptop in São Paulo at 23:00.
    // The implementation reads UTC parts, so the ISO instant IS the date.
    expect(formatVaultDate("2026-01-01T00:30:00Z")).toBe("1 Jan 2026");
    expect(formatVaultDate("2025-12-31T23:30:00Z")).toBe("31 Dec 2025");
  });

  it("is not locale-dependent", () => {
    // The month name comes from a literal table, not toLocaleDateString —
    // whose output depends on ICU data and the host locale (en-US would give
    // "Jul 12, 2026").
    expect(formatVaultDate("2026-03-09T12:00:00Z")).toBe("9 Mar 2026");
  });

  it("renders nothing for null", () => {
    expect(formatVaultDate(null)).toBe("");
  });

  it("renders nothing for an unparseable string, never 'Invalid Date'", () => {
    expect(formatVaultDate("not-a-date")).toBe("");
    expect(formatVaultDate("")).toBe("");
  });
});

describe("KIND_GLYPH / KIND_LABEL", () => {
  /**
   * THE UNION, WRITTEN OUT, OWNED BY THIS TEST.
   *
   * ────────────────────────────────────────────────────────────────────────
   * WHERE THE EXHAUSTIVENESS GATE ACTUALLY LIVES — MEASURED, NOT ASSUMED
   * ────────────────────────────────────────────────────────────────────────
   * It is `tsc`, not vitest. Verified by adding an eighth kind
   * (`"spreadsheet"`) to `VaultKind` and leaving the maps alone:
   *
   *   tsc     -> RED. TS2741 on BOTH maps: "Property 'spreadsheet' is missing
   *              in type ... but required in type 'Record<VaultKind, …>'".
   *   vitest  -> GREEN, all 21. It cannot see it.
   *
   * That is not a flaw to route around; it is how TypeScript works. A union
   * does not exist at runtime, so this array is a hand-copy of it, and a
   * hand-copy cannot notice that the original grew. `npx tsc --noEmit` is in
   * this lane's bar precisely so gates like this one are real.
   *
   * So the two `satisfies`/`Exclude` checks below are the load-bearing half,
   * and they pin BOTH directions:
   *   - `satisfies readonly VaultKind[]` — no PHANTOM kind in this array;
   *   - `AllKindsCovered`               — no MISSING kind from this array.
   * Without the second one, this list silently rots the day a kind is added,
   * and the runtime tests below would keep passing while checking six of
   * seven.
   *
   * The runtime tests remain worth their keep for what tsc does NOT check:
   * that no map has an extra key, and that no entry is a falsy value.
   */
  const ALL_KINDS = [
    "folder",
    "text",
    "image",
    "archive",
    "audio",
    "video",
    "file",
  ] as const satisfies readonly VaultKind[];

  /** Compile error if `VaultKind` grows and `ALL_KINDS` does not follow. */
  type MissingKinds = Exclude<VaultKind, (typeof ALL_KINDS)[number]>;
  const _allKindsCovered: MissingKinds extends never ? true : never = true;
  void _allKindsCovered;

  it("every VaultKind has a glyph — an unmapped kind renders nothing at all", () => {
    for (const kind of ALL_KINDS) {
      expect(KIND_GLYPH[kind], `no glyph for kind: ${kind}`).toBeDefined();
    }
    expect(Object.keys(KIND_GLYPH).sort()).toEqual([...ALL_KINDS].sort());
  });

  it("every VaultKind has an accessible label", () => {
    // The glyph is never the only carrier of meaning (anti-generic tell #4:
    // no icon without a name). The label lives in aria-label, not in visible
    // chrome — the row is already carrying the file's name.
    for (const kind of ALL_KINDS) {
      expect(KIND_LABEL[kind], `no label for kind: ${kind}`).toBeTruthy();
    }
    expect(Object.keys(KIND_LABEL).sort()).toEqual([...ALL_KINDS].sort());
  });

  it("maps folder and file kinds to distinct glyphs — kind is GEOMETRY (law 3)", () => {
    expect(KIND_GLYPH.folder).not.toBe(KIND_GLYPH.file);
    expect(KIND_GLYPH.image).not.toBe(KIND_GLYPH.text);
  });
});
