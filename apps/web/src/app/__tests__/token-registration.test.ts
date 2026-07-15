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
});
