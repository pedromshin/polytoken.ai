import type { Metadata } from "next";
import * as React from "react";

import { ReferencesSurface } from "./_components/references-surface";

export const metadata: Metadata = {
  title: "References — Polytoken",
  description:
    "Your saved references: url, title, note, and tags — owner-scoped and kept inside polytoken.",
};

/**
 * /references route — server-component shell (999.35 — saving references
 * INSIDE polytoken; the first real dogfood of D4+D2).
 *
 * Shell SHAPE mirrored from `documents/page.tsx` (server component for
 * metadata + the frame, one "use client" surface below it) and its identity
 * classes (`text-ink`, `border-rule`, `bg-shelf`) — chrome is monochrome
 * (law 1). NO HERO: a reference shelf is a registry; the characteristic thing
 * on the page is the rows plus the save form, so a banner would be noise
 * (taste contract — the vault/registry precedent).
 *
 * `api.references.*` is wired into root.ts, so the surface reads/writes it
 * directly through the app-wide tRPC provider — no temporary API-provider
 * seam.
 */
export default function ReferencesPage(): React.ReactElement {
  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] w-full flex-col bg-shelf">
      <div className="flex h-12 shrink-0 items-center border-b border-rule px-4">
        <h1 className="text-sm font-semibold text-ink">References</h1>
      </div>

      <div className="min-h-0 flex-1 p-4">
        <ReferencesSurface />
      </div>
    </main>
  );
}
