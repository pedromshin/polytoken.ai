/**
 * message-to-document.ts (DOCS-01 export entry point) — the PURE, DB-free
 * converter that turns a chat turn's text (or a deep-research report's markdown)
 * into the REAL {@link ReportBlock}[] a stored document typesets from.
 *
 * ## Why this is its own module, and pure
 *
 * The typeset-PDF pipeline (`api/documents/[id]/pdf/route.ts` prints
 * `documents/[id]/print/typeset-document.tsx` headless) is already correct for a
 * STORED document — but `documents.create` only ever made a BLANK doc
 * (`blocks: []`). This module is the missing half: it manufactures the real
 * blocks so "save this response as a document" produces something the existing
 * PDF export immediately applies to. It is deliberately free of React, of the
 * trpc client, and of any server import, so the conversion is unit-testable
 * without jsdom (MEMORY: jsdom does no layout; a pure text→model transform needs
 * no DOM at all) and the action component stays a thin mutation caller.
 *
 * ## Provenance (DOCS-01 "provenance marks preserved")
 *
 * A plain chat message carries NO structured provenance data — the tier marks
 * live on cited spans inside the agent's genui output, not on the prose stream
 * this sees. So every run here is an UNMARKED string ({@link Inline} = string),
 * never a fabricated `confirmed`/`suggested` span: inventing a provenance tier a
 * message never asserted would be the exact inversion of the mark contract
 * (solid border = a human verified it). The document reads as clean prose; marks
 * enter only where the source actually carried them.
 *
 * ## The grammar it recognises
 *
 * A pragmatic markdown subset that matches what `MarkdownRenderer` shows and what
 * `deep_research` emits — headings (`#`..`###`, deeper clamped to level 3),
 * blockquotes (`>` → evidence), unordered (`-`/`*`/`+`) and ordered (`1.`) lists,
 * and everything else as paragraphs. Inline emphasis/marks are left as literal
 * text rather than parsed into spans: the reading typeset is faithful to the
 * words, and no run is silently dropped.
 */

import type { Inline, ReportBlock } from "../../documents/_lib/report-document";

/** The shape `documents.create` consumes for a real-block document. */
export interface DocumentDraft {
  readonly title: string;
  readonly blocks: readonly ReportBlock[];
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BLOCKQUOTE_RE = /^>\s?(.*)$/;
const UNORDERED_RE = /^[-*+]\s+(.*)$/;
const ORDERED_RE = /^\d+[.)]\s+(.*)$/;

/** A heading level clamped into the model's 1–3 range (deeper markdown headings
 * still typeset, at the deepest available level, rather than being dropped). */
function clampHeadingLevel(hashes: string): 1 | 2 | 3 {
  const n = hashes.length;
  return n <= 1 ? 1 : n === 2 ? 2 : 3;
}

/** One paragraph's accumulated non-empty lines → a single paragraph block whose
 * runs are joined with spaces (soft-wrapped source lines read as one flow). */
function paragraphFrom(lines: readonly string[]): ReportBlock {
  const runs: Inline[] = [lines.join(" ")];
  return { kind: "paragraph", runs };
}

/**
 * Convert a block of markdown-ish text into typeset-ready report blocks.
 *
 * Deterministic and total: any input yields a (possibly empty) block list — an
 * empty/whitespace-only string yields `[]`, which stores and renders as a clean
 * empty reading view (the same shape a blank document carries).
 */
export function markdownToReportBlocks(text: string): ReportBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReportBlock[] = [];

  // Pending accumulators — at most one is non-empty at a time; a change of kind
  // (or a blank line) flushes the current one before the next begins.
  let para: string[] = [];
  let quote: string[] = [];
  let listItems: Inline[][] = [];
  let listOrdered = false;

  const flushPara = (): void => {
    if (para.length > 0) {
      blocks.push(paragraphFrom(para));
      para = [];
    }
  };
  const flushQuote = (): void => {
    if (quote.length > 0) {
      blocks.push({ kind: "evidence", runs: [quote.join(" ")] });
      quote = [];
    }
  };
  const flushList = (): void => {
    if (listItems.length > 0) {
      blocks.push({ kind: "list", ordered: listOrdered, items: listItems });
      listItems = [];
    }
  };
  const flushAll = (): void => {
    flushPara();
    flushQuote();
    flushList();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (trimmed === "") {
      flushAll();
      continue;
    }

    const heading = HEADING_RE.exec(trimmed);
    if (heading) {
      flushAll();
      blocks.push({
        kind: "heading",
        level: clampHeadingLevel(heading[1] ?? "#"),
        text: (heading[2] ?? "").trim(),
      });
      continue;
    }

    const quoteMatch = BLOCKQUOTE_RE.exec(trimmed);
    if (quoteMatch) {
      flushPara();
      flushList();
      quote.push((quoteMatch[1] ?? "").trim());
      continue;
    }

    const ordered = ORDERED_RE.exec(trimmed);
    const unordered = UNORDERED_RE.exec(trimmed);
    if (ordered || unordered) {
      flushPara();
      flushQuote();
      const isOrdered = ordered !== null;
      // A change of list flavour (ul ↔ ol) starts a fresh list rather than
      // silently merging two different lists into one.
      if (listItems.length > 0 && listOrdered !== isOrdered) flushList();
      listOrdered = isOrdered;
      const itemText = (ordered ? ordered[1] : unordered?.[1]) ?? "";
      listItems.push([itemText.trim()]);
      continue;
    }

    // Plain prose line — flush any open non-paragraph accumulator, then append.
    flushQuote();
    flushList();
    para.push(trimmed);
  }

  flushAll();
  return blocks;
}

const MAX_TITLE = 200;

/** Collapse whitespace and clamp to the router's title bound (≤200). */
function normaliseTitle(candidate: string): string {
  const collapsed = candidate.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_TITLE) return collapsed;
  return collapsed.slice(0, MAX_TITLE).trimEnd();
}

/** Strip leading markdown chrome from a line so it can seed a title. */
function stripLeadingMarks(line: string): string {
  return line
    .replace(HEADING_RE, "$2")
    .replace(BLOCKQUOTE_RE, "$1")
    .replace(UNORDERED_RE, "$1")
    .replace(ORDERED_RE, "$1")
    .trim();
}

/**
 * Derive a document title from the source text: the first non-empty line (its
 * heading text if that line is itself a heading, chrome stripped), else a stable
 * fallback. Note this takes the first content line as-is — it does not scan ahead
 * for a later heading when the opening line is prose.
 * Always non-empty and ≤200 chars so it satisfies the create input contract.
 */
export function deriveDocumentTitle(text: string, fallback = "Saved response"): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    const heading = HEADING_RE.exec(trimmed);
    if (heading) {
      const title = normaliseTitle(heading[2] ?? "");
      if (title !== "") return title;
    }
    const title = normaliseTitle(stripLeadingMarks(trimmed));
    if (title !== "") return title;
  }
  return fallback;
}

/**
 * Build the full {@link DocumentDraft} (title + real blocks) from a message's
 * markdown text. This is what the "Save as document" action hands to
 * `documents.create` — after which the existing typeset-PDF export applies
 * unchanged.
 */
export function buildDocumentDraft(text: string, fallbackTitle?: string): DocumentDraft {
  return {
    title: deriveDocumentTitle(text, fallbackTitle),
    blocks: markdownToReportBlocks(text),
  };
}
