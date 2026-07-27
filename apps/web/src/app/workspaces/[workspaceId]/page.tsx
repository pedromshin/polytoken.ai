import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import * as React from "react";

import { MembersPanel } from "./_components/members-panel";

export const metadata: Metadata = {
  title: "Workspace members — Polytoken",
  description: "Manage a workspace's members and their roles.",
};

/**
 * /workspaces/[workspaceId] route — server-component shell (Stream B).
 *
 * Same registry-shell shape + identity classes as `/workspaces` and the
 * /documents + /files precedent (monochrome chrome, law 1; no hero). The
 * `params` promise is unwrapped here in the server component and the id handed
 * to the one "use client" surface below.
 *
 * The roster + all member mutations are read/enforced server-side against
 * `ctx.user.id`; this shell sends no identity.
 */
export default async function WorkspaceDetailPage(props: {
  params: Promise<{ workspaceId: string }>;
}): Promise<React.ReactElement> {
  const { workspaceId } = await props.params;

  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] w-full flex-col bg-shelf">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-rule px-4">
        <Link
          href="/workspaces"
          className="flex items-center gap-1 text-2xs text-muted-foreground transition-colors hover:text-ink"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden strokeWidth={1.5} />
          Workspaces
        </Link>
        <span className="text-muted-foreground" aria-hidden>
          /
        </span>
        <h1 className="text-sm font-semibold text-ink">Members</h1>
      </div>

      <div className="min-h-0 flex-1 p-4">
        <MembersPanel workspaceId={workspaceId} />
      </div>
    </main>
  );
}
