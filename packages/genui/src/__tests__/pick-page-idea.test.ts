/**
 * __tests__/pick-page-idea.test.ts — Deterministic unit tests for the pure seedable
 * weighted sampler (pick-page-idea.ts).
 *
 * Coverage:
 *   1. weightFor — curveball 3x, Tier-B 2x, Tier-A 1x, composed multiplicatively
 *   2. pickPageIdea — deterministic with a stub rng; same input+rng → same output
 *   3. Empty input — throws a clear Error
 */

import { describe, expect, it } from "vitest";
import { weightFor, pickPageIdea } from "../studio/pick-page-idea";
import type { PageIdea } from "../eval/page-ideas-schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Tier-A non-curveball: weight should be 1 */
const tierA_nonCurveball: PageIdea = {
  id: 1,
  prompt: "A simple landing page",
  category: "Landing / Marketing",
  complexity: "simple",
  tier: "A",
  source: "https://example.com [verbatim]",
  curveball: false,
};

/** Tier-B non-curveball: weight should be 2 */
const tierB_nonCurveball: PageIdea = {
  id: 2,
  prompt: "An interactive dashboard",
  category: "Dashboard / Analytics",
  complexity: "medium",
  tier: "B",
  source: "https://example.com [verbatim]",
  curveball: false,
};

/** Tier-A curveball: weight should be 3 */
const tierA_curveball: PageIdea = {
  id: 3,
  prompt: "A soundscape mixer",
  category: "Creative / Weird",
  complexity: "complex",
  tier: "A",
  source: "https://example.com [verbatim]",
  curveball: true,
};

/** Tier-B curveball: weight should be 6 (3 * 2) */
const tierB_curveball: PageIdea = {
  id: 4,
  prompt: "A whiteboard collaboration tool",
  category: "Creative / Weird",
  complexity: "complex",
  tier: "B",
  source: "https://example.com [verbatim]",
  curveball: true,
};

// ---------------------------------------------------------------------------
// Block 1: weightFor
// ---------------------------------------------------------------------------

describe("weightFor — multiplicative curveball/tier weights (D-20)", () => {
  it("Tier-A non-curveball → weight 1", () => {
    expect(weightFor(tierA_nonCurveball)).toBe(1);
  });

  it("Tier-B non-curveball → weight 2", () => {
    expect(weightFor(tierB_nonCurveball)).toBe(2);
  });

  it("Tier-A curveball → weight 3 (curveball 3x)", () => {
    expect(weightFor(tierA_curveball)).toBe(3);
  });

  it("Tier-B curveball → weight 6 (curveball 3x * Tier-B 2x = 6)", () => {
    expect(weightFor(tierB_curveball)).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Block 2: pickPageIdea — determinism with a stub rng
// ---------------------------------------------------------------------------

describe("pickPageIdea — seedable deterministic sampler (D-20)", () => {
  const ideas: readonly PageIdea[] = [
    tierA_nonCurveball,
    tierB_nonCurveball,
    tierA_curveball,
    tierB_curveball,
  ];
  // Total weight: 1 + 2 + 3 + 6 = 12
  // Normalised cumulative: [1/12, 3/12, 6/12, 12/12] = [~0.083, 0.25, 0.5, 1.0]

  it("same stub rng always returns the same idea (determinism)", () => {
    const stubRng = (): number => 0.1; // falls in the second bucket (tierB_nonCurveball)
    const first = pickPageIdea(ideas, stubRng);
    const second = pickPageIdea(ideas, stubRng);
    expect(first.id).toBe(second.id);
  });

  it("rng=0 picks the first idea (smallest cumulative threshold)", () => {
    // 0 < 1/12 ≈ 0.0833 → first idea
    const result = pickPageIdea(ideas, () => 0);
    expect(result.id).toBe(tierA_nonCurveball.id);
  });

  it("rng=0.1 picks tierB_nonCurveball (second bucket: 1/12 < 0.1 ≤ 3/12)", () => {
    const result = pickPageIdea(ideas, () => 0.1);
    expect(result.id).toBe(tierB_nonCurveball.id);
  });

  it("rng=0.26 picks tierA_curveball (third bucket: 3/12 < 0.26 ≤ 6/12)", () => {
    const result = pickPageIdea(ideas, () => 0.26);
    expect(result.id).toBe(tierA_curveball.id);
  });

  it("rng=0.51 picks tierB_curveball (fourth bucket: 6/12 < 0.51 ≤ 12/12)", () => {
    const result = pickPageIdea(ideas, () => 0.51);
    expect(result.id).toBe(tierB_curveball.id);
  });

  it("rng very close to 1 still picks a valid idea (boundary)", () => {
    const result = pickPageIdea(ideas, () => 0.9999);
    expect(ideas.map((i) => i.id)).toContain(result.id);
  });

  it("single-item array always returns that item regardless of rng", () => {
    const single = [tierA_nonCurveball] as const;
    expect(pickPageIdea(single, () => 0.5).id).toBe(tierA_nonCurveball.id);
  });

  it("heavy-weight ideas appear more often with uniform sampling", () => {
    // With 100 draws using ascending rng values, curveball Tier-B should dominate
    const results = Array.from({ length: 100 }, (_, i) => {
      const r = (i + 0.5) / 100; // uniform spread [0.005, 0.015, ..., 0.995]
      return pickPageIdea(ideas, () => r);
    });
    const tierBCurveballCount = results.filter(
      (idea) => idea.id === tierB_curveball.id,
    ).length;
    // tierB_curveball has 6/12 = 50% of the weight → expect ≥ 40 in 100 draws
    expect(tierBCurveballCount).toBeGreaterThanOrEqual(40);
  });
});

// ---------------------------------------------------------------------------
// Block 3: empty array — throws a clear Error
// ---------------------------------------------------------------------------

describe("pickPageIdea — empty array contract", () => {
  it("throws an Error when given an empty array", () => {
    expect(() => pickPageIdea([], () => 0.5)).toThrow(Error);
  });

  it("thrown error message mentions the empty array", () => {
    expect(() => pickPageIdea([], () => 0.5)).toThrow(/empty/i);
  });
});
