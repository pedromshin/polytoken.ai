"use client";

import * as React from "react";

/**
 * use-is-mobile-viewport.ts — the single shared mobile-viewport MOUNT/UNMOUNT
 * signal for Phase 53 (53-UI-SPEC.md "Breakpoint & Mount Contract"). Every
 * other mobile presentation in this phase is CSS-only (`md:` classes /
 * `pointer-coarse:` variant) — this hook exists only for cases where a
 * subtree's JS must never execute below `md` (e.g. `dynamic(ssr:false)`
 * React-Flow islands), per D-48-07.
 *
 * Mirrors `@polytoken/ui/sidebar`'s private, unexported `useIsMobile()`
 * byte-for-byte in behavior (same 768px line, same `matchMedia` shape) —
 * duplicated only because `useIsMobile` is `sidebar.tsx`'s private internal
 * and this hook needs to be public/shared across `/chat` + `/knowledge`. The
 * same numeric contract means the AppSidebar's own mobile Sheet and this
 * hook's mount decisions always agree on which side of `md` the viewport is
 * on.
 *
 * `(max-width: 767px)` is the exact numeric complement of Tailwind's `md:`
 * (768px and up), so this hook can never disagree with a `md:` CSS class at
 * the same instant (off-by-one-px class of bug closed by construction).
 *
 * SSR-safe: state seeds `false` (never reads `window` at module/first-render
 * time), then corrects on mount via `useEffect` reading `mql.matches` and
 * subscribing to the `change` event, cleaning the listener up on unmount.
 * Coerced to a plain `boolean` — every consumer needs one, never `undefined`.
 */

const MOBILE_MAX_WIDTH_QUERY = "(max-width: 767px)";

export function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia(MOBILE_MAX_WIDTH_QUERY);
    const onChange = (): void => {
      setIsMobile(mql.matches);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
