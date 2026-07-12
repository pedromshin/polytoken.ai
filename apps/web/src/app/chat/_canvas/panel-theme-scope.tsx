"use client";

/**
 * panel-theme-scope.tsx — PanelThemeScope: app-owned pack + bounded
 * token-override theming wrapper (52-01-PLAN.md Task 2, PANL-01/04).
 *
 * Mirrors `@polytoken/genui/theme`'s `ThemedRoot` (the renderer's OWN
 * alias→CSS-var boundary) but is APP-owned and additionally accepts optional
 * per-panel `tokenOverrides` (PANL-04's NL re-theme resolution output).
 * Resolves `getStylePack(packId).resolvedVars`, merges `tokenOverrides` ON
 * TOP (override wins per-key), and renders a wrapper `div` whose inline
 * style sets every entry as `--{cssVarName}: value` — every shadcn/ui
 * component in `@polytoken/ui` reads `hsl(var(--*))` automatically, so this
 * swaps the panel's entire visual theme without any component changes.
 *
 * Security/discipline contracts (mirrors ThemedRoot's, T-17-02/T-17-04):
 *   - ZERO eval/new Function/dangerouslySetInnerHTML — values reach the DOM
 *     exclusively via the React `style` prop.
 *   - Unknown `packId` silently resolves to the default pack via
 *     `getStylePack()` (never throws — T-17-04).
 *   - `tokenOverrides` keys are applied VERBATIM as `--{key}`; the allow-list
 *     enforcement (only known TOKEN_ALIASES-mapped CSS var names) lives
 *     upstream in PANL-04's resolution schema — this component trusts its
 *     already-validated input, exactly as ThemedRoot trusts its caller's
 *     validated `packId`.
 *   - ZERO raw hex, ZERO Tailwind palette classes — every value flows from
 *     the pack registry or validated overrides (keeps `palette-ban.test.ts`
 *     + `token-contrast`/`token-registration` gates green).
 */

import * as React from "react";

import { getStylePack } from "@polytoken/genui/theme";
import type { StylePackId } from "@polytoken/genui/theme";

export interface PanelThemeScopeProps {
  /**
   * The style pack id to resolve. Unknown ids silently fall back to the
   * default pack (polytoken-teal) via getStylePack() — T-17-04.
   */
  readonly packId: StylePackId | string;
  /** Bounded per-panel token overrides (PANL-04) — cssVarName-without-`--`
   * -> value. Applied ON TOP of the pack's own resolvedVars (override wins). */
  readonly tokenOverrides?: Record<string, string>;
  readonly children: React.ReactNode;
}

/**
 * PanelThemeScope — pack + bounded-override CSS-variable boundary for a
 * single editable canvas panel.
 */
export function PanelThemeScope({
  packId,
  tokenOverrides,
  children,
}: PanelThemeScopeProps): React.ReactElement {
  // getStylePack always returns a valid pack — never throws (T-17-04).
  const pack = getStylePack(packId as StylePackId);

  const cssVarStyle: Record<string, string> = {};
  for (const [varName, value] of Object.entries(pack.resolvedVars)) {
    cssVarStyle[`--${varName}`] = value;
  }
  for (const [varName, value] of Object.entries(tokenOverrides ?? {})) {
    cssVarStyle[`--${varName}`] = value;
  }

  return (
    <div className="h-full min-h-0" style={cssVarStyle as React.CSSProperties}>
      {children}
    </div>
  );
}
