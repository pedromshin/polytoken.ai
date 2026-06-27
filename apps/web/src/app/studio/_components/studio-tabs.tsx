"use client";

/**
 * studio-tabs.tsx — Client Tabs shell for /studio landing (D-01).
 *
 * Contains:
 *   - TabsList with "Catalog" + "Sandbox" TabsTriggers
 *   - A next/link "Showcase" affordance (link to /studio/preview, NOT a TabsContent)
 *   - TabsContent "catalog" (aria-label="Component catalog") → CatalogBrowserIsland
 *   - TabsContent "sandbox" (aria-label="Generation sandbox") → placeholder (15-03 fills it)
 *
 * "use client" because Tabs require useState for active tab state internally (shadcn).
 * REGISTRY_VERSION is NOT imported here — it must stay server-side (T-12-15, Node crypto).
 */

import React from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@nauta/ui/tabs";

import { CatalogBrowserIsland } from "./catalog-browser-island";

export function StudioTabs(): React.ReactElement {
  return (
    <Tabs
      defaultValue="catalog"
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

      {/* Sandbox tab — placeholder; Plan 15-03 replaces this with GenerationSandboxIsland */}
      <TabsContent
        value="sandbox"
        aria-label="Generation sandbox"
        className="flex-1 overflow-y-auto m-0 border-0"
      >
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          Sandbox — coming in 15-03
        </div>
      </TabsContent>
    </Tabs>
  );
}
