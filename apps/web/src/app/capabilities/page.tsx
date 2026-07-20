import type { Metadata } from "next";
import * as React from "react";

import { CapabilitiesSurface } from "./_components/capabilities-surface";

export const metadata: Metadata = {
  title: "Capabilities — Polytoken",
  description:
    "Everything your agent can do, and nothing else — review each capability's risk and switch it on or off.",
};

/**
 * /capabilities route — server-component shell (v2.0 tool-registry allowlist panel).
 *
 * Shell SHAPE mirrors `files/page.tsx`: server component for metadata + the frame,
 * one "use client" surface below it. Identity classes only (`bg-shelf`, `border-rule`,
 * `text-ink`) — never the unswept legacy aliases.
 *
 * NO HERO. This is a registry read: the characteristic thing on this page is the
 * grouped capability rows, and the risk grouping IS the explanation — a banner
 * above them would be the interface introducing itself to someone who came to
 * check what their agent is allowed to do.
 */
export default function CapabilitiesPage(): React.ReactElement {
  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] w-full flex-col bg-shelf">
      <div className="flex h-12 shrink-0 items-center border-b border-rule px-4">
        <h1 className="text-sm font-semibold text-ink">Capabilities</h1>
      </div>

      <div className="min-h-0 flex-1 p-4">
        <CapabilitiesSurface />
      </div>
    </main>
  );
}
