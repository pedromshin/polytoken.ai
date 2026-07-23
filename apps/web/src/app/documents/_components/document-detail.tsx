"use client";

import Link from "next/link";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { Fragment } from "react";
import * as React from "react";

import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";
import { SendToMenu } from "~/app/_components/send-to-menu";

import type {
  Inline,
  ProvSpan,
  ReportBlock,
  ReportDocument,
} from "../_lib/report-document";

/**
 * document-detail.tsx — the /documents/[id] detail / re-open surface
 * (Phase 70 — DOCS-02).
 *
 * Reads the owner-scoped `documents.byId` tRPC procedure (gated through
 * ownership.ts server-side; NOT_FOUND becomes the not-found state here) and
 * renders the stored `spec` as an in-app READING view. The two secondary
 * exports — the typeset print route and the PDF — are reachable in ONE click
 * from arrival (taste contract: primary/near-primary actions at the top of the
 * surface), but the reading view itself is the focus.
 *
 * The spec crosses the tRPC boundary as `unknown` (jsonb; its concrete shape is
 * owned by this app, not @polytoken/api-client). We narrow it with a shallow
 * runtime guard before rendering — a malformed spec shows the "can't render"
 * state rather than throwing. Provenance marks reuse the ONE locked `pmark`
 * language (globals.css §SIGNATURE ELEMENT); the body is serif evidence (law 2:
 * the document is the user's own material), so prose carries `data-evidence`.
 */

// ---------------------------------------------------------------------------
// Shallow runtime narrowing of the jsonb spec -> ReportDocument
// ---------------------------------------------------------------------------

function isReportDocumentSpec(value: unknown): value is ReportDocument {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { blocks?: unknown }).blocks)
  );
}

// ---------------------------------------------------------------------------
// Reading-view block renderer (reuses the pmark provenance language)
// ---------------------------------------------------------------------------

function ProvenanceMark({ span }: { span: ProvSpan }): React.ReactElement {
  const cls =
    span.tier === "confirmed"
      ? "pmark pmark-confirmed"
      : "pmark pmark-suggested";
  return (
    <span className={cls} title={span.source} data-prov-tier={span.tier}>
      {span.text}
    </span>
  );
}

function renderRuns(runs: readonly Inline[]): React.ReactNode {
  return runs.map((run, i) =>
    typeof run === "string" ? (
      <Fragment key={i}>{run}</Fragment>
    ) : (
      <ProvenanceMark key={i} span={run} />
    ),
  );
}

function ReadingBlock({ block }: { block: ReportBlock }): React.ReactElement {
  switch (block.kind) {
    case "heading":
      return block.level === 3 ? (
        <h3 className="mt-6 text-sm font-semibold text-ink">{block.text}</h3>
      ) : (
        <h2 className="mt-8 text-base font-semibold text-ink">{block.text}</h2>
      );
    case "paragraph":
      return (
        <p className="mt-4 font-serif text-base leading-relaxed text-ink" data-evidence>
          {renderRuns(block.runs)}
        </p>
      );
    case "evidence":
      return (
        <blockquote className="mt-5 border-l-2 border-rule pl-4">
          <p className="font-serif text-base leading-relaxed text-ink" data-evidence>
            {renderRuns(block.runs)}
          </p>
          {block.cite ? (
            <cite className="mt-2 block text-2xs not-italic text-muted-foreground">
              {block.cite}
            </cite>
          ) : null}
        </blockquote>
      );
    case "list": {
      const items = block.items.map((runs, i) => (
        <li key={i} className="mt-1.5">
          {renderRuns(runs)}
        </li>
      ));
      return block.ordered ? (
        <ol
          className="mt-4 list-decimal pl-6 font-serif text-base leading-relaxed text-ink"
          data-evidence
        >
          {items}
        </ol>
      ) : (
        <ul
          className="mt-4 list-disc pl-6 font-serif text-base leading-relaxed text-ink"
          data-evidence
        >
          {items}
        </ul>
      );
    }
    default: {
      const _never: never = block;
      return _never;
    }
  }
}

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : dateFmt.format(d);
}

// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------

export function DocumentDetail({ id }: { id: string }): React.ReactElement {
  const query = api.documents.byId.useQuery({ id });

  return (
    <main className="min-h-[calc(100vh-3.5rem)] w-full bg-shelf">
      <div className="mx-auto w-full max-w-[72ch] px-4 py-8">
        <Link
          href="/documents"
          className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden strokeWidth={1.5} />
          All documents
        </Link>

        {query.isPending ? (
          <div className="mt-6" aria-busy>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-4 h-8 w-3/4" />
            <Skeleton className="mt-6 h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-2/3" />
          </div>
        ) : query.isError || !query.data ? (
          <div className="mt-6 rounded-md border border-rule bg-bright p-panel">
            <p className="text-sm font-medium text-ink">
              This document isn’t available.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              It may have been removed, or it isn’t yours to open.
            </p>
          </div>
        ) : (
          <DocumentBody id={id} row={query.data} />
        )}
      </div>
    </main>
  );
}

function DocumentBody({
  id,
  row,
}: {
  id: string;
  row: {
    id: string;
    title: string;
    spec: unknown;
    sourceLedgerId: string | null;
    createdAt: Date | string;
  };
}): React.ReactElement {
  const spec = isReportDocumentSpec(row.spec) ? row.spec : null;
  const generatedAt =
    spec?.generatedAt ??
    (row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : String(row.createdAt));

  return (
    <article className="mt-6">
      <header>
        <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          Polytoken · Document
        </div>
        <h1
          className="mt-2 font-serif text-xl font-semibold leading-tight text-ink"
          data-evidence
        >
          {row.title}
        </h1>
        {spec?.subtitle ? (
          <p className="mt-2 font-serif text-base text-muted-foreground" data-evidence>
            {spec.subtitle}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted-foreground">
          <span>
            Generated <span className="tabular">{formatDate(generatedAt)}</span>
          </span>
          {spec?.source ? <span>{spec.source}</span> : null}
          {row.sourceLedgerId ? <span>From a research run</span> : null}
        </div>
      </header>

      {/* Exports — one click from arrival (taste contract). Print + PDF build
          ON the Wave-1 pipeline; both are gated on the same owner identity. */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-y border-rule py-3">
        <Link
          href={`/documents/${id}/print`}
          className="inline-flex items-center gap-1.5 rounded-md border border-rule bg-bright px-3 py-1.5 text-2xs font-medium text-ink transition-colors hover:border-ink"
        >
          <Printer className="h-3.5 w-3.5" aria-hidden strokeWidth={1.5} />
          Open print view
        </Link>
        <a
          href={`/api/documents/${id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-rule bg-bright px-3 py-1.5 text-2xs font-medium text-ink transition-colors hover:border-ink"
        >
          <Download className="h-3.5 w-3.5" aria-hidden strokeWidth={1.5} />
          Download PDF
        </a>
        {/* AI-04: drop this document onto a conversation's canvas (kind
            `document` — canvas-only; there is no document chat-context rail). */}
        <div className="ml-auto">
          <SendToMenu
            object={{ kind: "document", documentId: row.id, label: row.title }}
            objectName={row.title}
          />
        </div>
      </div>

      {spec ? (
        <div className="mt-2">
          {spec.blocks.map((block, i) => (
            <ReadingBlock key={i} block={block} />
          ))}

          <footer className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-rule pt-3 text-2xs text-muted-foreground">
            <span>Provenance</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="pmark pmark-confirmed">confirmed</span>
              <span>a human verified this</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="pmark pmark-suggested">suggested</span>
              <span>machine-inferred, unconfirmed</span>
            </span>
          </footer>
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          This document’s stored contents couldn’t be rendered. You can still
          open the print view or export it.
        </p>
      )}
    </article>
  );
}
