import type { Metadata } from "next";
import React from "react";

import { Badge } from "@nauta/ui/badge";

import { REGISTRY_VERSION } from "@nauta/genui/registry";

import { StudioTabs } from "./_components/studio-tabs";

export const metadata: Metadata = {
  title: "Studio — Nauta",
  description: "Component catalog, generation sandbox, and showcase — Nauta design system.",
};

/**
 * /studio — server-component shell (Phase 15, D-01).
 *
 * Mirrors the /studio/preview shell (h-12 header + ml-auto chips) then hands
 * control to StudioTabs ("use client") for the tab surface.
 *
 * REGISTRY_VERSION is consumed here (server side) because registry-version.ts
 * uses Node.js `crypto` and must NOT enter the browser bundle — T-12-15.
 * StudioTabs ("use client") NEVER receives REGISTRY_VERSION.
 */
export default function StudioPage(): React.ReactElement {
  return (
    <main className="flex h-[calc(100vh-3.5rem)] w-full flex-col">
      {/* Header — h-12, matches /studio/preview exactly (D-01) */}
      <div className="flex h-12 shrink-0 items-center border-b border-border/50 px-4">
        <h1 className="text-sm font-semibold text-foreground">Studio</h1>

        {/* Version chips — ml-auto pushes to right edge */}
        <div className="ml-auto flex items-center gap-2">
          {/* Static spec version */}
          <Badge variant="secondary">v1</Badge>

          {/* Registry content-hash chip (server-only — T-12-15) */}
          <Badge variant="secondary" className="font-mono text-xs">
            Registry {REGISTRY_VERSION.version.slice(0, 8)}
          </Badge>
        </div>
      </div>

      {/* Tabbed surface — StudioTabs owns the flex-1 scroll region */}
      <StudioTabs />
    </main>
  );
}
