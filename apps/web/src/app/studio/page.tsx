import type { Metadata } from "next";
import React from "react";

import { REGISTRY_VERSION } from "@polytoken/genui/registry";

import { StudioTabs } from "./_components/studio-tabs";

export const metadata: Metadata = {
  title: "Your studio — Polytoken",
  description: "Component catalog, generation sandbox, and showcase — Polytoken design system.",
};

/**
 * /studio — server-component shell, on the LOCKED identity (Phase 62 /
 * SURF-05).
 *
 * One slim chrome row: the title in ink, the version facts pushed to the
 * right as quiet tabular chips (chrome speaking in its own sans voice —
 * a version hash is a count, so it is mono + tabular, never a decorated
 * badge). The tab rail below is the surface's real navigation.
 *
 * REGISTRY_VERSION is consumed here (server side) because registry-version.ts
 * uses Node.js `crypto` and must NOT enter the browser bundle — T-12-15.
 * StudioTabs ("use client") NEVER receives REGISTRY_VERSION.
 */
export default function StudioPage(): React.ReactElement {
  return (
    <main className="flex h-[calc(100vh-3.5rem)] w-full flex-col">
      {/* Header — h-11, leaf ground under a hairline */}
      <div className="flex h-11 shrink-0 items-center border-b border-hair bg-leaf px-4">
        <h1 className="text-sm font-semibold text-ink">Studio</h1>

        {/* Version facts — ml-auto, quiet chrome chips */}
        <div className="ml-auto flex items-center gap-2">
          <span className="tabular rounded-sm border border-rule bg-bright px-1.5 py-0.5 text-2xs font-semibold text-faded">
            v1
          </span>
          <span className="tabular rounded-sm border border-rule bg-bright px-1.5 py-0.5 font-mono text-2xs text-faded">
            Registry {REGISTRY_VERSION.version.slice(0, 8)}
          </span>
        </div>
      </div>

      {/* Tabbed surface — StudioTabs owns the flex-1 scroll region */}
      <StudioTabs />
    </main>
  );
}
