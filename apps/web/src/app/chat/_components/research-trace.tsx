"use client";

/**
 * research-trace.tsx — the deep-research run's two transcript rows
 * (Phase 69, RSRCH-02 + RSRCH-04).
 *
 * `deep_research` streams through the SAME server-tool part contract every
 * other tool round uses (39-UI-SPEC.md — `tool_invocation_streaming` while in
 * flight, `tool_invocation_result` once settled), so these are DISPATCH
 * TARGETS of the existing rows, not a parallel rendering path:
 * `ToolRoundActivityRow` / `ToolInvocationResultRow` each early-return here
 * for `toolName === DEEP_RESEARCH_TOOL_NAME` and change nothing else.
 *
 * ── RSRCH-04: the trace collapses to ONE line when done ──────────────────
 *
 * "Collapse-after-done is the detail everyone misses"
 * (docs/design/taste-references.md §research). A settled run mounts
 * COLLAPSED: one pencil-register line ("Deep research — N verified claims ·
 * M sources"), one click (a real <button aria-expanded>) to re-expand the
 * full trace — the loop's steps (plan → search rounds → verify →
 * synthesize), the verified claims, and the sources panel. The counts on
 * every step are DERIVED from the persisted envelope
 * (`{"mode":"deep_research","report","aborted","sources","claims"}`,
 * deep_research.py's DeepResearchToolExecutor) — never invented. The
 * envelope carries no per-round data, so the step rows narrate the loop's
 * REAL shape with only the counts it actually recorded; they do not fake a
 * per-round timeline the stream never delivered.
 *
 * ── RSRCH-02: pmark 3-tier citation disclosure — NO new footnote system ──
 *
 * Per taste §research ("the provenance mark IS tier 1 … reuse `pmark`,
 * build nothing new; a footnote-number system is the one unforgivable
 * move"):
 *   tier 1 — the mark. Each verified claim IS the cited span, and wears
 *            `pmark pmark-suggested` (the D-58-01 signature element,
 *            globals.css). SUGGESTED, dashed, deliberately: the claim
 *            survived the loop's ADVERSARIAL verify step, which is a
 *            machine's judgment — the suggest-only stance
 *            (region-vocabulary.ts's `tierOf`) never lets a machine claim
 *            the human's solid-border tier. A claim whose citations do not
 *            resolve to a source in the envelope renders UNMARKED (sans, no
 *            popover): the mark is a provenance claim, and this component
 *            can only ever demote evidence → chrome, never promote
 *            (provenance-link.tsx's `chipLabelFor` direction, T-61-11).
 *   tier 2 — hover, 0 clicks. The marked span is a Radix Tooltip trigger
 *            (the vendored `@polytoken/ui/tooltip`, hover AND
 *            keyboard-focus); the popover shows each cited source's title +
 *            host + verbatim excerpt. The excerpt/title are the SOURCE'S
 *            own words → `font-serif` + `data-evidence`, as a pair, always
 *            (law 2); the host line is our bookkeeping → sans.
 *   tier 3 — the sources panel, 1 click (the same click that expands the
 *            trace). Every source: its pmark host mark, its title as a real
 *            external link, its verbatim excerpt.
 *
 * External URLs come from a tool envelope (untrusted, T-61-11 posture): a
 * source's `url` becomes an <a href> ONLY when it parses as http(s) —
 * anything else renders as plain text, fail-closed. No field of the
 * envelope is ever interpolated into a class string or style.
 *
 * LAW 1 — everything here is chrome except the earned marks: step rows and
 * the summary line are `--pencil` bookkeeping (subordinate to the answer
 * below them, same register as the other tool rows); the only hue on this
 * surface is `--sugg` via `pmark-suggested`, which is the tier system
 * speaking, not decoration. The error row is INK on a triangle (a state,
 * never madder — tool-invocation-result-row.tsx's header). `wrap-break-word`
 * is the v4 spelling and is load-bearing (D-61-06 / D-61-04-C): the
 * transcript's ScrollArea shrink-wraps to content, and a long unbroken URL
 * in a claim or excerpt would widen the whole transcript sideways.
 */

import * as React from "react";
import { useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Globe,
  ListTree,
  Loader2,
  PenLine,
  ShieldCheck,
} from "lucide-react";

import { cn } from "@polytoken/ui";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@polytoken/ui/tooltip";

/** Mirrors deep_research.py's DEEP_RESEARCH_TOOL_NAME — the dispatch key the
 * two existing tool-round rows branch on. */
export const DEEP_RESEARCH_TOOL_NAME = "deep_research";

// ---------------------------------------------------------------------------
// Envelope parsing — defensive, mirrors tool-invocation-result-row.tsx's
// parseCitations discipline: coerce field-by-field, drop what doesn't
// conform, never throw (the content string is untrusted tool output).
// ---------------------------------------------------------------------------

export interface ResearchSource {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly excerpt: string;
}

export interface ResearchClaim {
  readonly text: string;
  readonly sourceIds: readonly string[];
}

export interface ResearchRun {
  readonly report: string;
  readonly aborted: boolean;
  readonly sources: readonly ResearchSource[];
  readonly claims: readonly ResearchClaim[];
}

/** Which citation surface this trace renders. `research` is deep_research's
 * verified-claims run (default, unchanged); `knowledge_memory` is AI-06's
 * canon-memory recall — same envelope shape, same 3-tier citation UI, but
 * `/knowledge` internal links and memory-appropriate labels. */
export type TraceVariant = "research" | "knowledge_memory";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseSources(value: unknown): readonly ResearchSource[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const sources: ResearchSource[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const id = asString(record.id).trim();
    if (id.length === 0) continue;
    sources.push({
      id,
      url: asString(record.url),
      title: asString(record.title),
      excerpt: asString(record.excerpt),
    });
  }
  return sources;
}

function parseClaims(value: unknown): readonly ResearchClaim[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const claims: ResearchClaim[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const text = asString(record.text).trim();
    if (text.length === 0) continue;
    const rawIds = Array.isArray(record.source_ids) ? record.source_ids : [];
    const sourceIds = rawIds
      .map((sid) => asString(sid).trim())
      .filter((sid) => sid.length > 0);
    claims.push({ text, sourceIds });
  }
  return claims;
}

/** Parse the persisted deep_research envelope, or null when `content` is not
 * a JSON object (the cap_tool_output mid-token truncation edge case — the
 * caller degrades gracefully, same as the other result rows, T-39-04). */
export function parseResearchRun(content: string): ResearchRun | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  return {
    report: asString(record.report),
    aborted: record.aborted === true,
    sources: parseSources(record.sources),
    claims: parseClaims(record.claims),
  };
}

/** http(s)-only, fail-closed — the url field is untrusted tool-envelope data
 * and must never become a javascript:/data: href (T-61-11 posture). */
export function safeExternalHref(url: string): string | undefined {
  return /^https?:\/\//i.test(url) ? url : undefined;
}

/** Same-origin `/knowledge…` deep-links only, fail-closed (AI-06). A canon
 * memory citation resolves to a real knowledge node on the graph surface; the
 * ONLY internal path we ever turn into an href is `/knowledge` (optionally
 * `/knowledge?node=<id>` or `/knowledge/…`). Anything else — including a
 * protocol-relative `//evil` or a `javascript:` string — renders as plain
 * text, never a link. */
export function safeInternalHref(url: string): string | undefined {
  return /^\/knowledge(?:$|[/?#])/.test(url) ? url : undefined;
}

/** The compact mark label for a source: its hostname (www-stripped), else a
 * trimmed title, else its envelope id. Our derived vocabulary for the
 * source — chrome by provenance, even though the pmark's own serif rides
 * along (the mark IS the signature element; its typeface is the mark's). */
export function sourceMarkLabel(source: ResearchSource): string {
  const href = safeExternalHref(source.url);
  if (href !== undefined) {
    try {
      const host = new URL(href).hostname.replace(/^www\./, "");
      if (host.length > 0) return host;
    } catch {
      // fall through to title/id
    }
  }
  const title = source.title.trim();
  if (title.length > 0) {
    return title.length > 28 ? `${title.slice(0, 28)}…` : title;
  }
  return source.id;
}

function countLabel(count: number, singular: string, plural: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

/** Mirrors the Python listener's knowledge_memory tool name — the dispatch key
 * ToolInvocationResultRow branches on to render a canon-memory recall (AI-06)
 * through THIS component with internal `/knowledge` citation links. */
export const KNOWLEDGE_MEMORY_TOOL_NAME = "knowledge_memory";

/** AI-06's one-line collapsed summary — the canon-memory analogue of
 * `researchSummaryLabel`. Claims are recalled facts; sources are the cited
 * `/knowledge` nodes. */
export function memorySummaryLabel(run: ResearchRun): string {
  if (run.claims.length === 0 && run.sources.length === 0) {
    return "Agent memory — nothing recalled";
  }
  return `Agent memory — ${countLabel(run.claims.length, "fact recalled", "facts recalled")} · ${countLabel(
    run.sources.length,
    "source",
    "sources",
  )}`;
}

/** The one-line collapsed summary (RSRCH-04's "one line when done"). */
export function researchSummaryLabel(run: ResearchRun): string {
  const base =
    run.claims.length === 0
      ? "Deep research — no verified claims"
      : `Deep research — ${countLabel(run.claims.length, "verified claim", "verified claims")} · ${countLabel(
          run.sources.length,
          "source",
          "sources",
        )}`;
  return run.aborted ? `${base} · stopped early` : base;
}

// ---------------------------------------------------------------------------
// In-flight row — dispatched from ToolRoundActivityRow. Same `.tool` status
// register (role="status", pencil, small step); a second, subordinate line
// sets the honest expectation that this round is minutes, not seconds.
// ---------------------------------------------------------------------------

export function ResearchActivityRow(): React.ReactElement {
  return (
    <div
      role="status"
      className="flex flex-col gap-0.5 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
    >
      <div className="flex items-center gap-1.5 text-xs text-pencil">
        <Loader2 className="size-3.5 shrink-0 motion-safe:animate-spin" aria-hidden />
        <span>Researching — planning, searching, verifying…</span>
      </div>
      <span className="pl-5 text-2xs text-pencil">
        Several web-search rounds; this can take a few minutes.
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The settled trace row — dispatched from ToolInvocationResultRow.
// ---------------------------------------------------------------------------

export interface ResearchTraceRowProps {
  readonly content: string;
  readonly isError: boolean;
  /** Defaults to `research` (deep_research). AI-06 passes `knowledge_memory`
   * to render a canon-memory recall through this same component. */
  readonly variant?: TraceVariant;
}

const SECTION_LABEL_CLASS =
  "text-2xs font-medium uppercase tracking-wide text-pencil";

/** Focus is an ink outline, never a ring (D-61-03-F — ring-offset paints a
 * white halo in dark mode). Same recipe as provenance-link.tsx. */
const FOCUS_OUTLINE_CLASS =
  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink";

function TraceStep({
  icon: Icon,
  label,
  ink = false,
}: {
  readonly icon: React.ComponentType<{ readonly className?: string }>;
  readonly label: string;
  readonly ink?: boolean;
}): React.ReactElement {
  return (
    <li
      className={cn(
        "flex items-center gap-1.5 text-xs tabular",
        ink ? "text-ink" : "text-pencil",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", ink ? undefined : "text-faded")} aria-hidden />
      <span>{label}</span>
    </li>
  );
}

/** Tier 2 — the hover popover's body: each cited source's title + host +
 * verbatim excerpt. Title/excerpt are the source's OWN words → serif +
 * `data-evidence`, as a pair (law 2); the host line is chrome → sans. */
function CitedSourcesPopoverBody({
  sources,
}: {
  readonly sources: readonly ResearchSource[];
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      {sources.map((source) => (
        <div key={source.id} className="flex min-w-0 flex-col gap-0.5">
          <span data-evidence className="font-serif tabular text-xs text-ink wrap-break-word">
            {source.title.trim().length > 0 ? source.title : source.url || source.id}
          </span>
          <span className="font-sans text-2xs text-pencil">{sourceMarkLabel(source)}</span>
          {source.excerpt.trim().length > 0 && (
            <span
              data-evidence
              className="line-clamp-4 font-serif tabular text-xs leading-snug text-pencil wrap-break-word"
            >
              {source.excerpt}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** One verified claim — tier 1 of RSRCH-02. The claim IS the cited span and
 * wears the signature mark; hovering (or keyboard-focusing) it is tier 2.
 * A claim with no RESOLVING citation renders unmarked — never promoted. */
function ClaimItem({
  claim,
  sourcesById,
}: {
  readonly claim: ResearchClaim;
  readonly sourcesById: ReadonlyMap<string, ResearchSource>;
}): React.ReactElement {
  const cited = claim.sourceIds
    .map((sid) => sourcesById.get(sid))
    .filter((source): source is ResearchSource => source !== undefined);

  if (cited.length === 0) {
    return (
      <li className="max-w-prose text-sm leading-relaxed text-ink wrap-break-word">
        {claim.text}
      </li>
    );
  }

  return (
    <li className="max-w-prose text-sm leading-relaxed wrap-break-word">
      <Tooltip>
        <TooltipTrigger asChild>
          {/* box-decoration-clone: a wrapped claim keeps the mark's wash and
              border on every line fragment, not only the first. tabIndex so
              tier 2 also opens on keyboard focus — hover costs 0 clicks and
              a keyboard costs 0 clicks too. */}
          <span
            tabIndex={0}
            className={cn("pmark pmark-suggested box-decoration-clone", FOCUS_OUTLINE_CLASS)}
          >
            {claim.text}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          className="max-w-80 rounded-card border border-rule bg-bright px-3 py-2 text-ink"
        >
          <CitedSourcesPopoverBody sources={cited} />
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

/** Tier 3 — the sources panel. Title links out (http(s) only, fail-closed);
 * excerpt is the page's verbatim words (serif + data-evidence). */
function SourcesPanel({
  sources,
  hrefFor = (source) => safeExternalHref(source.url),
  label = "Sources",
}: {
  readonly sources: readonly ResearchSource[];
  /** Resolves a source to its href (fail-closed → plain text). Defaults to the
   * http(s)-only external resolver; AI-06's memory variant passes the
   * `/knowledge`-only internal resolver so citations link to real nodes. */
  readonly hrefFor?: (source: ResearchSource) => string | undefined;
  readonly label?: string;
}): React.ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className={SECTION_LABEL_CLASS}>{label}</span>
      <ul className="flex min-w-0 flex-col gap-2">
        {sources.map((source) => {
          const href = hrefFor(source);
          const title =
            source.title.trim().length > 0
              ? source.title
              : source.url.trim().length > 0
                ? source.url
                : "Untitled source";
          return (
            <li key={source.id} className="flex min-w-0 flex-col gap-0.5">
              <div className="flex min-w-0 items-baseline gap-1.5">
                <span className="pmark pmark-suggested shrink-0 text-2xs">
                  {sourceMarkLabel(source)}
                </span>
                {href !== undefined ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-evidence
                    className={cn(
                      "min-w-0 truncate font-serif tabular text-xs text-ink underline-offset-2 hover:underline",
                      FOCUS_OUTLINE_CLASS,
                    )}
                  >
                    {title}
                  </a>
                ) : (
                  <span data-evidence className="min-w-0 truncate font-serif tabular text-xs text-ink">
                    {title}
                  </span>
                )}
              </div>
              {source.excerpt.trim().length > 0 && (
                <span
                  data-evidence
                  className="max-w-prose font-serif tabular text-xs leading-relaxed text-pencil wrap-break-word"
                >
                  {source.excerpt}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The expanded trace body: the loop's steps, the marked claims, the
 * sources panel — indented behind a quiet rule, subordinate to the answer
 * that follows in the same turn. */
function ResearchTraceDetail({
  run,
  variant = "research",
}: {
  readonly run: ResearchRun;
  readonly variant?: TraceVariant;
}): React.ReactElement {
  const sourcesById = new Map(run.sources.map((source) => [source.id, source]));
  const isMemory = variant === "knowledge_memory";
  return (
    <div className="flex min-w-0 flex-col gap-3 border-l border-rule pl-3">
      {isMemory ? (
        // AI-06: a canon-memory recall has no research loop to narrate — one
        // pencil line names its provenance (human-confirmed knowledge graph).
        <ol className="flex flex-col gap-1" aria-label="Memory steps">
          <TraceStep
            icon={ListTree}
            label={`Recalled from your knowledge graph — ${countLabel(
              run.sources.length,
              "canon node",
              "canon nodes",
            )} (human-confirmed)`}
          />
        </ol>
      ) : (
        <ol className="flex flex-col gap-1" aria-label="Research steps">
          <TraceStep icon={ListTree} label="Planned the research" />
          <TraceStep
            icon={Globe}
            label={`Ran web-search rounds — ${countLabel(run.sources.length, "source cited", "sources cited")}`}
          />
          <TraceStep
            icon={ShieldCheck}
            label={`Adversarial check against sources — ${countLabel(run.claims.length, "claim kept", "claims kept")}`}
          />
          {run.aborted ? (
            <TraceStep
              icon={AlertTriangle}
              ink
              label="Stopped early — research budget reached; only verified claims were kept"
            />
          ) : (
            <TraceStep icon={PenLine} label="Synthesized the report" />
          )}
        </ol>
      )}

      <div className="flex min-w-0 flex-col gap-1.5">
        <span className={SECTION_LABEL_CLASS}>{isMemory ? "Recalled facts" : "Verified claims"}</span>
        {run.claims.length === 0 ? (
          // The empty state teaches the next action (taste §4) rather than
          // presenting a bare "0".
          <span className="max-w-prose text-xs text-pencil">
            {isMemory
              ? "No canon facts matched this conversation yet."
              : "No claim survived verification. Try a narrower question, or name the specific fact you need."}
          </span>
        ) : (
          <TooltipProvider delayDuration={150}>
            <ul className="flex min-w-0 flex-col gap-1.5">
              {run.claims.map((claim, index) => (
                <ClaimItem key={index} claim={claim} sourcesById={sourcesById} />
              ))}
            </ul>
          </TooltipProvider>
        )}
      </div>

      {run.sources.length > 0 && (
        <SourcesPanel
          sources={run.sources}
          hrefFor={isMemory ? (source) => safeInternalHref(source.url) : undefined}
          label={isMemory ? "Cited knowledge nodes" : "Sources"}
        />
      )}
    </div>
  );
}

export function ResearchTraceRow({
  content,
  isError,
  variant = "research",
}: ResearchTraceRowProps): React.ReactElement {
  // Hooks before any early return (rules of hooks) — the collapsed/expanded
  // state exists even for the error/degraded branches that never use it.
  const [expanded, setExpanded] = useState(false);
  const isMemory = variant === "knowledge_memory";

  if (isError) {
    // A state, so it speaks in ink, never madder — the triangle carries the
    // meaning by shape (tool-invocation-result-row.tsx's law-1 note).
    return (
      <div role="alert" className="flex items-center gap-1.5 text-xs text-ink">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
        <span>
          {isMemory
            ? "Couldn't recall from your knowledge graph."
            : "Couldn't complete the deep research."}
        </span>
      </div>
    );
  }

  const run = parseResearchRun(content);
  if (run === null) {
    // Truncated/unparseable persisted envelope — degrade, never throw, never
    // render the raw string (T-39-04's discipline).
    return (
      <div className="flex items-center gap-1.5 text-xs text-pencil">
        <span>{isMemory ? "Recalled agent memory — details unavailable." : "Ran deep research — details unavailable."}</span>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className={cn(
          "flex w-fit items-center gap-1.5 rounded-sm text-left text-xs tabular text-pencil transition-colors hover:text-ink",
          FOCUS_OUTLINE_CLASS,
        )}
      >
        <ChevronRight
          className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-90")}
          aria-hidden
        />
        <span>{isMemory ? memorySummaryLabel(run) : researchSummaryLabel(run)}</span>
      </button>
      {expanded && <ResearchTraceDetail run={run} variant={variant} />}
    </div>
  );
}
