import type { Metadata } from "next";
import React from "react";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@polytoken/ui/resizable";

import { SHOWCASE_SPEC } from "@polytoken/genui/demo";
import { REGISTRY_VERSION } from "@polytoken/genui/registry";

import { SpecRendererIsland } from "./_components/spec-renderer-island";
import { JsonPane } from "../_components/json-pane";

export const metadata: Metadata = {
  title: "Component showcase — Polytoken",
  description: "Component showcase: trusted interpreter rendering hardcoded demo specs.",
};

/**
 * /studio/preview — server-component shell.
 *
 * Renders the hardcoded SHOWCASE_SPEC as live @polytoken/ui components
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
      {/* Header — h-11, matches /studio's chrome row (Phase 62 / SURF-05) */}
      <div className="flex h-11 shrink-0 items-center border-b border-hair bg-leaf px-4">
        <h1 className="text-sm font-semibold text-ink">Component Showcase</h1>

        {/* Version facts — ml-auto, quiet chrome chips */}
        <div className="ml-auto flex items-center gap-2">
          {/* Spec version (v field from spec root) */}
          <span className="tabular rounded-sm border border-rule bg-bright px-1.5 py-0.5 text-2xs font-semibold text-faded">
            v{SHOWCASE_SPEC.v}
          </span>

          {/* Registry content-hash chip (server-only — T-12-15) */}
          <span className="tabular rounded-sm border border-rule bg-bright px-1.5 py-0.5 font-mono text-2xs text-faded">
            Registry {REGISTRY_VERSION.version.slice(0, 8)}
          </span>
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
              className="h-full overflow-y-auto scrollbar-token p-6"
            >
              <SpecRendererIsland
                spec={SHOWCASE_SPEC}
                data={SHOWCASE_SPEC.data as Record<string, unknown> | undefined}
              />
            </div>
          </ResizablePanel>

          {/* Resize handle — NO withHandle per UI-SPEC §6 (developer tool) */}
          <ResizableHandle />

          {/* Right pane: read-only JSON inspector — leaf-ground well */}
          <ResizablePanel defaultSize={45} minSize={25}>
            <div
              role="region"
              aria-label="Spec JSON"
              className="flex h-full flex-col border-l border-hair bg-leaf"
            >
              <JsonPane value={SHOWCASE_SPEC} />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </main>
  );
}
