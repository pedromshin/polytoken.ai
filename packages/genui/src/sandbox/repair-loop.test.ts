import { describe, expect, it } from "vitest";

import {
  isTerminal,
  onHealed,
  onRunSuccess,
  onRuntimeError,
  startIsland,
} from "./repair-loop";
import { CURVEBALL_SOUNDSCAPE_CODE } from "./fixtures/curveball";
import {
  BROKEN_ISLAND_CODE,
  HEALED_ISLAND_CODE,
  UNREPAIRABLE_ISLAND_CODE,
} from "./fixtures/repair";

describe("startIsland", () => {
  it("routes safe code to running", () => {
    const s = startIsland(CURVEBALL_SOUNDSCAPE_CODE);
    expect(s.phase).toBe("running");
    expect(s.code.length).toBeGreaterThan(0);
  });

  it("rejects code with allowlist violations without running it", () => {
    const s = startIsland("fetch('https://evil.example');");
    expect(s.phase).toBe("rejected");
    expect(s.code).toBe("");
    expect(s.violations.length).toBeGreaterThan(0);
    expect(isTerminal(s.phase)).toBe(true);
  });
});

describe("happy path", () => {
  it("running → rendered on first success (no heals)", () => {
    const s = onRunSuccess(startIsland(CURVEBALL_SOUNDSCAPE_CODE));
    expect(s.phase).toBe("rendered");
    expect(s.attempts).toBe(0);
  });
});

describe("self-heal path", () => {
  it("running → healing → (healed code) running → healed on success", () => {
    let s = startIsland(BROKEN_ISLAND_CODE);
    expect(s.phase).toBe("running");
    s = onRuntimeError(s, "ReferenceError: renderWidget is not defined");
    expect(s.phase).toBe("healing");
    s = onHealed(s, HEALED_ISLAND_CODE);
    expect(s.phase).toBe("running");
    expect(s.attempts).toBe(1);
    s = onRunSuccess(s);
    expect(s.phase).toBe("healed");
  });

  it("re-validates healed code and rejects a malicious heal (never runs it)", () => {
    let s = startIsland(BROKEN_ISLAND_CODE);
    s = onRuntimeError(s, "boom");
    s = onHealed(s, "fetch('https://evil.example');");
    expect(s.phase).toBe("rejected");
    expect(s.violations.length).toBeGreaterThan(0);
  });
});

describe("circuit breaker", () => {
  it("falls back when the healer gives up", () => {
    let s = startIsland(UNREPAIRABLE_ISLAND_CODE);
    s = onRuntimeError(s, "boom");
    s = onHealed(s, null);
    expect(s.phase).toBe("fallback");
  });

  it("falls back after exhausting the heal budget (maxAttempts=2)", () => {
    let s = startIsland(BROKEN_ISLAND_CODE, { maxAttempts: 2 });
    // attempt 0 fails → heal → attempt 1
    s = onHealed(onRuntimeError(s, "e0"), BROKEN_ISLAND_CODE);
    expect(s.attempts).toBe(1);
    // attempt 1 fails → heal → attempt 2
    s = onHealed(onRuntimeError(s, "e1"), BROKEN_ISLAND_CODE);
    expect(s.attempts).toBe(2);
    // attempt 2 fails → budget spent → fallback (no more healing)
    s = onRuntimeError(s, "e2");
    expect(s.phase).toBe("fallback");
  });
});

describe("transition guards", () => {
  it("ignores events in terminal states", () => {
    const rendered = onRunSuccess(startIsland(CURVEBALL_SOUNDSCAPE_CODE));
    expect(onRuntimeError(rendered, "late").phase).toBe("rendered");
    expect(onHealed(rendered, "x").phase).toBe("rendered");
  });
});
