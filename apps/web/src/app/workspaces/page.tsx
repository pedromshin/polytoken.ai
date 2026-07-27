import type { Metadata } from "next";
import * as React from "react";

import { WorkspacesList } from "./_components/workspaces-list";

export const metadata: Metadata = {
  title: "Workspaces — Polytoken",
  description:
    "The teams you own or belong to: create a workspace, manage its members, and switch between them.",
};

/**
 * /workspaces route — server-component shell (Stream B — owner-scoped
 * workspace shell).
 *
 * Shell SHAPE + identity classes mirror `documents/page.tsx` and
 * `files/page.tsx` (server component for metadata + the frame, one
 * "use client" surface below it; `text-ink`/`border-rule`/`bg-shelf` — chrome
 * is monochrome, law 1). NO HERO: a workspace list is a registry, so the
 * characteristic thing on the page is the rows, not a banner introducing the
 * interface (taste contract — the /documents + /files registry precedent).
 *
 * `api.workspaces.list` / `.create` are already wired into root.ts, so the
 * list surface reads them directly through the app-wide tRPC provider — no
 * temporary API-provider seam.
 *
 * SCOPE: this surface only ever touches the owner/RBAC-scoped workspace
 * procedures (create / list / members / addMember / changeRole / removeMember
 * / leave). It never calls the resource-sharing procedures, and it never
 * re-scopes any global data.
 */
export default function WorkspacesPage(): React.ReactElement {
  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] w-full flex-col bg-shelf">
      <div className="flex h-12 shrink-0 items-center border-b border-rule px-4">
        <h1 className="text-sm font-semibold text-ink">Workspaces</h1>
      </div>

      <div className="min-h-0 flex-1 p-4">
        <WorkspacesList />
      </div>
    </main>
  );
}
