"use client";

// Explicit React import (not just named hook imports) — this file's JSX
// compiles fine under Next.js's SWC automatic JSX runtime, but vitest's
// plain esbuild transform defaults to the classic runtime
// (React.createElement) and needs `React` in scope whenever a test mounts
// this component (mirrors genui-panel-node.tsx's identical note — found
// live, 53-03-PLAN.md Task 1, inbox-mobile-stack.test.tsx).
import * as React from "react";
import { useState } from "react";
import { ChevronRight } from "lucide-react";

import type { EntityChipEntry } from "./entity-chips";
import { InboxRow, toInboxSnippet, type InboxEmail } from "./inbox-row";

interface InboxThreadGroupProps {
  /** Latest member's subject (server-computed by emails.listThreads). */
  readonly subject: string | null;
  readonly messageCount: number;
  readonly latestReceivedAt: Date | string | null;
  readonly latestSnippet: string | null;
  /**
   * Resolved member email rows, most-recent-first (already capped upstream
   * by the server's memberEmailIds cap — 45-UI-SPEC "Data contract"). May be
   * a strict subset of `messageCount` if the client-side email lookup hasn't
   * resolved every id yet.
   */
  readonly members: ReadonlyArray<InboxEmail>;
  readonly entitiesByEmailId: ReadonlyMap<string, ReadonlyArray<EntityChipEntry>>;
  /**
   * MAIL-01: per-email UNDECIDED rule-suggestion counts (already net of the
   * user's local accept/dismiss decisions), forwarded to each member
   * `InboxRow`'s collapsed dashed mark. Optional so existing call sites and
   * tests compile unchanged.
   */
  readonly ruleSuggestionCountByEmailId?: ReadonlyMap<string, number>;
  readonly selectedEmailId: string | null;
  readonly onSelectMember: (emailId: string) => void;
}

const formatDate = (value: Date | string | null): string =>
  value ? new Date(value).toLocaleDateString() : "—";

/**
 * InboxThreadGroup (THRD-03, 45-UI-SPEC, D-58-01) — one thread entry in the
 * inbox's middle pane, restructured (60-02 Task 2) into the reference's
 * `.row`/`.members` registry shape: a thread and a message read as the same
 * species, and a thread's members read as a ruled sub-list, not an
 * indented slab.
 *
 * Count-1 threads (including pre-backfill singleton orphans) render as a
 * flat `InboxRow`, identical to the pre-thread-grouping inbox — no
 * disclosure chrome (per the UI-SPEC's "no visual noise for the common
 * case"). Count>1 threads render a summary row mirroring `InboxRow`'s own
 * band structure (chevron + sender + count marker + tabular time / serif
 * subject / serif bounded snippet) that expands, via a local `useState`
 * toggle (zero new dependency, T-45-04-SC), to reveal its member emails
 * through the EXISTING `InboxRow` component — unmodified, so selecting a
 * member still drives the reading preview / "Open editor →" exactly as it
 * does today.
 */
export function InboxThreadGroup({
  subject,
  messageCount,
  latestReceivedAt,
  latestSnippet,
  members,
  entitiesByEmailId,
  ruleSuggestionCountByEmailId,
  selectedEmailId,
  onSelectMember,
}: InboxThreadGroupProps): React.ReactElement | null {
  const [expanded, setExpanded] = useState(false);

  // Singleton thread: identical to the pre-grouping inbox row. If the member
  // row hasn't resolved yet (client-side lookup still loading), render
  // nothing rather than a broken/partial row — the parent's loading gate
  // normally prevents this, but stay defensive.
  if (messageCount <= 1) {
    const only = members[0];
    if (!only) return null;
    return (
      <InboxRow
        email={only}
        entities={entitiesByEmailId.get(only.id) ?? []}
        isSelected={only.id === selectedEmailId}
        onSelect={onSelectMember}
        ruleSuggestionCount={ruleSuggestionCountByEmailId?.get(only.id) ?? 0}
      />
    );
  }

  const snippet = toInboxSnippet(latestSnippet);
  // Band 1's identity slot mirrors InboxRow's "sender" — the LATEST member's
  // sender (members is most-recent-first), not the subject. The subject gets
  // its own serif evidence band below, same as a singleton row.
  const latestMember = members[0];
  const latestSender = latestMember
    ? (latestMember.senderName ?? latestMember.senderAddress)
    : (subject ?? "(no subject)");

  return (
    <div className="border-b border-hair">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full flex-col gap-0.5 px-row-x py-row-y text-left transition-colors hover:bg-shade focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1"
      >
        <div className="flex items-center gap-2">
          <ChevronRight
            aria-hidden
            className={`size-3.5 shrink-0 text-pencil transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          />
          <span data-field="sender" className="flex-1 truncate text-sm font-semibold">
            {latestSender}
          </span>
          <span
            data-field="message-count"
            className="tabular shrink-0 rounded-sm bg-shade px-1.5 py-0.5 text-2xs font-semibold text-faded"
          >
            {messageCount}
          </span>
          <time data-field="time" className="tabular shrink-0 text-2xs text-pencil">
            {formatDate(latestReceivedAt)}
          </time>
        </div>

        <span
          data-field="subject"
          data-evidence
          className="truncate font-serif text-base text-ink"
        >
          {subject ?? "(no subject)"}
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
      </button>

      {expanded && (
        <div data-field="members" className="mt-1 ml-1.5 border-l border-rule pl-3">
          {members.map((member) => (
            <InboxRow
              key={member.id}
              email={member}
              entities={entitiesByEmailId.get(member.id) ?? []}
              isSelected={member.id === selectedEmailId}
              onSelect={onSelectMember}
              ruleSuggestionCount={
                ruleSuggestionCountByEmailId?.get(member.id) ?? 0
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
