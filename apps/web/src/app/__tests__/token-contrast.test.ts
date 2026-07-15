import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Committed WCAG-AA contrast regression gate (28-01-PLAN.md Task 3, rewritten
 * 55-03-PLAN.md Task 1 for the Tailwind v4 / oklch migration).
 *
 * Parses the LIVE apps/web/src/app/globals.css (both `:root` and `.dark`
 * blocks) and asserts every TOKEN-01 neutral `*`/`*-foreground` pair clears
 * WCAG-AA (>=4.5:1). Assertions are computed against the file's ACTUAL
 * current values, never hardcoded expected numbers -- so a future edit that
 * "rounds a value back" and silently drops contrast below the bar fails
 * this test, not just a manual visual check.
 *
 * 55-02 ported every :root/.dark color token from a bare `"H S% L%"` HSL
 * triplet to a full `oklch(L C H)` color function (55-RESEARCH.md Pattern
 * 1) -- the previous HSL-triplet parser/converter pair could not parse
 * that shape at all (it threw immediately on every oklch value). Per
 * 55-RESEARCH.md's "Don't Hand-Roll" guidance, no runtime HSL<->oklch
 * conversion library (e.g. culori) is added here: the oklch literals in
 * globals.css were precomputed ONCE in 55-02, so this gate only needs to
 * parse an already-final `oklch(L C H)` string and convert oklch ->
 * linear-sRGB (via the standard OKLab intermediate space) at TEST time --
 * `readTokenBlock` (engine-agnostic CSS-block extraction) and
 * `relativeLuminance`/`contrastRatio` (pure WCAG math over linear-sRGB
 * channels) are unchanged from the pre-migration version of this file.
 *
 * Chart tokens (`--chart-*`) are graphical, carry no `*-foreground`
 * counterpart in this token system, and are informational-only per the
 * UI-SPEC -- intentionally NOT gated here.
 */

export type OklchColor = {
  readonly l: number; // lightness, 0-1
  readonly c: number; // chroma
  readonly h: number; // hue, degrees
};

export type LinearRgb = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
};

/**
 * Parses an `oklch(L C H)` / `oklch(L% C H)` CSS color function (optionally
 * with a trailing `/ alpha` component, which is ignored -- none of the
 * gated NEUTRAL_PAIRS below carry an alpha channel). Throws on a value it
 * cannot parse (same fail-loud contract as this gate's previous parser).
 */
export function parseOklch(value: string): OklchColor {
  const match = value
    .trim()
    .match(/^oklch\(\s*(-?[\d.]+)(%)?\s+(-?[\d.]+)\s+(-?[\d.]+)\s*(?:\/\s*-?[\d.]+%?\s*)?\)$/i);
  if (!match) {
    throw new Error(`Cannot parse oklch(...) value from "${value}"`);
  }
  const [, lightnessRaw, lightnessIsPercent, chromaRaw, hueRaw] = match;
  if (lightnessRaw === undefined || chromaRaw === undefined || hueRaw === undefined) {
    throw new Error(`Cannot parse oklch(...) value from "${value}"`);
  }
  const l = lightnessIsPercent === "%" ? Number(lightnessRaw) / 100 : Number(lightnessRaw);
  return { l, c: Number(chromaRaw), h: Number(hueRaw) };
}

/**
 * Converts an OKLCH color to linearized sRGB channels (0-1), via the OKLab
 * perceptual color space and its LMS cone-response intermediate. This is
 * the standard Björn Ottosson OKLab <-> linear-sRGB forward transform
 * (https://bottosson.github.io/posts/oklab/) -- self-contained, no runtime
 * dependency added (55-RESEARCH.md "Don't Hand-Roll").
 *
 * Unlike this gate's previous HSL-to-linear-RGB converter, no separate
 * sRGB gamma-decode step is needed: the matrices below already resolve
 * directly to linear-light sRGB, which is exactly the representation
 * `relativeLuminance` expects.
 */
export function oklchToLinearRgb(color: OklchColor): LinearRgb {
  const hueRadians = (color.h * Math.PI) / 180;
  const a = color.c * Math.cos(hueRadians);
  const b = color.c * Math.sin(hueRadians);

  const lPrime = color.l + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = color.l - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = color.l - 0.0894841775 * a - 1.291485548 * b;

  const lCubed = lPrime ** 3;
  const mCubed = mPrime ** 3;
  const sCubed = sPrime ** 3;

  const r = 4.0767416621 * lCubed - 3.3077115913 * mCubed + 0.2309699292 * sCubed;
  const g = -1.2684380046 * lCubed + 2.6097574011 * mCubed - 0.3413193965 * sCubed;
  const blueChannel = -0.0041960863 * lCubed - 0.7034186147 * mCubed + 1.707614701 * sCubed;

  // Gamut-clipping edge case (55-RESEARCH.md): the OKLab matrices can
  // produce slightly out-of-[0,1] channels for colors near (or, from
  // floating-point rounding, just inside) the sRGB gamut boundary. Clamp
  // before feeding relativeLuminance -- an unclamped negative channel would
  // silently corrupt the WCAG luminance sum.
  return {
    r: Math.min(1, Math.max(0, r)),
    g: Math.min(1, Math.max(0, g)),
    b: Math.min(1, Math.max(0, blueChannel)),
  };
}

/** WCAG relative luminance from linearized sRGB channels. */
export function relativeLuminance(rgb: LinearRgb): number {
  return 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
}

/** WCAG contrast ratio: (Llighter + 0.05) / (Ldarker + 0.05). */
export function contrastRatio(luminanceA: number, luminanceB: number): number {
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Extracts all `--token: value;` custom properties inside a named CSS
 * block. Engine-agnostic (regexes raw CSS text, no PostCSS/Tailwind
 * runtime involved) -- unchanged since 28-01, and reused by
 * token-registration.test.ts to read the v4 `@theme`/`@theme inline`
 * blocks directly, with no JS build-config introspection needed.
 */
export function readTokenBlock(css: string, blockSelector: string): Record<string, string> {
  const escaped = blockSelector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blockPattern = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`);
  const blockMatch = css.match(blockPattern);
  if (!blockMatch) {
    throw new Error(`Block "${blockSelector}" not found in globals.css`);
  }
  const body = blockMatch[1] ?? "";
  const varPattern = /--([\w-]+):\s*([^;]+);/g;
  const tokens: Record<string, string> = {};
  let match: RegExpExecArray | null = varPattern.exec(body);
  while (match !== null) {
    const [, name, rawValue] = match;
    if (name !== undefined && rawValue !== undefined) {
      tokens[name] = rawValue.trim();
    }
    match = varPattern.exec(body);
  }
  return tokens;
}

function contrastForPair(
  tokens: Record<string, string>,
  backgroundKey: string,
  foregroundKey: string,
): number {
  const backgroundValue = tokens[backgroundKey];
  const foregroundValue = tokens[foregroundKey];
  if (backgroundValue === undefined || foregroundValue === undefined) {
    throw new Error(`Missing token(s) for pair "${backgroundKey}"/"${foregroundKey}"`);
  }
  const backgroundLuminance = relativeLuminance(oklchToLinearRgb(parseOklch(backgroundValue)));
  const foregroundLuminance = relativeLuminance(oklchToLinearRgb(parseOklch(foregroundValue)));
  return contrastRatio(backgroundLuminance, foregroundLuminance);
}

// Resolved via path.dirname(fileURLToPath(...)) rather than
// `new URL("../globals.css", import.meta.url)` directly: under vitest's
// jsdom environment, the global `URL` constructor resolves relative
// references against jsdom's document location (`http://localhost:3000/`)
// instead of the module's own `file:` base, producing a non-file URL that
// `fileURLToPath` then rejects. Resolving the directory first sidesteps
// jsdom's URL polyfill entirely.
const selfPath = fileURLToPath(import.meta.url);
const cssPath = path.resolve(path.dirname(selfPath), "..", "globals.css");
const css = readFileSync(cssPath, "utf-8");

const rootTokens = readTokenBlock(css, ":root");
const darkTokens = readTokenBlock(css, ".dark");

const NEUTRAL_PAIRS: ReadonlyArray<{
  readonly background: string;
  readonly foreground: string;
}> = [
  { background: "muted", foreground: "muted-foreground" },
  { background: "secondary", foreground: "secondary-foreground" },
  { background: "accent", foreground: "accent-foreground" },
];

const MODES: ReadonlyArray<{ readonly label: string; readonly tokens: Record<string, string> }> = [
  { label: "light (:root)", tokens: rootTokens },
  { label: "dark (.dark)", tokens: darkTokens },
];

const WCAG_AA_MINIMUM_CONTRAST = 4.5;

describe("token-contrast (WCAG-AA regression gate)", () => {
  for (const mode of MODES) {
    for (const pair of NEUTRAL_PAIRS) {
      it(`${pair.background}/${pair.foreground} clears ${WCAG_AA_MINIMUM_CONTRAST}:1 in ${mode.label}`, () => {
        const ratio = contrastForPair(mode.tokens, pair.background, pair.foreground);
        expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_MINIMUM_CONTRAST);
      });
    }
  }
});
