/**
 * email-detail-helpers — the pure helper cluster shared by the email-detail
 * editor and its view-model derivations. No React, no side effects: location
 * readers, lineage-origin detection, confidence narrowing, and the WR-02
 * deterministic candidate-value/key resolution. Extracted verbatim from
 * email-detail.tsx (800-line law); behavior unchanged.
 */

import type { Polygon } from "./use-region-edit";

/** Full-page polygon used by the legacy "Classify Page" affordance. */
export const FULL_PAGE_POLYGON: Polygon = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

export function getLocationPageIndex(location: unknown): number | null {
  if (
    location !== null &&
    typeof location === "object" &&
    "page_index" in location &&
    typeof (location as { page_index?: unknown }).page_index === "number"
  ) {
    return (location as { page_index: number }).page_index;
  }
  return null;
}

/** The lineage origin marker AutofillFieldsUseCase stamps on auto-detected boxes. */
const AUTO_DETECTED_ORIGIN = "auto_detected";

/**
 * Read the lineage origin from a component's content_raw (HIGH-1/WR-05), mirroring
 * the server's DenyFieldUseCase: recognizes both the nested `lineage.origin`
 * Phase-6 convention and a flat top-level `origin`. True ONLY for an auto-detected
 * box — any other value (including null/missing) means user-drawn.
 */
export function isAutoDetectedOrigin(contentRaw: unknown): boolean {
  if (contentRaw === null || typeof contentRaw !== "object") return false;
  const raw = contentRaw as Record<string, unknown>;
  const lineage = raw.lineage;
  if (lineage !== null && typeof lineage === "object") {
    const origin = (lineage as Record<string, unknown>).origin;
    if (typeof origin === "string") return origin === AUTO_DETECTED_ORIGIN;
  }
  return raw.origin === AUTO_DETECTED_ORIGIN;
}

/** Narrow a raw confidence value (string|number|null|unknown) to number|null. */
export function toConfidence(raw: unknown): number | null {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = parseFloat(raw);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/**
 * Resolve a FIELD's candidate value from its extraction record (WR-02).
 *
 * extractedFields is the JSONB blob keyed by field SLUG. When the FIELD box is
 * mapped to a property (entity_type_field_id → its slug, `fieldKey`), the value
 * is selected DETERMINISTICALLY by that key — never `Object.entries(...)[0]`,
 * which could surface a value for a different property than the mapped one.
 *
 * `fieldKey` is the resolved slug for the mapped entity_type_field_id (null when
 * the box is not yet mapped). Falls back to the single-entry blob only when the
 * box is unmapped AND exactly one value exists (a safe, unambiguous default).
 * Rendered as a React text node (auto-escaped, T-09-80).
 */
export function getCandidateValue(
  extractedFields: unknown,
  fieldKey: string | null,
): string | null {
  if (
    extractedFields === null ||
    typeof extractedFields !== "object" ||
    Array.isArray(extractedFields)
  ) {
    return null;
  }
  const fields = extractedFields as Record<string, unknown>;

  // Mapped: select the value for the mapped property's slug (deterministic).
  if (fieldKey !== null) {
    const v = fields[fieldKey];
    return v === null || v === undefined ? null : String(v);
  }

  // Unmapped: only surface a candidate when exactly one value exists, so an
  // unmapped box never shows an arbitrary value from a multi-property blob.
  const entries = Object.entries(fields);
  if (entries.length === 1) {
    const [, v] = entries[0]!;
    return v === null || v === undefined ? null : String(v);
  }
  return null;
}

/**
 * Resolve the extractedFields KEY that `getCandidateValue` surfaced (UI-2).
 *
 * The Inspector needs this key to build corrected_fields when the user edits
 * the candidate value before confirming: the correction must be keyed by the
 * same slug the machine value lives under. Mirrors getCandidateValue's
 * selection exactly — the mapped slug when mapped, else the single-entry key
 * of an unambiguous blob — and returns null when no addressable key exists
 * (unmapped multi-property blob), in which case the edit cannot be keyed.
 */
export function getCandidateFieldKey(
  extractedFields: unknown,
  fieldKey: string | null,
): string | null {
  if (
    extractedFields === null ||
    typeof extractedFields !== "object" ||
    Array.isArray(extractedFields)
  ) {
    return null;
  }
  const fields = extractedFields as Record<string, unknown>;
  if (fieldKey !== null) {
    return fieldKey in fields ? fieldKey : null;
  }
  const entries = Object.entries(fields);
  return entries.length === 1 ? entries[0]![0] : null;
}
