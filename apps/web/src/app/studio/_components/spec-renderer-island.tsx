"use client";

/**
 * spec-renderer-island.tsx — thin "use client" wrapper that holds the
 * `dynamic(ssr: false)` call for the SpecRenderer.
 *
 * Next.js 15 enforces that `ssr: false` is not allowed inside Server Components.
 * Moving it here (a Client Component) resolves the compile error while keeping
 * page.tsx a true server component for metadata + layout (D-08/D-20).
 *
 * Pattern mirrors knowledge-graph-island.tsx exactly.
 * loading: () => null per UI-SPEC §8 — no skeleton needed; this renders a
 * static hardcoded spec (no network request), so the flash is imperceptible.
 *
 * COMPONENT_REGISTRY is NOT passed as a prop from the server because it contains
 * Zod schema objects (class instances) that Next.js cannot serialize across the
 * server/client boundary. Instead, the island imports it directly — both
 * COMPONENT_REGISTRY and SpecRenderer are client-side modules. The SpecRenderer
 * default prop `registry = COMPONENT_REGISTRY` handles it automatically.
 *
 * SHARED ISLAND (lifted from preview/_components/ per D-07):
 * Both /studio and /studio/preview import from this module so there is exactly
 * ONE dynamic(ssr:false) SpecRenderer wrapper definition in apps/web/src/app/studio.
 */

import React from "react";
import dynamic from "next/dynamic";

import type { SpecRoot } from "@nauta/genui/schema";
import type { ActionRegistry } from "@nauta/genui/renderer";

const SpecRendererDynamic = dynamic(
  () =>
    import("@nauta/genui/renderer").then((mod) => ({
      default: mod.SpecRenderer,
    })),
  {
    ssr: false,
    loading: () => null,
  },
);

export interface SpecRendererIslandProps {
  readonly spec: SpecRoot;
  readonly data?: Record<string, unknown>;
  /**
   * Optional action handlers forwarded to SpecRenderer via ActionRegistryContext.
   * Build with buildActionRegistry() from @nauta/genui/renderer (Phase 13 / D-08).
   * When omitted, the default empty-context {} is used — all action IDs resolve to noop.
   */
  readonly actions?: ActionRegistry;
}

export function SpecRendererIsland({
  spec,
  data,
  actions,
}: SpecRendererIslandProps): React.ReactElement {
  // registry omitted — SpecRenderer defaults to COMPONENT_REGISTRY (NAUTA_CATALOG)
  // This avoids serializing Zod schema objects across the server/client boundary.
  // actions forwarded when present so the sandbox can wire live query/setState/navigate (D-08).
  return (
    <SpecRendererDynamic
      spec={spec}
      data={data}
      actions={actions}
    />
  );
}
