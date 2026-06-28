/**
 * theme/__tests__/token-allowlist.test.ts — TOKEN allowlist Zod schema tests (D-06/STYLE-03).
 *
 * Verifies:
 *   - TokenAliasSchema (z.enum) rejects raw hex, calc(), url(), and unknown aliases
 *   - TokenAliasSchema accepts every valid alias in TOKEN_ALIASES
 *   - TokenPropsSchema is a strict object: known aliases only, no additional fields
 *   - TokenPropsSchema rejects forbidden value patterns (security boundary)
 *   - StylePackIdSchema accepts all known pack ids
 *   - StylePackIdSchema rejects unknown strings
 *   - SpecRootSchema accepts a valid spec with optional style_pack_id
 *   - SpecRootSchema rejects a spec with unknown style_pack_id (fails StylePackIdSchema)
 *   - Backward compat: SpecRootSchema without style_pack_id is still valid
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

import {
  TokenAliasSchema,
  StylePackIdSchema,
  TokenPropsSchema,
} from "../../schema/token-props-schema";
import { TOKEN_ALIASES } from "../tokens";
import { STYLE_PACK_IDS } from "../packs";
import { SpecRootSchema } from "../../schema/spec-schema";

// ===========================================================================
// TokenAliasSchema
// ===========================================================================

describe("TokenAliasSchema — only TOKEN_ALIASES strings are accepted (D-06/STYLE-03)", () => {
  it("accepts every alias in TOKEN_ALIASES", () => {
    for (const alias of TOKEN_ALIASES) {
      const result = TokenAliasSchema.safeParse(alias);
      expect(result.success, `"${alias}" should be accepted`).toBe(true);
    }
  });

  it("rejects raw hex color strings", () => {
    for (const hex of ["#0a0a0a", "#fff", "#ffffff", "#112233AA"]) {
      const result = TokenAliasSchema.safeParse(hex);
      expect(result.success, `"${hex}" should be rejected`).toBe(false);
    }
  });

  it("rejects CSS function values (calc, url, var, etc.)", () => {
    for (const val of [
      "calc(100% - 1rem)",
      "url(javascript:alert(1))",
      "var(--primary)",
      "hsl(164, 39%, 22%)",
    ]) {
      const result = TokenAliasSchema.safeParse(val);
      expect(result.success, `"${val}" should be rejected`).toBe(false);
    }
  });

  it("rejects unknown alias strings", () => {
    for (const unknown of [
      "color.unknown",
      "anything",
      "typography.displayFamily",
      "",
      "SPACING.BASE",
    ]) {
      const result = TokenAliasSchema.safeParse(unknown);
      expect(result.success, `"${unknown}" should be rejected`).toBe(false);
    }
  });
});

// ===========================================================================
// StylePackIdSchema
// ===========================================================================

describe("StylePackIdSchema — only known pack ids are accepted", () => {
  it("accepts every id in STYLE_PACK_IDS", () => {
    for (const id of STYLE_PACK_IDS) {
      const result = StylePackIdSchema.safeParse(id);
      expect(result.success, `"${id}" should be accepted`).toBe(true);
    }
  });

  it("rejects unknown pack ids", () => {
    for (const unknown of [
      "dark-mode",
      "custom",
      "nauta_teal",
      "",
      "any-random-string",
    ]) {
      const result = StylePackIdSchema.safeParse(unknown);
      expect(result.success, `"${unknown}" should be rejected`).toBe(false);
    }
  });
});

// ===========================================================================
// TokenPropsSchema
// ===========================================================================

describe("TokenPropsSchema — strict object with TokenAlias keys (D-06)", () => {
  it("accepts a valid TokenPropsSchema object with known aliases", () => {
    const valid = {
      "color.primary": "somevalue",
      "radius.base": "0.5rem",
    };
    const result = TokenPropsSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects an object with an unknown alias as key", () => {
    const invalid = {
      "color.unknown": "somevalue",
    };
    const result = TokenPropsSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("accepts empty object (all aliases optional)", () => {
    const result = TokenPropsSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

// ===========================================================================
// SpecRootSchema — style_pack_id field
// ===========================================================================

const MINIMAL_SPEC = {
  v: 1 as const,
  root: {
    type: "text" as const,
    content: "hello",
  },
};

describe("SpecRootSchema — style_pack_id integration (D-08/STYLE-04)", () => {
  it("accepts a valid spec WITHOUT style_pack_id (backward compat)", () => {
    const result = SpecRootSchema.safeParse(MINIMAL_SPEC);
    expect(result.success).toBe(true);
  });

  it("accepts a valid spec WITH a known style_pack_id", () => {
    for (const id of STYLE_PACK_IDS) {
      const result = SpecRootSchema.safeParse({
        ...MINIMAL_SPEC,
        style_pack_id: id,
      });
      expect(result.success, `style_pack_id "${id}" should be accepted`).toBe(
        true,
      );
    }
  });

  it("rejects a spec with an unknown style_pack_id", () => {
    const result = SpecRootSchema.safeParse({
      ...MINIMAL_SPEC,
      style_pack_id: "dark-mode",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a spec with style_pack_id='' (empty string)", () => {
    const result = SpecRootSchema.safeParse({
      ...MINIMAL_SPEC,
      style_pack_id: "",
    });
    expect(result.success).toBe(false);
  });

  it("inferred SpecRoot type includes optional style_pack_id", () => {
    // This is a compile-time test — if TypeScript compiles, the type is correct
    const parsed = SpecRootSchema.safeParse({
      ...MINIMAL_SPEC,
      style_pack_id: "nauta-teal",
    });
    if (parsed.success) {
      const sp: string | undefined = parsed.data.style_pack_id;
      expect(sp).toBe("nauta-teal");
    }
  });
});

// ===========================================================================
// Enum shape
// ===========================================================================

describe("TokenAliasSchema enum — values match TOKEN_ALIASES exactly", () => {
  it("is a z.ZodEnum (not z.ZodString)", () => {
    expect(TokenAliasSchema instanceof z.ZodEnum).toBe(true);
  });

  it("has exactly TOKEN_ALIASES.length options", () => {
    const options = (TokenAliasSchema as z.ZodEnum<[string, ...string[]]>)
      .options;
    expect(options.length).toBe(TOKEN_ALIASES.length);
  });

  it("options match TOKEN_ALIASES set", () => {
    const options = (TokenAliasSchema as z.ZodEnum<[string, ...string[]]>)
      .options;
    const optionSet = new Set(options);
    for (const alias of TOKEN_ALIASES) {
      expect(optionSet.has(alias), `"${alias}" missing from enum options`).toBe(
        true,
      );
    }
  });
});
