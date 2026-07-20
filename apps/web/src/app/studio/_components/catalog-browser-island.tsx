"use client";

/**
 * catalog-browser-island.tsx — "use client" island that renders the full
 * POLYTOKEN_CATALOG as a browsable registry (D-10/D-11, STDO-02), on the
 * LOCKED identity (Phase 62 / SURF-05).
 *
 * The register is the sketch's card: a flat `bright` sheet on the `leaf`
 * ground, hairline `rule` border, hover is a rule change, ZERO shadow
 * (58-IDENTITY: "flat surfaces, hairline rules, zero shadow anywhere").
 * Component types and prop names are code, so they speak mono; counts speak
 * tabular. No hue anywhere — this is all chrome (law 1).
 *
 * WHY CLIENT ISLAND (D-10): POLYTOKEN_CATALOG contains Zod schema objects +
 * React component refs — it cannot cross the server→client boundary as
 * props, so it is imported directly here.
 *
 * STDO-02 ANTI-STUB: SpecRendererIsland is imported from the shared
 * studio/_components/ module. Exactly ONE dynamic(ssr:false) wrapper exists
 * in apps/web/src/app/studio.
 *
 * REGISTRY_VERSION must NOT be imported here (T-12-15 — Node crypto).
 * No eval / Function / dangerouslySetInnerHTML anywhere (D-15).
 */

import React, { useState } from "react";

import { Button } from "@polytoken/ui/button";

import { POLYTOKEN_CATALOG } from "@polytoken/genui/catalog";
import {
  buildCatalogExampleSpec,
  describePropsSchema,
} from "@polytoken/genui/studio";

import { SpecRendererIsland } from "./spec-renderer-island";

// ---------------------------------------------------------------------------
// Sub-components (named exports, immutable patterns, <50 lines each)
// ---------------------------------------------------------------------------

/** Facet 1 — type name (mono) + description in the card header. */
function EntryCardHeader({
  type,
  description,
}: {
  readonly type: string;
  readonly description: string;
}): React.ReactElement {
  return (
    <div className="border-b border-hair px-4 py-3">
      <span className="rounded-sm border border-rule bg-shade px-1.5 py-0.5 font-mono text-xs font-semibold text-ink">
        {type}
      </span>
      <p className="mt-2 text-xs leading-relaxed text-faded">{description}</p>
    </div>
  );
}

/** Facet 2 — live rendered example via the shared SpecRendererIsland. */
function EntryLiveExample({
  entry,
}: {
  readonly entry: (typeof POLYTOKEN_CATALOG)[keyof typeof POLYTOKEN_CATALOG];
}): React.ReactElement {
  const { type } = entry;
  const spec = buildCatalogExampleSpec(entry);
  return (
    <div className="px-4 py-3">
      <div
        role="region"
        aria-label={`Live example: ${type}`}
        className="rounded-md border border-hair bg-leaf p-3 text-sm"
      >
        <SpecRendererIsland spec={spec} />
      </div>
    </div>
  );
}

/** Facet 3 — prop table via describePropsSchema. */
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
    <div className="px-4 pb-3">
      <div
        aria-label={`Props for ${type}`}
        role="region"
        className="overflow-x-auto scrollbar-token"
      >
        {descriptors.length === 0 ? (
          <p className="text-xs text-pencil">No props</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-hair text-pencil">
                <th className="px-2 py-1.5 text-left font-semibold">Prop</th>
                <th className="px-2 py-1.5 text-left font-semibold">Type</th>
                <th className="px-2 py-1.5 text-left font-semibold">Req</th>
                <th className="px-2 py-1.5 text-left font-semibold">Locked</th>
              </tr>
            </thead>
            <tbody>
              {descriptors.map((d) => (
                <tr key={d.name} className="border-b border-hair last:border-0">
                  <td className="px-2 py-1 font-mono text-ink">{d.name}</td>
                  <td className="px-2 py-1 text-faded">{d.typeLabel}</td>
                  <td className="px-2 py-1">
                    {d.required ? (
                      <span className="text-ink">yes</span>
                    ) : (
                      <span className="text-pencil">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {d.locked ? (
                      <span className="rounded-sm border border-rule bg-bright px-1 text-2xs font-semibold text-faded">
                        locked
                      </span>
                    ) : (
                      <span className="text-pencil">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** Facet 4 — slot chips (only rendered when the entry has named slots). */
function EntrySlotChips({
  slots,
}: {
  readonly slots: ReadonlyArray<string>;
}): React.ReactElement | null {
  if (slots.length === 0) return null;
  return (
    <div className="border-t border-hair px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-2xs font-semibold tracking-[0.05em] text-pencil uppercase">
          Slots
        </span>
        {slots.map((slot) => (
          <span
            key={slot}
            className="rounded-sm border border-hair bg-leaf px-1.5 py-0.5 font-mono text-xs text-faded"
          >
            {slot}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A single catalog entry — the sketch's flat card, all four facets. */
function CatalogEntryCard({
  entry,
}: {
  readonly entry: (typeof POLYTOKEN_CATALOG)[keyof typeof POLYTOKEN_CATALOG];
}): React.ReactElement {
  return (
    <div className="flex flex-col overflow-hidden rounded-card border border-rule bg-bright transition-colors hover:border-rule-hi">
      <EntryCardHeader type={entry.type} description={entry.description} />
      <EntryLiveExample entry={entry} />
      <EntryPropTable
        type={entry.type}
        propsSchema={entry.propsSchema}
        lockedProps={(entry.lockedProps ?? []) as ReadonlyArray<string>}
      />
      <EntrySlotChips slots={(entry.slots ?? []) as ReadonlyArray<string>} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CatalogBrowserIsland — public export
// ---------------------------------------------------------------------------

/**
 * Renders all POLYTOKEN_CATALOG entries as a filterable registry grid.
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
      {/* Filter row — input + tabular result count */}
      <div className="flex items-center gap-3">
        <input
          type="search"
          placeholder="Filter components…"
          aria-label="Filter catalog components"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full max-w-xs rounded-md border border-rule bg-bright px-3 py-1.5 text-sm text-ink placeholder:text-pencil focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span className="tabular text-xs text-pencil" aria-live="polite">
          {filtered.length} of {entries.length}
        </span>
      </div>

      {/* Registry grid */}
      <div
        role="region"
        aria-label="Catalog components"
        aria-live="polite"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        {filtered.length === 0 ? (
          /* Filtered to zero — the next action is the only control */
          <div className="col-span-full flex flex-col items-center gap-2 rounded-card border border-rule bg-leaf p-panel text-center">
            <p className="text-sm font-semibold text-ink">
              No components match &ldquo;{filter}&rdquo;.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFilter("")}
            >
              Clear filter
            </Button>
          </div>
        ) : (
          filtered.map((entry) => (
            <CatalogEntryCard key={entry.type} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
}
