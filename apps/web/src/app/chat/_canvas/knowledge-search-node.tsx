"use client";

/**
 * knowledge-search-node.tsx — KnowledgeSearchNode: the canvas's
 * `knowledge-search` custom React Flow node. It surfaces the learned-knowledge
 * graph AS A SEARCHABLE CARD on the board, so the agent (or the user) can drop
 * "search my knowledge" next to whatever they're working on instead of leaving
 * for /knowledge.
 *
 * Ref-only, like every sibling (email-thread-node.tsx / circle-pack-node.tsx):
 * `node.data` carries ONLY a small display seed — an optional starting `query`
 * and an optional `label` — NEVER fetched rows. The result rows rehydrate HERE
 * via tRPC:
 *   - `api.knowledge.search` (KG-8 lexical arm, `match_knowledge_nodes_by_trgm`)
 *     once the debounced query clears the 2-char floor;
 *   - `api.knowledge.list` (recent active facts) while the box is empty/short,
 *     so an empty card still shows the user SOMETHING of their graph.
 * Both procedures are owner-scoped server-side (`userOwnedImporterIds` +
 * `resolveListScope`); a result can only ever be the caller's own knowledge.
 *
 * Clicking a row deep-links to `/knowledge?focus=<id>` via the shared
 * `hrefFor("knowledge", id)` switch (the destination derives from the server
 * id, never from the row's label — T-61-12). v1 is intentionally a results
 * LIST: spawning connected canvas nodes needs canvas-store access this node
 * doesn't hold, and a list is enough to make the graph reachable from the board.
 *
 * LAW 2 on this card: a knowledge node's title and content are the user's OWN
 * material (values synthesized from their documents), so they wear SERIF +
 * data-evidence — the same register knowledge-search-panel.tsx already uses for
 * its result titles. The source/tier chip and the confidence readout are
 * polytoken's SUMMARY of that material, so they stay sans. `font-serif` and
 * `data-evidence` ship as a PAIR (canvas-node-law.test.tsx asserts the
 * implication both ways).
 *
 * GESTURE ISOLATION: the search Input and the scrolling results list carry
 * `nowheel nopan nodrag` so typing and scrolling OVER the card don't pan/zoom
 * the board; the header row keeps `node-drag-handle`, so the card still drags by
 * its title bar (mirrors circle-pack-node.tsx / email-thread-node.tsx).
 *
 * Remove is INK, not madder — dropping this card from the board is not
 * irreversible (T-61-19); the underlying knowledge graph is untouched.
 */

import * as React from "react";
import { memo, useEffect, useState } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import Link from "next/link";
import { AlertCircle, Search, Sparkles, X } from "lucide-react";

import { Input } from "@polytoken/ui/input";
import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";
import { hrefFor } from "~/components/provenance-link";

import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";
import { type KnowledgeSearchNodeData } from "./node-data-schemas";

export type KnowledgeSearchNodeType = Node<KnowledgeSearchNodeData, "knowledge-search">;

/** Minimum trimmed length before a query hits the server — mirrors the
 * `knowledge.search` input floor (`z.string().trim().min(2)`) and the
 * /knowledge panel's `MIN_KNOWLEDGE_SEARCH_LENGTH`, so gating cannot drift. */
const MIN_SEARCH_LENGTH = 2;

/** How many rows either arm asks for. Within `knowledge.search`'s max (50) and
 * `knowledge.list`'s max (100). */
const RESULT_LIMIT = 20;

/** Debounce before the query re-runs, so each keystroke doesn't fire an RPC. */
const DEBOUNCE_MS = 300;

/** The normalized display shape both arms flatten into. */
interface KnowledgeRow {
  readonly id: string;
  readonly title: string | null;
  readonly content: string | null;
  /** A one-word provenance chip: source/tier, falling back to scope. */
  readonly chip: string | null;
  readonly confidence: number | null;
}

/** Confidence renders as a whole-percent chrome readout, or nothing when the
 * node carries no confidence. Values are stored 0..1; a stray >1 is treated as
 * already-percent rather than shown as "9000%". */
function formatConfidence(confidence: number | null): string | null {
  if (confidence === null || Number.isNaN(confidence)) return null;
  const pct = confidence <= 1 ? Math.round(confidence * 100) : Math.round(confidence);
  return `${pct}%`;
}

/** First non-empty of the candidate strings, else null — used to pick the chip
 * label from whichever provenance field an arm actually returns. */
function firstNonEmpty(...values: ReadonlyArray<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

export const KnowledgeSearchNode = memo(function KnowledgeSearchNode({
  id,
  data,
  selected,
}: NodeProps<KnowledgeSearchNodeType>) {
  const { deleteElements } = useReactFlow();
  const label = data.label ?? "Knowledge search";

  const [inputValue, setInputValue] = useState<string>(data.query ?? "");
  const [debounced, setDebounced] = useState<string>(inputValue);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(inputValue), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [inputValue]);

  const trimmed = debounced.trim();
  const belowFloor = inputValue.trim().length > 0 && inputValue.trim().length < MIN_SEARCH_LENGTH;
  const isSearching = trimmed.length >= MIN_SEARCH_LENGTH;

  // Both hooks are called unconditionally (rules of hooks); `enabled` picks
  // exactly one arm to run. The search arm never runs below the 2-char floor,
  // so its `.min(2)` input validation can never reject a live keystroke.
  const searchQuery = api.knowledge.search.useQuery(
    { query: trimmed, limit: RESULT_LIMIT },
    { enabled: isSearching },
  );
  const listQuery = api.knowledge.list.useQuery(
    { limit: RESULT_LIMIT },
    { enabled: !isSearching },
  );

  const activeQuery = isSearching ? searchQuery : listQuery;

  const rows: KnowledgeRow[] = isSearching
    ? (searchQuery.data?.items ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        content: item.content,
        chip: firstNonEmpty(item.tier, item.scope),
        confidence: item.confidence,
      }))
    : (listQuery.data?.items ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        content: item.content,
        chip: firstNonEmpty(item.source, item.scope),
        confidence: item.confidence,
      }));

  return (
    <div
      className={`flex h-[440px] w-[360px] flex-col animate-in fade-in-0 zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none ${canvasNodeShellClass(
        CANVAS_NODE_KIND_GEOMETRY["knowledge-search"],
        selected === true,
      )}`}
    >
      <Handle type="target" position={Position.Left} />

      {/* Header — chrome (polytoken's word for the card), sans (law 2). Drags
          the card by its title bar via `node-drag-handle`. */}
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-hair px-3 active:cursor-grabbing">
        <span className="flex min-w-0 items-center gap-2">
          <Search className="size-3 shrink-0 text-faded" aria-hidden />
          <span className="truncate text-xs font-semibold text-ink">{label}</span>
        </span>
        <button
          type="button"
          aria-label="Remove knowledge search"
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-pencil transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
          onClick={(event) => {
            event.stopPropagation();
            void deleteElements({ nodes: [{ id }] });
          }}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      {/* Search box — `nodrag` so typing/selecting doesn't drag the card. */}
      <div className="shrink-0 border-b border-hair px-3 py-2">
        <Input
          type="search"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="Search your knowledge…"
          aria-label="Search knowledge"
          autoComplete="off"
          className="nodrag h-8 text-xs"
        />
        {belowFloor && (
          <p className="mt-1.5 text-2xs text-pencil">
            Type at least {MIN_SEARCH_LENGTH} characters to search.
          </p>
        )}
      </div>

      {/* Results — the only scrolling region, so it (and only it) carries
          `nowheel nopan nodrag`: a wheel/drag here scrolls the list instead of
          panning the board. */}
      <div className="nowheel nopan nodrag relative flex-1 overflow-y-auto px-2 py-2">
        {activeQuery.isPending ? (
          <div role="status" aria-label="Loading knowledge" className="flex flex-col gap-2 px-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : activeQuery.isError ? (
          // Compact, card-embedded error — INK icon (a failure is a STATE, not
          // an irreversible action; §3: "an error is ink on a rule"), quiet
          // Retry. Mirrors email-thread-node.tsx / circle-pack-node.tsx.
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center">
            <AlertCircle className="size-5 shrink-0 text-ink" aria-hidden />
            <p className="text-xs text-faded">
              {isSearching
                ? "Couldn't run that search. Try again."
                : "Couldn't load your recent knowledge. Try again."}
            </p>
            <button
              type="button"
              onClick={() => void activeQuery.refetch()}
              className="rounded-sm px-1.5 py-0.5 text-xs text-faded transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-3 text-center">
            <Sparkles className="size-5 shrink-0 text-faded" aria-hidden />
            <p className="text-xs text-faded">
              {isSearching
                ? "No knowledge matches that search yet."
                : "No knowledge learned yet. Forward mail to your polytoken address and confirmed facts will appear here."}
            </p>
          </div>
        ) : (
          <>
            {/* Section hint — chrome, sans. Only present in the recent-facts
                (empty-query) mode, so the list isn't mistaken for search hits. */}
            {!isSearching && (
              <p className="px-1.5 pb-1 text-2xs font-semibold tracking-[0.06em] text-pencil uppercase">
                Recent facts
              </p>
            )}
            <ul className="flex flex-col gap-0.5" aria-label="Knowledge results">
              {rows.map((row) => {
                const confidence = formatConfidence(row.confidence);
                return (
                  <li key={row.id}>
                    <Link
                      href={hrefFor("knowledge", row.id)}
                      className="block rounded-md px-2.5 py-2 transition-colors hover:bg-ink-05 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                    >
                      {/* The fact's own words — SERIF + data-evidence (the
                          pair). */}
                      <span
                        data-evidence
                        className="block truncate font-serif text-sm text-ink"
                      >
                        {row.title ?? "(untitled)"}
                      </span>
                      {row.content && (
                        <span
                          data-evidence
                          className="mt-0.5 block truncate font-serif text-xs text-faded"
                        >
                          {row.content}
                        </span>
                      )}
                      {/* polytoken's summary OF the fact — sans chrome. */}
                      {(row.chip || confidence) && (
                        <span className="mt-1 flex items-center gap-1.5 text-2xs text-faded">
                          {row.chip && (
                            <span className="inline-flex max-w-[60%] items-center truncate rounded-sm border border-rule px-1.5 py-0.5 text-pencil">
                              {row.chip}
                            </span>
                          )}
                          {confidence && (
                            <span className="tabular text-pencil">{confidence} confidence</span>
                          )}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
});
