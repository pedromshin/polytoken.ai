// Explicit React import — vitest's classic-runtime esbuild transform needs
// `React` in scope for any suite that renders this file (codebase gotcha).
import * as React from "react";

import { Skeleton } from "@polytoken/ui/skeleton";

/**
 * Neutral route-level loading fallback for /spreadsheets (mirrors
 * /documents/loading.tsx).
 *
 * Exists so the ROOT app/loading.tsx (an inbox-specific skeleton) never spills
 * over onto this segment: per Next App Router semantics a root loading.tsx is
 * the Suspense fallback for EVERY child segment lacking its own, which would
 * flash inbox-branded chrome (and a wrong screen-reader announcement) on soft
 * navigations here. This shell is deliberately surface-agnostic: page-frame
 * padding, a title bar, a content block.
 */
export default function Loading(): React.ReactElement {
  return (
    <output
      aria-label="Loading page"
      className="block h-[calc(100svh-var(--app-tabbar-h))] w-full p-4 md:p-6"
    >
      <Skeleton className="mb-4 h-7 w-48" />
      <Skeleton className="mb-2 h-4 w-full max-w-xl" />
      <Skeleton className="h-[60svh] w-full" />
    </output>
  );
}
