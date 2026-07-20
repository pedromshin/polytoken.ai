"use client";

import Link from "next/link";
// Explicit React import (not just named hook imports) — this file's JSX
// compiles fine under Next.js's SWC automatic JSX runtime, but vitest's
// plain esbuild transform defaults to the classic runtime
// (React.createElement) and needs `React` in scope whenever a test mounts
// this component directly (mirrors genui-panel-node.tsx's identical note —
// found live, 53-03-PLAN.md Task 1, inbox-mobile-stack.test.tsx).
import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { Button } from "@polytoken/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@polytoken/ui/resizable";
import { Skeleton } from "@polytoken/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@polytoken/ui/tabs";

import { api } from "~/trpc/react";

import type { EntityChipEntry } from "./entity-chips";
import { InboxEntitiesRail } from "./inbox-entities-rail";
import { InboxThreadGroup } from "./inbox-thread-group";
import type { InboxEmail } from "./inbox-row";
import {
  MailRuleReviewPanel,
  type RuleDecision,
  type RuleSuggestionEntry,
} from "./mail-rule-review";

/** The inbox-list projection of an email (a subset of the emails.list row). */
export interface InboxEmailItem extends InboxEmail {
  readonly bodyText: string | null;
  readonly toAddresses: ReadonlyArray<string>;
}

/** One thread entry (a subset of the emails.listThreads row — THRD-03). */
export interface InboxThreadItem {
  readonly key: string;
  readonly threadId: string | null;
  readonly importerId: string;
  readonly subject: string | null;
  readonly messageCount: number;
  readonly latestReceivedAt: Date | string | null;
  readonly latestSnippet: string | null;
  /** Most-recent-first, capped server-side at 50 (T-45-04-02). */
  readonly memberEmailIds: ReadonlyArray<string>;
}

export interface InboxData {
  readonly items: ReadonlyArray<InboxThreadItem>;
  readonly hasMore: boolean;
  readonly nextOffset: number;
}

interface InboxThreePaneProps {
  readonly data: InboxData | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
}

type InboxFilter = "all" | "unread" | "with-entities";

const PAGE_SIZE = 50;

/** Server-side cap on `emails.entitySummary` input (`emailIds.max(100)`). */
const SUMMARY_BATCH_CAP = 100;

/**
 * Client-side full-row lookup size (THRD-03): `emails.listThreads` returns
 * grouping metadata (subject/count/snippet/date + member ids) but not the
 * per-member sender/recipient fields `InboxRow` renders. A single bounded
 * `emails.list` fetch resolves those — same cap as the entity-summary batch,
 * since both are "visible page" concerns. A mailbox with more than this many
 * emails may show partially-unresolved member rows for older threads (a
 * documented v1 limitation — 45-UI-SPEC "Non-goals").
 */
const EMAIL_LOOKUP_LIMIT = SUMMARY_BATCH_CAP;

// ---------------------------------------------------------------------------
// Sub-views
// ---------------------------------------------------------------------------

function FiltersRail({
  filter,
  onFilterChange,
}: {
  readonly filter: InboxFilter;
  readonly onFilterChange: (next: InboxFilter) => void;
}): React.ReactElement {
  const options: ReadonlyArray<{ value: InboxFilter; label: string }> = [
    { value: "all", label: "All" },
    { value: "unread", label: "Unread" },
    { value: "with-entities", label: "With entities" },
  ];

  return (
    <div data-pane="filters" className="flex h-full flex-col bg-leaf p-panel">
      <div className="mb-2 px-2 text-2xs font-semibold tracking-[0.07em] text-pencil uppercase">
        Filters
      </div>
      <nav className="flex flex-col gap-0.5" aria-label="Inbox filters">
        {options.map((option) => {
          const active = filter === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onFilterChange(option.value)}
              className={`rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                active
                  ? "bg-shade font-semibold text-ink"
                  : "text-faded hover:bg-shade hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </nav>
      <p className="mt-4 border-t border-hair pt-2.5 text-xs leading-relaxed text-pencil">
        Forward mail to your personal polytoken address and I&rsquo;ll read it
        and pull out what matters. Find yours under{" "}
        <Link
          href="/settings/forwarding"
          className="font-semibold text-ink underline underline-offset-2"
        >
          Settings → Forwarding
        </Link>
        .
      </p>
    </div>
  );
}

function ReadingPreview({
  email,
  ruleReview,
}: {
  readonly email: InboxEmailItem | null;
  /**
   * MAIL-01: the suggest-only rule-review panel for THIS email, rendered
   * between the meta line and the body — in-context during triage (HEY
   * Screener model), never a settings destination. Pre-built by the parent
   * so this sub-view stays presentational.
   */
  readonly ruleReview?: React.ReactNode;
}): React.ReactElement {
  if (!email) {
    return (
      <div
        data-pane="reading"
        className="flex h-full flex-col items-center justify-center gap-2 bg-leaf p-12 text-center"
      >
        <p className="text-sm font-semibold text-ink">No email selected</p>
        <p className="text-sm text-faded">
          Select a message from the list to preview it here.
        </p>
      </div>
    );
  }

  const sender = email.senderName
    ? `${email.senderName} <${email.senderAddress}>`
    : email.senderAddress;

  return (
    <div data-pane="reading" className="flex h-full flex-col overflow-auto bg-leaf p-panel">
      {/* .rp-head: the subject is the user's own material (law 2) — a
          serif h2, not muted chrome. */}
      <div className="flex items-start justify-between gap-4">
        <h2
          data-field="subject"
          data-evidence
          className="min-w-0 flex-1 font-serif text-xl text-ink"
        >
          {email.subject ?? "(no subject)"}
        </h2>
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link href={`/emails/${email.id}`}>Open email →</Link>
        </Button>
      </div>

      {/* .rp-meta: From/To are the user's material but they are metadata,
          not prose — sans, under a ruled boundary. */}
      <div className="mt-2.5 border-b border-hair pb-3.5 text-xs text-faded">
        From: {sender} · To: {email.toAddresses.join(", ") || "—"}
      </div>

      {ruleReview}

      {email.bodyText ? (
        // .rp-body: --text-lg (15.5px/1.7) is the step Phase 59 anchored
        // on THIS pane's body specifically (59-02-SUMMARY.md's scale
        // table) — the designed value, not a guess. The 56ch measure is
        // the reference's own, and is what makes long mail readable.
        // T-60-04: the 2000-char bound stays — never rely on CSS
        // truncation alone to tame a megabyte body.
        <p
          data-field="body"
          data-evidence
          className="mt-4 max-w-[56ch] whitespace-pre-line font-serif text-lg text-ink"
        >
          {email.bodyText.slice(0, 2000)}
        </p>
      ) : (
        <p className="mt-4 text-sm text-faded">
          This email has no plain-text body. Open the editor to view the full
          document and its regions.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * InboxThreePane (D-22, THRD-03) — a resizable, three-pane Gmail-style
 * inbox: filters rail · thread-grouped message list · reading preview. The
 * seed page comes from the page-level emails.listThreads query (passed in);
 * "Load more" appends further THREAD pages via the same query (hasMore /
 * nextOffset preserved verbatim). A single supplemental emails.list fetch
 * (bounded, EMAIL_LOOKUP_LIMIT) resolves the full per-email rows
 * (sender/subject/date) that listThreads's grouping metadata doesn't carry,
 * feeding both the expanded/singleton `InboxRow`s and the reading preview.
 * Per-email entity chips come from a SINGLE batched emails.entitySummary call
 * keyed by the resolved email ids — never a per-row fetch (D-23).
 */
export function InboxThreePane({
  data,
  isLoading,
  isError,
}: InboxThreePaneProps): React.ReactElement {
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);

  // MOBL-02 (53-UI-SPEC §4): below `md` the inbox is a single-pane
  // master->detail stack. Tapping a row explicitly flips this to "detail";
  // the desktop render path never reads it. Default "list" — first paint
  // never auto-deposits a mobile user into the detail view (guard lives at
  // handleSelectMemberMobile below vs. the background default-select effect,
  // which only ever sets selectedEmailId).
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");

  // Accumulated extra pages fetched via Load-more, appended after the seed page.
  const [extraItems, setExtraItems] = useState<ReadonlyArray<InboxThreadItem>>(
    [],
  );
  const [nextOffset, setNextOffset] = useState<number | null>(null);

  // Memoized so the reference is stable across renders. Without useMemo,
  // `data?.items ?? []` mints a fresh array every render whenever `data` is
  // undefined (loading or error state), which makes the reset effect below —
  // keyed on [seedItems] — fire on every render and call setState in a loop
  // ("Maximum update depth exceeded"). With memoization the dependency only
  // changes when a genuinely new seed page arrives.
  const seedItems = useMemo<ReadonlyArray<InboxThreadItem>>(
    () => data?.items ?? [],
    [data?.items],
  );

  // Reset accumulated pages whenever the seed page identity changes.
  useEffect(() => {
    setExtraItems([]);
    setNextOffset(null);
  }, [seedItems]);

  const allItems = useMemo<ReadonlyArray<InboxThreadItem>>(
    () => [...seedItems, ...extraItems],
    [seedItems, extraItems],
  );

  // Bounded full-email-row lookup (THRD-03 — see EMAIL_LOOKUP_LIMIT).
  const emailsListQuery = api.emails.list.useQuery({
    limit: EMAIL_LOOKUP_LIMIT,
    offset: 0,
  });

  const emailsById = useMemo(() => {
    const map = new Map<string, InboxEmailItem>();
    for (const email of emailsListQuery.data?.items ?? []) {
      map.set(email.id, email as InboxEmailItem);
    }
    return map;
  }, [emailsListQuery.data]);

  // Batched entity rollup for the resolved email ids (single query, never
  // per-row). Capped at the server-side batch limit: emails.entitySummary
  // validates `emailIds` with .max(100) — emailsById is already <= that cap.
  const emailIds = useMemo(
    () => Array.from(emailsById.keys()).slice(0, SUMMARY_BATCH_CAP),
    [emailsById],
  );
  const entitySummaryQuery = api.emails.entitySummary.useQuery(
    { emailIds },
    { enabled: emailIds.length > 0 },
  );

  const entitiesByEmailId = useMemo(() => {
    const map = new Map<string, ReadonlyArray<EntityChipEntry>>();
    for (const entry of entitySummaryQuery.data ?? []) {
      map.set(entry.emailId, entry.entities);
    }
    return map;
  }, [entitySummaryQuery.data]);

  // -------------------------------------------------------------------------
  // MAIL-01: suggest-only rule review (HEY Screener model — in-context, never
  // a /settings Rules page).
  //
  // THE DATA SEAM: emails.ruleSuggestions — a single batched, READ-ONLY query
  // over the same visible page of email ids the entity summary uses
  // (packages/api-client/src/router/emails/rule-suggestions.ts, the TS
  // projection of the Python matcher in mail_rules/rules.py). Never a
  // per-row fetch; never a write.
  // -------------------------------------------------------------------------
  const ruleSuggestionsQuery = api.emails.ruleSuggestions.useQuery(
    { emailIds },
    { enabled: emailIds.length > 0 },
  );

  const ruleSuggestionsByEmailId = useMemo(() => {
    const map = new Map<string, ReadonlyArray<RuleSuggestionEntry>>();
    for (const entry of ruleSuggestionsQuery.data ?? []) {
      if (entry.suggestions.length > 0) {
        map.set(entry.emailId, entry.suggestions as ReadonlyArray<RuleSuggestionEntry>);
      }
    }
    return map;
  }, [ruleSuggestionsQuery.data]);

  // The human's local verdicts, keyed `${emailId}:${ruleId}`. CLIENT state by
  // design: the backend matcher is suggest-only by construction (rules.py),
  // and the eventual bless/execute write runs through the capability
  // registry's permission model (MAIL-02). When that mutation lands it
  // attaches inside handleRuleDecision — the ONE place a decision is
  // recorded — without touching the render tree.
  const [ruleDecisions, setRuleDecisions] = useState<
    ReadonlyMap<string, RuleDecision>
  >(new Map());

  const handleRuleDecision = (
    emailId: string,
    ruleId: string,
    decision: RuleDecision,
  ): void => {
    setRuleDecisions((prev) => {
      const next = new Map(prev);
      next.set(`${emailId}:${ruleId}`, decision);
      return next;
    });
  };

  const handleRuleUndo = (emailId: string, ruleId: string): void => {
    setRuleDecisions((prev) => {
      const next = new Map(prev);
      next.delete(`${emailId}:${ruleId}`);
      return next;
    });
  };

  // Per-email UNDECIDED counts feeding the collapsed dashed mark on each
  // inbox row (taste doc Lane B point 1). Net of local decisions so the mark
  // disappears as the user works through the queue — triage progress is
  // visible from the list itself.
  const ruleSuggestionCountByEmailId = useMemo(() => {
    const map = new Map<string, number>();
    for (const [emailId, suggestions] of ruleSuggestionsByEmailId) {
      const undecided = suggestions.filter(
        (s) => !ruleDecisions.has(`${emailId}:${s.ruleId}`),
      ).length;
      if (undecided > 0) map.set(emailId, undecided);
    }
    return map;
  }, [ruleSuggestionsByEmailId, ruleDecisions]);

  // Teaching empty state gate: only when the query resolved and NO email on
  // the visible page matched any rule — the panel then teaches (once, on the
  // selected email) instead of silently not existing.
  const showRuleTeaching =
    ruleSuggestionsQuery.isSuccess && ruleSuggestionsByEmailId.size === 0;

  // A thread entry is visible under "With entities" if ANY of its member
  // emails carry extracted entities (45-UI-SPEC "Filters / load-more").
  const withEntities = useMemo(
    () =>
      allItems.filter((item) =>
        item.memberEmailIds.some(
          (id) => (entitiesByEmailId.get(id)?.length ?? 0) > 0,
        ),
      ),
    [allItems, entitiesByEmailId],
  );

  const visibleItems = filter === "with-entities" ? withEntities : allItems;

  // Default-select the latest member of the first visible thread once data
  // is available (memberEmailIds is most-recent-first).
  useEffect(() => {
    if (selectedEmailId === null && visibleItems.length > 0) {
      const firstMemberId = visibleItems[0]!.memberEmailIds[0];
      if (firstMemberId) setSelectedEmailId(firstMemberId);
    }
  }, [selectedEmailId, visibleItems]);

  // Load-more — append the next THREAD page via emails.listThreads,
  // preserving hasMore paging.
  const loadMoreOffset = nextOffset ?? data?.nextOffset ?? seedItems.length;
  const loadMoreQuery = api.emails.listThreads.useQuery(
    { limit: PAGE_SIZE, offset: loadMoreOffset },
    { enabled: false },
  );

  const hasMore =
    nextOffset === null ? (data?.hasMore ?? false) : loadMoreQuery.data?.hasMore ?? false;

  const handleLoadMore = async (): Promise<void> => {
    const result = await loadMoreQuery.refetch();
    const page = result.data;
    if (!page) return;
    setExtraItems((prev) => [...prev, ...(page.items as InboxThreadItem[])]);
    setNextOffset(page.nextOffset);
  };

  const selectedEmail = selectedEmailId
    ? (emailsById.get(selectedEmailId) ?? null)
    : null;

  // The selected email's review panel — decisions re-keyed to bare ruleId for
  // the panel's per-email view. Built once here and handed to BOTH trees
  // (desktop reading pane + mobile detail) so the two never drift.
  const selectedRuleSuggestions = selectedEmailId
    ? (ruleSuggestionsByEmailId.get(selectedEmailId) ?? [])
    : [];
  const selectedRuleDecisions = useMemo(() => {
    const map = new Map<string, RuleDecision>();
    if (selectedEmailId === null) return map;
    const prefix = `${selectedEmailId}:`;
    for (const [key, decision] of ruleDecisions) {
      if (key.startsWith(prefix)) map.set(key.slice(prefix.length), decision);
    }
    return map;
  }, [ruleDecisions, selectedEmailId]);

  const ruleReviewPanel = selectedEmailId ? (
    <MailRuleReviewPanel
      suggestions={selectedRuleSuggestions}
      decisions={selectedRuleDecisions}
      onDecide={(ruleId, decision) =>
        handleRuleDecision(selectedEmailId, ruleId, decision)
      }
      onUndo={(ruleId) => handleRuleUndo(selectedEmailId, ruleId)}
      isLoading={ruleSuggestionsQuery.isLoading}
      isError={ruleSuggestionsQuery.isError}
      showTeaching={showRuleTeaching}
    />
  ) : null;

  // Mobile-only: an explicit row tap resolves the email AND swaps the view to
  // detail. The background default-select effect above intentionally never
  // calls this — see 53-UI-SPEC §4 point 6.
  const handleSelectMemberMobile = (emailId: string): void => {
    setSelectedEmailId(emailId);
    setMobileView("detail");
  };

  const showLoading = isLoading || emailsListQuery.isLoading;
  const showError = isError || emailsListQuery.isError;

  return (
    <>
      {/* Desktop (>=md): the exact three-pane ResizablePanelGroup, byte-identical. */}
      <div data-tree="desktop" className="hidden h-full md:block">
        <ResizablePanelGroup direction="horizontal" className="h-full">
      <ResizablePanel defaultSize={18} minSize={14}>
        <FiltersRail filter={filter} onFilterChange={setFilter} />
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel defaultSize={42} minSize={28}>
        <div data-pane="threads" className="flex h-full flex-col bg-leaf">
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-hair bg-leaf px-4 py-3">
            <h2 className="text-base font-semibold text-ink">Inbox</h2>
            {data && (
              <span
                data-field="count"
                className="tabular rounded-sm border border-rule bg-bright px-1.5 py-0.5 text-2xs font-semibold text-faded"
              >
                {visibleItems.length}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-auto">
            {showLoading && (
              <div aria-hidden>
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="space-y-1.5 border-b border-hair px-row-x py-row-y"
                  >
                    <Skeleton className="h-3 w-24 rounded-sm" />
                    <Skeleton className="h-4 w-56 rounded-sm" />
                    <Skeleton className="h-3 w-72 rounded-sm" />
                  </div>
                ))}
              </div>
            )}

            {showError && (
              <div role="alert" className="m-4 border border-rule p-panel text-center">
                <p className="text-sm font-semibold text-ink">
                  Unable to load emails.
                </p>
                <p className="mt-1 text-xs text-faded">
                  Please try refreshing the page.
                </p>
              </div>
            )}

            {data && visibleItems.length === 0 && !showLoading && (
              <div className="p-panel text-center text-sm text-faded">
                {filter === "with-entities"
                  ? "Nothing extracted yet — entities will show up as mail arrives."
                  : "Your inbox is clear — forwarded mail will land here."}
              </div>
            )}

            {!showLoading &&
              visibleItems.map((item) => (
                <InboxThreadGroup
                  key={item.key}
                  subject={item.subject}
                  messageCount={item.messageCount}
                  latestReceivedAt={item.latestReceivedAt}
                  latestSnippet={item.latestSnippet}
                  members={item.memberEmailIds
                    .map((id) => emailsById.get(id))
                    .filter((email): email is InboxEmailItem => email !== undefined)}
                  entitiesByEmailId={entitiesByEmailId}
                  ruleSuggestionCountByEmailId={ruleSuggestionCountByEmailId}
                  selectedEmailId={selectedEmailId}
                  onSelectMember={setSelectedEmailId}
                />
              ))}

            {hasMore && filter !== "with-entities" && (
              <div className="p-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={loadMoreQuery.isFetching}
                  onClick={() => void handleLoadMore()}
                >
                  {loadMoreQuery.isFetching ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel defaultSize={40}>
        {/* Reading column + the fourth pane, as a horizontal flex INSIDE
            this one ResizablePanel — not a fourth ResizablePanel (the
            reference's `.entities` is a fixed-width aside, not a
            resizable one; adding a panel would renegotiate all three
            existing defaultSizes for no design gain). */}
        <div className="flex h-full">
          <div className="min-w-0 flex-1">
            <ReadingPreview email={selectedEmail} ruleReview={ruleReviewPanel} />
          </div>
          <InboxEntitiesRail
            entities={
              selectedEmailId ? (entitiesByEmailId.get(selectedEmailId) ?? []) : []
            }
            emailId={selectedEmailId ?? ""}
          />
        </div>
      </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Mobile (<md): single-pane master->detail stack (MOBL-02, 53-UI-SPEC §4). */}
      <div data-tree="mobile" className="flex h-full flex-col md:hidden">
        <Tabs
          value={filter}
          onValueChange={(next) => setFilter(next as InboxFilter)}
        >
          <TabsList
            aria-label="Inbox filter"
            className="h-11 w-full justify-start gap-1 border-b border-hair bg-leaf p-1"
          >
            <TabsTrigger
              value="all"
              className="h-9 flex-1 pointer-coarse:h-11 text-sm data-[state=active]:bg-shade data-[state=active]:text-ink"
            >
              All
            </TabsTrigger>
            <TabsTrigger
              value="unread"
              className="h-9 flex-1 pointer-coarse:h-11 text-sm data-[state=active]:bg-shade data-[state=active]:text-ink"
            >
              Unread
            </TabsTrigger>
            <TabsTrigger
              value="with-entities"
              className="h-9 flex-1 pointer-coarse:h-11 text-sm data-[state=active]:bg-shade data-[state=active]:text-ink"
            >
              With entities
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {mobileView === "list" ? (
          <div className="flex-1 overflow-auto">
            {showLoading && (
              <div aria-hidden>
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="space-y-1.5 border-b border-hair px-row-x py-row-y"
                  >
                    <Skeleton className="h-3 w-24 rounded-sm" />
                    <Skeleton className="h-4 w-56 rounded-sm" />
                    <Skeleton className="h-3 w-72 rounded-sm" />
                  </div>
                ))}
              </div>
            )}

            {showError && (
              <div role="alert" className="m-4 border border-rule p-panel text-center">
                <p className="text-sm font-semibold text-ink">
                  Unable to load emails.
                </p>
                <p className="mt-1 text-xs text-faded">
                  Please try refreshing the page.
                </p>
              </div>
            )}

            {data && visibleItems.length === 0 && !showLoading && (
              <div className="p-panel text-center text-sm text-faded">
                {filter === "with-entities"
                  ? "Nothing extracted yet — entities will show up as mail arrives."
                  : "Your inbox is clear — forwarded mail will land here."}
              </div>
            )}

            {!showLoading &&
              visibleItems.map((item) => (
                <InboxThreadGroup
                  key={item.key}
                  subject={item.subject}
                  messageCount={item.messageCount}
                  latestReceivedAt={item.latestReceivedAt}
                  latestSnippet={item.latestSnippet}
                  members={item.memberEmailIds
                    .map((id) => emailsById.get(id))
                    .filter((email): email is InboxEmailItem => email !== undefined)}
                  entitiesByEmailId={entitiesByEmailId}
                  ruleSuggestionCountByEmailId={ruleSuggestionCountByEmailId}
                  selectedEmailId={selectedEmailId}
                  onSelectMember={handleSelectMemberMobile}
                />
              ))}

            {hasMore && filter !== "with-entities" && (
              <div className="p-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={loadMoreQuery.isFetching}
                  onClick={() => void handleLoadMore()}
                >
                  {loadMoreQuery.isFetching ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-hair bg-leaf px-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Back to inbox"
                className="size-11 pointer-coarse:size-11"
                onClick={() => setMobileView("list")}
              >
                <ArrowLeft className="size-4" aria-hidden />
              </Button>
              <span
                data-field="subject"
                data-evidence
                className="truncate font-serif text-sm text-ink"
              >
                {selectedEmail?.subject ?? "Message"}
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <ReadingPreview email={selectedEmail} ruleReview={ruleReviewPanel} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
