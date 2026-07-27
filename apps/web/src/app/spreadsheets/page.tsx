import type { Metadata } from "next";
import * as React from "react";

import { SpreadsheetsList } from "./_components/spreadsheets-list";

export const metadata: Metadata = {
  title: "Tables — Polytoken",
  description:
    "Your tables: every spreadsheet you've created, discoverable off the canvas.",
};

/**
 * /spreadsheets route — server-component shell (Stream A — CV-03 discoverability).
 *
 * Shell SHAPE mirrors `/documents/page.tsx` (server component owning metadata +
 * the frame, one "use client" surface below it) and its identity classes
 * (`text-ink`, `border-rule`, `bg-shelf`) — chrome is monochrome (law 1). NO
 * HERO: a table registry is a registry, so the characteristic thing on the page
 * is the rows; a banner introducing the surface to someone who came to find a
 * table is noise (taste contract — the /documents + /files registry precedent).
 *
 * `api.spreadsheets.list` is wired into root.ts, so the list surface reads it
 * directly through the app-wide tRPC provider — no temporary API-provider seam.
 */
export default function SpreadsheetsPage(): React.ReactElement {
  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] w-full flex-col bg-shelf">
      <div className="flex h-12 shrink-0 items-center border-b border-rule px-4">
        <h1 className="text-sm font-semibold text-ink">Tables</h1>
      </div>

      <div className="min-h-0 flex-1 p-4">
        <SpreadsheetsList />
      </div>
    </main>
  );
}
