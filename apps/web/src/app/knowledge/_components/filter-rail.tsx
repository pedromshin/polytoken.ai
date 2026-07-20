"use client";

/**
 * filter-rail.tsx — the /knowledge filter rail on the LOCKED identity
 * (Phase 62 / SURF-03). Mirrors the inbox FiltersRail register
 * (_components/inbox-three-pane.tsx): a `bg-leaf p-panel` rail, a tracked
 * 2xs pencil header, rows that select with a `shade` fill — ink only, law 1.
 *
 * LAW 3 — the rail is the legitimate home for type-as-shape (the Chanel rule:
 * shapes belong where the label needs a key, never a hue). Each row's swatch
 * is a MINIATURE of the node card itself — a flat `bright` sheet with the
 * kind's own left-rule weight — so the rail literally teaches the canvas
 * encoding instead of teaching a colour key that exists nowhere on the board.
 *
 * Presentational: all state + handlers injected via props from
 * knowledge-graph.tsx. No font-medium (500) — only 400/600.
 */

import { Switch } from "@polytoken/ui/switch";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Node types displayed in the filter rail. Exported (53-06) so
 * `KnowledgeMobileList` reuses the EXACT facet data + swatch recipe — no
 * second vocabulary. `swatchClass` restates graph-nodes.tsx's left-rule
 * weight axis at key size (law 3: kind is structure, never hue).
 */
export const NODE_TYPE_ROWS = [
  {
    type: "entity_type" as const,
    label: "Entity Types",
    swatchClass:
      "h-3 w-4 rounded-[2px] border border-rule bg-bright border-l-4 border-l-ink",
  },
  {
    type: "entity_type_field" as const,
    label: "Fields",
    swatchClass:
      "h-3 w-4 rounded-[2px] border border-rule bg-bright border-l border-l-ink",
  },
  {
    type: "entity_instance" as const,
    label: "Instances",
    swatchClass:
      "h-3 w-4 rounded-[2px] border border-rule bg-bright border-l-2 border-l-ink",
  },
  {
    type: "email" as const,
    label: "Emails",
    swatchClass:
      "h-3 w-4 rounded-[2px] border border-rule bg-bright border-l-2 border-l-ink",
  },
  {
    type: "email_component" as const,
    label: "Components",
    swatchClass:
      "h-3 w-4 rounded-[2px] border border-rule bg-bright border-l border-l-ink",
  },
  {
    type: "knowledge_node" as const,
    label: "Knowledge Rules",
    swatchClass:
      "h-3 w-4 rounded-[2px] border border-rule bg-bright border-l-2 border-l-ink border-double",
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
    <div className="flex h-full w-full flex-col bg-leaf p-panel">
      {/* Header — the inbox rail's tracked pencil register */}
      <div className="mb-2 px-2 text-2xs font-semibold tracking-[0.07em] text-pencil uppercase">
        Show
      </div>

      {/* Node-type toggles — swatch key + label, selection is a shade fill */}
      <div className="flex flex-col gap-0.5" role="group" aria-label="Node types">
        {NODE_TYPE_ROWS.map(({ type, label, swatchClass }) => {
          const checked = visibleTypes.has(type);
          return (
            <label
              key={type}
              className={`flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                checked
                  ? "bg-shade font-semibold text-ink"
                  : "text-faded hover:bg-shade hover:text-ink"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggleType(type)}
                className="peer sr-only"
                aria-label={label}
              />
              {/* The kind swatch — a miniature of the node card (law 3) */}
              <span
                className={`${swatchClass} shrink-0 ${checked ? "" : "opacity-50"}`}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {/* Checkbox indicator — ink fill, never a hue (law 1) */}
              <span
                className={`flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-ink ${
                  checked
                    ? "border-ink bg-ink text-on-fill"
                    : "border-rule bg-bright"
                }`}
                aria-hidden
              >
                {checked && (
                  <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
                    <polyline
                      points="1.5,5 4,7.5 8.5,2.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
            </label>
          );
        })}
      </div>

      {/* Show-instances switch */}
      <div className="mt-3 border-t border-hair px-2 pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-ink">Show all instances</span>
          <Switch
            checked={showInstances}
            onCheckedChange={onToggleInstances}
            aria-label="Show all instances"
          />
        </div>
        <p className="mt-1 text-xs text-pencil">
          May slow rendering with large datasets
        </p>
      </div>

      {/* Spacer to push footer to bottom */}
      <div className="flex-1" />

      {/* Footer counts — tabular (law 2's numerals rule) */}
      <p className="tabular border-t border-hair px-2 pt-2.5 text-xs text-pencil">
        {counts.types} types · {counts.fields} fields · {counts.instances}{" "}
        instances
      </p>
    </div>
  );
}
