"use client";

/**
 * page-ideas-island.tsx — "use client" island for browsing and selecting
 * Page Ideas from the committed static corpus (IDEA-01).
 *
 * IDEA-01: Only real corpus prompts are surfaced here. PAGE_IDEAS is a
 * statically committed JSON (76 entries); no AI-generated suggestions.
 *
 * Static import pattern (mirrors catalog-browser-island.tsx):
 *   PAGE_IDEAS is imported directly from @nauta/genui/eval — no tRPC,
 *   no fetch, no network call. Filtering is pure in-memory JS.
 *
 * Props:
 *   onUseIdea(prompt: string) — called when user clicks "Use this idea"
 *   on a card, or when the weighted "Surprise me" sampler picks one.
 *
 * Filter controls (all client-state, immutable filter):
 *   category   — distinct values derived from PAGE_IDEAS
 *   complexity — "simple" | "medium" | "complex"
 *   tier       — "A" | "B"
 *   curveballOnly — boolean toggle
 *
 * "Surprise me" button: calls pickPageIdea(filtered || allIdeas, Math.random)
 * and forwards the result's prompt via onUseIdea. D-06 never fires generate.
 *
 * No eval / Function / dangerouslySetInnerHTML (D-15 / GR-01).
 * Immutable state only; named exports only (CLAUDE.md).
 */

import React, { useCallback, useMemo, useState } from "react";
import { Shuffle } from "lucide-react";

import { Badge } from "@nauta/ui/badge";
import { Button } from "@nauta/ui/button";
import { Card, CardContent, CardHeader } from "@nauta/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nauta/ui/select";

import { PAGE_IDEAS } from "@nauta/genui/eval";
import { pickPageIdea } from "@nauta/genui/studio";
import type { PageIdea } from "@nauta/genui/eval";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_SENTINEL = "__all__" as const;

const COMPLEXITY_OPTIONS: ReadonlyArray<{
  value: PageIdea["complexity"] | typeof ALL_SENTINEL;
  label: string;
}> = [
  { value: ALL_SENTINEL, label: "All complexities" },
  { value: "simple", label: "Simple" },
  { value: "medium", label: "Medium" },
  { value: "complex", label: "Complex" },
];

const TIER_OPTIONS: ReadonlyArray<{
  value: PageIdea["tier"] | typeof ALL_SENTINEL;
  label: string;
}> = [
  { value: ALL_SENTINEL, label: "All tiers" },
  { value: "A", label: "Tier A (static)" },
  { value: "B", label: "Tier B (interactive)" },
];

// ---------------------------------------------------------------------------
// Utility — derive distinct sorted categories from the full corpus
// ---------------------------------------------------------------------------

function deriveCategories(ideas: readonly PageIdea[]): readonly string[] {
  const seen = new Set<string>();
  for (const idea of ideas) {
    seen.add(idea.category);
  }
  return Array.from(seen).sort();
}

const ALL_CATEGORIES: readonly string[] = deriveCategories(PAGE_IDEAS);

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Badge strip showing category / complexity / tier / curveball chips. */
function IdeaChips({ idea }: { readonly idea: PageIdea }): React.ReactElement {
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      <Badge variant="secondary" className="text-xs font-mono">
        {idea.category}
      </Badge>
      <Badge variant="outline" className="text-xs">
        {idea.complexity}
      </Badge>
      <Badge variant="outline" className="text-xs">
        Tier {idea.tier}
      </Badge>
      {idea.curveball && (
        <Badge className="text-xs bg-amber-500/15 text-amber-700 border border-amber-400/40 hover:bg-amber-500/20">
          curveball
        </Badge>
      )}
    </div>
  );
}

/** A single idea card with prompt text, chips, and a "Use this idea" button. */
function IdeaCard({
  idea,
  onUseIdea,
}: {
  readonly idea: PageIdea;
  readonly onUseIdea: (prompt: string) => void;
}): React.ReactElement {
  const handleUse = useCallback((): void => {
    onUseIdea(idea.prompt);
  }, [idea.prompt, onUseIdea]);

  return (
    <Card className="flex flex-col gap-0">
      <CardHeader className="pb-2 pt-4 px-4">
        <p className="text-sm leading-relaxed text-foreground">{idea.prompt}</p>
        <IdeaChips idea={idea} />
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        <Button
          variant="outline"
          size="sm"
          onClick={handleUse}
          aria-label={`Use idea: ${idea.prompt}`}
          className="text-xs"
        >
          Use this idea
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

interface FilterState {
  readonly category: string;
  readonly complexity: PageIdea["complexity"] | typeof ALL_SENTINEL;
  readonly tier: PageIdea["tier"] | typeof ALL_SENTINEL;
  readonly curveballOnly: boolean;
}

const INITIAL_FILTER: FilterState = {
  category: ALL_SENTINEL,
  complexity: ALL_SENTINEL,
  tier: ALL_SENTINEL,
  curveballOnly: false,
};

function FilterBar({
  filter,
  onFilterChange,
}: {
  readonly filter: FilterState;
  readonly onFilterChange: (next: FilterState) => void;
}): React.ReactElement {
  const categoryOptions: ReadonlyArray<{
    value: string;
    label: string;
  }> = useMemo(
    () => [
      { value: ALL_SENTINEL, label: "All categories" },
      ...ALL_CATEGORIES.map((c) => ({ value: c, label: c })),
    ],
    [],
  );

  return (
    <div className="flex flex-wrap items-center gap-2 shrink-0 px-4 py-3 border-b border-border/50">
      {/* Category select */}
      <Select
        value={filter.category}
        onValueChange={(v): void =>
          onFilterChange({ ...filter, category: v })
        }
      >
        <SelectTrigger className="h-8 w-48 text-xs" aria-label="Filter by category">
          <SelectValue placeholder="All categories" />
        </SelectTrigger>
        <SelectContent>
          {categoryOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="text-xs">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Complexity select */}
      <Select
        value={filter.complexity}
        onValueChange={(v): void =>
          onFilterChange({
            ...filter,
            complexity: v as PageIdea["complexity"] | typeof ALL_SENTINEL,
          })
        }
      >
        <SelectTrigger className="h-8 w-40 text-xs" aria-label="Filter by complexity">
          <SelectValue placeholder="All complexities" />
        </SelectTrigger>
        <SelectContent>
          {COMPLEXITY_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="text-xs">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Tier select */}
      <Select
        value={filter.tier}
        onValueChange={(v): void =>
          onFilterChange({
            ...filter,
            tier: v as PageIdea["tier"] | typeof ALL_SENTINEL,
          })
        }
      >
        <SelectTrigger className="h-8 w-36 text-xs" aria-label="Filter by tier">
          <SelectValue placeholder="All tiers" />
        </SelectTrigger>
        <SelectContent>
          {TIER_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="text-xs">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Curveball toggle */}
      <Button
        variant={filter.curveballOnly ? "default" : "outline"}
        size="sm"
        onClick={(): void =>
          onFilterChange({ ...filter, curveballOnly: !filter.curveballOnly })
        }
        aria-pressed={filter.curveballOnly}
        className="h-8 text-xs"
      >
        Curveball only
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface PageIdeasIslandProps {
  /** Called when the user picks an idea (either via card button or Surprise me). */
  readonly onUseIdea: (prompt: string) => void;
}

/**
 * PageIdeasIsland — Browse, filter, and pick from the 76-entry real PAGE_IDEAS corpus.
 *
 * Accepts an onUseIdea callback; callers decide what to do with the prompt
 * (e.g. seed the Sandbox intent textarea — D-21/D-06 no auto-generate).
 */
export function PageIdeasIsland({
  onUseIdea,
}: PageIdeasIslandProps): React.ReactElement {
  const [filter, setFilter] = useState<FilterState>(INITIAL_FILTER);

  // Immutable filter — never mutates PAGE_IDEAS
  const filtered: readonly PageIdea[] = useMemo(() => {
    return PAGE_IDEAS.filter((idea) => {
      if (filter.category !== ALL_SENTINEL && idea.category !== filter.category) {
        return false;
      }
      if (filter.complexity !== ALL_SENTINEL && idea.complexity !== filter.complexity) {
        return false;
      }
      if (filter.tier !== ALL_SENTINEL && idea.tier !== filter.tier) {
        return false;
      }
      if (filter.curveballOnly && !idea.curveball) {
        return false;
      }
      return true;
    });
  }, [filter]);

  // "Surprise me" — pick from filtered results; fall back to full corpus if empty
  const handleSurprise = useCallback((): void => {
    const pool = filtered.length > 0 ? filtered : PAGE_IDEAS;
    const picked = pickPageIdea(pool, () => Math.random());
    onUseIdea(picked.prompt);
  }, [filtered, onUseIdea]);

  const resultCount = filtered.length;
  const totalCount = PAGE_IDEAS.length;

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* Header strip: title + Surprise me button */}
      <div className="flex shrink-0 items-center justify-between px-4 py-3 border-b border-border/50">
        <div>
          <span className="text-sm font-medium">Page Ideas</span>
          <span className="ml-2 text-xs text-muted-foreground" aria-live="polite">
            {resultCount === totalCount
              ? `${totalCount} ideas`
              : `${resultCount} of ${totalCount} ideas`}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSurprise}
          aria-label="Surprise me — pick a weighted random idea"
          className="gap-1.5 text-xs"
        >
          <Shuffle className="size-3" aria-hidden />
          Surprise me
        </Button>
      </div>

      {/* Filter bar */}
      <FilterBar filter={filter} onFilterChange={setFilter} />

      {/* Card grid — aria-live so screen readers announce count changes */}
      <div
        role="region"
        aria-label="Page idea cards"
        aria-live="polite"
        className="flex-1 overflow-y-auto p-4"
      >
        {resultCount === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No ideas match these filters. Try broadening your selection.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((idea) => (
              <IdeaCard key={idea.id} idea={idea} onUseIdea={onUseIdea} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
