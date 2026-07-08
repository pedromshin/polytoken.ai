/**
 * eval-dimensions-assets.test.ts — CI gate for retrieval-golden-set.json and
 * injection-fixtures.json (Phase 35, EVAL-06/EVAL-07).
 *
 * Mirrors eval-assets.test.ts's style: import from `../eval/index`, one
 * `describe` block per asset, structural CI-gate assertions only.
 */

import { describe, it, expect } from "vitest";
import {
  RETRIEVAL_GOLDEN_SET,
  INJECTION_FIXTURES,
  RetrievalGoldenSetSchema,
  InjectionFixtureSetSchema,
} from "../eval/index";

/** A canary marker MUST be present in this exact bracket format. */
const CANARY_PATTERN = /\[CANARY:[^\]]+\]/;

// ───────────── RETRIEVAL_GOLDEN_SET (EVAL-06) ─────────────────────────────

describe("RETRIEVAL_GOLDEN_SET", () => {
  it("passes Zod schema validation", () => {
    const result = RetrievalGoldenSetSchema.safeParse(RETRIEVAL_GOLDEN_SET);
    expect(result.success).toBe(true);
  });

  it("has between 5 and 10 entries", () => {
    expect(RETRIEVAL_GOLDEN_SET.length).toBeGreaterThanOrEqual(5);
    expect(RETRIEVAL_GOLDEN_SET.length).toBeLessThanOrEqual(10);
  });

  it("every id is unique", () => {
    const ids = RETRIEVAL_GOLDEN_SET.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry has at least one expected_ids element", () => {
    const empty = RETRIEVAL_GOLDEN_SET.filter((e) => e.expected_ids.length === 0);
    expect(empty).toHaveLength(0);
  });

  it("all 3 kind values (email/entity/knowledge) appear somewhere across the set", () => {
    const kinds = new Set(
      RETRIEVAL_GOLDEN_SET.flatMap((e) => e.expected_ids.map((x) => x.kind)),
    );
    expect(kinds.has("email")).toBe(true);
    expect(kinds.has("entity")).toBe(true);
    expect(kinds.has("knowledge")).toBe(true);
  });

  it("every notes field is non-empty", () => {
    const empty = RETRIEVAL_GOLDEN_SET.filter((e) => !e.notes || e.notes.trim() === "");
    expect(empty).toHaveLength(0);
  });

  it("has at least 2 entries with multi-element expected_ids (non-trivial recall/precision math)", () => {
    const multi = RETRIEVAL_GOLDEN_SET.filter((e) => e.expected_ids.length > 1);
    expect(multi.length).toBeGreaterThanOrEqual(2);
  });
});

// ───────────── INJECTION_FIXTURES (EVAL-07) ───────────────────────────────

describe("INJECTION_FIXTURES", () => {
  it("passes Zod schema validation", () => {
    const result = InjectionFixtureSetSchema.safeParse(INJECTION_FIXTURES);
    expect(result.success).toBe(true);
  });

  it("has between 3 and 5 entries", () => {
    expect(INJECTION_FIXTURES.length).toBeGreaterThanOrEqual(3);
    expect(INJECTION_FIXTURES.length).toBeLessThanOrEqual(5);
  });

  it("every name is unique", () => {
    const names = INJECTION_FIXTURES.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every retrievedText embeds a [CANARY:...] marker", () => {
    const missing = INJECTION_FIXTURES.filter((f) => !CANARY_PATTERN.test(f.retrievedText));
    expect(missing).toHaveLength(0);
  });

  it("every expectedBehavior is non-empty", () => {
    const empty = INJECTION_FIXTURES.filter(
      (f) => !f.expectedBehavior || f.expectedBehavior.trim() === "",
    );
    expect(empty).toHaveLength(0);
  });
});
