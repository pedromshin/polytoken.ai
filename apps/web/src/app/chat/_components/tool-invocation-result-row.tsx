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
 *
 * ────────────────────────────────────────────────────────────────────────
 * THE REGISTER (61-04): the round is BOOKKEEPING, the chips are the payload.
 * ────────────────────────────────────────────────────────────────────────
 *
 * Same register as the in-flight row: a `--pencil` line at the small step,
 * subordinate to the answer beside it. The label and the chips are STACKED
 * rather than run together on one line, which is the sketch's own order
 * (direction-final.html:1021-1022 — the `.tool` line, then the `.srcchip`,
 * then the answer). They shipped inline, which gave the bookkeeping the same
 * visual weight as the evidence it produced.
 *
 * T-61-13 — this renders exactly the fields it rendered before: the derived
 * label, the result count, and the citation chips. Tier-filtered envelopes are
 * enforced upstream (FOUND-6 `tool_envelope_gate` + Phase 38's three belts);
 * a restyle must not widen what reaches the DOM. In particular `results[]`
 * carries a `subject` that is NOT rendered here and must not start being
 * rendered "because the chip has room for it now" — see 61-04-SUMMARY.md's
 * note on the citation label gap.
 *
 * LAW 1 — `isError` IS A STATE, SO IT DOES NOT SPEAK IN MADDER (61-04).
 * The error row's AlertTriangle shipped wearing the madder TEXT token. Madder
 * means "irreversible — this cannot be undone"; 58-IDENTITY allows it on
 * irreversible CONTROLS and says "never errors, never warnings" in as many
 * words. A failed tool round is neither a control nor irreversible — it is a
 * state, and retrying it is one click away. Per brand-guide §3 "an error is
 * ink on a rule": the error row is INK, one step up from the pencil a normal
 * round wears, so it reads as more important without spending the identity's
 * loudest colour on a lookup that did not return. The triangle still carries
 * the meaning — by SHAPE, which survives greyscale.
 *
 * The retired token is DESCRIBED above rather than written out, deliberately:
 * `role-hue-ban.test.ts` reads LINES, not prose, and cannot tell a citation
 * from a class — and `chat/` joins its `SCOPED_DIRS` ratchet as Phase 61
 * finishes sweeping this surface. A commented-out violation is one paste away
 * from a live one.
 */

import * as React from "react";
import { AlertTriangle } from "lucide-react";

import { ProvenanceLink, type ProvenanceKind } from "~/components/provenance-link";

import { DEEP_RESEARCH_TOOL_NAME, ResearchTraceRow } from "./research-trace";

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
  // CLUS-03 (Phase 54-06, 54-UI-SPEC.md Component 4) — zero new component;
  // renders through the SAME no-citation path search_knowledge already uses
  // (Judgment Call #7 — raw web results carry no ProvenanceKind, so
  // `citations` is simply absent from the persisted envelope and
  // parseCitations/CitationChips naturally render nothing).
  web_search: {
    baseLabel: "Searched the web",
    errorLabel: "Couldn't search the web.",
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
        // CHROME, and it stays chrome: "+2" is polytoken counting, not the
        // document's words — so sans, no `data-evidence`, and no serif. It
        // borrows the chip's geometry (it sits in the same row) but not its
        // border: it links nowhere, so it must not read as a link. `tabular`
        // because it is a count (law 2's other half).
        <span className="inline-flex items-center rounded-sm bg-leaf px-chip-x py-chip-y font-sans text-xs tabular text-pencil">
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
  // Phase 69 (RSRCH-02/RSRCH-04): a settled deep-research round renders as
  // the collapsible research trace (one-line summary -> full trace with
  // pmark 3-tier citations), not the generic "N results" line. Dispatch on
  // the SAME part contract — this component's own behavior for every other
  // tool is unchanged, and the research row inherits the identical
  // error/degraded discipline (see research-trace.tsx).
  if (toolName === DEEP_RESEARCH_TOOL_NAME) {
    return <ResearchTraceRow content={content} isError={isError} />;
  }
  const copy = COPY_BY_TOOL_NAME[toolName] ?? FALLBACK_COPY;

  if (isError) {
    // Law 1: ink, not madder — see this file's header. The icon inherits
    // `currentColor` rather than naming a colour of its own.
    return (
      <div role="alert" className="flex items-center gap-1.5 text-xs text-ink">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
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
    // An uncertain read is `--pencil` (brand-guide §3) — which is exactly what
    // this row is: the round ran, we just cannot say what it found.
    return (
      <div className="flex items-center gap-1.5 text-xs text-pencil">
        <span>{copy.baseLabel} — details unavailable.</span>
      </div>
    );
  }

  const record = parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const results = Array.isArray(record.results) ? record.results : [];
  const citations = dedupeCitations(parseCitations(record.citations));
  const label =
    results.length === 0 ? `${copy.baseLabel} — no results found` : resultCountLabel(copy.baseLabel, results.length);

  // STACKED, not inline (the sketch's order — see the header). `min-w-0` so a
  // long chip row shrinks rather than widening the transcript's ScrollArea
  // sideways (D-61-06).
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs text-pencil">{label}</span>
      <CitationChips citations={citations} />
    </div>
  );
}
