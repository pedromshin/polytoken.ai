"use client";

/**
 * catalog-browser-island.tsx — "use client" island that renders the full
 * POLYTOKEN_CATALOG as browsable cards (D-10/D-11, STDO-02).
 *
 * WHY CLIENT ISLAND (D-10):
 *   POLYTOKEN_CATALOG contains Zod schema objects + React component refs.
 *   Next.js cannot serialize these across the server→client boundary, so the
 *   catalog MUST be imported directly in a client island — not passed as props
 *   from a server component.
 *
 * STDO-02 ANTI-STUB:
 *   SpecRendererIsland is imported from the shared studio/_components/ module.
 *   There is exactly ONE dynamic(ssr:false) wrapper in apps/web/src/app/studio.
 *
 * Four facets per card (UI-SPEC §6 / D-11):
 *   1. CardHeader — type chip + description text
 *   2. CardContent — live rendered example via shared SpecRendererIsland
 *   3. CardContent — prop table via describePropsSchema
 *   4. CardContent — slot chips (only when entry has named slots)
 *
 * REGISTRY_VERSION must NOT be imported here (T-12-15 — Node crypto).
 * No eval / Function / dangerouslySetInnerHTML anywhere (D-15).
 */

import React, { useState } from "react";

import { Badge } from "@polytoken/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@polytoken/ui/card";

import { POLYTOKEN_CATALOG } from "@polytoken/genui/catalog";
import { buildCatalogExampleSpec, describePropsSchema } from "@polytoken/genui/studio";

import { SpecRendererIsland } from "./spec-renderer-island";

// ---------------------------------------------------------------------------
// Sub-components (named exports, immutable patterns, <50 lines each)
// ---------------------------------------------------------------------------

/** Facet 1 — Type chip + description in the card header. */
function EntryCardHeader({
  type,
  description,
}: {
  readonly type: string;
  readonly description: string;
}): React.ReactElement {
  return (
    <CardHeader className="pb-2">
      <CardTitle className="flex items-center gap-2 text-sm">
        <Badge variant="secondary" className="font-mono text-xs">
          {type}
        </Badge>
      </CardTitle>
      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
    </CardHeader>
  );
}

/** Facet 2 — Live rendered example via the shared SpecRendererIsland. */
function EntryLiveExample({
  entry,
}: {
  readonly entry: (typeof POLYTOKEN_CATALOG)[keyof typeof POLYTOKEN_CATALOG];
}): React.ReactElement {
  const { type } = entry;
  const spec = buildCatalogExampleSpec(entry);
  return (
    <CardContent className="pb-2">
      <div
        role="region"
        aria-label={`Live example: ${type}`}
        className="rounded-md border border-border/50 bg-muted/30 p-3 text-sm"
      >
        <SpecRendererIsland spec={spec} />
      </div>
    </CardContent>
  );
}

/** Facet 3 — Prop table via describePropsSchema. */
function EntryPropTable({
  type,
  propsSchema,
  lockedProps,
}: {
  readonly type: string;
  readonly propsSchema: Parameters<typeof describePropsSchema>[0]["propsSchema"];
  readonly lockedProps: ReadonlyArray<string>;
}): React.ReactElement {
  const descriptors = describePropsSchema({ propsSchema, lockedProps });

  return (
    <CardContent className="pb-2">
      <div
        aria-label={`Props for ${type}`}
        role="region"
        className="overflow-x-auto scrollbar-token"
      >
        {descriptors.length === 0 ? (
          <p className="text-xs text-muted-foreground">No props</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 bg-muted/40 text-muted-foreground">
                <th className="px-2 py-2 text-left font-semibold">Prop</th>
                <th className="px-2 py-2 text-left font-semibold">Type</th>
                <th className="px-2 py-2 text-left font-semibold">Req</th>
                <th className="px-2 py-2 text-left font-semibold">Locked</th>
              </tr>
            </thead>
            <tbody>
              {descriptors.map((d) => (
                <tr key={d.name} className="border-b border-border/30 odd:bg-muted/20 last:border-0">
                  <td className="px-2 py-1 font-mono">{d.name}</td>
                  <td className="px-2 py-1 text-muted-foreground">{d.typeLabel}</td>
                  <td className="px-2 py-1">
                    {d.required ? (
                      <span className="text-foreground">yes</span>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {d.locked ? (
                      <Badge variant="outline" className="px-1 py-0 text-[10px]">
                        locked
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </CardContent>
  );
}

/** Facet 4 — Slot chips (only rendered when the entry has named slots). */
function EntrySlotChips({
  slots,
}: {
  readonly slots: ReadonlyArray<string>;
}): React.ReactElement | null {
  if (slots.length === 0) return null;
  return (
    <CardContent className="pt-0">
      <div className="flex flex-wrap gap-1">
        <span className="text-xs text-muted-foreground mr-1">Slots:</span>
        {slots.map((slot) => (
          <Badge key={slot} variant="outline" className="font-mono text-xs">
            {slot}
          </Badge>
        ))}
      </div>
    </CardContent>
  );
}

/** A single catalog entry card with all four facets. */
function CatalogEntryCard({
  entry,
}: {
  readonly entry: (typeof POLYTOKEN_CATALOG)[keyof typeof POLYTOKEN_CATALOG];
}): React.ReactElement {
  return (
    <Card className="flex flex-col">
      <EntryCardHeader type={entry.type} description={entry.description} />
      <EntryLiveExample entry={entry} />
      <EntryPropTable
        type={entry.type}
        propsSchema={entry.propsSchema}
        lockedProps={(entry.lockedProps ?? []) as ReadonlyArray<string>}
      />
      <EntrySlotChips slots={(entry.slots ?? []) as ReadonlyArray<string>} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// CatalogBrowserIsland — public export
// ---------------------------------------------------------------------------

/**
 * Renders all POLYTOKEN_CATALOG entries as a filterable card grid.
 * Imported directly (not passed as server props) because POLYTOKEN_CATALOG
 * contains Zod schemas + React refs that cannot cross the server→client boundary.
 */
export function CatalogBrowserIsland(): React.ReactElement {
  const [filter, setFilter] = useState("");

  const entries = Object.values(POLYTOKEN_CATALOG);

  const filtered =
    filter.trim() === ""
      ? entries
      : entries.filter(
          (e) =>
            e.type.toLowerCase().includes(filter.toLowerCase()) ||
            e.description.toLowerCase().includes(filter.toLowerCase()),
        );

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Filter input */}
      <input
        type="search"
        placeholder="Filter components…"
        aria-label="Filter catalog components"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />

      {/* Card grid */}
      <div
        role="region"
        aria-label="Catalog components"
        aria-live="polite"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        {filtered.length === 0 ? (
          <p className="col-span-full text-sm text-muted-foreground">
            No components match &ldquo;{filter}&rdquo;
          </p>
        ) : (
          filtered.map((entry) => (
            <CatalogEntryCard key={entry.type} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
}
