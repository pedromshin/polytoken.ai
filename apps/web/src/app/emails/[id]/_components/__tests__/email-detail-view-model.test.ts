/**
 * email-detail-view-model.test.ts — pins that deriving
 * `confirmDenyComponentIds` from the ALREADY-COMPUTED layers rows (Wave 0.6:
 * the second getCandidateValue pass was deleted) is output-identical to the
 * original direct-from-components derivation, across the full status ×
 * role × candidate matrix (mapped slug, unmapped single-entry blob, unmapped
 * multi-entry blob, terminal statuses).
 */

import { describe, expect, it } from "vitest";

import { getCandidateValue } from "../email-detail-helpers";
import {
  deriveDetailViewModel,
  type DetailComponent,
} from "../email-detail-view-model";

function component(
  overrides: Partial<DetailComponent> & Pick<DetailComponent, "id">,
): DetailComponent {
  return {
    attachmentId: null,
    sourceType: "region",
    contentText: null,
    contentRaw: null,
    extractionStatus: "candidate",
    location: null,
    role: "field",
    parentComponentId: null,
    entityTypeId: null,
    entityTypeFieldId: null,
    entityTypeLabel: null,
    extractedFields: null,
    confidenceScore: null,
    ...overrides,
  };
}

const FIELD_ID_TO_KEY = new Map<string, string>([
  ["f-amount", "amount"],
  ["f-date", "due_date"],
]);

const COMPONENTS: readonly DetailComponent[] = [
  // Pending FIELD, mapped, candidate present → gets ✓/✗.
  component({
    id: "c1",
    entityTypeFieldId: "f-amount",
    extractedFields: { amount: "120.50", other: "x" },
  }),
  // Pending FIELD, mapped, but the mapped slug is ABSENT → no candidate.
  component({
    id: "c2",
    entityTypeFieldId: "f-date",
    extractedFields: { amount: "120.50" },
  }),
  // Pending FIELD, unmapped, single-entry blob → safe default candidate.
  component({ id: "c3", extractedFields: { vendor: "ACME" } }),
  // Pending FIELD, unmapped, MULTI-entry blob → ambiguous, no candidate.
  component({ id: "c4", extractedFields: { a: "1", b: "2" } }),
  // Confirmed / rejected / superseded FIELDs → terminal, never controls.
  component({
    id: "c5",
    extractionStatus: "confirmed",
    extractedFields: { vendor: "ACME" },
  }),
  component({
    id: "c6",
    extractionStatus: "rejected",
    extractedFields: { vendor: "ACME" },
  }),
  component({
    id: "c7",
    extractionStatus: "superseded",
    extractedFields: { vendor: "ACME" },
  }),
  // ENTITY with a value blob → wrong role, never controls.
  component({ id: "c8", role: "entity", extractedFields: { vendor: "ACME" } }),
  // Null-role component → not a field.
  component({ id: "c9", role: null, extractedFields: { vendor: "ACME" } }),
];

function deriveViewModel(components: readonly DetailComponent[]) {
  return deriveDetailViewModel({
    components,
    idToLabel: new Map(),
    fieldIdToLabel: new Map(),
    fieldIdToKey: FIELD_ID_TO_KEY,
    selectedIds: [],
    activeParentId: null,
  });
}

describe("deriveDetailViewModel — confirmDenyComponentIds", () => {
  it("selects exactly the pending FIELD boxes with a resolvable candidate value", () => {
    const { confirmDenyComponentIds } = deriveViewModel(COMPONENTS);
    expect(confirmDenyComponentIds).toEqual(["c1", "c3"]);
  });

  it("is output-identical to the original direct-from-components derivation (the deleted second pass)", () => {
    const { confirmDenyComponentIds } = deriveViewModel(COMPONENTS);

    // The ORIGINAL derivation, verbatim: a second pass over the raw
    // components with its own getCandidateValue call.
    const original = COMPONENTS.filter(
      (c) =>
        c.role === "field" &&
        c.extractionStatus !== "confirmed" &&
        c.extractionStatus !== "rejected" &&
        c.extractionStatus !== "superseded" &&
        getCandidateValue(
          c.extractedFields,
          c.entityTypeFieldId !== null
            ? (FIELD_ID_TO_KEY.get(c.entityTypeFieldId) ?? null)
            : null,
        ) !== null,
    ).map((c) => c.id);

    expect(confirmDenyComponentIds).toEqual(original);
  });

  it("empty components — empty ids (degenerate case)", () => {
    expect(deriveViewModel([]).confirmDenyComponentIds).toEqual([]);
  });
});
