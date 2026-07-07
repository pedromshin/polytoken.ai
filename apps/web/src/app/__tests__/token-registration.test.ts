import resolveConfig from "tailwindcss/resolveConfig";
import { describe, expect, it } from "vitest";

import appConfig from "../../../tailwind.config";

/**
 * Regression guard for the "CSS var exists but Tailwind utility was never
 * registered" bug class (28-VERIFICATION gap, closed in 69c3afa): the
 * `--sidebar-*` vars were correctly aliased to teal tokens in globals.css,
 * yet `bg-sidebar`/`ring-sidebar-ring` emitted no CSS because no `sidebar`
 * color family existed in the config that actually compiles apps/web — so
 * the app silently kept Tailwind's stock blue ring. This test asserts every
 * token FAMILY that globals.css declares vars for is registered in the
 * resolved Tailwind theme, independent of whether a consumer exists yet.
 */
const theme = resolveConfig(appConfig).theme;

type ColorFamily = Record<string, unknown>;

const familyOf = (name: string): ColorFamily => {
  const colors = theme.colors as Record<string, unknown>;
  const family = colors[name];
  expect(family, `theme.colors.${name} must be registered`).toBeDefined();
  return family as ColorFamily;
};

describe("token family registration (guards the unregistered-utility bug class)", () => {
  it("registers the full sidebar family against the --sidebar-* vars", () => {
    const sidebar = familyOf("sidebar");
    for (const key of [
      "DEFAULT",
      "foreground",
      "primary",
      "primary-foreground",
      "accent",
      "accent-foreground",
      "border",
      "ring",
    ]) {
      expect(sidebar[key], `sidebar.${key}`).toMatch(/var\(--sidebar-/);
    }
  });

  it("registers chart-1..5 against the --chart-* vars", () => {
    const chart = familyOf("chart");
    for (const key of ["1", "2", "3", "4", "5"]) {
      expect(chart[key], `chart.${key}`).toBe(`hsl(var(--chart-${key}))`);
    }
  });

  it("registers the elevation shadow scale", () => {
    const boxShadow = theme.boxShadow as Record<string, string>;
    for (const key of ["elevation-1", "elevation-2", "elevation-3"]) {
      expect(boxShadow[key], `boxShadow.${key}`).toBe(`var(--${key})`);
    }
  });

  it("registers the xl/2xl radius steps", () => {
    const borderRadius = theme.borderRadius as Record<string, string>;
    expect(borderRadius.xl).toBe("var(--radius-xl)");
    expect(borderRadius["2xl"]).toBe("var(--radius-2xl)");
  });
});
