/**
 * The maritime system entity types retired by migration 0049 (deactivated)
 * and purged by 0050. Read surfaces exclude them explicitly so no Knowledge /
 * entity-type surface ever shows them, even against a database whose
 * migration state lags (0050 is gated on a prod secret at the time of
 * writing). The exclusion must only ever target SYSTEM rows
 * (importer_id IS NULL) — never a user's own custom type that happens to
 * reuse a slug.
 */
export const RETIRED_SYSTEM_TYPE_SLUGS = [
  "bill_of_lading",
  "container",
  "booking",
  "shipment",
  "maritime_line",
  "supplier",
] as const;
