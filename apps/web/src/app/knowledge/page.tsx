import type { Metadata } from "next";

import { KnowledgeSurface } from "./_components/knowledge-surface";

export const metadata: Metadata = {
  title: "Your knowledge — Polytoken",
  description: "Explore the entity and knowledge graph for your imported emails.",
};

/**
 * /knowledge route — server-component shell (Phase 62 / SURF-03).
 *
 * The page-level duplicate header is gone: the first draft spent two chrome
 * rows ("Knowledge Graph" here, "Knowledge" again in the toolbar) before the
 * board began. The desktop surface's GraphToolbar is now the ONE chrome row
 * (title + count + tier filter + fit view); the mobile list leads with its
 * filter-chip bar. Click-economy: the board is the page.
 *
 * `KnowledgeSurface` (a "use client" wrapper) branches the presentation on
 * `useIsMobileViewport()` (MOBL-01): below `md` it renders
 * `KnowledgeMobileList`; at/above `md` it renders `KnowledgeGraphIsland`,
 * the client island (ssr: false) React-Flow graph.
 *
 * Next.js 15 requires that `ssr: false` lives inside a Client Component —
 * the dynamic() call cannot be placed directly in a Server Component (D-08).
 * page.tsx itself stays a true server component for metadata + layout.
 */
export default function KnowledgePage(): React.ReactElement {
  return (
    <main className="flex h-[calc(100vh-3.5rem)] w-full flex-col">
      <div className="relative min-h-0 flex-1">
        <KnowledgeSurface />
      </div>
    </main>
  );
}
