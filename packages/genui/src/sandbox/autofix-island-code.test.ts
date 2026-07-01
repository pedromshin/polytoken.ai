import { describe, expect, it } from "vitest";

import { autofixIslandCode } from "./autofix-island-code";

describe("autofixIslandCode", () => {
  it("strips a leading `export default`", () => {
    const r = autofixIslandCode("export default function App(){ return 1; }");
    expect(r.code.startsWith("function App")).toBe(true);
    expect(r.applied).toContain("strip-export-default");
  });

  it("strips `export` from named declarations", () => {
    const r = autofixIslandCode("export const x = 1;\nexport function y(){}");
    expect(r.code).toContain("const x = 1;");
    expect(r.code).not.toContain("export ");
    expect(r.applied).toContain("strip-export-named");
  });

  it("leaves clean code unchanged with no transforms applied", () => {
    const code = "const el = document.createElement('div');";
    const r = autofixIslandCode(code);
    expect(r.code).toBe(code);
    expect(r.applied).toHaveLength(0);
  });
});
