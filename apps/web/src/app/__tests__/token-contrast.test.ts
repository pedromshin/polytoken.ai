import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Committed WCAG-AA contrast regression gate (28-01-PLAN.md Task 3, rewritten
 * 55-03-PLAN.md Task 1 for the Tailwind v4 / oklch migration, rewritten again
 * 59-01-PLAN.md Task 2 for the D-58-01 designed identity ladder).
 *
 * Parses the LIVE apps/web/src/app/globals.css (both `:root` and `.dark`
 * blocks) and asserts every gated pair clears WCAG-AA (>=4.5:1). Assertions
 * are computed against the file's ACTUAL current values, never hardcoded
 * expected numbers -- so a future edit that "rounds a value back" and
 * silently drops contrast below the bar fails this test, not just a manual
 * visual check.
 *
 * 59-01 (Task 1) rewrote every gated shadcn semantic token as a `var()`
 * reference onto the identity ladder (e.g. `--primary: var(--ink);`) rather
 * than a literal `oklch(...)` -- `parseOklch` cannot parse a `var()` string,
 * so this rewrite adds `resolveTokenValue`, which follows a `var()` chain
 * within the same block until it reaches a literal, before handing the
 * result to `parseOklch`. `contrastForPair` (and the new wash helper below)
 * are routed through it. `parseOklch` now also returns the alpha component
 * (default 1) -- the wash tokens (`--conf-wash`/`--sugg-wash`) carry one, and
 * WASH_PAIRS' compositing needs it. Existing callers that only read
 * `l`/`c`/`h` are unaffected.
 *
 * 55-02 ported every :root/.dark color token from a bare `"H S% L%"` HSL
 * triplet to a full `oklch(L C H)` color function (55-RESEARCH.md Pattern
 * 1) -- the previous HSL-triplet parser/converter pair could not parse
 * that shape at all (it threw immediately on every oklch value). Per
 * 55-RESEARCH.md's "Don't Hand-Roll" guidance, no runtime HSL<->oklch
 * conversion library (e.g. culori) is added here: the oklch literals in
 * globals.css were precomputed ONCE in 55-02/59-01, so this gate only needs
 * to parse an already-final `oklch(L C H)` string and convert oklch ->
 * linear-sRGB (via the standard OKLab intermediate space) at TEST time --
 * `readTokenBlock` (engine-agnostic CSS-block extraction) and
 * `relativeLuminance`/`contrastRatio` (pure WCAG math over linear-sRGB
 * channels) are unchanged from the pre-migration version of this file.
 *
 * WASH_PAIRS models 58-IDENTITY.md's "honest worst case": a tier colour as
 * text sitting on its own translucent wash, composited over `--card`.
 * `compositeOver` implements source-over alpha compositing in
 * GAMMA-ENCODED sRGB (verified during 59-01 planning to reproduce
 * 58-IDENTITY.md's published 4.59/6.72 (conf) and 4.52/6.59 (sugg) exactly):
 * convert both colors oklch -> linear sRGB, ENCODE each channel to gamma
 * sRGB, blend `fg*a + bg*(1-a)` per gamma-encoded channel, then DECODE the
 * blended result back to linear sRGB for `relativeLuminance`. Blending in
 * linear space (skipping the encode/decode round-trip) produces different,
 * WRONG numbers -- treat any deviation from those published ratios as a
 * porting bug in globals.css, not a reason to change this math.
 *
 * Chart tokens (`--chart-*`) are graphical, carry no `*-foreground`
 * counterpart in this token system, and are informational-only per the
 * UI-SPEC -- intentionally NOT gated here (also out of D-58-01's ladder
 * contract, see 59-01-PLAN.md interfaces §B).
 */

export type OklchColor = {
  readonly l: number; // lightness, 0-1
  readonly c: number; // chroma
  readonly h: number; // hue, degrees
  readonly alpha: number; // 0-1, defaults to 1 when the value carries none
};

export type LinearRgb = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
};

/**
 * Parses an `oklch(L C H)` / `oklch(L% C H)` CSS color function, including
 * an optional trailing `/ alpha` (`/ .1` or `/ 10%`) component -- the wash
 * tokens (`--conf-wash`/`--sugg-wash`/...) carry one, and `compositeOver`
 * needs it (59-01-PLAN.md Task 2). Callers that only read `l`/`c`/`h` are
 * unaffected. Throws on a value it cannot parse (same fail-loud contract as
 * this gate's previous parser).
 */
export function parseOklch(value: string): OklchColor {
  const match = value
    .trim()
    .match(
      /^oklch\(\s*(-?[\d.]+)(%)?\s+(-?[\d.]+)\s+(-?[\d.]+)\s*(?:\/\s*(-?[\d.]+)(%)?\s*)?\)$/i,
    );
  if (!match) {
    throw new Error(`Cannot parse oklch(...) value from "${value}"`);
  }
  const [, lightnessRaw, lightnessIsPercent, chromaRaw, hueRaw, alphaRaw, alphaIsPercent] = match;
  if (lightnessRaw === undefined || chromaRaw === undefined || hueRaw === undefined) {
    throw new Error(`Cannot parse oklch(...) value from "${value}"`);
  }
  const l = lightnessIsPercent === "%" ? Number(lightnessRaw) / 100 : Number(lightnessRaw);
  const alpha =
    alphaRaw === undefined
      ? 1
      : alphaIsPercent === "%"
        ? Number(alphaRaw) / 100
        : Number(alphaRaw);
  return { l, c: Number(chromaRaw), h: Number(hueRaw), alpha };
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

/** Encodes a single linear-light sRGB channel (0-1) to gamma-encoded sRGB (0-1). */
function linearChannelToGamma(channel: number): number {
  const clamped = Math.min(1, Math.max(0, channel));
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

/** Decodes a single gamma-encoded sRGB channel (0-1) back to linear-light sRGB (0-1). */
function gammaChannelToLinear(channel: number): number {
  const clamped = Math.min(1, Math.max(0, channel));
  return clamped <= 0.04045 ? clamped / 12.92 : ((clamped + 0.055) / 1.055) ** 2.4;
}

/**
 * Source-over alpha compositing of `foreground` (e.g. a translucent wash
 * token) onto opaque `background` (e.g. `--card`), in GAMMA-ENCODED sRGB
 * (59-01-PLAN.md Task 2, gotcha 6): oklch -> linear sRGB for both colors,
 * ENCODE each channel to gamma sRGB, blend `fg*alpha + bg*(1-alpha)` per
 * gamma-encoded channel, then DECODE the blend back to linear sRGB so the
 * result feeds `relativeLuminance` directly. This is the model 58-IDENTITY.md
 * used to publish its "honest worst case" tier-on-wash ratios -- blending in
 * linear space instead (skipping the encode/decode round-trip) reproduces
 * different, WRONG numbers.
 */
export function compositeOver(
  foreground: OklchColor,
  background: OklchColor,
  alpha: number,
): LinearRgb {
  const fgLinear = oklchToLinearRgb(foreground);
  const bgLinear = oklchToLinearRgb(background);

  const fgGamma = {
    r: linearChannelToGamma(fgLinear.r),
    g: linearChannelToGamma(fgLinear.g),
    b: linearChannelToGamma(fgLinear.b),
  };
  const bgGamma = {
    r: linearChannelToGamma(bgLinear.r),
    g: linearChannelToGamma(bgLinear.g),
    b: linearChannelToGamma(bgLinear.b),
  };

  return {
    r: gammaChannelToLinear(fgGamma.r * alpha + bgGamma.r * (1 - alpha)),
    g: gammaChannelToLinear(fgGamma.g * alpha + bgGamma.g * (1 - alpha)),
    b: gammaChannelToLinear(fgGamma.b * alpha + bgGamma.b * (1 - alpha)),
  };
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

const VAR_REFERENCE_PATTERN = /^var\(\s*--([\w-]+)\s*\)$/;

/**
 * Follows a `var(--x)` chain within a single token block until it reaches a
 * literal value (e.g. `oklch(...)`), returning that literal. 59-01-PLAN.md
 * Task 1 rewrote every gated shadcn token as a var() reference onto the
 * identity ladder (`--primary: var(--ink);`), which `parseOklch` cannot
 * parse directly -- every gate lookup below is routed through this instead
 * of a raw `tokens[key]` read. Throws (fail-loud, matching this gate's
 * existing contract) on an unresolved name or a reference cycle.
 */
export function resolveTokenValue(
  tokens: Record<string, string>,
  key: string,
  seen: ReadonlySet<string> = new Set(),
): string {
  if (seen.has(key)) {
    throw new Error(
      `Circular var() reference resolving "--${key}": ` +
        `${[...seen, key].map((visited) => `--${visited}`).join(" -> ")}`,
    );
  }
  const value = tokens[key];
  if (value === undefined) {
    throw new Error(`Cannot resolve "--${key}" -- no such token in this block`);
  }
  const varMatch = value.match(VAR_REFERENCE_PATTERN);
  if (varMatch === null) {
    return value;
  }
  const [, referencedKey] = varMatch;
  if (referencedKey === undefined) {
    throw new Error(`Cannot resolve "--${key}" -- unparseable var() reference "${value}"`);
  }
  return resolveTokenValue(tokens, referencedKey, new Set([...seen, key]));
}

function contrastForPair(
  tokens: Record<string, string>,
  backgroundKey: string,
  foregroundKey: string,
): number {
  const backgroundValue = resolveTokenValue(tokens, backgroundKey);
  const foregroundValue = resolveTokenValue(tokens, foregroundKey);
  const backgroundLuminance = relativeLuminance(oklchToLinearRgb(parseOklch(backgroundValue)));
  const foregroundLuminance = relativeLuminance(oklchToLinearRgb(parseOklch(foregroundValue)));
  return contrastRatio(backgroundLuminance, foregroundLuminance);
}

/**
 * The tier-on-wash "honest worst case" (58-IDENTITY.md): `textKey`'s opaque
 * literal, read as text, against `washKey`'s translucent literal composited
 * (via `compositeOver`) over `groundKey`'s opaque literal.
 */
function contrastForWashPair(
  tokens: Record<string, string>,
  textKey: string,
  washKey: string,
  groundKey: string,
): number {
  const textOklch = parseOklch(resolveTokenValue(tokens, textKey));
  const washOklch = parseOklch(resolveTokenValue(tokens, washKey));
  const groundOklch = parseOklch(resolveTokenValue(tokens, groundKey));

  const compositedGround = compositeOver(washOklch, groundOklch, washOklch.alpha);
  const groundLuminance = relativeLuminance(compositedGround);
  const textLuminance = relativeLuminance(oklchToLinearRgb(textOklch));

  return contrastRatio(textLuminance, groundLuminance);
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

/** background/foreground pairs -- the identity's semantic surfaces (59-01-PLAN.md interfaces §B). */
const SEMANTIC_PAIRS: ReadonlyArray<{
  readonly background: string;
  readonly foreground: string;
}> = [
  { background: "background", foreground: "foreground" },
  { background: "card", foreground: "card-foreground" },
  { background: "popover", foreground: "popover-foreground" },
  { background: "primary", foreground: "primary-foreground" },
  { background: "secondary", foreground: "secondary-foreground" },
  { background: "muted", foreground: "muted-foreground" },
  { background: "accent", foreground: "accent-foreground" },
  { background: "destructive", foreground: "destructive-foreground" },
  { background: "success", foreground: "success-foreground" },
  { background: "tier-extracted", foreground: "tier-extracted-foreground" },
  { background: "tier-inferred", foreground: "tier-inferred-foreground" },
  { background: "graph-entity", foreground: "graph-entity-foreground" },
  { background: "graph-email-component", foreground: "graph-email-component-foreground" },
  { background: "graph-email", foreground: "graph-email-foreground" },
];

/**
 * The pencil/faded usage rule (gotcha 1): both are legal text on any of the
 * three grounds below, but NEVER on `--shade` (that pair is what fails AA --
 * 4.23 light / 4.02 dark -- which is exactly why `--muted-foreground` maps to
 * `--faded`, not `--pencil`, in globals.css). This turns "pencil is legal on
 * the grounds but never on --shade" into an enforced rule, not a doc sentence.
 */
const GROUND_TEXT_PAIRS: ReadonlyArray<{
  readonly background: string;
  readonly foreground: string;
}> = [
  { background: "background", foreground: "pencil" },
  { background: "background", foreground: "faded" },
  { background: "card", foreground: "pencil" },
  { background: "card", foreground: "faded" },
  { background: "popover", foreground: "pencil" },
  { background: "popover", foreground: "faded" },
];

/**
 * 58-IDENTITY.md's explicit Phase 59 constraint -- the honest worst case: a
 * tier colour as text on its OWN wash, composited over `--card`. Light
 * headroom here is 0.09 (conf) and 0.02 (sugg) over the 4.5 floor -- the
 * tightest pairs in the system, and the reason any lightness drift on
 * `--sugg`/`--conf` must fail this gate loudly.
 */
const WASH_PAIRS: ReadonlyArray<{
  readonly text: string;
  readonly wash: string;
  readonly ground: string;
}> = [
  { text: "conf", wash: "conf-wash", ground: "card" },
  { text: "sugg", wash: "sugg-wash", ground: "card" },
];

const MODES: ReadonlyArray<{ readonly label: string; readonly tokens: Record<string, string> }> = [
  { label: "light (:root)", tokens: rootTokens },
  { label: "dark (.dark)", tokens: darkTokens },
];

const WCAG_AA_MINIMUM_CONTRAST = 4.5;

describe("token-contrast (WCAG-AA regression gate)", () => {
  for (const mode of MODES) {
    describe(`semantic pairs -- ${mode.label}`, () => {
      for (const pair of SEMANTIC_PAIRS) {
        it(`${pair.background}/${pair.foreground} clears ${WCAG_AA_MINIMUM_CONTRAST}:1`, () => {
          const ratio = contrastForPair(mode.tokens, pair.background, pair.foreground);
          expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_MINIMUM_CONTRAST);
        });
      }
    });

    describe(`ground/text usage-rule pairs (pencil & faded) -- ${mode.label}`, () => {
      for (const pair of GROUND_TEXT_PAIRS) {
        it(`${pair.foreground} on ${pair.background} clears ${WCAG_AA_MINIMUM_CONTRAST}:1`, () => {
          const ratio = contrastForPair(mode.tokens, pair.background, pair.foreground);
          expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_MINIMUM_CONTRAST);
        });
      }
    });

    describe(`tier-on-wash pairs (58-IDENTITY.md's honest worst case) -- ${mode.label}`, () => {
      for (const pair of WASH_PAIRS) {
        it(`${pair.text} text on ${pair.wash} over ${pair.ground} clears ${WCAG_AA_MINIMUM_CONTRAST}:1`, () => {
          const ratio = contrastForWashPair(mode.tokens, pair.text, pair.wash, pair.ground);
          // Evidence for the SUMMARY: 58-IDENTITY.md publishes 4.59/6.72
          // (conf) and 4.52/6.59 (sugg) for light/dark respectively.
          // eslint-disable-next-line no-console
          console.info(
            `[wash] ${mode.label} ${pair.text}-on-${pair.wash}-over-${pair.ground} = ${ratio.toFixed(2)}`,
          );
          expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_MINIMUM_CONTRAST);
        });
      }
    });
  }
});
