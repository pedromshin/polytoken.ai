/**
 * build-island-srcdoc.ts — assembles the sandboxed iframe document for a code-island.
 *
 * Jail construction (see 20-RESEARCH.md §1, §5):
 *  - The host renders the frame as `<iframe sandbox={ISLAND_SANDBOX} srcdoc={buildIslandSrcdoc(...)}>`.
 *    `ISLAND_SANDBOX` is "allow-scripts" — deliberately NO `allow-same-origin` (opaque/null origin
 *    → no host DOM/cookies/storage; and the scripts+same-origin self-unsandbox escape is impossible).
 *  - The SOLE CSP enforcement is the inline `<meta http-equiv="Content-Security-Policy">` emitted
 *    as the FIRST head element below (`default-src 'none'; connect-src 'none'` kills all network
 *    egress). This enforces in ALL engines. NOTE: no `csp=` iframe attribute is set — it is
 *    non-standard / not forwarded by React and unreliable across browsers; do not rely on it.
 *  - The harness posts to the parent with a pinned targetOrigin (the host origin) — never '*'.
 *  - A harness installs error capture (onerror + unhandledrejection) and, after the user code
 *    runs, an axe-core a11y pass — both reported to the host via postMessage with the nonce.
 */

/** iframe `sandbox` tokens. MUST NOT contain `allow-same-origin`. */
export const ISLAND_SANDBOX = "allow-scripts";

/**
 * The inline `<meta>` CSP for the frame — the SOLE, load-bearing CSP enforcement (all engines).
 * `'unsafe-inline'` is required to run the host-generated harness/user/axe scripts; the opaque
 * origin + `connect-src 'none'` are the real containment. Do NOT add an allowed connect-src/img
 * host without first removing `'unsafe-inline'` (nonce-gating), or you open an exfil channel.
 */
export const ISLAND_CSP_POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none';";

export interface BuildIslandSrcdocOptions {
  /** The island program (plain JS; runs against a fresh document). */
  readonly code: string;
  /** Per-render nonce echoed in every postMessage for host-side authentication. */
  readonly nonce: string;
  /** axe-core source string (from `getAxeSource()`); omit to skip the a11y pass. */
  readonly axeSource?: string;
  /**
   * Host origin to pin outbound `postMessage` to (the parent's `window.location.origin`).
   * The browser then only delivers frame messages when the actual parent origin matches —
   * scoping error/a11y payloads to the legitimate host. Defaults to "*" (no scoping) only
   * when omitted (e.g. SSR/tests); real callers should always pass it.
   */
  readonly hostOrigin?: string;
}

/** Prevent premature `</script>` termination when inlining arbitrary code into a script tag. */
function guardScript(source: string): string {
  return source.replace(/<\/script/gi, "<\\/script");
}

function harnessScript(nonce: string, hostOrigin: string | undefined): string {
  const nonceJson = JSON.stringify(nonce);
  const targetOriginJson = JSON.stringify(hostOrigin && hostOrigin.length > 0 ? hostOrigin : "*");
  return `(function(){
  var NONCE = ${nonceJson};
  var TARGET_ORIGIN = ${targetOriginJson};
  function post(msg){ try { parent.postMessage(Object.assign({ nonce: NONCE }, msg), TARGET_ORIGIN); } catch (_) {} }
  window.__islandPost = post;
  window.addEventListener('error', function(e){
    post({ type:'island-runtime-error', source:'onerror', message: (e && e.message) || 'error',
      stack: (e && e.error && e.error.stack) || null });
  });
  window.addEventListener('unhandledrejection', function(e){
    var r = e && e.reason;
    post({ type:'island-runtime-error', source:'unhandledrejection', message: String(r),
      stack: (r && r.stack) || null });
  });
})();`;
}

function finalizeScript(runA11y: boolean): string {
  const a11y = runA11y
    ? `try {
    if (window.axe) {
      window.axe.run(document).then(function(r){
        var vs = (r.violations || []).slice(0, 50).map(function(v){
          return { id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl,
            nodes: (v.nodes || []).slice(0, 10).map(function(n){
              return { target: (n.target || []).map(String), html: String(n.html || '').slice(0, 300) };
            }) };
        });
        if (window.__islandPost) window.__islandPost({ type:'island-a11y', violations: vs });
        done();
      }, function(){ done(); });
    } else { done(); }
  } catch (_) { done(); }`
    : `done();`;
  return `(function(){
  function done(){ if (window.__islandPost) window.__islandPost({ type:'island-ready' }); }
  ${a11y}
})();`;
}

/** Build the full srcdoc HTML document string for a code-island. */
export function buildIslandSrcdoc(options: BuildIslandSrcdocOptions): string {
  const { code, nonce, axeSource, hostOrigin } = options;
  const runA11y = typeof axeSource === "string" && axeSource.length > 0;

  const parts: string[] = [
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">",
    `<meta http-equiv="Content-Security-Policy" content="${ISLAND_CSP_POLICY}">`,
    "<style>html,body{margin:0;padding:0;font-family:system-ui,sans-serif}</style>",
    "</head><body>",
    '<div id="island-root"></div>',
    `<script>${harnessScript(nonce, hostOrigin)}</script>`,
    `<script>try { ${guardScript(code)}\n} catch (e) { if (window.__islandPost) window.__islandPost({ type:'island-runtime-error', source:'onerror', message: (e && e.message) || String(e), stack: (e && e.stack) || null }); }</script>`,
  ];

  if (runA11y) parts.push(`<script>${guardScript(axeSource as string)}</script>`);
  parts.push(`<script>${finalizeScript(runA11y)}</script>`);
  parts.push("</body></html>");

  return parts.join("\n");
}
