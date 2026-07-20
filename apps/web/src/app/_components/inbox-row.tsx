"use client";

// Explicit React import — this file's JSX compiles fine under Next.js's SWC
// automatic JSX runtime, but vitest's plain esbuild transform defaults to
// the classic runtime (React.createElement) and needs `React` in scope
// whenever a test mounts this component (mirrors genui-panel-node.tsx's
// identical note — found live, 53-03-PLAN.md Task 1,
// inbox-mobile-stack.test.tsx).
import * as React from "react";

import { EntityChips, type EntityChipEntry } from "./entity-chips";
import { RuleSuggestionRowMark } from "./mail-rule-review";

/**
 * The inbox-row's view of an email. A narrow projection of the emails.list row
 * (the DB EmailRow) — only the fields the row paints, typed explicitly so the
 * component never depends on the db package. `bodyText` (60-02 Task 1) unlocks
 * the row's serif snippet band — the data already flows from `emails.list`
 * (`InboxEmailItem` in inbox-three-pane.tsx); only this narrower type hid it.
 */
export interface InboxEmail {
  readonly id: string;
  readonly subject: string | null;
  readonly senderName: string | null;
  readonly senderAddress: string;
  readonly receivedAt: Date | string | null;
  readonly bodyText: string | null;
}

interface InboxRowProps {
  readonly email: InboxEmail;
  readonly entities: ReadonlyArray<EntityChipEntry>;
  readonly isSelected: boolean;
  readonly onSelect: (emailId: string) => void;
  /**
   * MAIL-01: count of UNDECIDED rule suggestions for this email (already
   * net of local accept/dismiss decisions). Renders the collapsed dashed
   * "N rule suggestions" mark (taste doc Lane B point 1 — proposals surface
   * in-context during triage, never on a settings page). Optional so
   * existing call sites and tests compile unchanged; 0/absent renders
   * nothing.
   */
  readonly ruleSuggestionCount?: number;
}

const formatDate = (value: Date | string | null): string =>
  value ? new Date(value).toLocaleDateString() : "—";

/**
 * T-60-04 (DoS, client): `bodyText` can be a multi-megabyte body. Bound the
 * snippet to this many characters in JS BEFORE it ever reaches the DOM —
 * never rely on CSS truncation alone to tame a megabyte string. Exported so
 * `inbox-thread-group.tsx` reuses the exact same bound for `latestSnippet`
 * rather than duplicating a different cap.
 */
export const SNIPPET_MAX_CHARS = 200;

/**
 * toInboxSnippet — collapse whitespace/newlines to single spaces, trim, and
 * ellipsis-truncate a message body into a compact single-line snippet.
 * Returns null for null/blank input so the caller can render nothing (an
 * empty serif line would be a hole in the row's rhythm) rather than a hole.
 */
export function toInboxSnippet(bodyText: string | null): string | null {
  if (bodyText === null) return null;
  const collapsed = bodyText.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  return collapsed.length > SNIPPET_MAX_CHARS
    ? `${collapsed.slice(0, SNIPPET_MAX_CHARS - 1)}…`
    : collapsed;
}

/**
 * InboxRow (D-23/D-24, D-58-01) — a registry entry, not a Gmail row.
 *
 * 60-02 Task 1 restructure (not a restyle): four bands, not three lines.
 * Band 1 (chrome, sans): sender + tabular time — product chrome, law 1
 * clean (no hue). Band 2 (EVIDENCE, serif): the subject — promoted from
 * muted secondary text to the user's own material (law 2). Band 3
 * (EVIDENCE, serif) — NEW: a bounded snippet of the message's own words,
 * the single biggest information-density gain this plan makes; omitted
 * entirely when there is no usable body text. Band 4: the entity chips
 * (Plan 01's provenance marks), unchanged in placement.
 *
 * The chips are independent `<a>` deep-links that must never be nested
 * inside an interactive element (invalid HTML + nested-interactive a11y
 * violation). The row is therefore a `<div role="button">` with explicit
 * keyboard handlers (Enter/Space activate selection) rather than a
 * `<button>` wrapping the chips. Selected rows are an ink/ground well
 * (`bg-bright` + `border-rule` top/bottom) — never a hue (law 1); the pre-60
 * translucent primary-tint accent is gone.
 */
export function InboxRow({
  email,
  entities,
  isSelected,
  onSelect,
  ruleSuggestionCount = 0,
}: InboxRowProps): React.ReactElement {
  const sender = email.senderName ?? email.senderAddress;
  const snippet = toInboxSnippet(email.bodyText);

  function activate(): void {
    onSelect(email.id);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    // Mirror native button activation: Enter and Space select the row. Space is
    // prevented from scrolling. Keys originating from the nested chip links are
    // left alone (their own anchor semantics handle Enter).
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={activate}
      onKeyDown={handleKeyDown}
      className={`flex w-full cursor-pointer flex-col gap-0.5 px-row-x py-row-y text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1 ${
        isSelected ? "border-y border-rule bg-bright" : "border-b border-hair hover:bg-shade"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span data-field="sender" className="truncate text-sm font-semibold">
          {sender}
        </span>
        <time data-field="time" className="tabular shrink-0 text-2xs text-pencil">
          {formatDate(email.receivedAt)}
        </time>
      </div>

      <span data-field="subject" data-evidence className="truncate font-serif text-base text-ink">
        {email.subject ?? "(no subject)"}
      </span>

      {snippet !== null && (
        <span
          data-field="snippet"
          data-evidence
          className="truncate font-serif text-xs text-faded"
        >
          {snippet}
        </span>
      )}

      {/* MAIL-01: the collapsed rule-suggestion mark — dashed (INFERRED)
          chrome, non-interactive on purpose: selecting the row is already
          the one click that opens the review panel in the reading pane. */}
      <RuleSuggestionRowMark count={ruleSuggestionCount} />

      {/* The chips are <a> deep-links — kept as a SIBLING (never nested in an
          interactive element). They stopPropagation so a chip click does not
          also toggle the row selection.
          totalCount: entitiesByEmailId (inbox-three-pane.tsx) does not carry
          the server's true per-email totalCount yet, so entities.length is
          used as an honest-for-now stand-in — a narrow edge case (only
          under-counts when a single email has MORE than the server's
          MAX_ENTITIES_PER_EMAIL=8 real entities). Deferred to a later plan
          that touches inbox-three-pane.tsx's data plumbing. */}
      <EntityChips entities={entities} totalCount={entities.length} emailId={email.id} />
    </div>
  );
}
