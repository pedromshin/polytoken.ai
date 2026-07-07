import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Committed WCAG-AA contrast regression gate (28-01-PLAN.md Task 3).
 *
 * Parses the LIVE apps/web/src/app/globals.css (both `:root` and `.dark`
 * blocks) and asserts every TOKEN-01 neutral `*`/`*-foreground` pair clears
 * WCAG-AA (>=4.5:1). Assertions are computed against the file's ACTUAL
 * current values, never hardcoded expected numbers -- so a future edit that
 * "rounds a value back" and silently drops contrast below the bar fails
 * this test, not just a manual visual check.
 *
 * Chart tokens (`--chart-*`) are graphical, carry no `*-foreground`
 * counterpart in this token system, and are informational-only per the
 * UI-SPEC -- intentionally NOT gated here.
 */

export type HslTriplet = {
  readonly h: number;
  readonly s: number;
  readonly l: number;
};

export type LinearRgb = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
};

/** Parses a `"H S% L%"` CSS custom-property value (e.g. `"164 6% 95.3%"`). */
export function parseHslTriplet(value: string): HslTriplet {
  const match = value.trim().match(/^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!match) {
    throw new Error(`Cannot parse HSL triplet from "${value}"`);
  }
  const [, h, s, l] = match;
  return { h: Number(h), s: Number(s), l: Number(l) };
}

function hueToRgbChannel(p: number, q: number, t: number): number {
  const wrapped = ((t % 1) + 1) % 1;
  if (wrapped < 1 / 6) return p + (q - p) * 6 * wrapped;
  if (wrapped < 1 / 2) return q;
  if (wrapped < 2 / 3) return p + (q - p) * (2 / 3 - wrapped) * 6;
  return p;
}

function toLinearChannel(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** Converts an HSL triplet to linearized sRGB channels (0-1), per WCAG. */
export function hslToLinearRgb({ h, s, l }: HslTriplet): LinearRgb {
  const hNorm = (((h % 360) + 360) % 360) / 360;
  const sNorm = s / 100;
  const lNorm = l / 100;

  if (sNorm === 0) {
    const linear = toLinearChannel(lNorm);
    return { r: linear, g: linear, b: linear };
  }

  const q = lNorm < 0.5 ? lNorm * (1 + sNorm) : lNorm + sNorm - lNorm * sNorm;
  const p = 2 * lNorm - q;

  return {
    r: toLinearChannel(hueToRgbChannel(p, q, hNorm + 1 / 3)),
    g: toLinearChannel(hueToRgbChannel(p, q, hNorm)),
    b: toLinearChannel(hueToRgbChannel(p, q, hNorm - 1 / 3)),
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

/** Extracts all `--token: value;` custom properties inside a named CSS block. */
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
  const backgroundLuminance = relativeLuminance(hslToLinearRgb(parseHslTriplet(backgroundValue)));
  const foregroundLuminance = relativeLuminance(hslToLinearRgb(parseHslTriplet(foregroundValue)));
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
