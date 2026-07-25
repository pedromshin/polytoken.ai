"use client";

/**
 * references-node.tsx — ReferencesNode: the canvas's `references` custom React
 * Flow node. It surfaces the caller's saved references (999.35 — references
 * saved INSIDE polytoken, the first dogfood of D4+D2) as a placed board card,
 * so "the sources I've kept" is a node the agent can drop rather than a route
 * the user must navigate to.
 *
 * REF-ONLY like every WAVE-1/WAVE-2 sibling (see node-data-schemas.ts): the
 * references are DERIVED, owner-scoped, and change constantly, so node.data
 * carries ONLY an optional display `label` — never fetched rows. The list
 * rehydrates HERE via `api.references.list` (a `protectedProcedure` filtered
 * directly on `ctx.user.id`, TENA-03 — the acting identity is never a
 * client-supplied field). This node introduces NO new backend; it is a second
 * read-only consumer of the references surface (the primary being /references).
 *
 * The list is READ-ONLY on the canvas: no save/remove here (those live on the
 * dedicated surface with their Undo-toast ergonomics). A row's primary action
 * is reading the reference — one click, straight out.
 *
 * THE URL IS UNTRUSTED AT RENDER TIME: while `references.save` validates the
 * url server-side, this node mirrors source-node.tsx's defense-in-depth
 * posture and re-gates every href to ABSOLUTE http(s) via `safeReferenceHref`
 * before mounting an <a>. A row whose url does not parse as http(s) degrades to
 * a disabled link, never a javascript:/data: href in the DOM.
 *
 * GESTURE ISOLATION: the reference list scrolls, so its container wears
 * `nowheel nopan nodrag` (mirrors brief-node / review-queue-node) — a wheel or
 * drag over the list scrolls the references instead of panning the board; the
 * header keeps `node-drag-handle` so the card still drags by its title bar.
 *
 * Remove is INK, not madder: dropping this card from the board is not
 * irreversible (every saved reference survives; only the placement goes), so it
 * follows the shared remove-button recipe.
 *
 * States mirror the established branch order (loading -> error -> empty ->
 * success), matching brief-node / review-queue-node byte-for-byte.
 */

import * as React from "react";
import { memo } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { AlertCircle, Bookmark, X } from "lucide-react";

import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";

import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";
import { type ReferencesNodeData } from "./node-data-schemas";

export type ReferencesNodeType = Node<ReferencesNodeData, "references">;

/**
 * The node surfaces the top slice of the caller's references as an at-a-glance
 * card; the full paginated list lives at /references. `offset: 0` is fixed
 * (this card never paginates).
 */
const REFERENCES_LIMIT = 8;
const REFERENCES_INPUT = Object.freeze({ limit: REFERENCES_LIMIT, offset: 0 });

/**
 * safeReferenceHref — returns the url only when it parses as an ABSOLUTE
 * http(s) URL; anything else (javascript:, data:, file:, relative, garbage)
 * resolves to null and the row's link renders disabled. The render-time half
 * of `references.save`'s write-time url validation (defense in depth — see the
 * component header for why the write-time gate alone is not enough). Mirrors
 * source-node.tsx's `safeSourceHref` byte-for-byte.
 */
export function safeReferenceHref(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return parsed.protocol === "https:" || parsed.protocol === "http:"
    ? parsed.href
    : null;
}

/**
 * referenceDomain — the hostname (www-stripped) polytoken states UNDER the
 * title, sans (law 2: a domain is polytoken's summary OF the reference, not a
 * line the reference contains). Null for an unsafe/unparseable url.
 */
export function referenceDomain(url: string): string | null {
  if (safeReferenceHref(url) === null) return null;
  return new URL(url).hostname.replace(/^www\./, "");
}

function resolveLabel(data: ReferencesNodeData): string {
  return data.label ?? "Saved references";
}

export const ReferencesNode = memo(function ReferencesNode({
  id,
  data,
  selected,
}: NodeProps<ReferencesNodeType>) {
  const { deleteElements } = useReactFlow();
  const label = resolveLabel(data);

  const query = api.references.list.useQuery(REFERENCES_INPUT);

  const items = query.data?.items ?? [];
  const hasMore = query.data?.hasMore ?? false;

  return (
    <div
      className={`flex h-[380px] w-[340px] flex-col animate-in fade-in-0 zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none ${canvasNodeShellClass(
        CANVAS_NODE_KIND_GEOMETRY["references"],
        selected === true,
      )}`}
    >
      <Handle type="target" position={Position.Left} />

      {/* Header — chrome, sans (law 2). Drags by its own bar. */}
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-hair px-3 active:cursor-grabbing">
        <span className="flex min-w-0 items-center gap-2">
          <Bookmark className="size-3 shrink-0 text-faded" aria-hidden />
          <span className="truncate text-xs font-semibold text-ink">{label}</span>
        </span>
        <button
          type="button"
          aria-label="Remove references"
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-pencil transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
          onClick={(event) => {
            event.stopPropagation();
            void deleteElements({ nodes: [{ id }] });
          }}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      {/* Body — the reference list scrolls; nowheel/nopan/nodrag keep the
          gesture inside the list instead of panning the board. */}
      <div className="nowheel nopan nodrag min-h-0 flex-1 overflow-y-auto">
        {query.isPending ? (
          <div role="status" aria-label="Loading references" className="space-y-2 p-3">
            <Skeleton className="h-12 w-full rounded-card" />
            <Skeleton className="h-12 w-full rounded-card" />
            <Skeleton className="h-12 w-full rounded-card" />
          </div>
        ) : query.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-3 text-center">
            <AlertCircle className="size-5 shrink-0 text-ink" aria-hidden />
            <p className="text-xs text-faded">
              Couldn&apos;t load your references. Try again.
            </p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="rounded-sm px-1.5 py-0.5 text-xs text-faded transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-3 text-center">
            <Bookmark className="size-5 shrink-0 text-faded" aria-hidden />
            <p className="text-xs text-faded">
              No saved references yet.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-hair">
            {items.map((reference) => (
              <ReferenceRow key={reference.id} reference={reference} />
            ))}
          </ul>
        )}
      </div>

      {/* Footer — the full list lives at the dedicated route; this card is the
          at-a-glance top slice. */}
      {hasMore && (
        <div className="flex h-8 shrink-0 items-center justify-center border-t border-hair px-3">
          <span className="text-2xs text-faded tabular">
            Showing top {items.length}
          </span>
        </div>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// One saved reference — title (links out, http(s)-gated) + domain + note.
// ---------------------------------------------------------------------------

/**
 * The row's data shape mirrors `references.list`'s item projection (id / url /
 * title / note / tags / savedAt). Only the fields this card renders are typed
 * here — a structural subset, so it stays typecheckable against the inferred
 * query row without importing the router's output type.
 */
function ReferenceRow({
  reference,
}: {
  readonly reference: {
    readonly id: string;
    readonly url: string;
    readonly title: string;
    readonly note: string | null;
  };
}): React.ReactElement {
  const href = safeReferenceHref(reference.url);
  const domain = referenceDomain(reference.url);
  const title =
    reference.title.trim().length > 0 ? reference.title : "Untitled reference";
  const note =
    reference.note !== null && reference.note.trim().length > 0
      ? reference.note
      : null;

  return (
    <li className="flex flex-col gap-1 p-3">
      {/* SERIF: the title is the reference's own words (law 2, the same call
          source-node.tsx makes on its title). One click, straight out; a
          tampered/unsafe url renders the link disabled rather than mounting an
          unsafe href. */}
      <a
        href={href ?? "#"}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={href === null}
        onClick={(event) => {
          if (href === null) event.preventDefault();
        }}
        className={`truncate font-serif text-xs font-semibold text-ink underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
          href !== null
            ? "hover:underline"
            : "pointer-events-none opacity-50"
        }`}
        data-evidence
      >
        {title}
      </a>

      {/* SANS: the domain is polytoken's summary OF the reference (law 2). */}
      <span className="truncate text-2xs text-faded">
        {domain ?? "Link unavailable"}
      </span>

      {/* SERIF: the note is the user's own annotation, quoted. */}
      {note !== null && (
        <p
          className="mt-0.5 line-clamp-2 font-serif text-xs leading-relaxed text-ink"
          data-evidence
        >
          {note}
        </p>
      )}
    </li>
  );
}
