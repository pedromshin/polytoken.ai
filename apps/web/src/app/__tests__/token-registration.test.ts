import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readTokenBlock } from "./token-contrast.test";

/**
 * Committed token-family-registration regression gate (28-01-PLAN.md Task 3,
 * rewritten 55-03-PLAN.md Task 2 for the Tailwind v4 migration, extended
 * 59-01-PLAN.md Task 3 for D-58-01's identity ladder).
 *
 * Guards the "CSS var exists but Tailwind utility was never registered" bug
 * class (28-VERIFICATION gap, closed in 69c3afa): the `--sidebar-*` vars
 * were correctly aliased to teal tokens in globals.css, yet
 * `bg-sidebar`/`ring-sidebar-ring` emitted no CSS because no `sidebar`
 * color family existed in the config that actually compiles apps/web -- so
 * the app silently kept Tailwind's stock blue ring. This test asserts every
 * token FAMILY that globals.css declares vars for is registered in the
 * compiled Tailwind theme, independent of whether a consumer exists yet.
 * 59-01 adds the same assertion for the identity ladder families
 * (conf/sugg/bad/ink/faded/pencil/shelf/leaf/bright/shade/rule/hair/
 * on-fill/washes/lines) -- this is what stops a Phase 60-62 surface from
 * reaching for `bg-conf` and silently getting no CSS.
 *
 * Tailwind v4's JS-config introspection API this gate used to depend on
 * does not exist under tailwindcss@4.x (v4 is CSS-first -- there is no JS
 * theme object to resolve; confirmed live during 55-01, see
 * 55-01-SUMMARY.md). That v3-shaped introspection is replaced here with
 * the SAME string-parsing technique token-contrast.test.ts already uses
 * (`readTokenBlock`, imported and reused rather than reimplemented) applied
 * directly against globals.css's `@theme inline` block (the color-family ->
 * Tailwind-namespace mapping, per 55-RESEARCH.md Pattern 1) and its native
 * `@theme` block (radius/shadow-scale registration, per 55-02-SUMMARY.md).
 * No JS build-config file is imported anywhere in this test -- CSS is the
 * single source of truth in v4, and this gate reads exactly the same CSS
 * the build pipeline reads.
 *
 * ────────────────────────────────────────────────────────────────────────
 * 61-05: THE CONTRACT ABOVE IS NOW TRUE. IT WAS NOT BEFORE.
 * ────────────────────────────────────────────────────────────────────────
 *
 * This header has claimed since 28-01 that it "asserts every token FAMILY
 * that globals.css declares vars for is registered". It did not: every
 * assertion below was a HAND-LIST, so a token declared without a
 * registration was invisible to it. The prose over-claimed and the gate was
 * silently wrong -- exactly the shape of defect it exists to catch.
 *
 * The cost was real and compounding. NINE palette tokens (bad-hi, ink-05,
 * ink-08, ink-14, edge, grid, fill-hi, rule-hi, shimmer) were declared in
 * BOTH themes and registered in neither. 61-03 hit it and worked around it,
 * 61-04 hit it and worked around it, and each flagged "register the missing
 * ones" to the next plan while this gate reported green.
 *
 * `PALETTE_TOKENS` below is now DERIVED from globals.css itself, so the
 * hand-list cannot drift from reality again. Adding a palette token without
 * a registration is red on arrival.
 */

const selfPath = fileURLToPath(import.meta.url);
const cssPath = path.resolve(path.dirname(selfPath), "..", "globals.css");
const css = readFileSync(cssPath, "utf-8");

// `@theme inline` maps every color-family CSS custom property (e.g.
// `--sidebar-background`) into Tailwind's `--color-*` theme namespace --
// this is where `bg-sidebar`/`text-chart-1`/etc. utilities get generated
// from.
const themeInlineTokens = readTokenBlock(css, "@theme inline");

// The native `@theme` block (no `inline`) registers the non-color families
// this gate also guards: the elevation shadow scale and the xl/2xl radius
// steps (55-02-SUMMARY.md's "native @theme port of borderRadius/
// boxShadow/fontFamily").
const themeTokens = readTokenBlock(css, "@theme");

// The `:root` block -- every token globals.css DECLARES, which is what the
// derived palette assertion below is computed from.
const rootTokens = readTokenBlock(css, ":root");

/**
 * A raw `oklch(...)` literal. THIS IS THE WHOLE DERIVATION, and it is exact
 * rather than clever -- verified against the file, not assumed:
 *
 *   - Every identity-ladder token (D-58-01) and every chart-N token is
 *     declared as a raw oklch literal. Those 31 tokens ARE the palette: the
 *     colours this design system actually owns.
 *   - Every shadcn semantic alias (`--primary`, `--border`, `--sidebar-*`,
 *     the tier/graph ladders, ...) is declared as a `var(--x)` REFERENCE
 *     onto that palette (59-01 Task 1 rewrote them all this way). They are
 *     registered under their own names already and must not be required to
 *     register under a raw palette name.
 *   - The non-colour tokens (`--radius*`, `--font-code`, `--elevation-*`)
 *     are neither oklch nor colour families and belong to the native
 *     `@theme` block's own assertions below.
 *
 * So "declared as a raw oklch in :root" selects exactly the set that MUST
 * have a `--color-*` mapping, with no allowlist to rot. A future palette
 * token is caught automatically; a future alias is correctly ignored.
 */
const RAW_OKLCH_VALUE = /^oklch\(/;

/** The palette, derived from globals.css itself. Exported so a reader can
 * see the set the assertion is computed over rather than trust a hand-list. */
export const PALETTE_TOKENS: readonly string[] = Object.entries(rootTokens)
  .filter(([, value]) => RAW_OKLCH_VALUE.test(value))
  .map(([name]) => name);

/** Asserts `tokens["--" + key]` exists and its mapped value matches `pattern`. */
function expectRegistered(
  tokens: Record<string, string>,
  key: string,
  pattern: RegExp,
): void {
  const value = tokens[key];
  if (value === undefined) {
    throw new Error(
      `Expected globals.css's @theme block to register "--${key}" -- not found. ` +
        `A declared token family with no @theme mapping line reproduces the ` +
        `unregistered-utility bug class this gate exists to catch.`,
    );
  }
  expect(value).toMatch(pattern);
}

/** Asserts `tokens["--" + key]` exists and is non-empty (no shape assertion). */
function expectPresent(tokens: Record<string, string>, key: string): void {
  const value = tokens[key];
  if (value === undefined || value.length === 0) {
    throw new Error(`Expected globals.css's @theme block to register "--${key}" -- not found.`);
  }
}

describe("token family registration (guards the unregistered-utility bug class)", () => {
  /**
   * THE TOTAL ASSERTION (61-05). Every hand-list below is a readable spec of
   * intent; THIS is the one that cannot drift.
   */
  it("registers EVERY palette token declared in :root (derived, not hand-listed)", () => {
    // VACUITY GUARD. A gate that inspects nothing passes everything. If a
    // future refactor moves the ladder out of `:root`, renames the block, or
    // switches the palette off raw oklch literals, this assertion must go RED
    // rather than silently certify an empty set. 31 tokens today; 20 is a
    // floor that cannot be reached by accident.
    expect(
      PALETTE_TOKENS.length,
      "the derived palette is empty or implausibly small, so this gate is " +
        "inspecting nothing and would pass on anything. Check that globals.css " +
        "still declares its ladder as raw oklch literals inside `:root`.",
    ).toBeGreaterThan(20);

    const missing = PALETTE_TOKENS.filter(
      (token) => themeInlineTokens[`color-${token}`] === undefined,
    );

    expect(
      missing,
      missing.length === 0
        ? ""
        : `globals.css declares ${missing.length} palette token(s) with NO ` +
            `\`--color-*\` mapping in its \`@theme inline\` block:\n` +
            missing.map((t) => `  --${t}: ${rootTokens[t]}`).join("\n") +
            `\n\nAn unregistered family emits NO CSS: a consumer reaching for ` +
            `bg-${missing[0]} / text-${missing[0]} / border-${missing[0]} gets ` +
            `nothing, with no build error and no console warning. Add ` +
            `\`--color-${missing[0]}: var(--${missing[0]});\` to the @theme inline ` +
            `block. Do NOT add an exemption here -- if a declared palette token ` +
            `genuinely must not be a utility, it does not belong in the palette.`,
    ).toEqual([]);
  });

  it("registers the full sidebar family against the --sidebar-* vars", () => {
    const sidebarKeys = [
      "color-sidebar",
      "color-sidebar-foreground",
      "color-sidebar-primary",
      "color-sidebar-primary-foreground",
      "color-sidebar-accent",
      "color-sidebar-accent-foreground",
      "color-sidebar-border",
      "color-sidebar-ring",
    ];
    for (const key of sidebarKeys) {
      expectRegistered(themeInlineTokens, key, /^var\(--sidebar-[\w-]+\)$/);
    }
  });

  it("registers the identity ladder families (D-58-01, 59-01-PLAN.md Task 1)", () => {
    const identityKeys = [
      "color-conf",
      "color-conf-wash",
      "color-conf-line",
      "color-sugg",
      "color-sugg-wash",
      "color-sugg-line",
      "color-bad",
      "color-ink",
      "color-faded",
      "color-pencil",
      "color-shelf",
      "color-leaf",
      "color-bright",
      "color-shade",
      "color-rule",
      "color-hair",
      "color-on-fill",
    ];
    for (const key of identityKeys) {
      expectRegistered(themeInlineTokens, key, /^var\(--[\w-]+\)$/);
    }
  });

  it("registers chart-1..5 against the --chart-* vars", () => {
    for (let index = 1; index <= 5; index += 1) {
      expectRegistered(
        themeInlineTokens,
        `color-chart-${index}`,
        new RegExp(`^var\\(--chart-${index}\\)$`),
      );
    }
  });

  it("registers the elevation shadow scale", () => {
    for (let index = 1; index <= 3; index += 1) {
      expectRegistered(
        themeTokens,
        `shadow-elevation-${index}`,
        new RegExp(`^var\\(--elevation-${index}\\)$`),
      );
    }
  });

  it("registers the xl/2xl radius steps", () => {
    expectPresent(themeTokens, "radius-xl");
    expectPresent(themeTokens, "radius-2xl");
  });

  it("registers the D-58-01 type scale + serif role (59-02-PLAN.md Task 1)", () => {
    // The serif is law 2's home -- a real token role, not an ad-hoc class.
    expectPresent(themeTokens, "font-serif");
    // A <=7-step designed scale (interfaces §A), each size paired with its
    // own line-height -- both halves of the pair must be registered, or a
    // consumer's `text-lg` renders the right size with the wrong leading.
    const textScaleSteps = ["2xs", "xs", "sm", "base", "lg", "xl"];
    for (const step of textScaleSteps) {
      expectPresent(themeTokens, `text-${step}`);
      expectPresent(themeTokens, `text-${step}--line-height`);
    }
  });

  it("registers the density/spacing rhythm + card/frame radii (59-02-PLAN.md Task 1)", () => {
    const spacingSteps = [
      "control-x",
      "control-y",
      "control-sm-x",
      "control-sm-y",
      "chip-x",
      "chip-y",
      "row-x",
      "row-y",
      "panel",
    ];
    for (const step of spacingSteps) {
      expectPresent(themeTokens, `spacing-${step}`);
    }
    expectPresent(themeTokens, "radius-card");
    expectPresent(themeTokens, "radius-frame");
  });
});
