import { describe, expect, it } from "vitest";

import { validateIslandCode } from "./validate-island-code";
import { ADVERSARIAL_FIXTURES } from "./fixtures/adversarial";
import { CURVEBALL_SOUNDSCAPE_CODE } from "./fixtures/curveball";

describe("validateIslandCode — allowlist blocks every adversarial escape", () => {
  it.each(ADVERSARIAL_FIXTURES.map((f) => [f.name, f.code, f.expectedRule] as const))(
    "blocks %s",
    (_name, code, expectedRule) => {
      const result = validateIslandCode(code);
      expect(result.ok).toBe(false);
      expect(result.violations.map((v) => v.rule)).toContain(expectedRule);
    },
  );
});

describe("validateIslandCode — accepts safe island code", () => {
  it("accepts the curveball canvas widget", () => {
    const result = validateIslandCode(CURVEBALL_SOUNDSCAPE_CODE);
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("accepts plain DOM-building code", () => {
    const code = `const el = document.createElement('div'); el.textContent = 'hi'; document.getElementById('island-root').appendChild(el);`;
    expect(validateIslandCode(code).ok).toBe(true);
  });
});

describe("validateIslandCode — no false positives on benign name positions", () => {
  it("does not flag a forbidden name used as an object-literal key", () => {
    expect(validateIslandCode("const o = { parent: 1, fetch: 2 };").ok).toBe(true);
  });

  it("does not flag a forbidden name used as a non-window member property", () => {
    expect(validateIslandCode("const store = {}; store.localStorage = 1; api.fetch();").ok).toBe(true);
  });

  it("does not flag a member property access unrelated to window/document/navigator", () => {
    expect(validateIslandCode("const x = config.top; layout.parent();").ok).toBe(true);
  });
});

describe("validateIslandCode — syntax errors are recovered, not thrown", () => {
  it("returns syntaxErrors without throwing", () => {
    const result = validateIslandCode("const x = ;");
    expect(result.syntaxErrors.length).toBeGreaterThan(0);
  });
});
