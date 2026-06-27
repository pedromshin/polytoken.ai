/**
 * derive-generation-state.test.ts — unit tests for the deriveGenerationState helper.
 *
 * Covers the §9 State Transition Summary table from 15-UI-SPEC:
 *   isPending=true           => kind:"in_progress", escalated:false
 *   outcome:"fallback"       => kind:"fallback",    escalated:false, reason forwarded
 *   outcome:"ok"+cacheHit    => kind:"cache_hit",   escalated:false
 *   outcome:"ok"+!cacheHit   => kind:"cold",        escalated:false
 *   outcome:"escalated"      => kind:"cold",        escalated:true
 *   immutability             => each call returns a NEW object
 */

import { describe, expect, it } from "vitest";

import { deriveGenerationState } from "../derive-generation-state";

describe("deriveGenerationState — §9 State Transition Summary", () => {
  it("isPending=true → in_progress, escalated=false (highest priority)", () => {
    const result = deriveGenerationState({ isPending: true });
    expect(result.kind).toBe("in_progress");
    expect(result.escalated).toBe(false);
  });

  it("isPending=true overrides any outcome (even fallback)", () => {
    const result = deriveGenerationState({
      isPending: true,
      outcome: "fallback",
      reason: "some reason",
    });
    expect(result.kind).toBe("in_progress");
    expect(result.escalated).toBe(false);
  });

  it("outcome='fallback' → kind:fallback, escalated:false, reason forwarded", () => {
    const result = deriveGenerationState({
      isPending: false,
      outcome: "fallback",
      cacheHit: false,
      reason: "spec re-validation failed",
    });
    expect(result.kind).toBe("fallback");
    expect(result.escalated).toBe(false);
    expect(result.reason).toBe("spec re-validation failed");
  });

  it("outcome='fallback' with no reason → reason absent from result", () => {
    const result = deriveGenerationState({
      isPending: false,
      outcome: "fallback",
      cacheHit: false,
    });
    expect(result.kind).toBe("fallback");
    expect(result.reason).toBeUndefined();
  });

  it("outcome='ok' + cacheHit=true → kind:cache_hit, escalated:false", () => {
    const result = deriveGenerationState({
      isPending: false,
      outcome: "ok",
      cacheHit: true,
    });
    expect(result.kind).toBe("cache_hit");
    expect(result.escalated).toBe(false);
  });

  it("outcome='ok' + cacheHit=false → kind:cold, escalated:false", () => {
    const result = deriveGenerationState({
      isPending: false,
      outcome: "ok",
      cacheHit: false,
    });
    expect(result.kind).toBe("cold");
    expect(result.escalated).toBe(false);
  });

  it("outcome='escalated' → kind:cold, escalated:true (D-03d: sub-flavor of cold)", () => {
    const result = deriveGenerationState({
      isPending: false,
      outcome: "escalated",
      cacheHit: false,
    });
    expect(result.kind).toBe("cold");
    expect(result.escalated).toBe(true);
  });

  it("no outcome/cacheHit provided → defaults to cold (outcome defaults to 'ok', cacheHit to false)", () => {
    const result = deriveGenerationState({ isPending: false });
    expect(result.kind).toBe("cold");
    expect(result.escalated).toBe(false);
  });
});

describe("deriveGenerationState — immutability (CLAUDE.md)", () => {
  it("returns a NEW object on every call (not a shared mutable reference)", () => {
    const input = { isPending: false, outcome: "ok" as const, cacheHit: false };
    const a = deriveGenerationState(input);
    const b = deriveGenerationState(input);

    // Different reference
    expect(a).not.toBe(b);
    // Same content
    expect(a).toEqual(b);
  });
});
