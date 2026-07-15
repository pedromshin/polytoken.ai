"use client";

// Explicit React import — this file's JSX compiles fine under Next.js's SWC
// automatic JSX runtime, but vitest's plain esbuild transform defaults to
// the classic runtime (React.createElement) and needs `React` in scope
// whenever a test mounts this component (mirrors genui-panel-node.tsx's
// identical note — found live, 53-03-PLAN.md Task 1,
// inbox-mobile-stack.test.tsx).
import * as React from "react";

import { EntityChips, type EntityChipEntry } from "./entity-chips";

/**
 * The inbox-row's view of an email. A narrow projection of the emails.list row
 * (the DB EmailRow) — only the fields the row paints, typed explicitly so the
 * component never depends on the db package.
 */
export interface InboxEmail {
  readonly id: string;
  readonly subject: string | null;
  readonly senderName: string | null;
  readonly senderAddress: string;
  readonly receivedAt: Date | string | null;
}

interface InboxRowProps {
  readonly email: InboxEmail;
  readonly entities: ReadonlyArray<EntityChipEntry>;
  readonly isSelected: boolean;
  readonly onSelect: (emailId: string) => void;
}

const formatDate = (value: Date | string | null): string =>
  value ? new Date(value).toLocaleDateString() : "—";

/**
 * InboxRow (D-23/D-24) — a single Gmail-style message row.
 *
 * Three lines, two font weights (400/600): sender (semibold) + date on line 1,
 * subject (truncated) on line 2, and the per-email entity-type chips on line 3.
 * Selecting the row drives the reading preview via `onSelect`; the entity chips
 * are independent `<a>` deep-links that must never be nested inside an
 * interactive element (invalid HTML + nested-interactive a11y violation). The
 * row is therefore a `<div role="button">` with explicit keyboard handlers
 * (Enter/Space activate selection) rather than a `<button>` wrapping the chips.
 * Selected rows carry the single teal `bg-primary/10` accent.
 */
export function InboxRow({
  email,
  entities,
  isSelected,
  onSelect,
}: InboxRowProps): React.ReactElement {
  const sender = email.senderName ?? email.senderAddress;

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
      className={`flex min-h-16 w-full cursor-pointer flex-col gap-1 border-b border-border/50 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        isSelected ? "bg-primary/10" : "hover:bg-muted/50"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-semibold">{sender}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDate(email.receivedAt)}
        </span>
      </div>

      <span className="truncate text-sm text-muted-foreground">
        {email.subject ?? "(no subject)"}
      </span>

      {/* The chips are <a> deep-links — kept as a SIBLING (never nested in an
          interactive element). They stopPropagation so a chip click does not
          also toggle the row selection.
          totalCount: 60-01 Task 3 stopgap — this row only has the capped
          `entities` array (entitiesByEmailId in inbox-three-pane.tsx does not
          yet carry the server's true totalCount), so entities.length is used
          as an honest-for-now approximation. 60-02 threads the real
          per-email totalCount the rest of the way through. */}
      <EntityChips entities={entities} totalCount={entities.length} emailId={email.id} />
    </div>
  );
}
