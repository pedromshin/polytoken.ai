/**
 * axe-source.ts — exposes the axe-core source string for inlining into the sandboxed frame.
 *
 * axe cannot reach INTO an opaque-origin (`allow-scripts`, no `allow-same-origin`) frame from
 * the parent, so the runtime a11y pass runs the engine INSIDE the frame: `axe.source` is
 * inlined via `buildIslandSrcdoc({ axeSource })`, `axe.run(document)` executes in-frame, and
 * violations are posted back over the nonce'd bridge (Pattern A, 20-RESEARCH.md §4).
 *
 * NOTE: importing this pulls the full axe-core module (~500KB) — import it only from the
 * dynamically-loaded code-island frame, never from a hot path.
 */

import axe from "axe-core";

export const AXE_SOURCE: string = (axe as unknown as { source: string }).source;

export function getAxeSource(): string {
  return AXE_SOURCE;
}
