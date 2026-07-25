"use client";

/**
 * brief-node.tsx — BriefNode: the canvas's `brief` custom React Flow node.
 * Pin the daily "morning brief" on any board — a compact, read-only,
 * system-to-user digest of what changed: new mail, merges awaiting review, and
 * recently generated documents.
 *
 * NO NEW BACKEND. This node reuses the EXACT three owner-scoped queries the
 * home board's morning brief already folds — `emails.listThreads`,
 * `entities.reviewQueue`, `documents.list` — and the SAME pure fold,
 * `shapeMorningBrief` (apps/web/src/app/home/_lib/morning-brief.ts). The fold is
 * DB-free/pure, so re-using it here keeps the two surfaces byte-identical in
 * their windowing/ordering/caps without a second implementation.
 *
 * REF-ONLY node.data (like every sibling): `node.data` carries at most an
 * optional display `label`. The brief itself is DERIVED, owner-scoped
 * server-side, and changes constantly — so it is fetched live HERE, never
 * persisted into node.data (`.strict()`, node-data-schemas.ts idiom).
 *
 * States mirror the established branch order (loading -> error -> empty ->
 * success). Loading = all three queries pending; error = ANY of the three
 * errored (with a Retry that refetches all three); empty = the fold's own
 * `isEmpty` (nothing new in the window); success = up to a few rows per section.
 *
 * GESTURE ISOLATION: the scrollable body wears `nowheel nopan nodrag` so a wheel
 * or drag over the brief scrolls the digest instead of panning the board; the
 * header keeps `node-drag-handle`, so the card still drags by its title bar
 * (mirrors circle-pack-node / spreadsheet-node).
 *
 * DESIGN NOTE (for the central wiring): "brief" is not yet a member of
 * `CanvasNodeKind` / `CANVAS_NODE_KIND_GEOMETRY`. `canvasNodeShellClass` takes
 * the geometry as a plain string argument, so this file passes a local
 * `BRIEF_GEOMETRY` literal to stay typecheckable before the vocabulary grows.
 * Once "brief" is added to `canvas-vocabulary.ts`, swap `BRIEF_GEOMETRY` for
 * `CANVAS_NODE_KIND_GEOMETRY["brief"]`. Remove is INK (dropping the card from
 * the board is not irreversible — the underlying mail/entities/documents are
 * untouched).
 */

import * as React from "react";
import { memo } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import Link from "next/link";
import { AlertCircle, FileText, GitMerge, Mail, Sunrise, X } from "lucide-react";

import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";
import { shapeMorningBrief } from "~/app/home/_lib/morning-brief";

import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";
import { type BriefNodeData } from "./node-data-schemas";

export type BriefNodeType = Node<BriefNodeData, "brief">;

const timeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

function resolveLabel(data: BriefNodeData): string {
  return data.label ?? "Daily brief";
}

export const BriefNode = memo(function BriefNode({
  id,
  data,
  selected,
}: NodeProps<BriefNodeType>) {
  const { deleteElements } = useReactFlow();
  const label = resolveLabel(data);

  // The SAME three owner-scoped queries + pure fold the home board uses (HM-02).
  const threads = api.emails.listThreads.useQuery({ limit: 6 });
  const reviews = api.entities.reviewQueue.useQuery({ limit: 6 });
  const documents = api.documents.list.useQuery({ limit: 6 });

  const brief = React.useMemo(
    () =>
      shapeMorningBrief({
        threads: threads.data,
        reviews: reviews.data,
        documents: documents.data,
      }),
    [threads.data, reviews.data, documents.data],
  );

  const isPending =
    threads.isPending || reviews.isPending || documents.isPending;
  const isError = threads.isError || reviews.isError || documents.isError;

  function retry(): void {
    void threads.refetch();
    void reviews.refetch();
    void documents.refetch();
  }

  return (
    <div
      className={`flex h-[340px] w-[320px] flex-col animate-in fade-in-0 zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none ${canvasNodeShellClass(
        CANVAS_NODE_KIND_GEOMETRY["brief"],
        selected === true,
      )}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-hair px-3 active:cursor-grabbing">
        <span className="flex min-w-0 items-center gap-2">
          <Sunrise className="size-3 shrink-0 text-faded" aria-hidden />
          {/* polytoken's name for the digest — chrome, sans (law 2). */}
          <span className="truncate text-xs font-semibold text-ink">{label}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {brief && !isPending && !isError ? (
            <span className="tabular text-2xs text-faded">
              {timeFmt.format(brief.generatedAt)}
            </span>
          ) : null}
          <button
            type="button"
            aria-label="Remove brief"
            className="flex size-6 shrink-0 items-center justify-center rounded-sm text-pencil transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
            onClick={(event) => {
              event.stopPropagation();
              void deleteElements({ nodes: [{ id }] });
            }}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </span>
      </div>

      {/* GESTURE ISOLATION — `nowheel nopan nodrag` keep a wheel/drag OVER the
          digest from bubbling to React Flow, so the gesture scrolls the brief
          instead of panning the board. The header keeps `node-drag-handle`, so
          the card still drags by its title bar. */}
      <div className="nowheel nopan nodrag relative flex-1 overflow-y-auto px-3 py-2">
        {isPending ? (
          <div role="status" aria-label="Assembling brief" className="flex flex-col gap-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-1/3" />
            <Skeleton className="h-3 w-full" />
          </div>
        ) : isError ? (
          // Compact, card-embedded error (mirrors email-thread-node / circle-
          // pack-node) — icon is INK (a failure is a state, not an irreversible
          // action; law 1: an error is ink on a rule, never madder).
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-1 text-center">
            <AlertCircle className="size-5 shrink-0 text-ink" aria-hidden />
            <p className="text-xs text-faded">
              Couldn&apos;t assemble your brief. Try again.
            </p>
            <button
              type="button"
              onClick={retry}
              className="rounded-sm px-1.5 py-0.5 text-xs text-faded transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              Retry
            </button>
          </div>
        ) : brief.isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-1 text-center">
            <Sunrise className="size-5 shrink-0 text-faded" aria-hidden />
            <p className="text-xs text-faded">
              Nothing new since yesterday. You&apos;re all caught up.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <BriefSection
              icon={<Mail className="size-3.5" aria-hidden strokeWidth={1.5} />}
              title="New email"
              count={brief.counts.newEmails}
            >
              {brief.newEmails.map((e) => (
                <li key={e.key} className="truncate text-xs text-ink">
                  {e.subject}
                  {e.messageCount > 1 ? (
                    <span className="text-faded"> · {e.messageCount}</span>
                  ) : null}
                </li>
              ))}
            </BriefSection>

            <BriefSection
              icon={<GitMerge className="size-3.5" aria-hidden strokeWidth={1.5} />}
              title="Merges to review"
              count={brief.counts.pendingMerges}
            >
              {brief.pendingMerges.map((m) => (
                <li key={m.pairKey} className="truncate text-xs">
                  <Link
                    href="/entities"
                    className="text-ink underline-offset-2 hover:underline"
                  >
                    {m.subjectName}
                    <span className="text-faded"> ↔ </span>
                    {m.candidateName}
                  </Link>
                </li>
              ))}
            </BriefSection>

            <BriefSection
              icon={<FileText className="size-3.5" aria-hidden strokeWidth={1.5} />}
              title="New documents"
              count={brief.counts.recentDocuments}
            >
              {brief.recentDocuments.map((d) => (
                <li key={d.id} className="truncate text-xs">
                  <Link
                    href={`/documents/${d.id}`}
                    className="text-ink underline-offset-2 hover:underline"
                  >
                    {d.title}
                  </Link>
                </li>
              ))}
            </BriefSection>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

/**
 * BriefSection — one titled section of the digest; renders nothing when its
 * section is empty (the fold caps/filters upstream, so a zero count means
 * "nothing in this window"). Mirrors morning-brief-panel.tsx's BriefSection.
 */
function BriefSection({
  icon,
  title,
  count,
  children,
}: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly count: number;
  readonly children: React.ReactNode;
}): React.ReactElement | null {
  if (count === 0) return null;
  return (
    <div>
      {/* polytoken's summary label — sans chrome (law 2). */}
      <div className="flex items-center gap-1.5 text-2xs font-medium text-faded">
        {icon}
        <span>{title}</span>
        <span>({count})</span>
      </div>
      <ul className="mt-1 flex flex-col gap-0.5">{children}</ul>
    </div>
  );
}
