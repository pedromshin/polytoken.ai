/**
 * generating-ring.tsx — ADOPT-03 (27-UI-SPEC.md, "ADOPT-03 — <GeneratingRing>").
 *
 * Hand-ported CSS TECHNIQUE from Magic UI's shine-border + animated-shiny-text:
 *   Source:  https://github.com/magicuidesign/magicui (shine-border.tsx, animated-shiny-text.tsx)
 *   Project: magicuidesign/magicui
 *   License: MIT
 *   Fetched: 2026-07-06
 *
 * This is the trivial wrapper primitive that applies the `.generating-ring` utility
 * (apps/web/src/app/globals.css, Plan 03) — a background-position sweep, not
 * shine-border's own component API. Purely presentational: no ARIA role, no click
 * handler, no keyboard interaction (decorative-only per 27-UI-SPEC.md's
 * Accessibility note) — it must never be the sole signal that generation is in
 * progress; both consumer sites (Studio Generation Sandbox, Chat streaming genui
 * parts) retain an independent accessible signal of their own (an aria-live
 * "Generating…" label / a streaming skeleton) alongside this ring.
 */

import * as React from "react";

import { cn } from "@nauta/ui";

export interface GeneratingRingProps {
  readonly active: boolean;
  readonly className?: string;
  readonly children: React.ReactNode;
}

/**
 * GeneratingRing — wraps `children` in a div and applies the `.generating-ring`
 * teal sweep utility ONLY while `active` is true. The CSS declares
 * `border-radius: inherit`, so the CALLER must set its own rounding (e.g.
 * `className="rounded-lg"`) on this same wrapper element.
 */
export function GeneratingRing({
  active,
  className,
  children,
}: GeneratingRingProps): React.ReactElement {
  return <div className={cn(active && "generating-ring", className)}>{children}</div>;
}
