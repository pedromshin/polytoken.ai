/**
 * region-vocabulary.test.ts — 60-04-PLAN.md Task 1 (tdd="true"): RED before
 * `region-vocabulary.ts` exists (or before it implements the behaviour
 * below), GREEN after. Covers every `<behavior>` bullet.
 */

import { describe, expect, it } from "vitest";

import {
  REGION_ROLE_GEOMETRY,
  REGION_TIER,
  regionLabelFor,
  tierOf,
} from "../region-vocabulary";

describe("tierOf — the tier truth (§C)", () => {
  it('maps "confirmed" to "confirmed"', () => {
    expect(tierOf("confirmed")).toBe("confirmed");
  });

  it('maps "candidate" and "pending" to "suggested"', () => {
    expect(tierOf("candidate")).toBe("suggested");
    expect(tierOf("pending")).toBe("suggested");
  });

  it('maps "rejected" and "superseded" to "terminal"', () => {
    expect(tierOf("rejected")).toBe("terminal");
    expect(tierOf("superseded")).toBe("terminal");
  });

  it("defaults ANY unrecognized status to \"suggested\", NEVER \"confirmed\" (T-60-08)", () => {
    // Tier is a claim about whether a HUMAN confirmed a fact. A new/unknown
    // status value must never silently inherit a confirmation the user
    // never gave — the suggest-only default is a correctness requirement,
    // not an arbitrary fallback.
    expect(tierOf("some-future-status")).toBe("suggested");
    expect(tierOf("")).toBe("suggested");
    expect(tierOf("CONFIRMED")).toBe("suggested"); // case-sensitive, not fuzzy
  });
});

describe("REGION_TIER — tier is the ONLY thing that carries colour", () => {
  it("confirmed classes reference conf tokens and are SOLID (no border-dashed)", () => {
    const { box } = REGION_TIER.confirmed;
    expect(box).toContain("conf");
    expect(box).not.toContain("border-dashed");
  });

  it("suggested classes reference sugg tokens and are DASHED", () => {
    const { box } = REGION_TIER.suggested;
    expect(box).toContain("sugg");
    expect(box).toContain("border-dashed");
  });

  it("terminal references NO tier token at all — a rejected/superseded region makes no tier claim", () => {
    const { box } = REGION_TIER.terminal;
    expect(box).not.toContain("conf");
    expect(box).not.toContain("sugg");
  });

  it("every tier's selection ring is ink — never a tier hue (law 1)", () => {
    for (const tier of Object.values(REGION_TIER)) {
      expect(tier.ring).toContain("ink");
      expect(tier.ring).not.toContain("conf");
      expect(tier.ring).not.toContain("sugg");
    }
  });

  it("no REGION_TIER value anywhere contains the substring \"graph-\"", () => {
    for (const tier of Object.values(REGION_TIER)) {
      expect(tier.box).not.toContain("graph-");
      expect(tier.chip).not.toContain("graph-");
      expect(tier.ring).not.toContain("graph-");
    }
  });
});

describe("REGION_ROLE_GEOMETRY — role carries structure, NEVER colour (law 3)", () => {
  const COLOUR_UTILITY_PATTERN = /\b(?:bg|text|ring)-|border-(?:conf|sugg|graph)/;

  it("no value contains a colour utility naming a tier or graph token", () => {
    for (const value of Object.values(REGION_ROLE_GEOMETRY)) {
      expect(value).not.toMatch(COLOUR_UTILITY_PATTERN);
    }
  });

  it('no value contains the substring "graph-"', () => {
    for (const value of Object.values(REGION_ROLE_GEOMETRY)) {
      expect(value).not.toContain("graph-");
    }
  });

  it("no value uses border-dashed — tier already owns solid-vs-dashed", () => {
    for (const value of Object.values(REGION_ROLE_GEOMETRY)) {
      expect(value).not.toContain("border-dashed");
    }
  });

  it("all four roles are structurally distinct (role must stay legible, not just hue-free)", () => {
    const values = Object.values(REGION_ROLE_GEOMETRY);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("regionLabelFor — B1's precedence, now discriminated by provenance (law 2)", () => {
  it('returns { kind: "type", text } when entityTypeLabel is present', () => {
    expect(
      regionLabelFor({
        entityTypeLabel: "Supplier",
        contentText: "Acme Freight Ltda",
        extractionStatus: "confirmed",
      }),
    ).toEqual({ kind: "type", text: "Supplier" });
  });

  it('falls back to { kind: "text", text } (a content snippet) when entityTypeLabel is null', () => {
    expect(
      regionLabelFor({
        entityTypeLabel: null,
        contentText: "  R$ 4.820,00  ",
        extractionStatus: "candidate",
      }),
    ).toEqual({ kind: "text", text: "R$ 4.820,00" });
  });

  it('falls back to { kind: "status", text } when neither entityTypeLabel nor usable contentText exist', () => {
    expect(
      regionLabelFor({
        entityTypeLabel: null,
        contentText: null,
        extractionStatus: "pending",
      }),
    ).toEqual({ kind: "status", text: "pending" });

    expect(
      regionLabelFor({
        entityTypeLabel: null,
        contentText: "   ",
        extractionStatus: "pending",
      }),
    ).toEqual({ kind: "status", text: "pending" });
  });

  it("preserves B1's exact precedence order (type wins even over non-blank contentText)", () => {
    expect(
      regionLabelFor({
        entityTypeLabel: "Amount",
        contentText: "some raw OCR text",
        extractionStatus: "confirmed",
      }),
    ).toEqual({ kind: "type", text: "Amount" });
  });
});
