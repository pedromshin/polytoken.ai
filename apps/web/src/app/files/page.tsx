import type { Metadata } from "next";
import * as React from "react";
import { Suspense } from "react";

import { VaultApiProvider } from "./_lib/vault-api";
import { VaultSurface } from "./_components/vault-surface";

export const metadata: Metadata = {
  title: "Your files — Polytoken",
  description: "Your own cloud drive: upload, organize, and download your files.",
};

/**
 * /files route — server-component shell (Phase 66 Plan 03).
 *
 * Shell SHAPE from `knowledge/page.tsx` (server component for metadata + the
 * frame, one "use client" surface below it) — but NOT its classes:
 * `text-foreground`/`border-border` there are unswept legacy aliases. Ours are
 * the identity's own (`text-ink`, `border-rule`, `bg-shelf`).
 *
 * `VaultApiProvider` is D-66-03's temporary seam and wraps ONLY this route —
 * nothing in the app-wide tree changes. It disappears at merge, once the
 * orchestrator wires `files: filesRouter` into `root.ts`.
 *
 * NO HERO. A vault is a registry: the characteristic thing on this page is the
 * rows, and a banner above them would be the interface introducing itself to
 * someone who came here to find a file.
 */
export default function FilesPage(): React.ReactElement {
  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] w-full flex-col bg-shelf">
      <div className="flex h-12 shrink-0 items-center border-b border-rule px-4">
        <h1 className="text-sm font-semibold text-ink">Files</h1>
      </div>

      <div className="min-h-0 flex-1 p-4">
        {/* `useSearchParams` (VaultSurface reads `?path=`) requires a Suspense
            boundary in the App Router — without one, `next build` fails the
            whole route with "de-opted into client-side rendering". The
            fallback is deliberately null rather than a spinner: the surface
            renders its own designed loading state a beat later, and two
            different loading treatments in sequence is a flash, not a
            courtesy. */}
        <Suspense fallback={null}>
          <VaultApiProvider>
            <VaultSurface />
          </VaultApiProvider>
        </Suspense>
      </div>
    </main>
  );
}
