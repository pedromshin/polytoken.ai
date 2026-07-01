import { describe, expect, it } from "vitest";

import {
  buildIslandSrcdoc,
  ISLAND_CSP_POLICY,
  ISLAND_SANDBOX,
} from "./build-island-srcdoc";

describe("ISLAND_SANDBOX — the jail must never grant same-origin", () => {
  it("is allow-scripts and NOT allow-same-origin", () => {
    expect(ISLAND_SANDBOX).toBe("allow-scripts");
    expect(ISLAND_SANDBOX).not.toContain("allow-same-origin");
  });
});

describe("ISLAND_CSP_POLICY — network egress killed by default", () => {
  it("sets default-src none and connect-src none", () => {
    expect(ISLAND_CSP_POLICY).toContain("default-src 'none'");
    expect(ISLAND_CSP_POLICY).toContain("connect-src 'none'");
  });
});

describe("buildIslandSrcdoc", () => {
  const nonce = "nonce-123";

  it("embeds the meta CSP as constructed and the mount root", () => {
    const html = buildIslandSrcdoc({ code: "1;", nonce });
    expect(html).toContain(`content="${ISLAND_CSP_POLICY}"`);
    expect(html).toContain('id="island-root"');
    expect(html).toContain('http-equiv="Content-Security-Policy"');
  });

  it("embeds the nonce and the user code", () => {
    const html = buildIslandSrcdoc({ code: "const marker = 42;", nonce });
    expect(html).toContain('"nonce-123"');
    expect(html).toContain("const marker = 42;");
  });

  it("neutralizes a </script> break-out attempt in the code", () => {
    const html = buildIslandSrcdoc({ code: "x = '</script><script>alert(1)</script>';", nonce });
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("<\\/script");
  });

  it("includes the axe pass only when axeSource is provided", () => {
    const without = buildIslandSrcdoc({ code: "1;", nonce });
    expect(without).not.toContain("window.axe");
    const withAxe = buildIslandSrcdoc({ code: "1;", nonce, axeSource: "window.axe = { run: function(){} };" });
    expect(withAxe).toContain("window.axe");
    expect(withAxe).toContain("island-a11y");
  });

  it("always posts island-ready to finalize", () => {
    expect(buildIslandSrcdoc({ code: "1;", nonce })).toContain("island-ready");
  });
});
