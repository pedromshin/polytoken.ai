/**
 * search.test.ts — unit tests for the knowledge.search input schema and the
 * pure merge/rank helper (KG-8 closure, web reachability half).
 *
 * DB-free: mergeKnowledgeSearchRows is a pure function; schema tests verify
 * bounds/defaults, mirroring list.test.ts's conventions.
 */

import { describe, expect, it } from "vitest";

import {
  mergeKnowledgeSearchRows,
  searchKnowledgeInputSchema,
  type KnowledgeSearchRow,
} from "./search";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function row(overrides: Partial<KnowledgeSearchRow> & { id: string }): KnowledgeSearchRow {
  return {
    title: "Invoice INV-123",
    content: "invoice: INV-123",
    scope: "region",
    scope_ref_id: null,
    tier: "EXTRACTED",
    confidence: 0.9,
    sim: 0.5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

describe("searchKnowledgeInputSchema", () => {
  it("accepts a plain query and defaults limit to 10", () => {
    const parsed = searchKnowledgeInputSchema.parse({ query: "invoice" });
    expect(parsed.query).toBe("invoice");
    expect(parsed.limit).toBe(10);
    expect(parsed.importerId).toBeUndefined();
  });

  it("trims surrounding whitespace before the min-length check", () => {
    const parsed = searchKnowledgeInputSchema.parse({ query: "  po  " });
    expect(parsed.query).toBe("po");
  });

  it("rejects a query shorter than 2 chars after trimming", () => {
    expect(searchKnowledgeInputSchema.safeParse({ query: " a " }).success).toBe(
      false,
    );
  });

  it("rejects a query longer than 200 chars (listener tool-schema parity)", () => {
    expect(
      searchKnowledgeInputSchema.safeParse({ query: "x".repeat(201) }).success,
    ).toBe(false);
  });

  it("rejects a non-uuid importerId and an out-of-bounds limit", () => {
    expect(
      searchKnowledgeInputSchema.safeParse({ query: "po", importerId: "nope" })
        .success,
    ).toBe(false);
    expect(
      searchKnowledgeInputSchema.safeParse({ query: "po", limit: 0 }).success,
    ).toBe(false);
    expect(
      searchKnowledgeInputSchema.safeParse({ query: "po", limit: 51 }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mergeKnowledgeSearchRows
// ---------------------------------------------------------------------------

describe("mergeKnowledgeSearchRows", () => {
  it("merges pages across importers sorted by similarity descending", () => {
    const pageA = [row({ id: "a", sim: 0.2 }), row({ id: "b", sim: 0.9 })];
    const pageB = [row({ id: "c", sim: 0.5 })];

    const items = mergeKnowledgeSearchRows([pageA, pageB], 10);

    expect(items.map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("maps snake_case row fields to camelCase items", () => {
    const items = mergeKnowledgeSearchRows(
      [[row({ id: "a", scope_ref_id: "region-1", sim: 0.4 })]],
      10,
    );
    expect(items[0]).toMatchObject({
      id: "a",
      scopeRefId: "region-1",
      sim: 0.4,
      tier: "EXTRACTED",
    });
  });

  it("truncates to limit AFTER the global sort (top-N overall, not per page)", () => {
    const pageA = [row({ id: "a", sim: 0.1 }), row({ id: "b", sim: 0.8 })];
    const pageB = [row({ id: "c", sim: 0.6 })];

    const items = mergeKnowledgeSearchRows([pageA, pageB], 2);

    expect(items.map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("de-duplicates by node id, first occurrence winning", () => {
    const items = mergeKnowledgeSearchRows(
      [[row({ id: "a", sim: 0.3 })], [row({ id: "a", sim: 0.9 })]],
      10,
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.sim).toBe(0.3);
  });

  it("treats a null sim as 0 and never throws", () => {
    const items = mergeKnowledgeSearchRows(
      [[row({ id: "a", sim: null }), row({ id: "b", sim: 0.1 })]],
      10,
    );
    expect(items.map((i) => i.id)).toEqual(["b", "a"]);
    expect(items[1]!.sim).toBe(0);
  });

  it("never mutates its input pages", () => {
    const page = [row({ id: "a", sim: 0.2 }), row({ id: "b", sim: 0.9 })];
    const snapshot = [...page];
    mergeKnowledgeSearchRows([page], 10);
    expect(page).toEqual(snapshot);
  });
});
