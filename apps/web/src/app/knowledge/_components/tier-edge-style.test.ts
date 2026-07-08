import { describe, expect, it } from "vitest";

import { tierEdgeStyle } from "./tier-edge-style";

describe("tierEdgeStyle", () => {
  it("INFERRED returns a dashed muted stroke, no opacity override", () => {
    const result = tierEdgeStyle("INFERRED");
    expect(result.style?.strokeDasharray).toBe("5 3");
    expect(result.style?.stroke).toBe("hsl(var(--muted-foreground))");
    expect(result.style?.opacity).toBeUndefined();
    expect(result.labelStyle).toBeUndefined();
  });

  it("AMBIGUOUS returns a faint muted stroke with a dimmer label", () => {
    const result = tierEdgeStyle("AMBIGUOUS");
    expect(result.style?.stroke).toBe("hsl(var(--muted-foreground))");
    expect(result.style?.opacity).toBe(0.45);
    expect(result.labelStyle?.opacity).toBe(0.6);
    expect(result.style?.strokeDasharray).toBeUndefined();
  });

  it("EXTRACTED returns an empty object (React Flow default)", () => {
    expect(tierEdgeStyle("EXTRACTED")).toEqual({});
  });

  it("undefined (structural edges) returns an empty object", () => {
    expect(tierEdgeStyle(undefined)).toEqual({});
  });
});
