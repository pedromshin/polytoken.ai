/**
 * extraction-fixture.ts — the ONE `LayersComponent[]` fixture both
 * `capture-extraction-baseline.test.tsx` (60-05-PLAN.md Task 1, which froze
 * the pre-60 shape from it) and `extraction-summary-structure.test.tsx`
 * (Task 3, which asserts the post-60 shape differs from that baseline) mount
 * `ExtractionSummaryPanel` against.
 *
 * WHY A SHARED MODULE, not the inbox pair's copy-paste convention: Task 3's
 * whole claim is "the DOM restructured", measured as a delta against Task 1's
 * frozen artifact. That comparison is only honest if BOTH sides render the
 * SAME input — the plan says so in as many words ("an unfair fixture
 * invalidates the comparison"). Two inline copies make fixture-identity a
 * copy-paste hope that any later edit to one side can silently break, and the
 * break would show up as a FALSE structural delta — i.e. as the gate passing
 * for the wrong reason. Importing one frozen module makes identity a
 * compile-time fact instead. (`capture-inbox-baseline.test.tsx` /
 * `inbox-structure.test.tsx` duplicate theirs because each needs its own
 * hoisted `vi.mock("~/trpc/react")` factory with a DIFFERENT entitySummary
 * shape; `ExtractionSummaryPanel` is pure presentational — it takes
 * `components` as a prop and makes no tRPC call — so that constraint simply
 * does not apply here.)
 *
 * Free of vitest imports, mirroring `src/app/__tests__/support/
 * structural-fingerprint.ts`'s convention, so it is consumable from any test
 * tree without registering a suite.
 *
 * FIXTURE COVERAGE — every branch the Task 2 redesign touches:
 *   - a CONFIRMED entity with TWO fields (one with a value, one without —
 *     the "no value" italic-note branch)
 *   - a CANDIDATE entity (unlabelled -> the "Unclassified entity" fallback)
 *     with ONE field, which also renders the confirm affordance
 *   - an ORPHAN meaningful field (no parent among the entities)
 *   - rows that MUST be filtered out, so the preserved behaviour is exercised
 *     rather than merely asserted: a `rejected` row + a `superseded` row
 *     (HIDDEN_STATUSES), a value-less/unmapped field (isMeaningfulField), and
 *     a non-`region` sourceType.
 */

import type { LayersComponent } from "../../layers-panel";

export const ENTITY_CONFIRMED_ID = "11111111-1111-1111-1111-111111111111";
export const ENTITY_CANDIDATE_ID = "22222222-2222-2222-2222-222222222222";
export const FIELD_AMOUNT_ID = "33333333-3333-3333-3333-333333333333";
export const FIELD_NO_VALUE_ID = "44444444-4444-4444-4444-444444444444";
export const FIELD_PERSON_ID = "55555555-5555-5555-5555-555555555555";
export const ORPHAN_FIELD_ID = "66666666-6666-6666-6666-666666666666";

/** A `LayersComponent` with the fixture's defaults; `overrides` wins. */
function component(overrides: Partial<LayersComponent> & { id: string }): LayersComponent {
  return {
    sourceType: "region",
    role: null,
    parentComponentId: null,
    entityTypeLabel: null,
    entityTypeFieldId: null,
    extractionStatus: "candidate",
    location: null,
    contentText: null,
    candidateValue: null,
    propertyLabel: null,
    ...overrides,
  };
}

export const EXTRACTION_FIXTURE: readonly LayersComponent[] = [
  // ── A confirmed entity, two fields ───────────────────────────────────
  component({
    id: ENTITY_CONFIRMED_ID,
    role: "entity",
    entityTypeLabel: "Supplier",
    extractionStatus: "confirmed",
    contentText: "Acme Freight Ltda",
  }),
  component({
    id: FIELD_AMOUNT_ID,
    role: "field",
    parentComponentId: ENTITY_CONFIRMED_ID,
    entityTypeFieldId: "aaaaaaaa-0000-0000-0000-000000000001",
    extractionStatus: "confirmed",
    propertyLabel: "Total amount",
    candidateValue: "R$ 4.820,00",
  }),
  // Mapped to a property but with NO extracted value -> the "no value" branch.
  component({
    id: FIELD_NO_VALUE_ID,
    role: "field",
    parentComponentId: ENTITY_CONFIRMED_ID,
    entityTypeFieldId: "aaaaaaaa-0000-0000-0000-000000000002",
    extractionStatus: "candidate",
    propertyLabel: "Due date",
    candidateValue: null,
  }),

  // ── A candidate entity with no type label, one field ─────────────────
  component({
    id: ENTITY_CANDIDATE_ID,
    role: "entity",
    entityTypeLabel: null,
    extractionStatus: "candidate",
    contentText: "Rafael Lima",
  }),
  component({
    id: FIELD_PERSON_ID,
    role: "field",
    parentComponentId: ENTITY_CANDIDATE_ID,
    extractionStatus: "candidate",
    propertyLabel: null,
    contentText: "Contact name",
    candidateValue: "Rafael Lima",
  }),

  // ── An orphan meaningful field (no parent among the entities) ────────
  component({
    id: ORPHAN_FIELD_ID,
    role: "field",
    parentComponentId: null,
    entityTypeFieldId: "aaaaaaaa-0000-0000-0000-000000000003",
    extractionStatus: "pending",
    propertyLabel: "Pickup date",
    candidateValue: "18 Jul 2026",
  }),

  // ── Rows that MUST be filtered out (behaviour preserved by Task 2) ────
  // HIDDEN_STATUSES.
  component({
    id: "77777777-7777-7777-7777-777777777777",
    role: "entity",
    entityTypeLabel: "Rejected supplier",
    extractionStatus: "rejected",
  }),
  component({
    id: "88888888-8888-8888-8888-888888888888",
    role: "field",
    parentComponentId: ENTITY_CONFIRMED_ID,
    extractionStatus: "superseded",
    propertyLabel: "Old total",
    candidateValue: "R$ 9.999,00",
  }),
  // Not meaningful: no candidateValue AND no entityTypeFieldId.
  component({
    id: "99999999-9999-9999-9999-999999999999",
    role: "field",
    parentComponentId: ENTITY_CONFIRMED_ID,
    extractionStatus: "candidate",
    contentText: "raw ocr box",
  }),
  // Not a region.
  component({
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    sourceType: "attachment",
    role: "entity",
    entityTypeLabel: "Attachment entity",
    extractionStatus: "confirmed",
  }),
];
