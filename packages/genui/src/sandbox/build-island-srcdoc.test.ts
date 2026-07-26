import { describe, expect, it } from "vitest";

import {
  buildIslandSrcdoc,
  ISLAND_CSP_POLICY,
  ISLAND_SANDBOX,
  MAX_ISLAND_DATA_BYTES,
  serializeIslandData,
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

  it("never allows 'unsafe-eval' (CSP-drift guard)", () => {
    expect(ISLAND_CSP_POLICY).not.toContain("unsafe-eval");
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

  it("shims module/exports so CommonJS-style emitted code does not ReferenceError", () => {
    const html = buildIslandSrcdoc({ code: "exports.x = 1;", nonce });
    expect(html).toContain("window.module = { exports: {} }");
    expect(html).toContain("window.exports = window.module.exports");
  });

  it("pins postMessage targetOrigin to the host origin when provided", () => {
    const html = buildIslandSrcdoc({ code: "1;", nonce, hostOrigin: "https://studio.example" });
    expect(html).toContain('TARGET_ORIGIN = "https://studio.example"');
    expect(html).not.toContain('parent.postMessage(Object.assign({ nonce: NONCE }, msg), \'*\')');
  });

  it("falls back to '*' targetOrigin only when hostOrigin is omitted", () => {
    const html = buildIslandSrcdoc({ code: "1;", nonce });
    expect(html).toContain('TARGET_ORIGIN = "*"');
  });
});

// ---------------------------------------------------------------------------
// Phase 76 (BTAP-01) — the island data channel. The jail is the whole product;
// these lock that the channel adds NO egress surface and stays inert.
// ---------------------------------------------------------------------------

describe("CSP/sandbox drift guard — the data channel must not relax the jail", () => {
  it("ISLAND_SANDBOX is byte-for-byte unchanged", () => {
    expect(ISLAND_SANDBOX).toBe("allow-scripts");
  });

  it("ISLAND_CSP_POLICY is byte-for-byte unchanged (connect-src none preserved)", () => {
    expect(ISLAND_CSP_POLICY).toBe(
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
        "img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none';",
    );
  });

  it("injecting data leaves the CSP + sandbox tokens identical", () => {
    const without = buildIslandSrcdoc({ code: "1;", nonce: "n" });
    const withData = buildIslandSrcdoc({ code: "1;", nonce: "n", data: { a: 1 } });
    const csp = `content="${ISLAND_CSP_POLICY}"`;
    expect(without).toContain(csp);
    expect(withData).toContain(csp);
    expect(withData).not.toContain("allow-same-origin");
    expect(withData).not.toContain("unsafe-eval");
  });
});

describe("serializeIslandData (BTAP-01) — validate before injection", () => {
  it("accepts a normal bounded object", () => {
    const r = serializeIslandData({ invoices: [{ id: 1, amount: 10 }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.json)).toEqual({ invoices: [{ id: 1, amount: 10 }] });
  });

  it("rejects prototype-pollution-keyed data at any depth", () => {
    expect(serializeIslandData({ a: { b: { constructor: 1 } } })).toEqual({
      ok: false,
      reason: "pollution",
    });
    expect(serializeIslandData([{ prototype: 1 }])).toEqual({
      ok: false,
      reason: "pollution",
    });
  });

  it("rejects non-serializable values (BigInt, cycles)", () => {
    expect(serializeIslandData({ n: 1n }).ok).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(serializeIslandData(cyclic)).toEqual({ ok: false, reason: "unserializable" });
  });

  it("rejects data over MAX_ISLAND_DATA_BYTES", () => {
    const big = { blob: "x".repeat(MAX_ISLAND_DATA_BYTES + 1) };
    expect(serializeIslandData(big)).toEqual({ ok: false, reason: "oversize" });
  });
});

describe("buildIslandSrcdoc data channel (BTAP-01)", () => {
  const nonce = "nonce-data";

  it("injects a deep-frozen __ISLAND_DATA__ global via JSON.parse (never eval)", () => {
    const html = buildIslandSrcdoc({ code: "1;", nonce, data: { invoices: [{ id: 1 }] } });
    expect(html).toContain("window.__ISLAND_DATA__");
    expect(html).toContain("JSON.parse(");
    expect(html).toContain("deepFreeze");
    // The data rides as an escaped JSON string literal, not an object literal /
    // eval — there is no bare `eval(` or `new Function` anywhere.
    expect(html).not.toContain("eval(");
    expect(html).not.toContain("new Function");
  });

  it("injects the data BEFORE the user code runs", () => {
    const html = buildIslandSrcdoc({
      code: "const marker = 42;",
      nonce,
      data: { ready: true },
    });
    expect(html.indexOf("__ISLAND_DATA__")).toBeLessThan(html.indexOf("const marker = 42;"));
  });

  it("does NOT inject a data global when data is omitted (back-compat)", () => {
    const html = buildIslandSrcdoc({ code: "1;", nonce });
    expect(html).not.toContain("__ISLAND_DATA__");
  });

  it("neutralizes a </script> breakout smuggled inside the data", () => {
    const html = buildIslandSrcdoc({
      code: "1;",
      nonce,
      data: { evil: "</script><script>alert(1)</script>" },
    });
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c");
  });

  it("degrades invalid (oversize) data to an empty object, never crashing the build", () => {
    const big = { blob: "x".repeat(MAX_ISLAND_DATA_BYTES + 1) };
    const html = buildIslandSrcdoc({ code: "1;", nonce, data: big });
    // Still injects the global (so reads don't ReferenceError) but with no data.
    expect(html).toContain("window.__ISLAND_DATA__");
    expect(html).not.toContain("x".repeat(1000));
  });
});
