/**
 * theme/__tests__/packs.test.ts — Style pack library validation (STYLE-01/02/03/D-02/D-03)
 *
 * Verifies:
 *   - STYLE_PACKS contains >=5 distinct entries with unique ids
 *   - "polytoken-teal" is present and flagged as the default/baseline pack
 *   - Every pack defines a value for EVERY alias in TOKEN_ALIASES (completeness)
 *   - Every pack's color values are HSL channel-triplet strings, NOT raw hex or prose
 *   - polytoken-teal reproduces the current baseline (--primary "164 39% 22%", --radius "0.5rem")
 *   - getStylePack(id) returns the correct pack; getStylePack(unknown) returns default baseline
 */

import { describe, it, expect } from "vitest";

import {
  STYLE_PACKS,
  STYLE_PACK_IDS,
  DEFAULT_PACK_ID,
  getStylePack,
} from "../packs";
import { TOKEN_ALIASES, TOKEN_ALIAS_TO_CSS_VAR } from "../tokens";
import type { TokenAlias } from "../tokens";
import { contrastRatio } from "./contrast";

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

  it("polytoken-teal is present in STYLE_PACKS", () => {
    expect("polytoken-teal" in STYLE_PACKS).toBe(true);
  });

  it("DEFAULT_PACK_ID is 'polytoken-teal'", () => {
    expect(DEFAULT_PACK_ID).toBe("polytoken-teal");
  });

  it("polytoken-teal pack is flagged as default in its metadata", () => {
    const pack = STYLE_PACKS["polytoken-teal"];
    expect(pack.isDefault).toBe(true);
  });

  it("all other packs are NOT flagged as default", () => {
    for (const [id, pack] of Object.entries(STYLE_PACKS)) {
      if (id !== "polytoken-teal") {
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

describe("polytoken-teal baseline reproduces globals.css :root values (D-02)", () => {
  it("--primary maps to '164 39% 22%'", () => {
    const pack = STYLE_PACKS["polytoken-teal"];
    expect(pack.tokens["color.primary"]).toBe("164 39% 22%");
  });

  it("--radius maps to '0.5rem'", () => {
    const pack = STYLE_PACKS["polytoken-teal"];
    expect(pack.tokens["radius.base"]).toBe("0.5rem");
  });

  it("--background maps to '0 0% 100%'", () => {
    const pack = STYLE_PACKS["polytoken-teal"];
    expect(pack.tokens["color.background"]).toBe("0 0% 100%");
  });

  it("--foreground maps to '0 0% 3.9%'", () => {
    const pack = STYLE_PACKS["polytoken-teal"];
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

  it("returns the default baseline (polytoken-teal) for an unknown id", () => {
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

// ===========================================================================
// WCAG-AA contrast — semantic status pairs (48-01/D-48-02)
//
// Named array (not a one-off loop) so future plans (e.g. 48-02's tier-ladder
// and graph node/edge pairs) can append to this SAME loop instead of standing
// up a parallel contrast-gate mechanism.
// ===========================================================================

const SEMANTIC_STATUS_PAIRS: ReadonlyArray<{
  readonly label: string;
  readonly background: TokenAlias;
  readonly foreground: TokenAlias;
}> = [
  {
    label: "success",
    background: "color.success",
    foreground: "color.successForeground",
  },
  // 48-02: tier-ladder pairs (D-48-04)
  {
    label: "tier-extracted",
    background: "color.tier.extracted",
    foreground: "color.tier.extractedForeground",
  },
  {
    label: "tier-inferred",
    background: "color.tier.inferred",
    foreground: "color.tier.inferredForeground",
  },
  // 48-02: closed graph node-type palette pairs (D-48-05)
  {
    label: "graph-entity",
    background: "color.graph.entity",
    foreground: "color.graph.entityForeground",
  },
  {
    label: "graph-emailComponent",
    background: "color.graph.emailComponent",
    foreground: "color.graph.emailComponentForeground",
  },
  {
    label: "graph-email",
    background: "color.graph.email",
    foreground: "color.graph.emailForeground",
  },
];

describe("WCAG-AA contrast — semantic status pairs (D-48-02)", () => {
  for (const [packId, pack] of Object.entries(STYLE_PACKS)) {
    for (const pair of SEMANTIC_STATUS_PAIRS) {
      it(`pack "${packId}" ${pair.label} pair passes >= 4.5:1`, () => {
        const backgroundValue = pack.tokens[pair.background] as string;
        const foregroundValue = pack.tokens[pair.foreground] as string;
        const ratio = contrastRatio(backgroundValue, foregroundValue);
        expect(
          ratio,
          `pack "${packId}" ${pair.label} pair (background "${backgroundValue}" / foreground "${foregroundValue}") computed ratio ${ratio.toFixed(2)}:1 is below the 4.5:1 WCAG-AA floor`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

// ===========================================================================
// Token-family registration — every alias resolves to a non-empty CSS var
// (D-48-08 regression: catches "var exists but utility never registered")
// ===========================================================================

describe("Token-family registration — every alias resolves to a non-empty CSS var", () => {
  for (const [packId, pack] of Object.entries(STYLE_PACKS)) {
    it(`pack "${packId}" resolves every TOKEN_ALIAS via TOKEN_ALIAS_TO_CSS_VAR + resolvedVars`, () => {
      for (const alias of TOKEN_ALIASES) {
        const cssVar = TOKEN_ALIAS_TO_CSS_VAR[alias];
        expect(
          cssVar,
          `TOKEN_ALIAS_TO_CSS_VAR is missing an entry for alias "${alias}"`,
        ).toBeDefined();

        const resolved = pack.resolvedVars[cssVar];
        expect(
          typeof resolved,
          `pack "${packId}" resolvedVars["${cssVar}"] (alias "${alias}") must be a string — resolveVars() may be missing this alias`,
        ).toBe("string");
        expect(
          (resolved as string).length,
          `pack "${packId}" resolvedVars["${cssVar}"] (alias "${alias}") must not be empty`,
        ).toBeGreaterThan(0);
      }
    });
  }
});
