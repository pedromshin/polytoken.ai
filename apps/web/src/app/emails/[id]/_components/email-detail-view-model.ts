/**
 * email-detail-view-model — the pure derivation layer between the raw
 * emails.detail component rows and the editor panels (LAYERS / INSPECTOR /
 * on-PDF controls). No React, no side effects: one per-derivation pure helper
 * each (layers rows, confirm/deny ids, auto-detected ids, parent options,
 * inspector selection, labels), composed by a thin deriveDetailViewModel that
 * maps the fetched components + selection state to the exact view-model rows
 * the panels consume. Extracted verbatim from email-detail.tsx (800-line law);
 * every derivation is behavior-identical.
 */

import {
  getCandidateFieldKey,
  getCandidateValue,
  getLocationPageIndex,
  isAutoDetectedOrigin,
  toConfidence,
} from "./email-detail-helpers";

import type { ParentEntityOption } from "./field-relationship-picker";
import type { InspectorComponent } from "./inspector-panel";
import type { LayersComponent } from "./layers-panel";
import type { ComponentRole } from "~/components/regions/region-overlay-box";

/**
 * The component shape the derivations read (structural subset of the
 * emails.detail row — same local-interface idiom as the sibling panels).
 */
export interface DetailComponent {
  readonly id: string;
  readonly attachmentId: string | null;
  readonly sourceType: string;
  readonly contentText: string | null;
  readonly contentRaw: unknown;
  readonly extractionStatus: string;
  readonly location: unknown;
  readonly role: string | null;
  readonly parentComponentId: string | null;
  readonly entityTypeId: string | null;
  readonly entityTypeFieldId: string | null;
  readonly entityTypeLabel: string | null;
  readonly extractedFields: unknown;
  readonly confidenceScore: unknown;
}

export interface DetailViewModelInput {
  readonly components: readonly DetailComponent[];
  /** entityTypeId → label (entity-type label resolution). */
  readonly idToLabel: ReadonlyMap<string, string>;
  /** entityTypeFieldId → label, for FIELD property labels in tree/inspector. */
  readonly fieldIdToLabel: ReadonlyMap<string, string>;
  /**
   * entityTypeFieldId (uuid) → field key/slug (WR-02). extractedFields is keyed
   * by slug; this resolves the mapped property's slug so the candidate value is
   * selected deterministically (not by JSONB insertion order).
   */
  readonly fieldIdToKey: ReadonlyMap<string, string>;
  readonly selectedIds: readonly string[];
  readonly activeParentId: string | null;
}

export interface DetailViewModel {
  readonly layersComponents: LayersComponent[];
  readonly confirmDenyComponentIds: string[];
  readonly autoDetectedComponentIds: string[];
  readonly selectedId: string | null;
  readonly selectedComponent: DetailComponent | undefined;
  readonly parentOptions: ParentEntityOption[];
  readonly inspectorSelected: InspectorComponent | null;
  readonly inspectorEntityTypeLabel: string | null;
  readonly activeParentLabel: string;
}

/** Resolves a component's mapped field slug (null when unmapped). */
type FieldKeyResolver = (entityTypeFieldId: string | null) => string | null;

function makeFieldKeyResolver(
  fieldIdToKey: ReadonlyMap<string, string>,
): FieldKeyResolver {
  return (entityTypeFieldId) =>
    entityTypeFieldId !== null
      ? (fieldIdToKey.get(entityTypeFieldId) ?? null)
      : null;
}

/** View-model rows for LAYERS + INSPECTOR. */
function deriveLayersComponents(
  components: readonly DetailComponent[],
  idToLabel: ReadonlyMap<string, string>,
  fieldIdToLabel: ReadonlyMap<string, string>,
  fieldKeyFor: FieldKeyResolver,
): LayersComponent[] {
  return components.map((c) => ({
    id: c.id,
    sourceType: c.sourceType,
    role: (c.role ?? null) as ComponentRole,
    parentComponentId: c.parentComponentId ?? null,
    entityTypeLabel:
      c.entityTypeId !== null
        ? (idToLabel.get(c.entityTypeId) ?? c.entityTypeLabel)
        : c.entityTypeLabel,
    entityTypeFieldId: c.entityTypeFieldId ?? null,
    extractionStatus: c.extractionStatus,
    location: c.location,
    contentText: c.contentText,
    candidateValue: getCandidateValue(
      c.extractedFields,
      fieldKeyFor(c.entityTypeFieldId ?? null),
    ),
    propertyLabel:
      c.entityTypeFieldId !== null
        ? (fieldIdToLabel.get(c.entityTypeFieldId) ?? null)
        : null,
  }));
}

/**
 * HIGH-1/D-16: FIELD boxes that carry a pending candidate value get the on-PDF
 * inline ✓/✗. Confirmed/terminal boxes show no controls (UI-SPEC §Inline ✓/✗).
 * Derived from the ALREADY-COMPUTED layers rows — `role` and `candidateValue`
 * there are the same values a second getCandidateValue pass would recompute
 * (pinned by the equality test in email-detail-view-model.test.ts).
 */
function deriveConfirmDenyIds(
  layersComponents: readonly LayersComponent[],
): string[] {
  return layersComponents
    .filter(
      (row) =>
        row.role === "field" &&
        row.extractionStatus !== "confirmed" &&
        row.extractionStatus !== "rejected" &&
        row.extractionStatus !== "superseded" &&
        row.candidateValue !== null,
    )
    .map((row) => row.id);
}

/** WR-05/D-18: boxes the AI auto-detected (origin marker) drive the canonical
 * control's origin-aware deny + Undo affordance on the PDF. */
function deriveAutoDetectedIds(
  components: readonly DetailComponent[],
): string[] {
  return components
    .filter((c) => isAutoDetectedOrigin(c.contentRaw))
    .map((c) => c.id);
}

/** Same-page ENTITY regions for the field-relationship parent picker (06-04). */
function deriveParentOptions(
  components: readonly DetailComponent[],
  idToLabel: ReadonlyMap<string, string>,
  selectedId: string | null,
  selectedPageIndex: number | null,
): ParentEntityOption[] {
  return components
    .filter(
      (c) =>
        c.sourceType === "region" &&
        c.role === "entity" &&
        c.id !== selectedId &&
        c.extractionStatus !== "rejected" &&
        c.extractionStatus !== "superseded" &&
        (selectedPageIndex === null ||
          getLocationPageIndex(c.location) === selectedPageIndex),
    )
    .map((c) => ({
      id: c.id,
      label:
        (c.entityTypeId !== null ? idToLabel.get(c.entityTypeId) : null) ??
        c.entityTypeLabel ??
        "Entity",
      entityTypeId: c.entityTypeId ?? null,
      entityTypeLabel:
        (c.entityTypeId !== null ? idToLabel.get(c.entityTypeId) : null) ??
        c.entityTypeLabel,
    }));
}

/** The candidate field children of the selected entity (Confirm All Fields). */
function deriveCandidateFieldIds(
  components: readonly DetailComponent[],
  selectedComponent: DetailComponent | undefined,
  fieldKeyFor: FieldKeyResolver,
): string[] {
  if (selectedComponent === undefined || selectedComponent.role !== "entity") {
    return [];
  }
  return components
    .filter(
      (c) =>
        c.role === "field" &&
        c.parentComponentId === selectedComponent.id &&
        c.extractionStatus !== "confirmed" &&
        getCandidateValue(
          c.extractedFields,
          fieldKeyFor(c.entityTypeFieldId ?? null),
        ) !== null,
    )
    .map((c) => c.id);
}

/** The current selection (first selected id wins) and its page index. */
interface DetailSelection {
  readonly selectedId: string | null;
  readonly selectedComponent: DetailComponent | undefined;
  readonly selectedPageIndex: number | null;
}

function deriveSelection(
  components: readonly DetailComponent[],
  selectedIds: readonly string[],
): DetailSelection {
  const selectedId = selectedIds[0] ?? null;
  const selectedComponent =
    selectedId !== null
      ? components.find((c) => c.id === selectedId)
      : undefined;
  const selectedPageIndex =
    selectedComponent !== undefined
      ? getLocationPageIndex(selectedComponent.location)
      : null;
  return { selectedId, selectedComponent, selectedPageIndex };
}

/** The INSPECTOR's selected-component projection. */
function deriveInspectorSelected(
  selectedComponent: DetailComponent | undefined,
  idToLabel: ReadonlyMap<string, string>,
  fieldIdToLabel: ReadonlyMap<string, string>,
  fieldKeyFor: FieldKeyResolver,
  candidateFieldIds: string[],
): InspectorComponent | null {
  if (selectedComponent === undefined) return null;
  return {
    id: selectedComponent.id,
    role: (selectedComponent.role ?? null) as ComponentRole,
    entityTypeId: selectedComponent.entityTypeId ?? null,
    entityTypeFieldId: selectedComponent.entityTypeFieldId ?? null,
    parentComponentId: selectedComponent.parentComponentId ?? null,
    entityTypeLabel:
      selectedComponent.entityTypeId !== null
        ? (idToLabel.get(selectedComponent.entityTypeId) ??
          selectedComponent.entityTypeLabel)
        : selectedComponent.entityTypeLabel,
    extractionStatus: selectedComponent.extractionStatus,
    pageNumber: (getLocationPageIndex(selectedComponent.location) ?? 0) + 1,
    candidateValue: getCandidateValue(
      selectedComponent.extractedFields,
      fieldKeyFor(selectedComponent.entityTypeFieldId ?? null),
    ),
    candidateFieldKey: getCandidateFieldKey(
      selectedComponent.extractedFields,
      fieldKeyFor(selectedComponent.entityTypeFieldId ?? null),
    ),
    confidenceScore: toConfidence(selectedComponent.confidenceScore),
    propertyLabel:
      selectedComponent.entityTypeFieldId !== null
        ? (fieldIdToLabel.get(selectedComponent.entityTypeFieldId) ?? null)
        : null,
    candidateFieldIds,
  };
}

/** Entity-type label for the INSPECTOR header (resolved id only, no fallback). */
function deriveInspectorEntityTypeLabel(
  selectedComponent: DetailComponent | undefined,
  idToLabel: ReadonlyMap<string, string>,
): string | null {
  return selectedComponent !== undefined &&
    selectedComponent.entityTypeId !== null
    ? (idToLabel.get(selectedComponent.entityTypeId) ?? null)
    : null;
}

/** The active-parent entity label (D-10 banner). */
function deriveActiveParentLabel(
  components: readonly DetailComponent[],
  activeParentId: string | null,
  idToLabel: ReadonlyMap<string, string>,
): string {
  const activeParentComponent =
    activeParentId !== null
      ? components.find((c) => c.id === activeParentId)
      : undefined;
  return activeParentComponent !== undefined
    ? ((activeParentComponent.entityTypeId !== null
        ? idToLabel.get(activeParentComponent.entityTypeId)
        : null) ??
      activeParentComponent.entityTypeLabel ??
      "Entity")
    : "";
}

export function deriveDetailViewModel({
  components,
  idToLabel,
  fieldIdToLabel,
  fieldIdToKey,
  selectedIds,
  activeParentId,
}: DetailViewModelInput): DetailViewModel {
  const fieldKeyFor = makeFieldKeyResolver(fieldIdToKey);

  const layersComponents = deriveLayersComponents(
    components,
    idToLabel,
    fieldIdToLabel,
    fieldKeyFor,
  );

  const { selectedId, selectedComponent, selectedPageIndex } = deriveSelection(
    components,
    selectedIds,
  );
  const candidateFieldIds = deriveCandidateFieldIds(
    components,
    selectedComponent,
    fieldKeyFor,
  );

  return {
    layersComponents,
    confirmDenyComponentIds: deriveConfirmDenyIds(layersComponents),
    autoDetectedComponentIds: deriveAutoDetectedIds(components),
    selectedId,
    selectedComponent,
    parentOptions: deriveParentOptions(components, idToLabel, selectedId, selectedPageIndex),
    inspectorSelected: deriveInspectorSelected(
      selectedComponent,
      idToLabel,
      fieldIdToLabel,
      fieldKeyFor,
      candidateFieldIds,
    ),
    inspectorEntityTypeLabel: deriveInspectorEntityTypeLabel(selectedComponent, idToLabel),
    activeParentLabel: deriveActiveParentLabel(components, activeParentId, idToLabel),
  };
}
