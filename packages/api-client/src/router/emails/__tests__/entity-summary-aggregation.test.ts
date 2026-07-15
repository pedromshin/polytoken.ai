/**
 * entity-summary-aggregation.test.ts — unit tests for the pure
 * aggregateEntitySummary helper, rewritten for 60-01-PLAN.md Task 2's per-FACT
 * contract (D-58-01's signature element: "a provenance mark on every
 * extracted fact"). Supersedes `router/__tests__/entity-summary.test.ts`
 * (deleted by this task), which tested the pre-60 distinct-TYPE rollup this
 * task replaces.
 *
 * DB-free: the helper transforms flat entity-component rows into a per-email,
 * per-FACT list. Same testability pattern as groupEntityTypeRows.
 *
 * Test plan (mirrors <behavior> in 60-01-PLAN.md Task 2):
 *   Test 1:  one EmailEntitySummary per requested id, in requested order.
 *   Test 2:  an unknown/foreign emailId yields { emailId, entities: [], totalCount: 0 }.
 *   Test 3:  rows with null entityTypeId or null label are skipped.
 *   Test 4:  entries are NOT collapsed by type — two suppliers = two entries.
 *   Test 5:  tier is "confirmed" only for extractionStatus === "confirmed";
 *            a confirmed and a candidate component of the SAME type yield two
 *            entries with different tiers (the case a type-rollup could not express).
 *   Test 6:  "pending"/"candidate"/any other surviving status maps to "suggested".
 *   Test 7:  value is a trimmed, whitespace-collapsed, length-capped snippet of contentText.
 *   Test 8:  null/blank contentText yields value: null.
 *   Test 9:  a 12-entity email yields 8 entries with totalCount: 12 (T-60-03 cap),
 *            preserving first-appearance order.
 *   Test 10: ordering is deterministic for a fixed row order (first appearance).
 *   Test 11: entityInstanceId surfaces from the row; undefined when absent.
 *   Test 12: does not mutate the input rows (immutability); returns fresh objects.
 */

import { describe, expect, it } from "vitest";

import {
  aggregateEntitySummary,
  MAX_ENTITIES_PER_EMAIL,
  type EntitySummaryRow,
} from "../entity-summary";

const EMAIL_A = "00000000-0000-0000-0000-00000000000a";
const EMAIL_B = "00000000-0000-0000-0000-00000000000b";
const EMAIL_C = "00000000-0000-0000-0000-00000000000c";

const TYPE_SUPPLIER = "00000000-0000-0000-0000-0000000000b1";
const TYPE_AMOUNT = "00000000-0000-0000-0000-0000000000b2";

const INSTANCE_1 = "00000000-0000-0000-0000-000000000001";

let componentSeq = 0;
function nextComponentId(): string {
  componentSeq += 1;
  return `10000000-0000-0000-0000-${String(componentSeq).padStart(12, "0")}`;
}

function row(overrides: Partial<EntitySummaryRow> & { emailId: string }): EntitySummaryRow {
  return {
    componentId: nextComponentId(),
    entityTypeId: TYPE_SUPPLIER,
    label: "Supplier",
    contentText: null,
    extractionStatus: "confirmed",
    entityInstanceId: undefined,
    ...overrides,
  };
}

describe("aggregateEntitySummary", () => {
  it("Test 1: one entry per requested email id, in requested order", () => {
    const rows: EntitySummaryRow[] = [
      row({ emailId: EMAIL_C }),
      row({ emailId: EMAIL_A }),
    ];

    const result = aggregateEntitySummary(rows, [EMAIL_A, EMAIL_B, EMAIL_C]);

    expect(result.map((r) => r.emailId)).toEqual([EMAIL_A, EMAIL_B, EMAIL_C]);
  });

  it("Test 2: an unknown/foreign emailId yields an empty, zero-total entry", () => {
    const result = aggregateEntitySummary([], [EMAIL_A]);

    expect(result).toEqual([{ emailId: EMAIL_A, entities: [], totalCount: 0 }]);
  });

  it("Test 3: rows with null entityTypeId or null label are skipped", () => {
    const rows: EntitySummaryRow[] = [
      row({ emailId: EMAIL_A, entityTypeId: null }),
      row({ emailId: EMAIL_A, label: null }),
      row({ emailId: EMAIL_A, entityTypeId: TYPE_AMOUNT, label: "Amount" }),
    ];

    const result = aggregateEntitySummary(rows, [EMAIL_A]);

    expect(result[0]!.entities).toHaveLength(1);
    expect(result[0]!.entities[0]!.entityTypeId).toBe(TYPE_AMOUNT);
  });

  it("Test 4: entries are NOT collapsed by type — two suppliers are two entries", () => {
    const rows: EntitySummaryRow[] = [
      row({ emailId: EMAIL_A, contentText: "Acme Freight" }),
      row({ emailId: EMAIL_A, contentText: "Beta Logistics" }),
    ];

    const result = aggregateEntitySummary(rows, [EMAIL_A]);

    expect(result[0]!.entities).toHaveLength(2);
    expect(result[0]!.entities[0]!.value).toBe("Acme Freight");
    expect(result[0]!.entities[1]!.value).toBe("Beta Logistics");
    expect(result[0]!.entities[0]!.componentId).not.toBe(result[0]!.entities[1]!.componentId);
  });

  it("Test 5: a confirmed and a candidate component of the SAME type yield two entries with different tiers", () => {
    const rows: EntitySummaryRow[] = [
      row({ emailId: EMAIL_A, extractionStatus: "confirmed" }),
      row({ emailId: EMAIL_A, extractionStatus: "candidate" }),
    ];

    const result = aggregateEntitySummary(rows, [EMAIL_A]);

    expect(result[0]!.entities).toHaveLength(2);
    expect(result[0]!.entities[0]!.tier).toBe("confirmed");
    expect(result[0]!.entities[1]!.tier).toBe("suggested");
  });

  it("Test 6: any non-confirmed surviving status maps to suggested", () => {
    const rows: EntitySummaryRow[] = [
      row({ emailId: EMAIL_A, extractionStatus: "pending" }),
      row({ emailId: EMAIL_A, extractionStatus: "review_pending" }),
      row({ emailId: EMAIL_A, extractionStatus: "auto_confirmed" }),
    ];

    const result = aggregateEntitySummary(rows, [EMAIL_A]);

    expect(result[0]!.entities.map((e) => e.tier)).toEqual([
      "suggested",
      "suggested",
      "suggested",
    ]);
  });

  it("Test 7: value is a trimmed, whitespace-collapsed, length-capped snippet of contentText", () => {
    const rows: EntitySummaryRow[] = [
      row({ emailId: EMAIL_A, contentText: "  R$  4.820,00  \n com coleta  " }),
      row({
        emailId: EMAIL_A,
        contentText:
          "A very long extracted OCR run of text that exceeds the snippet cap by a wide margin indeed",
      }),
    ];

    const result = aggregateEntitySummary(rows, [EMAIL_A]);

    expect(result[0]!.entities[0]!.value).toBe("R$ 4.820,00 com coleta");
    const longValue = result[0]!.entities[1]!.value!;
    expect(longValue.length).toBeLessThanOrEqual(48);
    expect(longValue.endsWith("…")).toBe(true);
  });

  it("Test 8: null/blank contentText yields value: null", () => {
    const rows: EntitySummaryRow[] = [
      row({ emailId: EMAIL_A, contentText: null }),
      row({ emailId: EMAIL_A, contentText: "   " }),
    ];

    const result = aggregateEntitySummary(rows, [EMAIL_A]);

    expect(result[0]!.entities[0]!.value).toBeNull();
    expect(result[0]!.entities[1]!.value).toBeNull();
  });

  it("Test 9: a 12-entity email yields 8 entries with totalCount: 12, first-appearance order preserved", () => {
    const rows: EntitySummaryRow[] = Array.from({ length: 12 }, (_, i) =>
      row({ emailId: EMAIL_A, contentText: `Entity ${i}` }),
    );

    const result = aggregateEntitySummary(rows, [EMAIL_A]);

    expect(MAX_ENTITIES_PER_EMAIL).toBe(8);
    expect(result[0]!.entities).toHaveLength(8);
    expect(result[0]!.totalCount).toBe(12);
    expect(result[0]!.entities.map((e) => e.value)).toEqual([
      "Entity 0",
      "Entity 1",
      "Entity 2",
      "Entity 3",
      "Entity 4",
      "Entity 5",
      "Entity 6",
      "Entity 7",
    ]);
  });

  it("Test 10: ordering is deterministic for a fixed row order (first appearance)", () => {
    const rows: EntitySummaryRow[] = [
      row({ emailId: EMAIL_A, entityTypeId: TYPE_AMOUNT, label: "Amount", contentText: "second-typed-first" }),
      row({ emailId: EMAIL_A, contentText: "first-typed-second" }),
    ];

    const result = aggregateEntitySummary(rows, [EMAIL_A]);

    expect(result[0]!.entities.map((e) => e.value)).toEqual([
      "second-typed-first",
      "first-typed-second",
    ]);
  });

  it("Test 11: entityInstanceId surfaces from the row; undefined when absent", () => {
    const rows: EntitySummaryRow[] = [
      row({ emailId: EMAIL_A, entityInstanceId: INSTANCE_1 }),
      row({ emailId: EMAIL_A, entityInstanceId: undefined }),
    ];

    const result = aggregateEntitySummary(rows, [EMAIL_A]);

    expect(result[0]!.entities[0]!.entityInstanceId).toBe(INSTANCE_1);
    expect(result[0]!.entities[1]!.entityInstanceId).toBeUndefined();
  });

  it("Test 12: does not mutate the input rows and returns fresh objects", () => {
    const rows: EntitySummaryRow[] = [row({ emailId: EMAIL_A, contentText: "Acme" })];
    const snapshot = JSON.stringify(rows);

    const result = aggregateEntitySummary(rows, [EMAIL_A]);

    expect(JSON.stringify(rows)).toBe(snapshot);
    expect(result[0]!.entities[0]).not.toBe(rows[0]);
  });
});
