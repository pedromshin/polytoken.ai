/**
 * catalog-example-render.test.tsx — Regression guard for the catalog browser's
 * live-example wrapping (BUG A).
 *
 * THE BUG THIS LOCKS DOWN:
 *   The catalog browser island used to wrap each entry's example as a NESTED node:
 *     { v:1, root: { type, props: example, children: [] } }
 *   A genui spec node is FLAT — `{ type, ...props }` — so renderNode extracted
 *   `{ props: {...}, children: [] }` and ran propsSchema.safeParse on it, which
 *   FAILED for every entry → every catalog card showed the
 *   `[!] "<type>" node — prop validation failed` fallback.
 *
 * The fix flattens the wrapper via buildCatalogExampleSpec (the SAME helper the
 * island imports). This test exercises that exact helper, so the test and the
 * island can never drift.
 *
 * For EVERY entry in POLYTOKEN_CATALOG this test asserts:
 *   (a) buildCatalogExampleSpec(entry) passes SpecRootSchema.safeParse, and
 *   (b) rendering it through SpecRenderer produces NO NodeErrorFallback
 *       (no `[!]`, no "prop validation failed", no role="alert" fallback).
 *
 * Against the OLD nested wrapper this test FAILS (every entry renders a fallback);
 * against the flat wrapper it PASSES.
 *
 * Environment: jsdom (genui vitest.config.ts). Rendered with react-dom/server
 * renderToStaticMarkup — the prop-validation fallback is emitted synchronously
 * (no thrown error), so static markup faithfully reflects the fallback path.
 */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { POLYTOKEN_CATALOG } from "../../catalog/index";
import { SpecRootSchema } from "../../schema/index";
import { SpecRenderer } from "../../renderer/index";
import { buildCatalogExampleSpec } from "../build-catalog-example-spec";
import type { SpecRoot } from "../../schema/index";

// NodeErrorFallback renders: `[!] "<type>" node — <reason>` (error-boundary.tsx).
// The `[!]` prefix + the " node — " connector are unique to the fallback path.
// NOTE: role="alert" is NOT a fallback marker — the real `alert` component also
// renders role="alert", so matching on it would false-positive.
const FALLBACK_MARKER = "[!]";
const FALLBACK_NODE_PREFIX = "node —"; // "node —" (em dash) from the fallback copy
const FALLBACK_REASON_PROPS = "prop validation failed";
const FALLBACK_REASON_RENDER = "render error";

const entries = Object.values(POLYTOKEN_CATALOG);

describe("catalog example live-render (BUG A regression)", () => {
  it("covers all 22 catalog entries", () => {
    expect(entries).toHaveLength(22); // 999.13 added 5 vendored entries
  });

  it.each(entries.map((entry) => [entry.type, entry] as const))(
    "%s: flat-wrapped example passes SpecRootSchema",
    (_type, entry) => {
      const spec = buildCatalogExampleSpec(entry);
      const result = SpecRootSchema.safeParse(spec);
      expect(result.success).toBe(true);
    },
  );

  it.each(entries.map((entry) => [entry.type, entry] as const))(
    "%s: flat-wrapped example renders WITHOUT a NodeErrorFallback",
    (_type, entry) => {
      const spec = buildCatalogExampleSpec(entry) as SpecRoot;
      const html = renderToStaticMarkup(
        React.createElement(SpecRenderer, { spec }),
      );

      expect(html).not.toContain(FALLBACK_MARKER);
      expect(html).not.toContain(FALLBACK_NODE_PREFIX);
      expect(html).not.toContain(FALLBACK_REASON_PROPS);
      expect(html).not.toContain(FALLBACK_REASON_RENDER);
    },
  );
});
