/**
 * emails.circlePackLandscape — the aggregate feeding the email circle-pack view
 * (FEATURE-CATALOG TM-02). Returns the mailbox as a containment hierarchy the
 * shared `CirclePack` primitive (TM-01) renders directly:
 *
 *   root ("Mailbox") → sender → thread → email (leaf)
 *
 * Leaf size = 1 message (so a thread circle sizes by message count and a sender
 * circle by total messages — "leaf size = message count", 45-catalog TM-02).
 * Leaf tint = recency, normalized across the scanned window into a MONOCHROME
 * [0,1] the primitive maps to an ink wash (design law 1: no per-datum hue).
 *
 * SCOPING is identical to `emails.list` / `emails.listThreads` (T-45-04-01):
 * `userOwnedImporterIds` + `resolveListScope`, reused verbatim — a query is
 * NEVER built from an unverified importerId. The row scan is bounded newest-
 * first at `MAX_SCAN_ROWS` (Rule 2 — DoS), the same ceiling listThreads uses.
 *
 * The grouping is a pure, DB-free helper (`buildSenderLandscape`) — the same
 * "fetch flat scoped rows, aggregate in a pure helper" idiom as
 * `groupEmailsIntoThreads` — so the shape is unit-testable without a database.
 */

import { desc, inArray } from "drizzle-orm";
import { z } from "zod";

import { Emails } from "@polytoken/db/schema";
import { userOwnedImporterIds } from "@polytoken/db/ownership";

import { protectedProcedure } from "../../trpc";
import { resolveListScope } from "./list-scope";

/** Upper bound on emails scanned per request, newest-first (Rule 2 — DoS). */
export const LANDSCAPE_MAX_SCAN_ROWS = 5000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One flat email row feeding the landscape helper. */
export interface LandscapeEmailRow {
  readonly emailId: string;
  readonly threadId: string | null;
  readonly senderAddress: string;
  readonly senderName: string | null;
  readonly subject: string | null;
  readonly receivedAt: Date;
}

/** The opaque leaf payload the circle-pack view threads to its click handler. */
export interface LandscapeLeaf {
  readonly emailId: string;
  readonly subject: string | null;
  readonly senderAddress: string;
  readonly receivedAt: string;
}

/**
 * A hierarchy node. Structurally a `CircleDatum<LandscapeLeaf>` (name / value /
 * children / leaf / tint) plus a `kind` + `senderAddress` discriminator the
 * view uses for the sender-level send-to-chat affordance — the primitive
 * ignores the extra keys.
 */
export interface LandscapeNode {
  readonly name: string;
  readonly kind: "root" | "sender" | "thread" | "email";
  readonly value?: number;
  readonly tint?: number;
  readonly senderAddress?: string;
  readonly leaf?: LandscapeLeaf;
  readonly children?: LandscapeNode[];
}

// ---------------------------------------------------------------------------
// Pure grouping helper — exported for DB-free unit testing
// ---------------------------------------------------------------------------

function threadKeyOf(row: LandscapeEmailRow): string {
  return row.threadId ?? `email:${row.emailId}`;
}

/** Normalize a timestamp into a [0,1] recency tint against the scanned window. */
function recencyTint(receivedMs: number, minMs: number, maxMs: number): number {
  if (maxMs <= minMs) return 1; // single point in time ⇒ all "current"
  return (receivedMs - minMs) / (maxMs - minMs);
}

/**
 * buildSenderLandscape — collapse flat scoped rows into the root→sender→thread→
 * email hierarchy. Senders and threads are ordered by message count desc (the
 * pack's own convention re-sorts, but a deterministic input keeps tests stable);
 * leaves are newest-first. Never mutates input; returns new objects.
 */
export function buildSenderLandscape(
  rows: ReadonlyArray<LandscapeEmailRow>,
): LandscapeNode {
  if (rows.length === 0) {
    return { name: "Mailbox", kind: "root", children: [] };
  }

  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const row of rows) {
    const ms = row.receivedAt.getTime();
    if (ms < minMs) minMs = ms;
    if (ms > maxMs) maxMs = ms;
  }

  // sender → thread → rows
  const senders = new Map<
    string,
    { name: string; threads: Map<string, LandscapeEmailRow[]> }
  >();
  for (const row of rows) {
    const senderKey = row.senderAddress;
    let sender = senders.get(senderKey);
    if (!sender) {
      sender = { name: row.senderName?.trim() || row.senderAddress, threads: new Map() };
      senders.set(senderKey, sender);
    }
    const tKey = threadKeyOf(row);
    const bucket = sender.threads.get(tKey);
    if (bucket) bucket.push(row);
    else sender.threads.set(tKey, [row]);
  }

  const senderNodes: LandscapeNode[] = [];
  for (const [senderAddress, sender] of senders) {
    const threadNodes: LandscapeNode[] = [];
    for (const members of sender.threads.values()) {
      const newestFirst = [...members].sort(
        (a, b) => b.receivedAt.getTime() - a.receivedAt.getTime(),
      );
      const latest = newestFirst[0]!;
      const leaves: LandscapeNode[] = newestFirst.map((row) => ({
        name: row.subject?.trim() || "(no subject)",
        kind: "email",
        value: 1,
        tint: recencyTint(row.receivedAt.getTime(), minMs, maxMs),
        senderAddress,
        leaf: {
          emailId: row.emailId,
          subject: row.subject,
          senderAddress,
          receivedAt: row.receivedAt.toISOString(),
        },
      }));
      threadNodes.push({
        name: latest.subject?.trim() || "(no subject)",
        kind: "thread",
        senderAddress,
        children: leaves,
      });
    }
    threadNodes.sort((a, b) => (b.children?.length ?? 0) - (a.children?.length ?? 0));
    senderNodes.push({
      name: sender.name,
      kind: "sender",
      senderAddress,
      children: threadNodes,
    });
  }

  senderNodes.sort((a, b) => messageCount(b) - messageCount(a));

  return { name: "Mailbox", kind: "root", children: senderNodes };
}

/** Total email leaves beneath a node — used only for deterministic ordering. */
function messageCount(node: LandscapeNode): number {
  if (node.kind === "email") return 1;
  return (node.children ?? []).reduce((n, c) => n + messageCount(c), 0);
}

// ---------------------------------------------------------------------------
// Procedure — spread into emailsRouter
// ---------------------------------------------------------------------------

export const emailCirclePackProcedures = {
  /**
   * circlePackLandscape — the mailbox as a sender→thread→email containment
   * hierarchy for the circle-pack view. Scoping identical to `list`/
   * `listThreads` (owned importers only; an explicit `importerId` is validated
   * against ownership, never trusted raw).
   */
  circlePackLandscape: protectedProcedure
    .input(
      z
        .object({ importerId: z.string().uuid().optional() })
        .default({}),
    )
    .query(async ({ ctx, input }): Promise<LandscapeNode> => {
      const owned = await userOwnedImporterIds(ctx.db, ctx.user.id);
      const scope = resolveListScope(owned, input.importerId);
      if (!scope.ok) {
        return { name: "Mailbox", kind: "root", children: [] };
      }

      const rows = await ctx.db
        .select({
          emailId: Emails.id,
          threadId: Emails.threadId,
          senderAddress: Emails.senderAddress,
          senderName: Emails.senderName,
          subject: Emails.subject,
          receivedAt: Emails.receivedAt,
        })
        .from(Emails)
        .where(inArray(Emails.importerId, scope.importerIds))
        .orderBy(desc(Emails.receivedAt))
        .limit(LANDSCAPE_MAX_SCAN_ROWS);

      return buildSenderLandscape(rows);
    }),
};
