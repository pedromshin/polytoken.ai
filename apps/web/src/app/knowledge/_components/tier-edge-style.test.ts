import { describe, expect, it } from "vitest";

import { tierEdgeStyle } from "./tier-edge-style";

describe("tierEdgeStyle", () => {
  it("INFERRED returns a dashed tier-inferred stroke, no opacity override", () => {
    const result = tierEdgeStyle("INFERRED");
    expect(result.style?.strokeDasharray).toBe("5 3");
    expect(result.style?.stroke).toBe("hsl(var(--tier-inferred))");
    expect(result.style?.opacity).toBeUndefined();
    expect(result.labelStyle).toBeUndefined();
  });

  it("AMBIGUOUS returns a faint tier-inferred stroke with a dimmer label", () => {
    const result = tierEdgeStyle("AMBIGUOUS");
    expect(result.style?.stroke).toBe("hsl(var(--tier-inferred))");
    expect(result.style?.opacity).toBe(0.45);
    expect(result.labelStyle?.opacity).toBe(0.6);
    expect(result.style?.strokeDasharray).toBeUndefined();
  });

  it("EXTRACTED returns an explicit tier-extracted stroke", () => {
    const result = tierEdgeStyle("EXTRACTED");
    expect(result.style?.stroke).toBe("hsl(var(--tier-extracted))");
    expect(result.style?.strokeDasharray).toBeUndefined();
    expect(result.style?.opacity).toBeUndefined();
    expect(result.labelStyle).toBeUndefined();
  });

  it("undefined (structural edges) returns an empty object", () => {
    expect(tierEdgeStyle(undefined)).toEqual({});
  });
});
