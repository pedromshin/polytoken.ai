import { describe, expect, it } from "vitest";

import { SAFE_PLACEHOLDER_SRCDOC, buildSafePlaceholderSrcdoc } from "./safe-placeholder";

describe("buildSafePlaceholderSrcdoc", () => {
  it("HTML-escapes the reason so no executable markup is injected", () => {
    const html = buildSafePlaceholderSrcdoc("<script>alert(1)</script> & \"quotes\" 'x'");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
    expect(html).toContain("&#39;");
  });

  it("renders an accessible alert region", () => {
    expect(buildSafePlaceholderSrcdoc()).toContain('role="alert"');
  });

  it("carries a locked-down CSP (no script execution)", () => {
    const html = buildSafePlaceholderSrcdoc("x");
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain("script-src");
  });

  it("SAFE_PLACEHOLDER_SRCDOC is the zero-arg default", () => {
    expect(SAFE_PLACEHOLDER_SRCDOC).toBe(buildSafePlaceholderSrcdoc());
  });
});
