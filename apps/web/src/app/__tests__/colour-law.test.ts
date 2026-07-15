import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseOklch, readTokenBlock, resolveTokenValue } from "./token-contrast.test";

/**
 * Committed law-1 structural-enforcement gate (59-02-PLAN.md Task 3).
 *
 * 58-IDENTITY.md's law 1 ("colour is earned, never decorative") and its
 * "Token ladder" note (hue+chroma hold constant across themes; only
 * lightness moves) were documentation until now. 59-CONTEXT.md asked for
 * exactly this: "consider extending the committed palette-ban gate to catch
 * a hue reaching chrome. A gate beats a doc." `palette-ban.test.ts` walks
 * `.ts`/`.tsx` for Tailwind palette classes and structurally cannot see
 * globals.css -- this is a new, complementary gate on the token SOURCE
 * itself. `palette-ban.test.ts` is left untouched.
 *
 * Reuses `readTokenBlock`/`parseOklch`/`resolveTokenValue` from
 * `token-contrast.test.ts` (the same reuse pattern `token-registration.test.ts`
 * already uses) rather than reimplementing CSS-block parsing or oklch math.
 *
 * COLOUR-TOKEN DISCOVERY: every key in `:root`/`.dark` is resolved via
 * `resolveTokenValue` (follows `var()` chains to a literal) and handed to
 * `parseOklch`. If parsing throws, the token is non-colour (radius, font,
 * elevation box-shadow, spacing, calc()) and is silently skipped -- this is
 * a dynamic filter, not a hardcoded allowlist, so a future colour token
 * added to either block is automatically gated with no test-file edit
 * required.
 *
 * THREE ASSERTION GROUPS, per theme (:root and .dark):
 *   1. CHROME CEILING -- every colour token NOT in the earned-hue set has
 *      chroma <= 0.03 (verified headroom during planning: highest chrome
 *      chroma in the ladder is 0.026 on --rule/dark -- a real ceiling, no
 *      borderline case).
 *   2. EARNED-HUE FLOOR -- every token in the earned-hue set has chroma
 *      >= 0.06 (verified: min in the ladder is 0.068 on --conf). Proves the
 *      separation is designed, not accidental -- fails if a tier colour is
 *      quietly desaturated into the chrome band.
 *   3. CROSS-THEME INVARIANCE -- conf/sugg/bad hold hue AND chroma
 *      IDENTICAL between :root and .dark; only lightness may differ. This
 *      is D-58-01's explicit claim ("the dark theme costs three numbers,
 *      not a second design") and it is exactly checkable.
 *
 * Both negative proofs required by the plan's acceptance criteria (revert
 * --primary to its pre-59 stock teal; drift .dark's --conf chroma by 0.002)
 * are recorded verbatim in 59-02-SUMMARY.md, not committed to this file --
 * a committed gate must always be green; a temporary revert-and-confirm-red
 * cycle is how it was proven able to fail.
 */

const selfPath = fileURLToPath(import.meta.url);
const cssPath = path.resolve(path.dirname(selfPath), "..", "globals.css");
const css = readFileSync(cssPath, "utf-8");

const rootTokens = readTokenBlock(css, ":root");
const darkTokens = readTokenBlock(css, ".dark");

const CHROME_CHROMA_CEILING = 0.03;
const EARNED_HUE_CHROMA_FLOOR = 0.06;

/**
 * The closed earned-hue set (58-IDENTITY.md law 1 + interfaces §D) --
 * the ONLY tokens allowed to exceed the chrome chroma ceiling, and the set
 * gated against the earned-hue floor. `destructive`/`success`/
 * `tier-extracted`/`tier-inferred` are var()-chain aliases onto
 * `bad`/`conf`/`conf`/`sugg` respectively -- included by name so a future
 * edit that repoints one of these aliases at a chrome token (silently
 * breaking the "success IS verdigris" contract, 59-01-SUMMARY.md) is
 * caught under its own alias name, not just the token it currently
 * resolves to.
 */
const EARNED_HUE_TOKENS: ReadonlySet<string> = new Set([
  "conf",
  "conf-wash",
  "conf-line",
  "sugg",
  "sugg-wash",
  "sugg-line",
  "bad",
  "bad-hi",
  "destructive",
  "success",
  "tier-extracted",
  "tier-inferred",
]);

/**
 * DOCUMENTED, CLOSED EXEMPTION -- excluded from BOTH the chrome ceiling and
 * the earned-hue floor. `--chart-1..5` is a user-assigned spreadsheet-cell
 * colour feature (packages/ui's conditional-formatting-dialog), not part of
 * D-58-01's ladder contract (59-01 interfaces §B, same exemption category
 * as packages/genui/src/theme/packs.ts) -- and its own chroma values sit
 * BETWEEN the two bands, neither chrome nor earned-hue by this gate's
 * definition: light chart-1 = 0.053 (below the 0.06 floor), dark chart-3 =
 * 0.057 and chart-4 = 0.044 (both below the floor too). Naming the
 * exemption here makes it auditable rather than an unexplained hole in the
 * assertion loops below -- see the "documented exemption" describe block,
 * which still parses and logs these tokens without gating their chroma.
 */
const CHART_EXEMPT_TOKENS: ReadonlySet<string> = new Set([
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
]);

/** Resolves `key` and parses it as oklch, or returns `null` if it isn't a colour token. */
function tryParseColourToken(
  tokens: Record<string, string>,
  key: string,
): { readonly chroma: number; readonly hue: number } | null {
  try {
    const resolved = resolveTokenValue(tokens, key);
    const parsed = parseOklch(resolved);
    return { chroma: parsed.c, hue: parsed.h };
  } catch {
    return null;
  }
}

/** Every key in `tokens` that resolves to a parseable oklch(...) literal -- radius/font/elevation/etc. excluded. */
function colourTokenNames(tokens: Record<string, string>): string[] {
  return Object.keys(tokens).filter((key) => tryParseColourToken(tokens, key) !== null);
}

const MODES: ReadonlyArray<{ readonly label: string; readonly tokens: Record<string, string> }> = [
  { label: "light (:root)", tokens: rootTokens },
  { label: "dark (.dark)", tokens: darkTokens },
];

describe("colour-law (D-58-01 law 1 structural-enforcement gate)", () => {
  for (const mode of MODES) {
    const names = colourTokenNames(mode.tokens);
    const chromeNames = names.filter(
      (name) => !EARNED_HUE_TOKENS.has(name) && !CHART_EXEMPT_TOKENS.has(name),
    );
    const earnedNames = names.filter((name) => EARNED_HUE_TOKENS.has(name));
    const chartNames = names.filter((name) => CHART_EXEMPT_TOKENS.has(name));

    describe(`chrome ceiling -- ${mode.label}`, () => {
      for (const name of chromeNames) {
        const parsed = tryParseColourToken(mode.tokens, name);
        if (parsed === null) {
          // Unreachable -- `name` was selected from colourTokenNames(), which
          // already proved it parses. Guards against a future refactor
          // silently dropping the filter above.
          throw new Error(`Expected "--${name}" to parse as a colour token`);
        }
        it(`--${name} (chroma ${parsed.chroma}) stays at or below the ${CHROME_CHROMA_CEILING} chrome ceiling -- law 1: colour is earned, never decorative`, () => {
          expect(parsed.chroma).toBeLessThanOrEqual(CHROME_CHROMA_CEILING);
        });
      }
    });

    describe(`earned-hue floor -- ${mode.label}`, () => {
      for (const name of earnedNames) {
        const parsed = tryParseColourToken(mode.tokens, name);
        if (parsed === null) {
          throw new Error(`Expected "--${name}" to parse as a colour token`);
        }
        it(`--${name} (chroma ${parsed.chroma}) clears the ${EARNED_HUE_CHROMA_FLOOR} earned-hue floor -- proves law 1's separation is designed, not accidental`, () => {
          expect(parsed.chroma).toBeGreaterThanOrEqual(EARNED_HUE_CHROMA_FLOOR);
        });
      }
    });

    describe(`documented exemption -- chart-1..5 -- ${mode.label}`, () => {
      for (const name of chartNames) {
        const parsed = tryParseColourToken(mode.tokens, name);
        it(`--${name} is a valid colour token, NOT gated by the chrome ceiling or the earned-hue floor (user-assigned spreadsheet cell colour, out of D-58-01's ladder contract)`, () => {
          expect(parsed).not.toBeNull();
          // eslint-disable-next-line no-console
          console.info(`[chart-exempt] ${mode.label} --${name} chroma = ${parsed?.chroma}`);
        });
      }
    });
  }

  describe("cross-theme hue+chroma invariance (D-58-01: only lightness moves)", () => {
    const INVARIANT_TOKENS = ["conf", "sugg", "bad"] as const;

    for (const name of INVARIANT_TOKENS) {
      it(`--${name} holds hue and chroma identical between :root and .dark`, () => {
        const light = tryParseColourToken(rootTokens, name);
        const dark = tryParseColourToken(darkTokens, name);
        if (light === null || dark === null) {
          throw new Error(`Expected "--${name}" to parse as a colour token in both themes`);
        }
        expect(dark.chroma).toBe(light.chroma);
        expect(dark.hue).toBe(light.hue);
      });
    }
  });
});
