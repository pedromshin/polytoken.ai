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

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@nauta/ui/tabs";

import { CatalogBrowserIsland } from "./catalog-browser-island";
import { GenerationSandboxIsland } from "./generation-sandbox-island";
import { HistoryIsland } from "./history-island";
import { PageIdeasIsland } from "./page-ideas-island";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabValue = "catalog" | "sandbox" | "history" | "page-ideas";

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
      <TabsList className="shrink-0 justify-start rounded-none border-b border-border/50 bg-transparent px-4 h-auto pb-0">
        <TabsTrigger
          value="catalog"
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
        >
          Catalog
        </TabsTrigger>
        <TabsTrigger
          value="sandbox"
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
        >
          Sandbox
        </TabsTrigger>
        <TabsTrigger
          value="history"
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
        >
          History
        </TabsTrigger>
        <TabsTrigger
          value="page-ideas"
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
        >
          Page Ideas
        </TabsTrigger>

        {/* Showcase affordance — a next/link, NOT a TabsContent (D-01) */}
        <Link
          href="/studio/preview"
          aria-label="Open Component Showcase"
          className="ml-2 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground px-3 py-1.5"
        >
          Showcase
          <ExternalLink className="size-3" aria-hidden />
        </Link>
      </TabsList>

      {/* Catalog tab — lists all NAUTA_CATALOG entries with four D-11 facets each */}
      <TabsContent
        value="catalog"
        aria-label="Component catalog"
        className="flex-1 overflow-y-auto m-0 border-0"
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
