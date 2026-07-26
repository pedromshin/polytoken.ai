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
  /**
   * Phase 76 (BTAP-01) — the DATA CHANNEL. When provided, the harness installs a
   * deep-frozen `window.__ISLAND_DATA__` global (the user's OWN owner-scoped,
   * bounded projections, keyed by targetKey) BEFORE the user script runs, so a
   * generated app can compute over real data. It is injected as an inert JSON
   * *string* passed through `JSON.parse` — NEVER interpolated as code, never
   * `eval`'d. This opens NO network sink: `ISLAND_CSP_POLICY` / `ISLAND_SANDBOX`
   * are unchanged (`connect-src 'none'` preserved), the data is local, and the
   * AST allowlist doesn't forbid reading `__ISLAND_DATA__`. Over-cap or
   * prototype-pollution-keyed data is rejected by `serializeIslandData` and
   * degrades to an empty `{}` (the node surfaces the real reason to the user).
   * Omit for the exact pre-Phase-76 behaviour (no global injected at all).
   */
  readonly data?: unknown;
}

/** Prevent premature `</script>` termination when inlining arbitrary code into a script tag. */
function guardScript(source: string): string {
  return source.replace(/<\/script/gi, "<\\/script");
}

// ---------------------------------------------------------------------------
// Phase 76 (BTAP-01) — the island data channel.
// ---------------------------------------------------------------------------

/** Injected-data byte ceiling. The data is the user's OWN bounded projections
 * (Phase 73 publish port already caps rows); this is the srcdoc-bloat backstop
 * so a runaway projection can't balloon the frame document. */
export const MAX_ISLAND_DATA_BYTES = 256 * 1024;

/** Prototype-pollution keys — mirrors `@polytoken/capabilities` table.ts's guard
 * (kept local so this package stays free of a runtime dep on it). */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** True if `value` (or any nested object/array) carries a prototype-pollution
 * key. Cycle-safe (a `seen` set) so a cyclic input is walked once, not into a
 * stack overflow — the cycle itself is then rejected as unserializable by
 * `JSON.stringify` downstream. */
function hasForbiddenKeyDeep(value: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value as object)) return false;
  seen.add(value as object);
  if (Array.isArray(value)) return value.some((item) => hasForbiddenKeyDeep(item, seen));
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (hasForbiddenKeyDeep((value as Record<string, unknown>)[key], seen)) return true;
  }
  return false;
}

export type IslandDataResult =
  | { readonly ok: true; readonly json: string }
  | { readonly ok: false; readonly reason: "pollution" | "oversize" | "unserializable" };

/**
 * Validate + serialize island data to inert JSON text. Rejects (never injects)
 * prototype-pollution-keyed data, non-serializable values (BigInt, cycles), and
 * anything over `MAX_ISLAND_DATA_BYTES`. Exported so the code-island node can
 * check BEFORE rendering and surface the real reason, rather than silently
 * showing an empty app.
 */
export function serializeIslandData(data: unknown): IslandDataResult {
  if (hasForbiddenKeyDeep(data)) return { ok: false, reason: "pollution" };
  let json: string;
  try {
    json = JSON.stringify(data);
  } catch {
    return { ok: false, reason: "unserializable" };
  }
  // JSON.stringify(undefined) === undefined and JSON.stringify(fn/symbol) too;
  // there is nothing meaningful to inject in those cases.
  if (json === undefined) return { ok: false, reason: "unserializable" };
  const bytes = new TextEncoder().encode(json).length;
  if (bytes > MAX_ISLAND_DATA_BYTES) return { ok: false, reason: "oversize" };
  return { ok: true, json };
}

/**
 * Turn already-serialized JSON text into a JS string literal safe to inline
 * inside a `<script>` block. `JSON.stringify` escapes quotes/backslashes/control
 * chars; we additionally `\u`-escape the four characters that are inert inside a
 * JSON/JS string but hostile inside a `<script>` element — `<` (`</script`,
 * `<!--`), `>`, `&`, and the U+2028/U+2029 line separators that terminate an
 * inline script. The result evaluates back to the exact original JSON text,
 * which `JSON.parse` then turns into the data. (The serialize-javascript /
 * Next.js flight-data pattern.)
 */
function toScriptSafeJsonLiteral(json: string): string {
  return JSON.stringify(json)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function harnessScript(
  nonce: string,
  hostOrigin: string | undefined,
  dataJson: string | undefined,
): string {
  const nonceJson = JSON.stringify(nonce);
  const targetOriginJson = JSON.stringify(hostOrigin && hostOrigin.length > 0 ? hostOrigin : "*");
  // Phase 76 (BTAP-01): install the deep-frozen data global BEFORE user code.
  // `dataJson` is inert JSON text; it is embedded as a JS string literal and
  // fed to JSON.parse (a string, never executed). Deep-freeze so the app can
  // read but the injection is immutable. Any failure degrades to an empty
  // object — the frame never crashes on a bad injection.
  const dataInstall =
    dataJson === undefined
      ? ""
      : `
  try {
    var __raw = JSON.parse(${toScriptSafeJsonLiteral(dataJson)});
    (function deepFreeze(o){ if (o && typeof o === 'object'){ Object.keys(o).forEach(function(k){ deepFreeze(o[k]); }); Object.freeze(o); } return o; })(__raw);
    window.__ISLAND_DATA__ = __raw;
  } catch (_) { window.__ISLAND_DATA__ = {}; }`;
  return `(function(){
  var NONCE = ${nonceJson};
  var TARGET_ORIGIN = ${targetOriginJson};
  function post(msg){ try { parent.postMessage(Object.assign({ nonce: NONCE }, msg), TARGET_ORIGIN); } catch (_) {} }
  window.__islandPost = post;${dataInstall}
  // CommonJS/module-emit shim: LLMs sometimes wrap vanilla DOM code in module boilerplate
  // (exports.x = / module.exports = / Object.defineProperty(exports, ...)). Provide harmless
  // globals so that boilerplate does not ReferenceError — the actual DOM code still runs.
  // (import/require are blocked upstream by the AST allowlist, so no real module loading occurs.)
  window.module = { exports: {} };
  window.exports = window.module.exports;
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
  const { code, nonce, axeSource, hostOrigin, data } = options;
  const runA11y = typeof axeSource === "string" && axeSource.length > 0;

  // Phase 76 (BTAP-01): resolve the data channel. Absent → no global injected
  // (exact pre-Phase-76 behaviour). Present but invalid (pollution / oversize /
  // unserializable) → inject an empty object so the app runs cleanly with no
  // data; the node is responsible for surfacing the real reason via
  // `serializeIslandData` before it ever calls this builder.
  const dataResult = data === undefined ? undefined : serializeIslandData(data);
  const dataJson =
    dataResult === undefined ? undefined : dataResult.ok ? dataResult.json : "{}";

  const parts: string[] = [
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">",
    `<meta http-equiv="Content-Security-Policy" content="${ISLAND_CSP_POLICY}">`,
    "<style>html,body{margin:0;padding:0;font-family:system-ui,sans-serif}</style>",
    "</head><body>",
    '<div id="island-root"></div>',
    `<script>${harnessScript(nonce, hostOrigin, dataJson)}</script>`,
    `<script>try { ${guardScript(code)}\n} catch (e) { if (window.__islandPost) window.__islandPost({ type:'island-runtime-error', source:'onerror', message: (e && e.message) || String(e), stack: (e && e.stack) || null }); }</script>`,
  ];

  if (runA11y) parts.push(`<script>${guardScript(axeSource as string)}</script>`);
  parts.push(`<script>${finalizeScript(runA11y)}</script>`);
  parts.push("</body></html>");

  return parts.join("\n");
}
