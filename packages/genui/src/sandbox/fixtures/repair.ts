/**
 * repair.ts — fixtures exercising the self-heal loop and the safe-placeholder circuit breaker.
 *
 * `BROKEN_ISLAND_CODE` throws a ReferenceError at runtime; `stubHealer` returns a working
 * version (simulating the LLM self-heal that, in the full phase, calls Bedrock). `UNREPAIRABLE_
 * ISLAND_CODE` + `failingHealer` prove the fallback path. All healers are the injectable seam.
 */

/** Runs but throws at runtime (calls an undefined function). */
export const BROKEN_ISLAND_CODE = `
const root = document.getElementById('island-root');
renderWidget(root); // ReferenceError: renderWidget is not defined
`.trim();

/** A valid, working replacement the stub healer returns for BROKEN_ISLAND_CODE. */
export const HEALED_ISLAND_CODE = `
const root = document.getElementById('island-root');
root.innerHTML = '';
const badge = document.createElement('div');
badge.setAttribute('role', 'status');
badge.textContent = 'Healed \\u2714 widget rendered';
badge.style.cssText = 'padding:12px;border-radius:8px;background:#dcfce7;color:#166534;font:14px system-ui';
root.appendChild(badge);
`.trim();

/** Also throws at runtime; used with `failingHealer` to prove the fallback path. */
export const UNREPAIRABLE_ISLAND_CODE = `
const root = document.getElementById('island-root');
undefinedThing.doStuff();
`.trim();

/** The injectable heal seam. In the full phase this calls Bedrock with {code, error}. */
export type IslandHealer = (code: string, error: string) => Promise<string | null>;

/** Deterministic healer: always returns a known-good replacement (offline test double). */
export const stubHealer: IslandHealer = async () => HEALED_ISLAND_CODE;

/** Healer that always gives up — drives the safe-placeholder fallback. */
export const failingHealer: IslandHealer = async () => null;
