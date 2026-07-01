/**
 * autofix-island-code.ts — deterministic, pre-heal fixes for common LLM code-emit quirks.
 *
 * This is the cheap "fix-before-execute" layer v0 uses (deterministic autofixers) that runs
 * before the (expensive, bounded) LLM self-heal loop. It only performs SAFE, reversible text
 * transforms; it never attempts to "fix" a security violation (those are rejected, not healed).
 *
 * Spike scope: strip module-style `export` wrappers LLMs frequently emit for a script-context
 * island, and normalize whitespace. Richer autofixers (provider-wrapping, import repair, icon
 * name correction) are deferred to the full phase.
 */

export interface AutofixResult {
  readonly code: string;
  /** Ids of the transforms that changed the source (empty when nothing applied). */
  readonly applied: readonly string[];
}

export function autofixIslandCode(code: string): AutofixResult {
  const applied: string[] = [];
  let out = code.trim();

  // `export default function App() {}` / `export default (...)` → strip the wrapper so the
  // program runs in script context. Only the leading occurrence.
  const withoutDefault = out.replace(/^export\s+default\s+/, "");
  if (withoutDefault !== out) {
    applied.push("strip-export-default");
    out = withoutDefault;
  }

  // `export const/let/var/function/class …` at statement starts → drop the `export` keyword.
  const withoutNamed = out.replace(/^export\s+(?=(?:const|let|var|function|class|async)\b)/gm, "");
  if (withoutNamed !== out) {
    applied.push("strip-export-named");
    out = withoutNamed;
  }

  // Standalone `export { A, B as default };` — a SyntaxError in a classic script. Drop it entirely
  // (the declarations themselves remain; the module shim in the srcdoc handles exports.x = ...).
  const withoutBrace = out.replace(/^export\s*\{[^}]*\}\s*;?/gm, "");
  if (withoutBrace !== out) {
    applied.push("strip-export-brace");
    out = withoutBrace;
  }

  return { code: out.trim(), applied };
}
