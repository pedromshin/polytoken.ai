/**
 * morning-brief.test.ts — HM-02 data-shaping unit tests for shapeMorningBrief.
 *
 * Pure/DB-free: proves the fold from the three existing query outputs
 * (emails.listThreads, entities.reviewQueue, documents.list) into the
 * render-ready brief — window filtering, newest-first ordering, per-section
 * caps, and the empty state.
 */
import { describe, expect, it } from "vitest";

import { shapeMorningBrief } from "./morning-brief";

const NOW = new Date("2026-07-23T09:00:00.000Z");
const HOURS = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

function thread(key: string, hoursAgo: number, subject: string | null) {
  return {
    key,
    threadId: null,
    importerId: "imp-1",
    subject,
    messageCount: 2,
    latestReceivedAt: HOURS(hoursAgo),
    latestSnippet: null,
    memberEmailIds: [],
  };
}

function reviewPair(pairKey: string, subj: string, cand: string) {
  const side = (id: string, name: string) => ({
    id,
    displayName: name,
    entityTypeId: "type-1",
    entityTypeLabel: "Person",
    aliases: [] as string[],
    identifiers: {},
    occurrenceCount: 1,
  });
  return {
    pairKey,
    subject: side(`${pairKey}-s`, subj),
    candidate: side(`${pairKey}-c`, cand),
    matchTypes: ["alias"],
    maxSimilarity: 0.92,
    linkCount: 1,
    sharedAliases: [] as string[],
    sharedIdentifierKeys: [] as string[],
  };
}

function doc(id: string, hoursAgo: number, title: string) {
  return {
    id,
    title,
    sourceLedgerId: null,
    createdAt: HOURS(hoursAgo),
  };
}

describe("shapeMorningBrief (HM-02)", () => {
  it("returns an empty brief when every input is undefined", () => {
    const brief = shapeMorningBrief({ now: NOW });
    expect(brief.isEmpty).toBe(true);
    expect(brief.counts).toEqual({
      newEmails: 0,
      pendingMerges: 0,
      recentDocuments: 0,
    });
    expect(brief.generatedAt).toEqual(NOW);
  });

  it("keeps only emails within the digest window (default 24h), newest-first", () => {
    const brief = shapeMorningBrief({
      now: NOW,
      threads: {
        items: [
          thread("old", 48, "Stale"),
          thread("recent", 2, "Fresh"),
          thread("mid", 10, "Midday"),
        ],
        hasMore: false,
        nextOffset: 0,
      },
    });
    expect(brief.newEmails.map((e) => e.key)).toEqual(["recent", "mid"]);
    expect(brief.newEmails[0].subject).toBe("Fresh");
    expect(brief.counts.newEmails).toBe(2);
    expect(brief.isEmpty).toBe(false);
  });

  it("substitutes a placeholder for a null subject", () => {
    const brief = shapeMorningBrief({
      now: NOW,
      threads: {
        items: [thread("x", 1, null)],
        hasMore: false,
        nextOffset: 0,
      },
    });
    expect(brief.newEmails[0].subject).toBe("(no subject)");
  });

  it("carries pending merges (EN-02) with entity-keyed fields", () => {
    const brief = shapeMorningBrief({
      now: NOW,
      reviews: {
        items: [reviewPair("p1", "Acme Inc", "Acme Incorporated")],
        hasMore: false,
        nextOffset: 0,
        totalPending: 1,
      },
    });
    expect(brief.pendingMerges).toHaveLength(1);
    expect(brief.pendingMerges[0]).toMatchObject({
      pairKey: "p1",
      subjectName: "Acme Inc",
      candidateName: "Acme Incorporated",
      entityTypeLabel: "Person",
      maxSimilarity: 0.92,
    });
  });

  it("keeps only recently-generated documents, newest-first", () => {
    const brief = shapeMorningBrief({
      now: NOW,
      documents: {
        items: [doc("d-old", 40, "Old report"), doc("d-new", 3, "Q3 brief")],
        hasMore: false,
        nextOffset: 0,
      },
    });
    expect(brief.recentDocuments.map((d) => d.id)).toEqual(["d-new"]);
    expect(brief.recentDocuments[0].title).toBe("Q3 brief");
  });

  it("caps each section at `limit`", () => {
    const threads = Array.from({ length: 10 }, (_, i) =>
      thread(`t${i}`, 1, `S${i}`),
    );
    const brief = shapeMorningBrief({
      now: NOW,
      limit: 3,
      threads: { items: threads, hasMore: true, nextOffset: 0 },
    });
    expect(brief.newEmails).toHaveLength(3);
  });

  it("respects a custom sinceHours window", () => {
    const brief = shapeMorningBrief({
      now: NOW,
      sinceHours: 6,
      threads: {
        items: [thread("in", 4, "In"), thread("out", 8, "Out")],
        hasMore: false,
        nextOffset: 0,
      },
    });
    expect(brief.newEmails.map((e) => e.key)).toEqual(["in"]);
  });
});
