"use client";

/**
 * search-all-node.tsx — SearchAllNode: the canvas's `search-all` custom React
 * Flow node. It surfaces the EXISTING cross-surface omnibox (AI-05,
 * `search.omnibox`) AS A PLACED BOARD CARD, so "search everything I have" is a
 * node the agent (or the user) can drop next to whatever they're working on
 * instead of a Cmd/Ctrl+K palette they must summon and dismiss.
 *
 * NO NEW BACKEND. This node is a SECOND consumer of the one procedure the
 * Cmd/Ctrl+K omnibox already calls — `api.search.omnibox` — which fans a single
 * query string across five owner-scoped arms (entities / emails / conversations
 * / knowledge / files) and returns a flat, typed, already-ordered result list.
 * Every arm is tenancy-scoped server-side (`userOwnedImporterIds` +
 * `resolveListScope`, or a DIRECT `user_id` filter for conversations), so a
 * result can only ever be the caller's own data. Read-only: the node issues one
 * query and renders it — it writes nothing.
 *
 * REF-ONLY node.data, like every sibling (see node-data-schemas.ts): `node.data`
 * carries ONLY a small display SEED — an optional starting `query` and an
 * optional `label` — NEVER fetched rows. Results are DERIVED, owner-scoped
 * server-side, and change constantly, so they are fetched live HERE and never
 * persisted into node.data (`.strict()`).
 *
 * THE HREF IS SERVER-BUILT (T-61-12 posture): each row's `href` is composed
 * server-side in `search.omnibox` from the row's own server id
 * (`/entities/<id>`, `/emails/<id>`, `/chat?c=<id>`, `/knowledge?node=<id>`,
 * `/files`) — an app-relative path, never a value derived from the row's
 * user-controlled TITLE. The node deep-links straight to it.
 *
 * LAW 2 on this card: a result's title is the user's OWN material (an entity
 * name, an email subject, a file name, a note title, a conversation title), so
 * it wears SERIF + data-evidence — the same register knowledge-search-node.tsx
 * gives its result titles. The KIND group header and the per-row `subtitle`
 * (sender, entity type, tier…) are polytoken's SUMMARY of that material, so
 * they stay sans chrome. `font-serif` and `data-evidence` ship as a PAIR
 * (canvas-node-law.test.tsx asserts the implication both ways).
 *
 * GESTURE ISOLATION: the search Input and the scrolling results list carry
 * `nowheel nopan nodrag` so typing and scrolling OVER the card don't pan/zoom
 * the board; the header row keeps `node-drag-handle`, so the card still drags by
 * its title bar (mirrors knowledge-search-node.tsx / circle-pack-node.tsx).
 *
 * Remove is INK, not madder — dropping this card from the board is not
 * irreversible (T-61-19); the underlying data is untouched.
 */

import * as React from "react";
import { memo, useEffect, useState } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import Link from "next/link";
import {
  AlertCircle,
  File as FileIcon,
  Mail,
  MessageSquare,
  Search,
  Shapes,
  Sparkles,
  X,
} from "lucide-react";

import { Input } from "@polytoken/ui/input";
import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";

import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { useCanvasPublish } from "./canvas-store-context";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";
import { type SearchAllNodeData } from "./node-data-schemas";

export type SearchAllNodeType = Node<SearchAllNodeData, "search-all">;

/** Minimum trimmed length before a query hits the server — mirrors the
 * `search.omnibox` input floor (`z.string().trim().min(2)`), so gating cannot
 * drift: the query arm never runs below the floor, and its `.min(2)` input
 * validation can therefore never reject a live keystroke. */
const MIN_SEARCH_LENGTH = 2;

/** How many rows per arm the card asks for. Within `omnibox`'s per-kind max
 * (20); the card is an at-a-glance surface, not the full corpus. */
const LIMIT_PER_KIND = 6;

/** Debounce before the query re-runs, so each keystroke doesn't fire an RPC. */
const DEBOUNCE_MS = 300;

/** The five arms the omnibox fans across, in the SAME display order the server
 * merges them (OMNIBOX_KIND_ORDER) — entities first (smallest, most name-shaped
 * corpus). Declared as a local literal (not imported from api-client) so this
 * file stays a self-contained web component; the server already returns results
 * in this order, so grouping only has to bucket while PRESERVING order. */
const KIND_ORDER = ["entity", "email", "conversation", "knowledge", "file"] as const;

type OmniboxKind = (typeof KIND_ORDER)[number];

/** polytoken's word for each arm — chrome, sans (law 2). */
const KIND_LABEL: Record<OmniboxKind, string> = {
  entity: "Entities",
  email: "Email",
  conversation: "Conversations",
  knowledge: "Knowledge",
  file: "Files",
};

const KIND_ICON: Record<OmniboxKind, React.ReactNode> = {
  entity: <Shapes className="size-3 shrink-0" aria-hidden strokeWidth={1.5} />,
  email: <Mail className="size-3 shrink-0" aria-hidden strokeWidth={1.5} />,
  conversation: (
    <MessageSquare className="size-3 shrink-0" aria-hidden strokeWidth={1.5} />
  ),
  knowledge: <Sparkles className="size-3 shrink-0" aria-hidden strokeWidth={1.5} />,
  file: <FileIcon className="size-3 shrink-0" aria-hidden strokeWidth={1.5} />,
};

/** The single result row shape, kept minimal — exactly what one omnibox result
 * carries. Typed locally (not imported) so the component stays self-contained;
 * tRPC's inferred output already matches this field-for-field. */
interface SearchAllRow {
  readonly kind: OmniboxKind;
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly href: string;
}

/** One kind's bucket of rows, in the order the server returned them. */
interface SearchAllGroup {
  readonly kind: OmniboxKind;
  readonly rows: SearchAllRow[];
}

/**
 * groupByKind — buckets the flat, server-ordered result list into per-kind
 * groups WITHOUT reordering: the server already emits results grouped in
 * KIND_ORDER, so a first-seen-kind pass preserves both the group order and each
 * arm's native internal order. An unknown kind (shouldn't happen — the union is
 * closed server-side) is skipped rather than trusted into a bogus group.
 */
function groupByKind(rows: ReadonlyArray<SearchAllRow>): SearchAllGroup[] {
  const groups: SearchAllGroup[] = [];
  const byKind = new Map<OmniboxKind, SearchAllGroup>();
  for (const row of rows) {
    if (!(row.kind in KIND_LABEL)) continue;
    let group = byKind.get(row.kind);
    if (group === undefined) {
      group = { kind: row.kind, rows: [] };
      byKind.set(row.kind, group);
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}

export const SearchAllNode = memo(function SearchAllNode({
  id,
  data,
  selected,
}: NodeProps<SearchAllNodeType>) {
  const { deleteElements } = useReactFlow();
  const label = data.label ?? "Search";

  const [inputValue, setInputValue] = useState<string>(data.query ?? "");
  const [debounced, setDebounced] = useState<string>(inputValue);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(inputValue), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [inputValue]);

  const trimmed = debounced.trim();
  const belowFloor =
    inputValue.trim().length > 0 && inputValue.trim().length < MIN_SEARCH_LENGTH;
  const isSearching = trimmed.length >= MIN_SEARCH_LENGTH;

  // The one owner-scoped omnibox query — enabled ONLY above the 2-char floor, so
  // its `.min(2)` input validation can never reject a live keystroke, and an
  // empty/short box issues ZERO requests.
  const query = api.search.omnibox.useQuery(
    { query: trimmed, limitPerKind: LIMIT_PER_KIND },
    { enabled: isSearching },
  );

  const rows = (query.data?.results ?? []) as ReadonlyArray<SearchAllRow>;
  const groups = React.useMemo(() => groupByKind(rows), [rows]);
  const totalResults = rows.length;

  // Phase 73 Wave B (LCAN-03/04) — the publish port. Once the omnibox query
  // settles, publish a bounded, glanceable projection to
  // `shared.published.{id}` so an agent-wired edge carries this live result
  // summary through the unchanged usePanelData engine. A DERIVED read, never
  // written into node.data. The box only queries above the 2-char floor, so a
  // publish only happens once the user has entered a real search.
  const publish = useCanvasPublish(id);
  useEffect(() => {
    if (query.data === undefined) return;
    const results = query.data.results as ReadonlyArray<SearchAllRow>;
    publish({
      query: trimmed,
      count: results.length,
      topLabels: results.slice(0, 5).map((row) => row.title),
    });
  }, [publish, query.data, trimmed]);

  return (
    <div
      className={`flex h-[440px] w-[360px] flex-col animate-in fade-in-0 zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none ${canvasNodeShellClass(
        CANVAS_NODE_KIND_GEOMETRY["search-all"],
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
          {isSearching && !query.isPending && !query.isError && totalResults > 0 && (
            <span className="shrink-0 rounded-sm bg-ink-08 px-1.5 py-0.5 text-2xs text-faded tabular">
              {totalResults}
            </span>
          )}
        </span>
        <button
          type="button"
          aria-label="Remove search"
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
          placeholder="Search everything…"
          aria-label="Search across your data"
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
        {!isSearching ? (
          // Empty / below-floor box: no query is in flight. Invite one rather
          // than showing a spinner over nothing.
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-3 text-center">
            <Search className="size-5 shrink-0 text-faded" aria-hidden />
            <p className="text-xs text-faded">
              Search across your entities, email, conversations, knowledge, and
              files.
            </p>
          </div>
        ) : query.isPending ? (
          <div
            role="status"
            aria-label="Searching"
            className="flex flex-col gap-2 px-1"
          >
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-1/4" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : query.isError ? (
          // Compact, card-embedded error — INK icon (a failure is a STATE, not
          // an irreversible action; §3: "an error is ink on a rule"), quiet
          // Retry. Mirrors knowledge-search-node.tsx / review-queue-node.tsx.
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center">
            <AlertCircle className="size-5 shrink-0 text-ink" aria-hidden />
            <p className="text-xs text-faded">Couldn&apos;t run that search. Try again.</p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="rounded-sm px-1.5 py-0.5 text-xs text-faded transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              Retry
            </button>
          </div>
        ) : totalResults === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-3 text-center">
            <Search className="size-5 shrink-0 text-faded" aria-hidden />
            <p className="text-xs text-faded">Nothing matches that search yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((group) => (
              <section key={group.kind} aria-label={KIND_LABEL[group.kind]}>
                {/* Kind group header — chrome, sans. */}
                <div className="flex items-center gap-1.5 px-1.5 pb-1 text-2xs font-semibold tracking-[0.06em] text-pencil uppercase">
                  {KIND_ICON[group.kind]}
                  <span>{KIND_LABEL[group.kind]}</span>
                </div>
                <ul
                  className="flex flex-col gap-0.5"
                  aria-label={`${KIND_LABEL[group.kind]} results`}
                >
                  {group.rows.map((row) => (
                    <li key={`${row.kind}:${row.id}`}>
                      <Link
                        href={row.href}
                        className="block rounded-md px-2.5 py-2 transition-colors hover:bg-ink-05 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                      >
                        {/* The result's own words — SERIF + data-evidence (the
                            pair). */}
                        <span
                          data-evidence
                          className="block truncate font-serif text-sm text-ink"
                        >
                          {row.title}
                        </span>
                        {/* polytoken's summary OF the result — sans chrome. */}
                        {row.subtitle && (
                          <span className="mt-0.5 block truncate text-2xs text-faded">
                            {row.subtitle}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
});
