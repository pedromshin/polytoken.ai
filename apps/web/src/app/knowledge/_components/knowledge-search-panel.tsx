"use client";

/**
 * knowledge-search-panel.tsx — the /knowledge search affordance (KG-8
 * closure, web reachability half).
 *
 * Before this component, knowledge-node search was UNREACHABLE from the web
 * app: the only caller of the Phase-37 BlendedRAG read side was the chat
 * tool. The panel is PRESENTATIONAL — query state, the `knowledge.search`
 * tRPC call, and the select-node behavior are owned by knowledge-graph.tsx
 * (mirrors the FilterRail props-injection convention), so this file is
 * testable in jsdom without mounting the ReactFlow canvas host.
 *
 * Identity notes (D-58-01):
 *   - Result titles are the user's own material (values synthesized from
 *     their documents) — serif + data-evidence (law 2), same register as
 *     knowledge-mobile-list.tsx rows.
 *   - Chrome (header, hints, errors) is monochrome ink/pencil (law 1); the
 *     error state is border-rule + text-ink, never a hue.
 *   - No font-medium (500) — only 400/600.
 */

import * as React from "react";

import { Input } from "@polytoken/ui/input";

// ---------------------------------------------------------------------------
// Pure gating helper — exported for DB-free testing and shared with the
// container (knowledge-graph.tsx) so the "when do we hit the server" rule
// cannot drift between the two.
// ---------------------------------------------------------------------------

/** Minimum trimmed length before a search query is sent to the server. */
export const MIN_KNOWLEDGE_SEARCH_LENGTH = 2;

export function shouldRunKnowledgeSearch(query: string): boolean {
  return query.trim().length >= MIN_KNOWLEDGE_SEARCH_LENGTH;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface KnowledgeSearchResultItem {
  readonly id: string;
  readonly title: string | null;
  readonly tier: string | null;
}

interface KnowledgeSearchPanelProps {
  readonly query: string;
  readonly onQueryChange: (next: string) => void;
  /** undefined while no search has resolved for the current query. */
  readonly results: ReadonlyArray<KnowledgeSearchResultItem> | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly onSelectResult: (nodeId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KnowledgeSearchPanel({
  query,
  onQueryChange,
  results,
  isLoading,
  isError,
  onSelectResult,
}: KnowledgeSearchPanelProps): React.ReactElement {
  const active = shouldRunKnowledgeSearch(query);

  return (
    <div className="border-b border-hair bg-leaf p-panel">
      <label
        htmlFor="knowledge-search-input"
        className="mb-2 block px-2 text-2xs font-semibold tracking-[0.07em] text-pencil uppercase"
      >
        Search knowledge
      </label>
      <Input
        id="knowledge-search-input"
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Search confirmed knowledge…"
        aria-label="Search knowledge"
        autoComplete="off"
      />

      {/* Below-minimum hint — teach the rule instead of silently doing nothing */}
      {query.length > 0 && !active && (
        <p className="mt-1.5 px-2 text-xs text-pencil">
          Type at least {MIN_KNOWLEDGE_SEARCH_LENGTH} characters to search.
        </p>
      )}

      {active && isError && (
        <div role="alert" className="mt-2 border border-rule p-2.5">
          <p className="text-xs font-semibold text-ink">Search failed.</p>
          <p className="mt-0.5 text-xs text-faded">
            Please try again in a moment.
          </p>
        </div>
      )}

      {active && !isError && isLoading && (
        <p className="mt-1.5 px-2 text-xs text-pencil" aria-live="polite">
          Searching…
        </p>
      )}

      {active && !isError && !isLoading && results !== undefined && (
        <>
          {results.length === 0 ? (
            <p className="mt-1.5 px-2 text-xs text-faded">
              No confirmed knowledge matches.
            </p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-0.5" aria-label="Search results">
              {results.map((result) => (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() => onSelectResult(result.id)}
                    className="w-full rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-shade"
                  >
                    <span
                      data-evidence
                      className="block truncate font-serif text-sm text-ink"
                    >
                      {result.title ?? "(untitled)"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
