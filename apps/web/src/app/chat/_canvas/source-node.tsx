"use client";

/**
 * source-node.tsx — SourceNode: the canvas's `source` custom React Flow node
 * (RCNV-02 / RSRCH-03) — auto-collected research sources ON the canvas, the
 * 6th node type alongside Chat/GenuiPanel/KnowledgePreview/EmailThread/
 * Document.
 *
 * ZERO CAPTURE CEREMONY is this node's entire reason to exist (999.19's
 * framing, restated by chat-source-ledger.ts's header): a source lands here
 * because the agent USED it in a tool round, not because the user clicked a
 * confirm widget — CLUS-04's per-turn confirm flow is the explicit anti-goal.
 * taste-references.md §3 (Phase 63): "arrival is free, promotion is
 * deliberate." Accordingly there is NO add-popover for this kind (contrast
 * `add-email-thread-popover.tsx`): the wiring seam materializes these nodes
 * from the conversation's chat_source_ledger rows without the user asking.
 *
 * THE ONE STRUCTURAL DIFFERENCE from the sibling ref-only nodes: node.data
 * carries the display payload itself (url/title/excerpt/tier) rather than a
 * ref to fetch, because a ledger capture is INSERT-only-immutable and has no
 * per-row web read procedure — see SourceNodeDataSchema's header for the full
 * argument. Consequence: this node has NO loading/error branches (nothing to
 * fetch), only a degraded no-excerpt / unsafe-url presentation.
 *
 * THE PROVENANCE MARK carries the tier (D-58-01's signature element): the
 * source's TITLE — the source's own words, so law 2 grants it the serif —
 * wears `pmark pmark-suggested` (dashed pencil-amber wash: auto-collected,
 * nobody confirmed) or `pmark pmark-confirmed` (solid verdigris: promoted
 * into the knowledge graph through the existing suggest-only gate). Mirrors
 * entity-chips.tsx's exact structure: the pmark CONTAINER takes `font-sans`
 * so serif never leaks to chrome by inheritance, and the inner value span
 * carries the literal `font-serif` + `data-evidence` PAIR the law-2 gates
 * read. An absent/unknown tier resolves to "suggested", NEVER "confirmed"
 * (tier.ts's suggest-only stance — an auto-capture must not claim a
 * confirmation the user never gave).
 *
 * Kind geometry: `CANVAS_NODE_KIND_GEOMETRY.source` — a weight-1 ink left
 * rule (not the user's own material yet) inside a DOTTED frame (a candidate,
 * not an artifact — the system's guess that this source matters). Tier owns
 * the pmark's colour/dash; kind owns this shape; the two never trade (law 3).
 *
 * THE URL IS UNTRUSTED AT RENDER TIME: node.data arrives from
 * chat_canvas_layouts (user-writable), and the restore path validates only
 * the generic snapshot schema — not SourceNodeDataSchema. `safeSourceHref`
 * re-gates to http(s) here so a tampered row degrades to a disabled link,
 * never a javascript:/data: href in the DOM (T-61-04's posture, extended).
 *
 * Remove mirrors the sibling nodes byte-for-byte: `deleteElements` drops only
 * the placement; the ledger row survives (ink, not madder — T-61-19).
 */

import * as React from "react";
import { memo } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { Globe, X } from "lucide-react";

import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";
import type { SourceNodeData } from "./node-data-schemas";

export type SourceNodeType = Node<SourceNodeData, "source">;

/**
 * safeSourceHref — returns the url only when it parses as an ABSOLUTE http(s)
 * URL; anything else (javascript:, data:, file:, relative, garbage) resolves
 * to null and the Open-source action renders disabled. The render-time half
 * of SourceNodeDataSchema's write-time refine (defense in depth — see the
 * component header for why the write-time gate alone is not enough).
 */
export function safeSourceHref(url: string): string | null {
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
 * sourceDomain — the hostname (www-stripped) polytoken states UNDER the
 * title, sans (law 2: a domain is polytoken's summary OF the source, not a
 * line the source contains — the same call email-thread-node.tsx makes on
 * its participants line). Null for an unsafe/unparseable url.
 */
export function sourceDomain(url: string): string | null {
  if (safeSourceHref(url) === null) return null;
  return new URL(url).hostname.replace(/^www\./, "");
}

/**
 * resolveSourceTier — an absent or unrecognized tier is "suggested", NEVER
 * "confirmed" (mirrors tier.ts's tierOf default: tier is a claim about
 * whether a human confirmed a fact, and a zero-ceremony auto-capture must
 * never inherit a confirmation the user never gave).
 */
export function resolveSourceTier(
  tier: SourceNodeData["tier"],
): "confirmed" | "suggested" {
  return tier === "confirmed" ? "confirmed" : "suggested";
}

export const SourceNode = memo(function SourceNode({
  id,
  data,
  selected,
}: NodeProps<SourceNodeType>) {
  const { deleteElements } = useReactFlow();

  const tier = resolveSourceTier(data.tier);
  const href = safeSourceHref(data.url);
  const domain = sourceDomain(data.url);
  const title = data.title.trim().length > 0 ? data.title : "Untitled source";
  const excerpt =
    data.excerpt !== undefined && data.excerpt.trim().length > 0
      ? data.excerpt
      : null;

  return (
    <div
      className={`h-[180px] w-[300px] animate-in fade-in-0 zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none ${canvasNodeShellClass(CANVAS_NODE_KIND_GEOMETRY.source, selected === true)}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-hair px-3 active:cursor-grabbing">
        <span className="flex min-w-0 items-center gap-2">
          <Globe className="size-3 shrink-0 text-faded" aria-hidden />
          {/* THE PROVENANCE MARK on the source's own title (see header):
              pmark container in font-sans, serif + data-evidence PAIRED on
              the inner span — entity-chips.tsx's exact structure. */}
          <span
            data-tier={tier}
            className={`pmark ${tier === "confirmed" ? "pmark-confirmed" : "pmark-suggested"} inline-flex min-w-0 max-w-full items-baseline font-sans`}
          >
            <span
              className="truncate font-serif text-xs font-semibold"
              data-evidence
            >
              {title}
            </span>
          </span>
        </span>
        {/* Ink, not madder (T-61-19): removing this card drops only the
            placement — the ledger row survives and the wiring seam is the
            record of what was collected. */}
        <button
          type="button"
          aria-label="Remove source"
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-pencil transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
          onClick={(event) => {
            event.stopPropagation();
            void deleteElements({ nodes: [{ id }] });
          }}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <div className="relative flex flex-1 flex-col gap-1 px-3 py-2">
        {/* SANS: the domain is polytoken's summary OF the source (law 2). */}
        <div className="flex min-w-0 items-center gap-2 text-2xs text-faded">
          <span className="truncate">{domain ?? "Link unavailable"}</span>
        </div>
        {excerpt !== null ? (
          /* SERIF: the excerpt is the source's own sentence, quoted (the same
             call email-thread-node.tsx makes on its snippet). */
          <p
            className="mt-1 line-clamp-3 font-serif text-xs leading-relaxed text-ink"
            data-evidence
          >
            {excerpt}
          </p>
        ) : (
          <p className="mt-1 text-xs text-faded">
            No excerpt was captured for this source.
          </p>
        )}
      </div>
      <div className="flex h-9 shrink-0 items-center justify-end gap-1 border-t border-hair px-2">
        {/* Click economy: reading the source is this card's primary action —
            1 click, straight out (taste checklist item 1). External href,
            gated by safeSourceHref; a tampered/unsafe url renders this
            disabled rather than mounting the href at all. */}
        <a
          href={href ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={href === null}
          onClick={(event) => {
            if (href === null) event.preventDefault();
          }}
          className={`flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 text-xs text-faded transition-colors hover:bg-ink-05 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:h-11 ${href !== null ? "" : "pointer-events-none opacity-50"}`}
        >
          Open source →
        </a>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
