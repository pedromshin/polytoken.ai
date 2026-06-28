/**
 * eval-schema-parse-enforcement.test.ts — Regression test for CR-02.
 *
 * CR-02: Both PAGE_IDEAS and GOLDEN_SET must be parsed through
 * PageIdeaSetSchema.parse() at module load, NOT through an unsafe `as` cast.
 *
 * This test asserts:
 *   1. PAGE_IDEAS and GOLDEN_SET are frozen arrays (Object.freeze applied).
 *   2. PageIdeaSetSchema.parse() throws a ZodError when given a malformed
 *      fixture — proving that the schema is enforced, not bypassed with `as`.
 *   3. A single entry with an extra unknown field is rejected by .strict()
 *      (the same check that would catch schema drift in the JSON files).
 *
 * If a future refactor replaces parse() with an `as` cast, tests 2 and 3
 * will still pass (they test PageIdeaSetSchema directly), but the module-load
 * behaviour that throws on drift would be silently removed. The combination
 * of test 1 + tests 2/3 documents the intended contract.
 */

import { describe, it, expect } from "vitest";
import { PAGE_IDEAS, GOLDEN_SET, PageIdeaSetSchema } from "../eval/index";

// ---------------------------------------------------------------------------
// Regression: PAGE_IDEAS and GOLDEN_SET must be frozen (Object.freeze applied)
// ---------------------------------------------------------------------------

describe("CR-02 regression — PAGE_IDEAS and GOLDEN_SET are frozen (immutable)", () => {
  it("PAGE_IDEAS is frozen — cannot push to it at runtime", () => {
    // Object.freeze on an array prevents mutation.
    // The readonly type prevents this at compile time, but we also want a
    // runtime guard so that an accidental unfreeze is caught.
    expect(Object.isFrozen(PAGE_IDEAS)).toBe(true);
  });

  it("GOLDEN_SET is frozen — cannot push to it at runtime", () => {
    expect(Object.isFrozen(GOLDEN_SET)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression: PageIdeaSetSchema.parse() enforces .strict() validation.
// A malformed fixture MUST throw a ZodError — not silently produce wrong data.
// ---------------------------------------------------------------------------

describe("CR-02 regression — PageIdeaSetSchema.parse() rejects malformed data", () => {
  it("throws ZodError when an entry has an extra unknown field (strict mode rejects it)", () => {
    const malformedFixture = [
      {
        id: 1,
        prompt: "Show me an invoice",
        category: "data-display",
        complexity: "simple",
        tier: "A",
        source: "https://example.com [verbatim]",
        curveball: false,
        EXTRA_UNKNOWN_FIELD: "this should not be here",  // extra field
      },
    ];

    // .strict() in PageIdeaSchema means this MUST throw
    expect(() => PageIdeaSetSchema.parse(malformedFixture)).toThrow();
  });

  it("throws ZodError when a required field is missing", () => {
    const missingField = [
      {
        id: 1,
        prompt: "Show me an invoice",
        category: "data-display",
        complexity: "simple",
        tier: "A",
        // missing: source, curveball
      },
    ];

    expect(() => PageIdeaSetSchema.parse(missingField)).toThrow();
  });

  it("throws ZodError when complexity has an invalid value", () => {
    const badComplexity = [
      {
        id: 1,
        prompt: "Show me an invoice",
        category: "data-display",
        complexity: "INVALID_VALUE",  // must be simple|medium|complex
        tier: "A",
        source: "https://example.com [verbatim]",
        curveball: false,
      },
    ];

    expect(() => PageIdeaSetSchema.parse(badComplexity)).toThrow();
  });

  it("throws ZodError when tier has an invalid value", () => {
    const badTier = [
      {
        id: 1,
        prompt: "Show me an invoice",
        category: "data-display",
        complexity: "simple",
        tier: "C",  // must be A|B
        source: "https://example.com [verbatim]",
        curveball: false,
      },
    ];

    expect(() => PageIdeaSetSchema.parse(badTier)).toThrow();
  });

  it("accepts a well-formed entry (schema is not overly restrictive)", () => {
    const validFixture = [
      {
        id: 99,
        prompt: "Show me a dashboard",
        category: "data-display",
        complexity: "complex",
        tier: "B",
        source: "https://example.com [verbatim]",
        curveball: true,
      },
    ];

    const result = PageIdeaSetSchema.safeParse(validFixture);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.id).toBe(99);
    }
  });
});
