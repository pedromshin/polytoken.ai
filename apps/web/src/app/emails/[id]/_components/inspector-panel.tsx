"use client";

import { useState } from "react";
import { Loader2, MousePointer2, Sparkles } from "lucide-react";

import { Badge } from "@polytoken/ui/badge";
import { Button } from "@polytoken/ui/button";
import { Input } from "@polytoken/ui/input";

import { EntityTypePicker } from "./entity-type-picker";
import { FieldRelationshipPicker } from "./field-relationship-picker";
import { REGION_ROLE_LABEL, REGION_ROLE_SWATCH } from "./region-vocabulary";
import { RolePicker } from "./role-picker";
import { getStatusBadge } from "./status-badge";

import type { AutofillFieldsPhase } from "./use-autofill-fields";
import type { ParentEntityOption } from "./field-relationship-picker";
import type { ComponentRole } from "./region-overlay-box";

/** The selected component, as the inspector consumes it (subset of detail). */
export interface InspectorComponent {
  readonly id: string;
  readonly role: ComponentRole;
  readonly entityTypeId: string | null;
  readonly entityTypeFieldId: string | null;
  readonly parentComponentId: string | null;
  readonly entityTypeLabel: string | null;
  readonly extractionStatus: string;
  readonly pageNumber: number;
  /** AI candidate value (auto-escaped React text node — T-09-80). */
  readonly candidateValue: string | null;
  /** Overall confidence for the candidate value (0..1), if present. */
  readonly confidenceScore: number | null;
  /** Resolved field-property label for a FIELD. */
  readonly propertyLabel: string | null;
  /** Candidate field children ids (for "Confirm All Fields"). */
  readonly candidateFieldIds: readonly string[];
}

interface InspectorPanelProps {
  readonly selected: InspectorComponent | null;
  /** Same-page ENTITY regions for the parent picker (06-04 pattern). */
  readonly parentOptions: readonly ParentEntityOption[];
  /** Entity-type label resolved from the component's entityTypeId. */
  readonly entityTypeLabel: string | null;
  /** Autofill phase for the selected entity (if any). */
  readonly autofillPhase: AutofillFieldsPhase | undefined;

  // ---- Mutations (use-role-mutations + use-autofill-fields) ----
  readonly onSetRole: (componentId: string, role: ComponentRole) => void;
  /** Resolve a chosen entity-type SLUG → id, then setEntityType. */
  readonly onSetEntityTypeSlug: (componentId: string, slug: string) => void;
  readonly onSetFieldRelationship: (
    componentId: string,
    parentComponentId: string | null,
    entityTypeFieldId: string | null,
  ) => void;
  readonly onAutofillFields: (entityComponentId: string) => void;
  readonly onConfirmAllFields: (
    entityComponentId: string,
    candidateFieldIds: readonly string[],
  ) => void;
  readonly onConfirmField: (componentId: string) => void;
  readonly onUnconfirmField: (componentId: string) => void;
}

/**
 * Compact role marker used in the Region Identity section.
 *
 * Pre-60 this was a map of one node-TYPE hue per role (a tinted fill plus
 * matching text, three times over) — a ROLE encoded in a hue, which law 3
 * gives to shape and law 1 forbids on chrome outright. The retired tokens
 * are described rather than named: `role-hue-ban.test.ts` walks this file
 * line by line and cannot tell a citation from a class. It now states the
 * role the same way the
 * Role picker does and the same way the page does: the miniature box
 * geometry (`REGION_ROLE_SWATCH`) over a hue-free chrome fill, with
 * polytoken's word for the role beside it (`REGION_ROLE_LABEL` — one map,
 * shared with the picker, so the two cannot disagree about what the user
 * just clicked). Tier — the one thing that HAS earned colour here — is
 * stated separately, by the status badge below, through `tierOf`.
 */
const ROLE_MARKER = "inline-flex items-center gap-1.5 rounded-sm bg-shade px-2 py-1 text-2xs font-semibold text-ink";

/**
 * InspectorPanel — the single role + relationship control point (D-11,
 * 09-UI-SPEC §INSPECTOR Panel).
 */
export function InspectorPanel({
  selected,
  parentOptions,
  entityTypeLabel,
  autofillPhase,
  onSetRole,
  onSetEntityTypeSlug,
  onSetFieldRelationship,
  onAutofillFields,
  onConfirmAllFields,
  onConfirmField,
  onUnconfirmField,
}: InspectorPanelProps) {
  const [entityTypeOpen, setEntityTypeOpen] = useState(false);

  if (selected === null) {
    return (
      <aside
        className="flex flex-col h-full"
        role="complementary"
        aria-label="Region inspector"
      >
        <div className="py-12 px-6 text-center text-sm text-muted-foreground space-y-2">
          <MousePointer2
            className="h-8 w-8 text-muted-foreground/50 mx-auto"
            aria-hidden="true"
          />
          <p className="text-foreground font-semibold">Select a region</p>
          <p>
            Click a box on the canvas or a row in the Layers panel to inspect it.
          </p>
        </div>
      </aside>
    );
  }

  const role = selected.role;
  const statusBadge = getStatusBadge(selected.extractionStatus);
  const isExtracting = autofillPhase === "extracting";
  const showAutofill = role === "entity" && selected.entityTypeId !== null;
  const showCandidateValue =
    role === "field" &&
    selected.candidateValue !== null &&
    selected.extractionStatus !== "confirmed";
  const showConfirmed =
    role === "field" && selected.extractionStatus === "confirmed";
  /**
   * A weak candidate is a WARNING, and law 1 spends madder only on the
   * irreversible — "never errors, never warnings" (58-IDENTITY). Pre-60 this
   * drove `text-destructive`, which told the user an uncertain guess was a
   * dangerous one. It is neither: it is a machine's low-confidence read that
   * a human is about to confirm or correct, which is the entire job of this
   * panel. Distinguished now by ink WEIGHT, not hue, so it survives
   * greyscale — and pencil, not madder, is the ladder's word for "uncertain".
   * The tier hues are not available here either: `sugg` means "suggested",
   * not "suspect", and a hue means exactly one thing.
   */
  const lowConfidence =
    selected.confidenceScore !== null && selected.confidenceScore < 0.5;

  return (
    <aside
      className="flex flex-col h-full overflow-y-auto"
      role="complementary"
      aria-label="Region inspector"
    >
      <div className="flex flex-col gap-4 p-4">
        {/* Section 1: Region Identity */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {role !== null && (
              <span className={ROLE_MARKER}>
                <span className={REGION_ROLE_SWATCH[role]} aria-hidden="true" />
                {REGION_ROLE_LABEL[role]}
              </span>
            )}
            <span className="text-sm font-semibold truncate text-ink">
              {selected.entityTypeLabel ??
                selected.propertyLabel ??
                "Region"}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-pencil">
            <Badge
              variant={statusBadge.variant}
              className={["text-xs", statusBadge.className]
                .filter(Boolean)
                .join(" ")}
            >
              {selected.extractionStatus}
            </Badge>
            <span className="tabular">· Page {selected.pageNumber}</span>
          </div>
        </div>

        {/* Section 2: Role Picker */}
        <RolePicker
          value={role}
          onSelect={(next) => onSetRole(selected.id, next)}
        />

        {/* Section 3: Entity Type Picker (role = entity OR field) */}
        {(role === "entity" || role === "field") && (
          <div className="space-y-1">
            <p className="text-2xs font-semibold uppercase tracking-wide text-pencil">
              Entity type
            </p>
            <EntityTypePicker
              open={entityTypeOpen}
              onOpenChange={setEntityTypeOpen}
              onSelect={(slug) => onSetEntityTypeSlug(selected.id, slug)}
              trigger={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  aria-expanded={entityTypeOpen}
                >
                  {entityTypeLabel ?? "Select entity type…"}
                </Button>
              }
            />
          </div>
        )}

        {/* Section 3b: Field relationship pickers (role = field) */}
        {role === "field" && (
          <FieldRelationshipPicker
            parentOptions={parentOptions}
            parentComponentId={selected.parentComponentId}
            entityTypeFieldId={selected.entityTypeFieldId}
            onSelect={(parentId, fieldId) =>
              onSetFieldRelationship(selected.id, parentId, fieldId)
            }
          />
        )}

        {/* Section 4: Sub-field Autofill (role = entity AND entityTypeId set) */}
        {showAutofill && (
          <div className="space-y-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              className="w-full"
              disabled={isExtracting}
              aria-busy={isExtracting}
              onClick={() => onAutofillFields(selected.id)}
            >
              {isExtracting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
                  Extracting…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" aria-hidden="true" />
                  Autofill Fields
                </>
              )}
            </Button>
            {selected.candidateFieldIds.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                title="Confirms all candidate field values for this entity. You can still edit them individually afterward."
                onClick={() =>
                  onConfirmAllFields(selected.id, selected.candidateFieldIds)
                }
              >
                Confirm All Fields
              </Button>
            )}
          </div>
        )}

        {/* Section 5a: Confirmed field — show value + Unconfirm button */}
        {showConfirmed && selected.candidateValue !== null && (
          <div className="space-y-1">
            <p className="text-2xs font-semibold uppercase tracking-wide text-pencil">
              Confirmed value
            </p>
            {/* The document's own words — law 2's evidence, even inside a
                control. The field is the product; the label above it is
                polytoken's chrome and stays quiet sans. */}
            <Input
              className="h-8 text-sm font-serif tabular"
              data-evidence
              defaultValue={selected.candidateValue}
              readOnly
              aria-label="Confirmed value"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => onUnconfirmField(selected.id)}
            >
              Unconfirm Field
            </Button>
          </div>
        )}

        {/* Section 5: Candidate Value (role = field AND candidate present) */}
        {showCandidateValue && (
          <div className="space-y-1">
            <p className="text-2xs font-semibold uppercase tracking-wide text-pencil">
              Candidate value
            </p>
            {/* Evidence: this is what the machine read off the page. */}
            <Input
              className="h-8 text-sm font-serif tabular"
              data-evidence
              defaultValue={selected.candidateValue ?? ""}
              aria-label="Candidate value"
            />
            {selected.confidenceScore !== null && (
              <span
                className={`text-xs tabular ${
                  lowConfidence ? "font-semibold text-ink" : "text-pencil"
                }`}
              >
                {Math.round(selected.confidenceScore * 100)}% confidence
              </span>
            )}
            <Button
              type="button"
              variant="default"
              size="sm"
              className="w-full"
              onClick={() => onConfirmField(selected.id)}
            >
              Confirm Field
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}
