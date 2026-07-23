/**
 * detail.test.ts — unit tests for the entities.byId pure aggregation helpers.
 *
 * DB-free: aggregateEntityFields and groupPendingSuggestions are exported
 * pure helpers tested without a DB connection (same testability precedent as
 * aggregateEntitySummary).
 *
 * Test plan:
 *   Test 1: aggregateEntityFields — single occurrence, single value: not conflicting.
 *   Test 2: aggregateEntityFields — two occurrences, same value: not conflicting, count=2.
 *   Test 3: aggregateEntityFields — two occurrences, distinct values: conflicting=true,
 *           both values retained with provenance, no canonical chosen (D-19).
 *   Test 4: aggregateEntityFields — multiple fields, only one conflicts.
 *   Test 5: aggregateEntityFields — empty input returns empty array.
 *   Test 6: aggregateEntityFields — does not mutate input (immutability).
 *
 *   groupPendingSuggestions (RES-1 read path — D-20 "a rejected suggestion
 *   never re-surfaces"):
 *   Test 7:  pending rows group by target entity with match types + counts.
 *   Test 8:  a dismissed candidate's rows are excluded — after REJECT the
 *            suggestion list for that candidate is EMPTY (the user-visible
 *            contract of the reject button).
 *   Test 9:  a merged-away (inactive) candidate is excluded.
 *   Test 10: dismissal of one candidate does not hide a different candidate.
 */

import { describe, expect, it } from "vitest";

import {
  aggregateEntityFields,
  groupPendingSuggestions,
  type FieldOccurrenceRow,
  type PendingSuggestionRow,
} from "./detail";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ROW_A: FieldOccurrenceRow = {
  emailId: "00000000-0000-0000-0000-000000000010",
  emailSubject: "Invoice INV-001",
  receivedAt: new Date("2024-01-10T00:00:00Z"),
  fieldSlug: "po_number",
  fieldLabel: "PO Number",
  value: "PO-1234",
  extractionStatus: "confirmed",
};

const ROW_B: FieldOccurrenceRow = {
  emailId: "00000000-0000-0000-0000-000000000011",
  emailSubject: "Follow-up on PO",
  receivedAt: new Date("2024-01-15T00:00:00Z"),
  fieldSlug: "po_number",
  fieldLabel: "PO Number",
  value: "PO-1234",
  extractionStatus: "confirmed",
};

const ROW_C: FieldOccurrenceRow = {
  emailId: "00000000-0000-0000-0000-000000000012",
  emailSubject: "Re: Invoice",
  receivedAt: new Date("2024-01-20T00:00:00Z"),
  fieldSlug: "po_number",
  fieldLabel: "PO Number",
  // Different value — conflicts with ROW_A and ROW_B
  value: "PO-9999",
  extractionStatus: "candidate",
};

const ROW_INVOICE: FieldOccurrenceRow = {
  emailId: "00000000-0000-0000-0000-000000000010",
  emailSubject: "Invoice INV-001",
  receivedAt: new Date("2024-01-10T00:00:00Z"),
  fieldSlug: "invoice_number",
  fieldLabel: "Invoice Number",
  value: "INV-001",
  extractionStatus: "confirmed",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("aggregateEntityFields", () => {
  it("Test 1: single occurrence, single value — not conflicting", () => {
    const result = aggregateEntityFields([ROW_A]);

    expect(result).toHaveLength(1);
    const field = result[0];
    expect(field).toBeDefined();
    if (!field) throw new Error("field not defined");

    expect(field.fieldSlug).toBe("po_number");
    expect(field.fieldLabel).toBe("PO Number");
    expect(field.conflicting).toBe(false);
    expect(field.values).toHaveLength(1);
    expect(field.values[0]?.value).toBe("PO-1234");
    expect(field.values[0]?.emailId).toBe(ROW_A.emailId);
    expect(field.values[0]?.emailSubject).toBe(ROW_A.emailSubject);
    expect(field.values[0]?.extractionStatus).toBe("confirmed");
  });

  it("Test 2: two occurrences with the same value — not conflicting, two provenance entries", () => {
    const result = aggregateEntityFields([ROW_A, ROW_B]);

    expect(result).toHaveLength(1);
    const field = result[0];
    expect(field).toBeDefined();
    if (!field) throw new Error("field not defined");

    expect(field.conflicting).toBe(false);
    // Both occurrences listed
    expect(field.values).toHaveLength(2);
  });

  it("Test 3: two distinct values — conflicting=true, BOTH values retained, no canonical (D-19)", () => {
    const result = aggregateEntityFields([ROW_A, ROW_C]);

    expect(result).toHaveLength(1);
    const field = result[0];
    expect(field).toBeDefined();
    if (!field) throw new Error("field not defined");

    expect(field.conflicting).toBe(true);

    // Both distinct values must be present
    const values = field.values.map((v) => v.value);
    expect(values).toContain("PO-1234");
    expect(values).toContain("PO-9999");

    // Provenance for conflicting value PO-9999
    const conflictEntry = field.values.find((v) => v.value === "PO-9999");
    expect(conflictEntry?.emailId).toBe(ROW_C.emailId);
    expect(conflictEntry?.emailSubject).toBe("Re: Invoice");
    expect(conflictEntry?.extractionStatus).toBe("candidate");

    // No canonicalValue property set (D-19 — human decides)
    expect("canonicalValue" in field).toBe(false);
  });

  it("Test 4: multiple fields, only po_number conflicts", () => {
    const result = aggregateEntityFields([ROW_A, ROW_C, ROW_INVOICE]);

    // Two fields: po_number and invoice_number
    expect(result).toHaveLength(2);

    const poField = result.find((f) => f.fieldSlug === "po_number");
    const invoiceField = result.find((f) => f.fieldSlug === "invoice_number");

    expect(poField?.conflicting).toBe(true);
    expect(invoiceField?.conflicting).toBe(false);
  });

  it("Test 5: empty input returns empty array", () => {
    const result = aggregateEntityFields([]);
    expect(result).toEqual([]);
  });

  it("Test 6: does not mutate the input rows (immutability)", () => {
    const rows: FieldOccurrenceRow[] = [{ ...ROW_A }];
    const snapshot = JSON.stringify(rows);
    aggregateEntityFields(rows);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// groupPendingSuggestions — RES-1 read path (D-20 reject is user-visible)
// ---------------------------------------------------------------------------

const CANDIDATE_X = "70000000-0000-0000-0000-0000000000a1";
const CANDIDATE_Y = "70000000-0000-0000-0000-0000000000b2";
const TYPE_SUPPLIER = "80000000-0000-0000-0000-000000000001";

function suggestionRow(
  overrides: Partial<PendingSuggestionRow>,
): PendingSuggestionRow {
  return {
    linkedEntityId: CANDIDATE_X,
    linkedDisplayName: "Acme Freight",
    linkedEntityTypeId: TYPE_SUPPLIER,
    linkedEntityTypeLabel: "Supplier",
    linkedIdentifiers: { cnpj: "12.345.678/0001-00" },
    matchType: "name_trgm",
    wasDismissed: false,
    linkedIsActive: true,
    ...overrides,
  };
}

describe("groupPendingSuggestions", () => {
  it("Test 7: groups pending rows by target entity with match types and occurrence counts", () => {
    const result = groupPendingSuggestions([
      suggestionRow({ matchType: "name_trgm" }),
      suggestionRow({ matchType: "embedding" }),
      suggestionRow({
        linkedEntityId: CANDIDATE_Y,
        linkedDisplayName: "ACME FREIGHT LTDA",
      }),
    ]);

    expect(result).toHaveLength(2);
    const x = result.find((s) => s.entityInstanceId === CANDIDATE_X);
    expect(x?.occurrenceCount).toBe(2);
    expect([...(x?.matchTypes ?? [])].sort()).toEqual(["embedding", "name_trgm"]);
    expect(x?.displayName).toBe("Acme Freight");
    expect(x?.keyIdentifiers).toEqual({ cnpj: "12.345.678/0001-00" });
  });

  it("Test 8: REJECT regression — a dismissed candidate yields an EMPTY suggestion list", () => {
    // Before dismiss: the candidate surfaces.
    const before = groupPendingSuggestions([suggestionRow({})]);
    expect(before.map((s) => s.entityInstanceId)).toEqual([CANDIDATE_X]);

    // After the human clicks REJECT, RejectMerge flags the same rows
    // was_dismissed=true. The read layer must now return NOTHING for that
    // candidate — previously this filter did not exist and the rejected
    // suggestion re-surfaced forever (user-visible no-op).
    const after = groupPendingSuggestions([
      suggestionRow({ wasDismissed: true }),
      suggestionRow({ wasDismissed: true, matchType: "embedding" }),
    ]);
    expect(after).toEqual([]);
  });

  it("Test 9: a merged-away (inactive) candidate never re-surfaces as pending", () => {
    const result = groupPendingSuggestions([
      suggestionRow({ linkedIsActive: false }),
    ]);
    expect(result).toEqual([]);
  });

  it("Test 10: dismissing one candidate does not hide a different pending candidate", () => {
    const result = groupPendingSuggestions([
      suggestionRow({ wasDismissed: true }),
      suggestionRow({
        linkedEntityId: CANDIDATE_Y,
        linkedDisplayName: "ACME FREIGHT LTDA",
      }),
    ]);

    expect(result.map((s) => s.entityInstanceId)).toEqual([CANDIDATE_Y]);
  });
});
