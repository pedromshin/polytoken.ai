"use client";

/**
 * filter-rail.tsx — 240px filter rail for the /knowledge graph surface (RSKN-03: solid, no blur).
 *
 * UI-SPEC Filter Rail:
 *   Header "Show" — text-xs font-semibold uppercase tracking-wide text-muted-foreground
 *   6 node-type checkboxes (color dot + label) with defaults: Entity Types + Fields checked
 *   Separator
 *   Switch "Show all instances" + sub-label "May slow rendering with large datasets"
 *   Footer: "{N} types · {M} fields · {P} instances"
 *
 * Presentational: all state + handlers injected via props from knowledge-graph.tsx.
 * No font-medium (500) — UI-SPEC Note #5.
 */

import { Separator } from "@polytoken/ui/separator";
import { Switch } from "@polytoken/ui/switch";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Node types displayed in the filter rail — order matches UI-SPEC.
 * Exported (53-06-PLAN.md Task 1) so `KnowledgeMobileList` reuses the EXACT
 * facet data + dotClass recipe — no second vocabulary, no redesign.
 */
export const NODE_TYPE_ROWS = [
  {
    type: "entity_type" as const,
    label: "Entity Types",
    dotClass: "bg-primary/80 border-primary/40",
  },
  {
    type: "entity_type_field" as const,
    label: "Fields",
    dotClass: "bg-muted-foreground/40 border-border",
  },
  {
    type: "entity_instance" as const,
    label: "Instances",
    dotClass: "bg-graph-entity/80 border-graph-entity/40",
  },
  {
    type: "email" as const,
    label: "Emails",
    dotClass: "bg-graph-email/80 border-graph-email/40",
  },
  {
    type: "email_component" as const,
    label: "Components",
    dotClass: "bg-graph-email-component/80 border-graph-email-component/40",
  },
  {
    type: "knowledge_node" as const,
    label: "Knowledge Rules",
    dotClass: "bg-primary/60 border-primary/60",
  },
] as const;

export type NodeTypeKey =
  | "entity_type"
  | "entity_type_field"
  | "entity_instance"
  | "email"
  | "email_component"
  | "knowledge_node";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FilterRailCounts {
  readonly types: number;
  readonly fields: number;
  readonly instances: number;
}

interface FilterRailProps {
  readonly visibleTypes: ReadonlySet<NodeTypeKey>;
  readonly onToggleType: (type: NodeTypeKey) => void;
  readonly showInstances: boolean;
  readonly onToggleInstances: (value: boolean) => void;
  readonly counts: FilterRailCounts;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FilterRail({
  visibleTypes,
  onToggleType,
  showInstances,
  onToggleInstances,
  counts,
}: FilterRailProps): React.ReactElement {
  return (
    <div className="flex h-full w-60 flex-col border-r border-border/50 bg-background/95">
      {/* Header */}
      <p className="px-4 pb-2 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Show
      </p>

      {/* Node type checkboxes */}
      <div className="flex flex-col">
        {NODE_TYPE_ROWS.map(({ type, label, dotClass }) => {
          const checked = visibleTypes.has(type);
          return (
            <label
              key={type}
              className="flex cursor-pointer items-center gap-2 px-4 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggleType(type)}
                className="peer sr-only"
                aria-label={label}
              />
              {/* Color dot */}
              <span
                className={`size-2 shrink-0 rounded-full border ${dotClass}`}
                aria-hidden
              />
              {/* Label */}
              <span className={checked ? "text-foreground" : "text-muted-foreground"}>
                {label}
              </span>
              {/* Visual checkbox indicator */}
              <span
                className={`ml-auto flex size-4 shrink-0 items-center justify-center rounded border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-1 ${
                  checked
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background"
                }`}
                aria-hidden
              >
                {checked && (
                  <svg
                    viewBox="0 0 10 10"
                    className="size-2.5 fill-current"
                    aria-hidden
                  >
                    <polyline points="1.5,5 4,7.5 8.5,2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
            </label>
          );
        })}
      </div>

      <Separator className="my-3" />

      {/* Show instances toggle */}
      <div className="px-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">Show all instances</span>
          <Switch
            checked={showInstances}
            onCheckedChange={onToggleInstances}
            aria-label="Show all instances"
          />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          May slow rendering with large datasets
        </p>
      </div>

      {/* Spacer to push footer to bottom */}
      <div className="flex-1" />

      {/* Footer counts */}
      <p className="border-t border-border/50 px-4 py-3 text-xs text-muted-foreground">
        {counts.types} types · {counts.fields} fields · {counts.instances} instances
      </p>
    </div>
  );
}
