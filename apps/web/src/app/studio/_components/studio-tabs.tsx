"use client";

/**
 * studio-tabs.tsx — Client Tabs shell for /studio landing (D-01 / D-21).
 *
 * 16-04 lift (D-21): minimal controlled-Tabs refactor.
 *   - `activeTab` replaces `defaultValue` (controlled; no global store).
 *   - `pendingIntent` state: string set when user picks a Page Idea,
 *     cleared to undefined once seeded into GenerationSandboxIsland.
 *     NEVER auto-triggers generation (D-06).
 *   - Four tabs: Catalog | Sandbox | History | Page Ideas
 *   - History TabsContent renders HistoryIsland (landed by 16-05).
 *
 * Contains:
 *   - TabsList with four TabsTriggers: Catalog, Sandbox, History, Page Ideas
 *   - A next/link "Showcase" affordance (link to /studio/preview, NOT a TabsContent)
 *   - TabsContent "catalog"    → CatalogBrowserIsland
 *   - TabsContent "sandbox"    → GenerationSandboxIsland (receives pendingIntent)
 *   - TabsContent "history"    → HistoryIsland (landed in 16-05)
 *   - TabsContent "page-ideas" → PageIdeasIsland (onUseIdea seeds pendingIntent)
 *
 * "use client" — controlled Tabs + useState require client context.
 * REGISTRY_VERSION is NOT imported here (T-12-15, Node crypto).
 * No eval / Function / dangerouslySetInnerHTML (D-15 / GR-01).
 */

import React, { useCallback, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@polytoken/ui/tabs";

import { CatalogBrowserIsland } from "./catalog-browser-island";
import { GenerationSandboxIsland } from "./generation-sandbox-island";
import { CodeSandboxIsland } from "./code-sandbox-island";
import { HistoryIsland } from "./history-island";
import { PageIdeasIsland } from "./page-ideas-island";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabValue = "catalog" | "sandbox" | "code-island" | "history" | "page-ideas";

// ---------------------------------------------------------------------------
// The registry tab register, on the locked identity (Phase 62 / SURF-05):
// an underline-rail tab strip — inactive tabs are faded ink that step onto
// the shade well on hover; the active tab is an ink underline + ink text,
// no fill, zero shadow (law 1: selection is ink and weight, never a hue).
// ---------------------------------------------------------------------------
const TAB_TRIGGER_CLASS =
  "rounded-none border-b-2 border-transparent text-sm text-faded transition-colors hover:bg-shade hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 data-[state=active]:border-ink data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-ink data-[state=active]:shadow-none data-[state=active]:hover:bg-transparent data-[state=active]:hover:text-ink";

// ---------------------------------------------------------------------------
// StudioTabs
// ---------------------------------------------------------------------------

export function StudioTabs(): React.ReactElement {
  // D-21: Controlled Tabs — minimal lift, no global store.
  const [activeTab, setActiveTab] = useState<TabValue>("catalog");

  // D-21 / D-06: pendingIntent is set by onUseIdea (from PageIdeasIsland),
  // passed as initialIntent to GenerationSandboxIsland. NEVER auto-generates.
  // Navigating away from sandbox and back will retain the seeded text (by design).
  const [pendingIntent, setPendingIntent] = useState<string | undefined>(
    undefined,
  );

  // Called by PageIdeasIsland when user picks an idea.
  // Seeds the sandbox intent textarea and switches to the Sandbox tab.
  const handleUseIdea = useCallback((prompt: string): void => {
    setPendingIntent(prompt);
    setActiveTab("sandbox");
  }, []);

  const handleTabChange = useCallback((value: string): void => {
    setActiveTab(value as TabValue);
  }, []);

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      className="flex flex-1 min-h-0 flex-col"
    >
      {/* Tab strip — shrink-0, does not scroll */}
      {/* max-w-full + overflow-x-auto: on a phone the five triggers + the
          Showcase link exceed the viewport — the STRIP scrolls sideways
          (standard mobile tab-strip pattern); the document never pans. */}
      <TabsList className="max-w-full shrink-0 justify-start overflow-x-auto rounded-none border-b border-hair bg-transparent px-4 h-auto pb-0 [scrollbar-width:none]">
        <TabsTrigger value="catalog" className={TAB_TRIGGER_CLASS}>
          Catalog
        </TabsTrigger>
        <TabsTrigger value="sandbox" className={TAB_TRIGGER_CLASS}>
          Sandbox
        </TabsTrigger>
        <TabsTrigger value="code-island" className={TAB_TRIGGER_CLASS}>
          Code-Island
        </TabsTrigger>
        <TabsTrigger value="history" className={TAB_TRIGGER_CLASS}>
          History
        </TabsTrigger>
        <TabsTrigger value="page-ideas" className={TAB_TRIGGER_CLASS}>
          Page Ideas
        </TabsTrigger>

        {/* Showcase affordance — a next/link, NOT a TabsContent (D-01) */}
        <Link
          href="/studio/preview"
          aria-label="Open Component Showcase"
          className="ml-2 flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-faded transition-colors hover:bg-shade hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          Showcase
          <ExternalLink className="size-3" aria-hidden />
        </Link>
      </TabsList>

      {/* Catalog tab — lists all POLYTOKEN_CATALOG entries with four D-11 facets each */}
      <TabsContent
        value="catalog"
        aria-label="Component catalog"
        className="flex-1 overflow-y-auto scrollbar-token m-0 border-0"
      >
        <CatalogBrowserIsland />
      </TabsContent>

      {/* Sandbox tab — GenerationSandboxIsland seeded with pendingIntent (D-21/D-06) */}
      <TabsContent
        value="sandbox"
        aria-label="Generation sandbox"
        className="data-[state=inactive]:hidden flex flex-col flex-1 min-h-0 m-0 border-0"
      >
        <GenerationSandboxIsland initialIntent={pendingIntent} />
      </TabsContent>

      {/* Code-Island tab — Phase 20 SPIKE: jailed-eval arbitrary code in a sandboxed iframe */}
      <TabsContent
        value="code-island"
        aria-label="Sandboxed code-island"
        className="data-[state=inactive]:hidden flex flex-col flex-1 min-h-0 overflow-y-auto scrollbar-token m-0 border-0"
      >
        <CodeSandboxIsland />
      </TabsContent>

      {/* History tab — HistoryIsland (landed by 16-05; replaces former placeholder) */}
      <TabsContent
        value="history"
        aria-label="Generation history"
        className="data-[state=inactive]:hidden flex flex-col flex-1 min-h-0 m-0 border-0"
      >
        <HistoryIsland />
      </TabsContent>

      {/* Page Ideas tab — browse + filter 76-entry corpus; onUseIdea → sandbox */}
      <TabsContent
        value="page-ideas"
        aria-label="Page idea browser"
        className="data-[state=inactive]:hidden flex flex-col flex-1 min-h-0 m-0 border-0"
      >
        <PageIdeasIsland onUseIdea={handleUseIdea} />
      </TabsContent>
    </Tabs>
  );
}
