import type { Metadata } from "next";
import React from "react";

import { Badge } from "@nauta/ui/badge";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@nauta/ui/resizable";

import { SHOWCASE_SPEC } from "@nauta/genui/demo";
import { REGISTRY_VERSION } from "@nauta/genui/registry";

import { SpecRendererIsland } from "./_components/spec-renderer-island";
import { JsonPane } from "../_components/json-pane";

export const metadata: Metadata = {
  title: "Studio — Nauta",
  description: "Component showcase: trusted interpreter rendering hardcoded demo specs.",
};

/**
 * /studio/preview — server-component shell.
 *
 * Renders the hardcoded SHOWCASE_SPEC as live @nauta/ui components
 * (left pane, client island ssr:false) side-by-side with the raw spec JSON
 * (right pane, read-only) — D-19/STDO-03.
 *
 * REGISTRY_VERSION is consumed here (server side) because registry-version.ts
 * uses Node.js `crypto` and must NOT enter the browser bundle — T-12-15.
 *
 * The island (SpecRendererIsland) is a "use client" component that holds the
 * `dynamic(ssr:false)` call, identical to the /knowledge island pattern (D-08/D-20).
 *
 * This page is READ-ONLY this phase. No input controls, no generation states.
 * Those ship in Phase 15 (UI-SPEC §14).
 */
export default function StudioPreviewPage(): React.ReactElement {
  return (
    <main className="flex h-[calc(100vh-3.5rem)] w-full flex-col">
      {/* Header — h-12, matches /knowledge page header exactly */}
      <div className="flex h-12 shrink-0 items-center border-b border-border/50 px-4">
        <h1 className="text-sm font-semibold text-foreground">
          Component Showcase
        </h1>

        {/* Version chips — ml-auto pushes to right edge */}
        <div className="ml-auto flex items-center gap-2">
          {/* Spec version (v field from spec root) */}
          <Badge variant="secondary">
            v{SHOWCASE_SPEC.v}
          </Badge>

          {/* Registry content-hash chip (server-only — T-12-15) */}
          <Badge variant="secondary" className="font-mono text-xs">
            Registry {REGISTRY_VERSION.version.slice(0, 8)}
          </Badge>
        </div>
      </div>

      {/* Body: render pane (55%) + JSON pane (45%) side-by-side — D-19 */}
      <div className="min-h-0 flex-1">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* Left pane: live SpecRenderer output */}
          <ResizablePanel defaultSize={55} minSize={30}>
            <div
              role="region"
              aria-label="Rendered output"
              className="h-full overflow-y-auto p-6"
            >
              <SpecRendererIsland
                spec={SHOWCASE_SPEC}
                data={SHOWCASE_SPEC.data as Record<string, unknown> | undefined}
              />
            </div>
          </ResizablePanel>

          {/* Resize handle — NO withHandle per UI-SPEC §6 (developer tool) */}
          <ResizableHandle />

          {/* Right pane: read-only JSON inspector */}
          <ResizablePanel defaultSize={45} minSize={25}>
            <div
              role="region"
              aria-label="Spec JSON"
              className="flex h-full flex-col bg-muted"
            >
              <JsonPane value={SHOWCASE_SPEC} />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </main>
  );
}
