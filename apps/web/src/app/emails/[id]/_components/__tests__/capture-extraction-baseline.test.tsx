/**
 * capture-extraction-baseline.test.tsx — 60-05-PLAN.md Task 1: freezes the
 * pre-Phase-60 `ExtractionSummaryPanel` DOM shape as a committed artifact
 * (`__baselines__/extraction-summary-pre-60.json`) BEFORE the component is
 * edited.
 *
 * ORDER IS THE WHOLE POINT. `extraction-summary-panel.tsx` is untouched by
 * Plans 01-04, so its state at the moment this capture ran IS the
 * pre-Phase-60 state — but only until Task 2 rewrites it. Capturing after the
 * rewrite would compare the redesign against itself and make Task 3's
 * structural-delta gate vacuous.
 *
 * Mirrors `../../../_components/__tests__/capture-inbox-baseline.test.tsx`'s
 * convention exactly, minus one thing it does not need: `ExtractionSummaryPanel`
 * is a pure presentational component — it takes `components` as a prop and
 * makes no tRPC call — so there is NO `vi.mock("~/trpc/react")` here.
 *
 * The fixture AND the render are imported from `support/` rather than inlined,
 * so `extraction-summary-structure.test.tsx` (Task 3) provably mounts the
 * IDENTICAL input this baseline was frozen from — see those modules' headers
 * for why that identity is load-bearing here and why the inbox pair's
 * copy-paste convention does not apply.
 *
 * Artifact-safety (identical to the inbox capture's): the capture only WRITES
 * when `CAPTURE_STRUCTURE_BASELINE` is `"1"` (`describe.skipIf` — a normal
 * `vitest run` neither writes nor fails) AND only when the artifact does not
 * already exist. If it exists, the capture throws rather than silently
 * overwriting — a post-60 rewrite of this artifact would make the delta gate
 * it feeds vacuous. A separate always-on test asserts the committed baseline
 * exists, parses, and is non-empty, so a missing artifact is loud, not silent.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { fingerprintTree } from "../../../../__tests__/support/structural-fingerprint";
import { renderExtractionPanel } from "./support/render-extraction-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = path.join(__dirname, "__baselines__");
const BASELINE_PATH = path.join(BASELINE_DIR, "extraction-summary-pre-60.json");

describe.skipIf(process.env.CAPTURE_STRUCTURE_BASELINE !== "1")(
  "capture-extraction-baseline (writes the frozen pre-60 artifact — CAPTURE_STRUCTURE_BASELINE=1 only)",
  () => {
    it("writes __baselines__/extraction-summary-pre-60.json from the CURRENT ExtractionSummaryPanel, once", async () => {
      if (existsSync(BASELINE_PATH)) {
        throw new Error(
          `${BASELINE_PATH} already exists. The pre-Phase-60 baseline is FROZEN and must never ` +
            "be regenerated — a post-60 rewrite would make the structural delta gate it feeds " +
            "vacuous. Delete the stray regeneration attempt; if the baseline is genuinely wrong, " +
            "that is a decision for a human, not this capture script.",
        );
      }

      const container = await renderExtractionPanel();
      const fingerprint = fingerprintTree(container);

      mkdirSync(BASELINE_DIR, { recursive: true });
      writeFileSync(BASELINE_PATH, `${JSON.stringify(fingerprint, null, 2)}\n`, "utf-8");

      // eslint-disable-next-line no-console -- deliberate one-time capture output
      console.log(
        `Captured extraction-summary-pre-60.json: elements=${fingerprint.elementCount} ` +
          `leafText=${fingerprint.leafTextCount} depth=${fingerprint.maxDepth}`,
      );

      expect(existsSync(BASELINE_PATH)).toBe(true);
    });
  },
);

describe("extraction-summary-pre-60.json (the committed, frozen artifact)", () => {
  it("exists, parses, and has a non-empty shape + elementCount > 0", () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);

    const raw = readFileSync(BASELINE_PATH, "utf-8");
    const parsed: unknown = JSON.parse(raw);

    expect(parsed).toMatchObject({
      shape: expect.any(String),
      elementCount: expect.any(Number),
      maxDepth: expect.any(Number),
      leafTextCount: expect.any(Number),
    });

    const baseline = parsed as { shape: string; elementCount: number; leafTextCount: number };
    expect(baseline.shape.length).toBeGreaterThan(0);
    expect(baseline.elementCount).toBeGreaterThan(0);
    expect(baseline.leafTextCount).toBeGreaterThan(0);
  });
});
