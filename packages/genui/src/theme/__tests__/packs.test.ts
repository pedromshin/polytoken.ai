/**
 * theme/__tests__/packs.test.ts — Style pack library validation (STYLE-01/02/03/D-02/D-03)
 *
 * Verifies:
 *   - STYLE_PACKS contains >=5 distinct entries with unique ids
 *   - "nauta-teal" is present and flagged as the default/baseline pack
 *   - Every pack defines a value for EVERY alias in TOKEN_ALIASES (completeness)
 *   - Every pack's color values are HSL channel-triplet strings, NOT raw hex or prose
 *   - nauta-teal reproduces the current baseline (--primary "164 39% 22%", --radius "0.5rem")
 *   - getStylePack(id) returns the correct pack; getStylePack(unknown) returns default baseline
 */

import { describe, it, expect } from "vitest";

import {
  STYLE_PACKS,
  STYLE_PACK_IDS,
  DEFAULT_PACK_ID,
  getStylePack,
} from "../packs";
import { TOKEN_ALIASES } from "../tokens";

/** HSL channel-triplet pattern: "H S% L%" — no leading # or prose */
const HSL_TRIPLET_RE = /^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/;

/** Token alias groups that hold color values (HSL triplets) */
const COLOR_ALIASES = TOKEN_ALIASES.filter((a) => a.startsWith("color."));

/** Token alias groups that hold non-color values (radius/spacing/shadow/typography) */
const NON_COLOR_ALIASES = TOKEN_ALIASES.filter((a) => !a.startsWith("color."));

describe("STYLE_PACKS registry (STYLE-01/02/03)", () => {
  it("contains >= 5 distinct entries", () => {
    expect(STYLE_PACK_IDS.length).toBeGreaterThanOrEqual(5);
  });

  it("pack ids are unique lowercase-kebab slugs", () => {
    const idSet = new Set(STYLE_PACK_IDS);
    expect(idSet.size).toBe(STYLE_PACK_IDS.length);
    for (const id of STYLE_PACK_IDS) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("nauta-teal is present in STYLE_PACKS", () => {
    expect("nauta-teal" in STYLE_PACKS).toBe(true);
  });

  it("DEFAULT_PACK_ID is 'nauta-teal'", () => {
    expect(DEFAULT_PACK_ID).toBe("nauta-teal");
  });

  it("nauta-teal pack is flagged as default in its metadata", () => {
    const pack = STYLE_PACKS["nauta-teal"];
    expect(pack.isDefault).toBe(true);
  });

  it("all other packs are NOT flagged as default", () => {
    for (const [id, pack] of Object.entries(STYLE_PACKS)) {
      if (id !== "nauta-teal") {
        expect(pack.isDefault).toBeFalsy();
      }
    }
  });
});

describe("Pack completeness — every alias in TOKEN_ALIASES is defined per pack", () => {
  for (const [packId, pack] of Object.entries(STYLE_PACKS)) {
    it(`pack "${packId}" defines every TOKEN_ALIAS`, () => {
      for (const alias of TOKEN_ALIASES) {
        expect(
          pack.tokens[alias],
          `pack "${packId}" is missing alias "${alias}"`,
        ).toBeDefined();
        expect(
          typeof pack.tokens[alias],
          `pack "${packId}" alias "${alias}" must be a string`,
        ).toBe("string");
        expect(
          (pack.tokens[alias] as string).length,
          `pack "${packId}" alias "${alias}" must not be empty`,
        ).toBeGreaterThan(0);
      }
    });
  }
});

describe("Color values are HSL channel-triplets — no raw hex, no prose (D-03/STYLE-03)", () => {
  for (const [packId, pack] of Object.entries(STYLE_PACKS)) {
    it(`pack "${packId}" uses HSL triplets for all color aliases`, () => {
      for (const alias of COLOR_ALIASES) {
        const value = pack.tokens[alias] as string;
        expect(
          HSL_TRIPLET_RE.test(value),
          `pack "${packId}" alias "${alias}" value "${value}" is not a valid HSL triplet (H S% L%)`,
        ).toBe(true);
        // Ensure no raw hex
        expect(
          value,
          `pack "${packId}" alias "${alias}" must not contain raw hex`,
        ).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      }
    });
  }
});

describe("nauta-teal baseline reproduces globals.css :root values (D-02)", () => {
  it("--primary maps to '164 39% 22%'", () => {
    const pack = STYLE_PACKS["nauta-teal"];
    expect(pack.tokens["color.primary"]).toBe("164 39% 22%");
  });

  it("--radius maps to '0.5rem'", () => {
    const pack = STYLE_PACKS["nauta-teal"];
    expect(pack.tokens["radius.base"]).toBe("0.5rem");
  });

  it("--background maps to '0 0% 100%'", () => {
    const pack = STYLE_PACKS["nauta-teal"];
    expect(pack.tokens["color.background"]).toBe("0 0% 100%");
  });

  it("--foreground maps to '0 0% 3.9%'", () => {
    const pack = STYLE_PACKS["nauta-teal"];
    expect(pack.tokens["color.foreground"]).toBe("0 0% 3.9%");
  });
});

describe("getStylePack — look up and fallback behavior", () => {
  it("returns the correct pack for a known id", () => {
    for (const id of STYLE_PACK_IDS) {
      const pack = getStylePack(id);
      expect(pack).toBe(STYLE_PACKS[id]);
    }
  });

  it("returns the default baseline (nauta-teal) for an unknown id", () => {
    const pack = getStylePack("this-pack-does-not-exist");
    expect(pack).toBe(STYLE_PACKS[DEFAULT_PACK_ID]);
  });

  it("never throws — even for empty or weird inputs", () => {
    expect(() => getStylePack("")).not.toThrow();
    expect(() => getStylePack("!@#$%")).not.toThrow();
    expect(() => getStylePack("__proto__")).not.toThrow();
  });
});

describe("Non-color token aliases have non-empty string values", () => {
  for (const [packId, pack] of Object.entries(STYLE_PACKS)) {
    it(`pack "${packId}" non-color aliases are valid strings`, () => {
      for (const alias of NON_COLOR_ALIASES) {
        const value = pack.tokens[alias] as string;
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    });
  }
});
