/**
 * emails.listThreads — the thread-grouped inbox projection (THRD-03, Phase 45
 * Plan 04). Governed by 45-UI-SPEC.md.
 *
 * Scoping is IDENTICAL to `emails.list` (T-45-04-01): `userOwnedImporterIds` +
 * `resolveListScope` (list-scope.ts), reused verbatim — never a query built
 * from an unverified importerId.
 *
 * Grouping strategy (same "fetch flat scoped rows, aggregate in a pure
 * DB-free helper" idiom as `aggregateEntitySummary` in entity-summary.ts):
 * the query selects one row per email in scope (id, threadId, importerId,
 * subject, receivedAt, and a server-truncated snippet), and the exported pure
 * `groupEmailsIntoThreads` collapses them into one entry per thread —
 * `emails.thread_id` is the grouping key; a null thread_id (pre-backfill
 * orphan) falls back to a per-email singleton key so every email still lists.
 *
 * T-45-04-02 (DoS — unbounded payload): `memberEmailIds` is capped per thread
 * at `MEMBER_EMAIL_ID_CAP` (most-recent members only). The underlying email
 * scan is additionally capped at `MAX_SCAN_ROWS` — a generous ceiling for
 * this phase's local/personal-use scale, ordered newest-first so the most
 * relevant threads are always included even if the cap is ever hit
 * (Rule 2 addition — the plan's own DoS mitigation extended to the row scan,
 * not just the member list).
 */

import { desc, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { Emails } from "@polytoken/db/schema";
import { userOwnedImporterIds } from "@polytoken/db/ownership";

import { protectedProcedure } from "../../trpc";
import { resolveListScope } from "./list-scope";

/** Server-side truncation length for a thread entry's latest-message snippet. */
export const THREAD_SNIPPET_CHARS = 240;

/** Most-recent members returned per thread entry (T-45-04-02). */
export const MEMBER_EMAIL_ID_CAP = 50;

/** Upper bound on emails scanned per request, newest-first (Rule 2 — DoS). */
export const MAX_SCAN_ROWS = 5000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One flat email row feeding the grouping helper. */
export interface ThreadEmailRow {
  readonly emailId: string;
  readonly threadId: string | null;
  readonly importerId: string;
  readonly subject: string | null;
  readonly receivedAt: Date;
  readonly bodyText: string | null;
}

/** One thread entry in the inbox list — the unit the UI renders. */
export interface ThreadListEntry {
  /** `threadId` when the email belongs to a resolved thread, else a
   * per-email singleton key (`email:{emailId}`) — stable, never collides
   * with a real thread id. */
  readonly key: string;
  readonly threadId: string | null;
  readonly importerId: string;
  /** The latest member email's subject (reflects the live conversation, not
   * necessarily the thread's original/normalized subject). */
  readonly subject: string | null;
  readonly messageCount: number;
  readonly latestReceivedAt: Date;
  readonly latestSnippet: string | null;
  /** Most-recent-first, capped at `MEMBER_EMAIL_ID_CAP`. */
  readonly memberEmailIds: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Pure grouping helper — exported for DB-free unit testing
// (same testability pattern as aggregateEntitySummary in entity-summary.ts)
// ---------------------------------------------------------------------------

function singletonKey(emailId: string): string {
  return `email:${emailId}`;
}

/**
 * groupEmailsIntoThreads — collapse flat scoped email rows into one entry per
 * thread, ordered by `latestReceivedAt` desc.
 *
 * - Grouping key: `threadId`, or a per-email singleton key when null
 *   (COALESCE null thread_id to a per-email singleton — orphan pre-backfill
 *   emails still list, each as its own count-1 entry).
 * - "Latest" member (subject/snippet/date source) is the row with the
 *   greatest `(receivedAt, emailId)` tuple — the same deterministic
 *   tie-break idiom the Python `thread_grouping` domain service (45-02)
 *   uses, kept consistent across the stack.
 * - `memberEmailIds` is most-recent-first, capped at `memberCap`.
 * - Never mutates the input rows; returns new immutable objects.
 */
export function groupEmailsIntoThreads(
  rows: ReadonlyArray<ThreadEmailRow>,
  options?: { readonly memberCap?: number },
): ReadonlyArray<ThreadListEntry> {
  const memberCap = options?.memberCap ?? MEMBER_EMAIL_ID_CAP;

  const groups = new Map<string, ThreadEmailRow[]>();
  for (const row of rows) {
    const key = row.threadId ?? singletonKey(row.emailId);
    const existing = groups.get(key);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  const entries: ThreadListEntry[] = [];
  for (const [key, members] of groups) {
    let latest = members[0]!;
    for (const member of members) {
      const isNewer = member.receivedAt.getTime() > latest.receivedAt.getTime();
      const isTieBreakWinner =
        member.receivedAt.getTime() === latest.receivedAt.getTime() &&
        member.emailId > latest.emailId;
      if (isNewer || isTieBreakWinner) {
        latest = member;
      }
    }

    const membersNewestFirst = [...members].sort((a, b) => {
      const byDate = b.receivedAt.getTime() - a.receivedAt.getTime();
      return byDate !== 0 ? byDate : b.emailId.localeCompare(a.emailId);
    });

    entries.push({
      key,
      threadId: latest.threadId,
      importerId: latest.importerId,
      subject: latest.subject,
      messageCount: members.length,
      latestReceivedAt: latest.receivedAt,
      latestSnippet: latest.bodyText,
      memberEmailIds: membersNewestFirst.slice(0, memberCap).map((m) => m.emailId),
    });
  }

  entries.sort((a, b) => {
    const byDate = b.latestReceivedAt.getTime() - a.latestReceivedAt.getTime();
    return byDate !== 0 ? byDate : a.key.localeCompare(b.key);
  });

  return entries;
}

// ---------------------------------------------------------------------------
// Procedures — spread into emailsRouter
// ---------------------------------------------------------------------------

export const emailThreadListProcedures = {
  /**
   * listThreads — thread-grouped inbox projection, newest-thread-first.
   * Scoping identical to `list` (owned importers only; an explicit
   * `importerId` filter is validated against ownership, never trusted raw).
   */
  listThreads: protectedProcedure
    .input(
      z
        .object({
          importerId: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .default({ limit: 50, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const owned = await userOwnedImporterIds(ctx.db, ctx.user.id);
      const scope = resolveListScope(owned, input.importerId);

      if (!scope.ok) {
        return {
          items: [] as ReadonlyArray<ThreadListEntry>,
          hasMore: false,
          nextOffset: input.offset,
        };
      }

      // Explicit column projection, same snippet-truncation pattern as
      // `list` (never streams the full body). Ordered newest-first so the
      // MAX_SCAN_ROWS cap (if ever hit) drops the oldest emails first.
      const rows = await ctx.db
        .select({
          emailId: Emails.id,
          threadId: Emails.threadId,
          importerId: Emails.importerId,
          subject: Emails.subject,
          receivedAt: Emails.receivedAt,
          bodyText: sql<
            string | null
          >`left(${Emails.bodyText}, ${THREAD_SNIPPET_CHARS})`,
        })
        .from(Emails)
        .where(inArray(Emails.importerId, scope.importerIds))
        .orderBy(desc(Emails.receivedAt))
        .limit(MAX_SCAN_ROWS);

      const allEntries = groupEmailsIntoThreads(rows, {
        memberCap: MEMBER_EMAIL_ID_CAP,
      });

      const page = allEntries.slice(input.offset, input.offset + input.limit + 1);
      const hasMore = page.length > input.limit;
      const items = hasMore ? page.slice(0, input.limit) : page;

      return {
        items,
        hasMore,
        nextOffset: input.offset + items.length,
      };
    }),
};
