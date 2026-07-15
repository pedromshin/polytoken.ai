/**
 * extraction-summary-structure.test.tsx — 60-05-PLAN.md Task 3: the
 * extraction surface's shape gate, built the same way the inbox is gated
 * (`_components/__tests__/inbox-structure.test.tsx`).
 *
 * Unlike the overlay box — which was a pure re-encoding and where a structural
 * delta would have been dishonest evidence — this surface genuinely
 * RESTRUCTURES, so a colour-blind shape delta IS the honest evidence here.
 *
 * Mounts the CURRENT panel through `support/render-extraction-panel.tsx`, the
 * exact render `capture-extraction-baseline.test.tsx` froze the baseline from
 * (same fixture, same props — an unfair fixture would invalidate the
 * comparison, and the props decide whether the confirm affordance renders at
 * all).
 *
 * SIX LEGS:
 *   1. LAYOUT + HIERARCHY — `shape` differs from the frozen pre-60 baseline.
 *   2. INFORMATION DENSITY — `elementCount` and `leafTextCount` both grew.
 *   3. LAW 2 — values are serif evidence, and serif and `data-evidence` imply
 *      each other in BOTH directions (serif must never drift onto chrome).
 *   4. TIER IS A WORD — every tier badge declares a valid tier AND renders a
 *      visible one, which the pre-60 `sr-only` dot would fail.
 *   5. A CANDIDATE IS AMBER — the CONTEXT-flagged regression, asserted
 *      directly. Proven able to fail; see the negative proof below.
 *   6. XSS (T-60-02) — the panel never reaches for dangerouslySetInnerHTML.
 *
 * THE NEGATIVE PROOF (required — RED output recorded verbatim in
 * 60-05-SUMMARY.md): Leg 5 was proven able to fail by temporarily
 * reintroducing the exact violation 60-CONTEXT.md names — a tone map whose
 * `candidate` entry is the node-TYPE hue — into the panel's tier badge, and
 * confirming Leg 5 went RED. The tree was then restored and `git diff --stat`
 * against the Task 2 commit confirmed empty. A gate that has never been seen
 * to fail is not evidence.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { fingerprintTree } from "../../../../__tests__/support/structural-fingerprint";
import { renderExtractionPanel } from "./support/render-extraction-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = path.join(__dirname, "__baselines__", "extraction-summary-pre-60.json");

interface Baseline {
  readonly shape: string;
  readonly elementCount: number;
  readonly leafTextCount: number;
}

function readBaseline(): Baseline {
  return JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as Baseline;
}

const VALID_TIERS = ["confirmed", "suggested", "terminal"];

describe("extraction-summary-structure (SURF-04 — the extraction surface's shape gate)", () => {
  it("Leg 1: layout + hierarchy — shape differs from the frozen pre-60 baseline", async () => {
    const baseline = readBaseline();
    const container = await renderExtractionPanel();
    const current = fingerprintTree(container);

    // WHY THIS PROVES criterion 3's "visibly improved in hierarchy", and not
    // merely "recoloured": `fingerprintTree` reads NO className, NO style and
    // NO data-* attribute (structural-fingerprint.ts's central design
    // constraint). So no amount of recolouring — not the candidate's hue
    // moving from a node-type grey to pencil-amber, not one token swapped for
    // another — can move `shape` by so much as a character. Only real DOM
    // restructuring can. What moved it here: the tier BADGE (a swatch + a real
    // word) replacing the dot + sr-only label, the label-over-value band
    // replacing the justify-between label/value/dot row, and the entity header
    // gaining its own evidence line.
    expect(current.shape).not.toBe(baseline.shape);
  });

  it("Leg 2: information density — elementCount and leafTextCount both grew", async () => {
    const baseline = readBaseline();
    const container = await renderExtractionPanel();
    const current = fingerprintTree(container);

    expect(
      current.elementCount,
      `elementCount did not grow: baseline=${baseline.elementCount} current=${current.elementCount}`,
    ).toBeGreaterThan(baseline.elementCount);

    // jsdom does not evaluate Tailwind CSS, so an honest px-density metric is
    // not available here (that is the screenshot harness's job). What IS
    // measurable is how many distinct FACTS the panel renders.
    //
    // NOTE, because the arithmetic is not what it first looks like: swapping
    // the sr-only tier word for a visible one does NOT move this number.
    // `fingerprintTree` is class-blind, so it already counted the sr-only text
    // as a rendered fact — the pre-60 `sr-only` label was invisible to users
    // but never to this metric. The growth is real and comes from elsewhere:
    // each entity header now renders the entity's OWN detected words as
    // evidence. Pre-60 the header could say "Supplier" but never WHICH
    // supplier — the one question a "what did we pull out of this document"
    // registry exists to answer.
    expect(
      current.leafTextCount,
      `leafTextCount did not grow: baseline=${baseline.leafTextCount} current=${current.leafTextCount}`,
    ).toBeGreaterThan(baseline.leafTextCount);
  });

  it("Leg 3: law 2 — every value is serif evidence, and serif never drifts onto chrome", async () => {
    const container = await renderExtractionPanel();

    // Every rendered value is BOTH serif and marked as evidence.
    const valueEls = Array.from(container.querySelectorAll<HTMLElement>('[data-field="value"]'));
    expect(valueEls.length).toBeGreaterThan(0);
    for (const el of valueEls) {
      expect(el.className).toContain("font-serif");
      expect(el.hasAttribute("data-evidence")).toBe(true);
    }

    // Forward direction: every [data-evidence] element is serif.
    const evidenceEls = Array.from(container.querySelectorAll<HTMLElement>("[data-evidence]"));
    expect(evidenceEls.length).toBeGreaterThan(0);
    for (const el of evidenceEls) {
      expect(el.className).toContain("font-serif");
    }

    // Reverse direction — the half that actually bites: nothing carries the
    // serif without being evidence. This is what would catch the serif
    // creeping onto a label, a tier word, or a count.
    const serifEls = Array.from(container.querySelectorAll<HTMLElement>('[class*="font-serif"]'));
    expect(serifEls.length).toBeGreaterThan(0);
    for (const el of serifEls) {
      expect(
        el.hasAttribute("data-evidence"),
        `font-serif on a non-evidence element (chrome must speak sans): <${el.tagName.toLowerCase()} class="${el.className}">`,
      ).toBe(true);
    }
  });

  it("Leg 4: tier is a WORD, not a dot with an invisible label", async () => {
    const container = await renderExtractionPanel();

    const badges = Array.from(
      container.querySelectorAll<HTMLElement>('[data-field="tier-badge"]'),
    );
    expect(badges.length).toBeGreaterThan(0);

    for (const el of badges) {
      // Asserted through the ATTRIBUTE, never by reading colour — this leg
      // stays colour-blind and therefore honest.
      expect(VALID_TIERS).toContain(el.getAttribute("data-tier"));

      // The assertion the pre-60 StatusDot would FAIL: its word lived in an
      // `sr-only` span, so a sighted user got a 2x2 dot and nothing else.
      // (`textContent` sees sr-only text too, so this alone would not catch
      // it — which is exactly why Leg 5 asserts the tier's own token class,
      // and why the sr-only span is gone rather than merely restyled.)
      expect(
        (el.textContent ?? "").trim().length,
        "a tier badge rendered no visible word",
      ).toBeGreaterThan(0);
    }
  });

  it("Leg 5: a candidate is pencil-amber — never a node-type hue (the CONTEXT-flagged regression)", async () => {
    const container = await renderExtractionPanel();

    const suggestedBadges = Array.from(
      container.querySelectorAll<HTMLElement>('[data-field="tier-badge"][data-tier="suggested"]'),
    );
    // The fixture carries candidate AND pending rows, both of which tierOf
    // maps to "suggested" — if this is 0, the fixture stopped covering the
    // very tier this leg exists to police.
    expect(suggestedBadges.length).toBeGreaterThan(0);

    for (const el of suggestedBadges) {
      expect(
        el.className,
        "a suggested tier must wear the sugg token — this is the tier's whole claim",
      ).toContain("sugg");
      expect(
        el.className,
        "a suggested tier must never wear a confirmed token — that would claim a confirmation no human gave (T-60-08)",
      ).not.toContain("conf");
      // The exact pre-60 violation: a node-TYPE hue standing in for a TIER,
      // breaking laws 1 and 3 at once.
      expect(
        el.className,
        "a tier must never be painted with a node-type hue (law 3)",
      ).not.toMatch(/graph-/);
    }
  });

  it("Leg 6 (T-60-02): the extraction panel never uses dangerouslySetInnerHTML", () => {
    const source = readFileSync(
      path.join(__dirname, "..", "extraction-summary-panel.tsx"),
      "utf-8",
    );
    // Filter comment lines out first, mirroring palette-ban.test.ts's
    // source-walking idiom, so a header comment mentioning the string cannot
    // self-invalidate the gate.
    const codeOnly = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    expect(codeOnly).not.toContain("dangerouslySetInnerHTML");
  });
});
