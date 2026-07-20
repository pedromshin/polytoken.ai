"use client";

/**
 * knowledge-graph-skeleton.tsx — loading placeholder for the knowledge graph
 * (Phase 62 / SURF-06, on the locked identity).
 *
 * Ghosts wear the REAL node chrome — the flat `bright` card with a `rule`
 * hairline and the kind's left-rule weight (graph-nodes.tsx) — so the loading
 * state teaches the same encoding the loaded board uses, instead of generic
 * grey lozenges. Plain <div>s, NOT React Flow nodes (SSR/canvas safety).
 * `motion-reduce:animate-none` per the app-wide reduced-motion contract.
 */

// Ghost counts approximate a small schema: 3 entity types + 5 fields.
const ENTITY_TYPE_GHOSTS = 3;
const ENTITY_TYPE_FIELD_GHOSTS = 5;

interface GhostConfig {
  readonly width: number;
  readonly height: number;
  readonly ruleClass: string;
  readonly key: string;
}

const ENTITY_TYPE_CONFIGS: ReadonlyArray<GhostConfig> = Array.from(
  { length: ENTITY_TYPE_GHOSTS },
  (_, i) => ({
    key: `et-${i}`,
    width: 160,
    height: 48,
    ruleClass: "border-l-4 border-l-ink/40",
  }),
);

const ENTITY_TYPE_FIELD_CONFIGS: ReadonlyArray<GhostConfig> = Array.from(
  { length: ENTITY_TYPE_FIELD_GHOSTS },
  (_, i) => ({
    key: `etf-${i}`,
    width: 128,
    height: 32,
    ruleClass: "border-l border-l-ink/40",
  }),
);

function Ghost({
  width,
  height,
  ruleClass,
}: Omit<GhostConfig, "key">): React.ReactElement {
  return (
    <div
      style={{ width, height }}
      className={`animate-pulse rounded-card border border-rule bg-bright motion-reduce:animate-none ${ruleClass}`}
      aria-hidden
    />
  );
}

/**
 * KnowledgeGraphSkeleton — static div-based loading ghost for the graph area.
 * Displayed via dynamic(ssr:false, loading: <KnowledgeGraphSkeleton />).
 */
export function KnowledgeGraphSkeleton(): React.ReactElement {
  return (
    <div
      role="status"
      aria-label="Loading knowledge graph"
      className="flex h-full w-full flex-col items-center justify-center gap-6"
    >
      {/* Row 1: entity_type ghosts (3 anchor cards) */}
      <div className="flex flex-row items-center justify-center gap-6">
        {ENTITY_TYPE_CONFIGS.map((cfg) => (
          <Ghost
            key={cfg.key}
            width={cfg.width}
            height={cfg.height}
            ruleClass={cfg.ruleClass}
          />
        ))}
      </div>

      {/* Row 2: entity_type_field ghosts (5 lighter cards) */}
      <div className="flex flex-row flex-wrap items-center justify-center gap-4">
        {ENTITY_TYPE_FIELD_CONFIGS.map((cfg) => (
          <Ghost
            key={cfg.key}
            width={cfg.width}
            height={cfg.height}
            ruleClass={cfg.ruleClass}
          />
        ))}
      </div>

      {/* Visually hidden status text for screen readers */}
      <span className="sr-only">Loading knowledge graph, please wait…</span>
    </div>
  );
}
