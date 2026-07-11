"use client";

/**
 * tool-invocation-result-row.tsx — ToolInvocationResultRow (TUI-01
 * completion + TUI-02 citations, 39-UI-SPEC.md "Component 2"). Renders once
 * a server-tool round settles: a collapsed, quiet single-line entry (label +
 * result count + up to 5 citation chips via the shared `<ProvenanceLink>`),
 * an `isError` row, or a degraded "details unavailable" row when `content`
 * fails `JSON.parse` (the `cap_tool_output` mid-token truncation edge case).
 * Never renders the raw `content` string verbatim (success or error) — only
 * derived label/count/chip values (T-39-04, T-39-06, DO-NOT 6).
 */

import * as React from "react";
import { AlertTriangle } from "lucide-react";

import { ProvenanceLink, type ProvenanceKind } from "~/components/provenance-link";

export interface ToolInvocationResultRowProps {
  readonly toolName: string;
  readonly content: string;
  readonly isError: boolean;
}

interface ToolCopy {
  readonly baseLabel: string;
  readonly errorLabel: string;
}

// 39-UI-SPEC.md Component 2 "Copy — tool-name -> completed/error label maps".
const COPY_BY_TOOL_NAME: Readonly<Record<string, ToolCopy>> = {
  lookup_entity: {
    baseLabel: "Looked up an entity",
    errorLabel: "Couldn't look up that entity.",
  },
  search_emails: {
    baseLabel: "Searched emails",
    errorLabel: "Couldn't search emails.",
  },
  search_knowledge: {
    baseLabel: "Searched knowledge",
    errorLabel: "Couldn't search the knowledge graph.",
  },
};

const FALLBACK_COPY: ToolCopy = {
  baseLabel: "Ran a lookup",
  errorLabel: "Couldn't complete that lookup.",
};

const MAX_VISIBLE_CHIPS = 5;

interface ParsedCitation {
  readonly kind: ProvenanceKind;
  readonly id: string;
  readonly route: string;
}

function isProvenanceKind(value: unknown): value is ProvenanceKind {
  return value === "email" || value === "entity" || value === "knowledge";
}

function parseCitations(value: unknown): readonly ParsedCitation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const citations: ParsedCitation[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (!isProvenanceKind(record.kind) || typeof record.id !== "string") continue;
    citations.push({
      kind: record.kind,
      id: record.id,
      route: typeof record.route === "string" ? record.route : "",
    });
  }
  return citations;
}

function dedupeCitations(citations: readonly ParsedCitation[]): readonly ParsedCitation[] {
  const seen = new Set<string>();
  const deduped: ParsedCitation[] = [];
  for (const citation of citations) {
    const key = `${citation.kind}:${citation.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(citation);
  }
  return deduped;
}

function resultCountLabel(baseLabel: string, count: number): string {
  return count === 1 ? `${baseLabel} — 1 result` : `${baseLabel} — ${count} results`;
}

function CitationChips({
  citations,
}: {
  readonly citations: readonly ParsedCitation[];
}): React.ReactElement | null {
  if (citations.length === 0) {
    return null;
  }
  const visible = citations.slice(0, MAX_VISIBLE_CHIPS);
  const overflowCount = citations.length - visible.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((citation) => (
        <ProvenanceLink
          key={`${citation.kind}:${citation.id}`}
          kind={citation.kind}
          id={citation.id}
        />
      ))}
      {overflowCount > 0 && (
        <span className="inline-flex items-center rounded-pill border border-transparent bg-muted px-2 py-1 text-xs font-normal text-muted-foreground">
          +{overflowCount}
        </span>
      )}
    </div>
  );
}

export function ToolInvocationResultRow({
  toolName,
  content,
  isError,
}: ToolInvocationResultRowProps): React.ReactElement {
  const copy = COPY_BY_TOOL_NAME[toolName] ?? FALLBACK_COPY;

  if (isError) {
    return (
      <div role="alert" className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
        <span>{copy.errorLabel}</span>
      </div>
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // cap_tool_output's 2000-char truncation can cut JSON mid-token —
    // degrade gracefully, never throw, never render a blank turn (T-39-04).
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <span>{copy.baseLabel} — details unavailable.</span>
      </div>
    );
  }

  const record = parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const results = Array.isArray(record.results) ? record.results : [];
  const citations = dedupeCitations(parseCitations(record.citations));
  const label =
    results.length === 0 ? `${copy.baseLabel} — no results found` : resultCountLabel(copy.baseLabel, results.length);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1 text-sm text-muted-foreground">
      <span>{label}</span>
      <CitationChips citations={citations} />
    </div>
  );
}
