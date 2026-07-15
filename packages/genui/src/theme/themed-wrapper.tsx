"use client";

/**
 * themed-wrapper.tsx — ThemedRoot CSS-variable wrapper component
 *
 * ThemedRoot is the SINGLE alias→CSS-var boundary in the genui render path.
 * It resolves a StylePackId to a curated set of CSS variables (from
 * pack.resolvedVars) and applies them as inline `style` on a wrapper div.
 * All shadcn/ui components in @polytoken/ui read `hsl(var(--*))` automatically,
 * so swapping the pack id changes the entire visual theme without any component
 * changes.
 *
 * Security contracts:
 *   GR-01: ZERO eval/new Function/dangerouslySetInnerHTML. CSS vars are set
 *          via the React `style` prop (object form), never injected as raw HTML.
 *   T-17-02: style object is derived exclusively from pack.resolvedVars
 *            (curated at pack-build time). Model-supplied strings never reach
 *            this component — the caller only passes a validated StylePackId.
 *   T-17-04: Unknown packId is silently resolved to the default pack via
 *            getStylePack(), which always returns a valid pack. ThemedRoot
 *            never throws on bad input.
 *
 * CSS variable format:
 *   globals.css declares `--primary: 164 39% 22%` (HSL channels, no "hsl()" wrapper).
 *   pack.resolvedVars uses the same format: bare HSL channels for color tokens,
 *   raw values for radius/shadow/font family tokens.
 *   ThemedRoot sets `--<varName>: <value>` inline — matching globals.css behavior.
 *
 * Usage:
 *   <ThemedRoot packId="linear-clean">
 *     <SpecContent />
 *   </ThemedRoot>
 */

import React from "react";

import { getStylePack } from "./packs";
import type { StylePackId } from "./tokens";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ThemedRootProps {
  /**
   * The style pack id to resolve. Unknown ids silently fall back to the
   * default pack (polytoken-teal) via getStylePack() — T-17-04.
   */
  readonly packId: StylePackId | string;
  /** Content to theme. */
  readonly children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * ThemedRoot — single alias→CSS-var boundary.
 *
 * Renders a div with inline CSS variable declarations derived exclusively from
 * the curated pack.resolvedVars. Children inherit all CSS variables via cascade.
 */
export function ThemedRoot({ packId, children }: ThemedRootProps): React.ReactElement {
  // getStylePack always returns a valid pack — never throws (T-17-04 compliance).
  // Unknown ids fall back to the default pack (polytoken-teal).
  const pack = getStylePack(packId as StylePackId);

  // Build the inline style object from curated resolvedVars only (T-17-02 compliance).
  // Each entry in resolvedVars is: cssVarName (no --) → value
  // React accepts CSS custom properties as `--varName: value` in the style object.
  const cssVarStyle: Record<string, string> = {};
  for (const [varName, value] of Object.entries(pack.resolvedVars)) {
    cssVarStyle[`--${varName}`] = value;
  }

  // GR-01: style prop (not dangerouslySetInnerHTML) is the only way values
  // reach the DOM. React serializes it as attribute `style="--primary: ...;"`.
  return (
    <div
      className="polytoken-themed"
      style={cssVarStyle as React.CSSProperties}
    >
      {children}
    </div>
  );
}
