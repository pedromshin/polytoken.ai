"use client";

import { Badge } from "@polytoken/ui/badge";
import { Button } from "@polytoken/ui/button";
import { Input } from "@polytoken/ui/input";
import { Loader2 } from "lucide-react";

import { REGION_TIER } from "./region-vocabulary";
import { getStatusBadge } from "./status-badge";

// ---- Types ----

/**
 * The law-1 dispositions in this file (58-IDENTITY law 1; 60-06-PLAN §D).
 * Madder is earned by an IRREVERSIBLE ACTION and by nothing else — "never
 * errors, never warnings". This panel had four `destructive` uses and not
 * one of them was an action:
 *
 *   - the REQUIRED asterisk: a rule about a form, stated before anything has
 *     gone wrong. It now carries ink weight; its `aria-label` already said
 *     "required" and still does, so the meaning never depended on the hue.
 *   - the LOW-CONFIDENCE percentage (x2): a machine's uncertainty, which is
 *     what this review surface exists to resolve, not a hazard. Ink weight
 *     against `text-pencil` — the ladder's own word for "uncertain".
 *
 * The two genuinely destructive controls on this surface are Discard Fields
 * (here, `variant="ghost"` by 07-UI-SPEC) and the deny buttons in
 * `confirm-deny-controls.tsx` / `layers-tree-row.tsx`, which keep their
 * madder — see 60-05-SUMMARY.md.
 */

/** Required marker: ink weight, never madder — a form rule is not a hazard. */
const REQUIRED_MARK = "ml-0.5 text-xs font-semibold text-ink";

/** A confidence read: ink weight when weak, quiet pencil otherwise. Never hue. */
function confidenceClass(score: number): string {
  return score < 0.5
    ? "text-xs tabular font-semibold text-ink"
    : "text-xs tabular text-pencil";
}

interface FieldDef {
  readonly key: string;
  readonly label: string;
  readonly isRequired: boolean;
}

export interface FieldsPanelProps {
  readonly phase: "extracting" | "reviewing" | "confirming" | "confirmed";
  readonly entityTypeLabel: string;
  readonly extractionRecordStatus: string | null;
  readonly confidenceScore: number | null;
  readonly fields: ReadonlyArray<FieldDef>;
  readonly extractedFields: Record<string, unknown>;
  readonly correctedFields: Record<string, unknown> | null;
  readonly confidenceBreakdown: Record<string, unknown> | null;
  readonly fieldValues: Record<string, string>;
  onFieldChange: (key: string, value: string) => void;
  onConfirm: () => void;
  onDiscard: () => void;
}

// ---- Helpers ----

function getFieldScore(
  confidenceBreakdown: Record<string, unknown> | null,
  key: string,
): number | null {
  if (!confidenceBreakdown) return null;
  const raw = confidenceBreakdown[key];
  if (typeof raw === "number") return raw;
  return null;
}

// ---- Component ----

/**
 * FieldsPanel — inline extraction fields panel for the autofill review surface.
 *
 * Per 07-UI-SPEC §3.3 (panel structure), §3.4 (extracting spinner),
 * §3.6 (confirmed state), §6.3-6.5 (copy), §7 (a11y contracts).
 *
 * Phases:
 * - "extracting": spinner with aria-busy
 * - "reviewing" | "confirming": editable inputs + Confirm/Discard action row
 * - "confirmed": read-only paragraphs + Confirmed badge, no action row
 */
export function FieldsPanel({
  phase,
  entityTypeLabel,
  extractionRecordStatus,
  confidenceScore,
  fields,
  extractedFields,
  correctedFields,
  confidenceBreakdown,
  fieldValues,
  onFieldChange,
  onConfirm,
  onDiscard,
}: FieldsPanelProps) {
  // Extracting phase: spinner only
  if (phase === "extracting") {
    return (
      <div
        role="region"
        aria-label="Extracting fields…"
        aria-busy="true"
        className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground"
      >
        <Loader2
          className="h-4 w-4 animate-spin text-primary"
          aria-hidden="true"
        />
        Extracting fields…
      </div>
    );
  }

  // Confirmed phase: read-only field values
  if (phase === "confirmed") {
    return (
      <div
        role="region"
        aria-label={`Extracted fields for ${entityTypeLabel}`}
        className="border-t"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-muted border-b">
          <span className="text-sm font-semibold text-foreground">
            {entityTypeLabel}
          </span>
          <div className="flex items-center gap-2">
            {confidenceScore !== null && (
              <span className="text-xs text-muted-foreground">
                {Math.round(confidenceScore * 100)}% overall
              </span>
            )}
            {/* A badge whose word IS "Confirmed" must wear the confirmed
                tier, not full chrome ink: verdigris means confirmed, and
                this is the same claim the overlay boxes, the layers rows and
                the extraction registry make — through the same lookup, so
                the four cannot drift (T-60-08). `badge`, never `chip`: the
                word is polytoken's vocabulary, not the document's, and
                `chip` carries pmark's serif (law 2). */}
            <Badge
              variant="outline"
              className={`text-2xs font-semibold px-2 py-0.5 rounded-sm inline-flex items-center gap-1.5 ${REGION_TIER.confirmed.badge}`}
              aria-label="Status: Confirmed"
            >
              <span
                className={`h-[7px] w-[7px] shrink-0 rounded-[1.5px] ${REGION_TIER.confirmed.swatch}`}
                aria-hidden="true"
              />
              Confirmed
            </Badge>
          </div>
        </div>
        {/* Field rows — read-only */}
        <div className="px-4 py-3 space-y-3">
          {fields.map((field) => {
            const value = String(
              correctedFields?.[field.key] ??
                extractedFields[field.key] ??
                "",
            );
            const fieldScore = getFieldScore(confidenceBreakdown, field.key);

            return (
              <div key={field.key}>
                <p className="text-2xs font-semibold uppercase tracking-wide text-pencil">
                  {field.label}
                  {field.isRequired && (
                    <span
                      className={REQUIRED_MARK}
                      aria-label={`${field.label} (required)`}
                    >
                      *
                    </span>
                  )}
                </p>
                {/* The extracted value is the document's own words and the
                    entire product of this panel — law 2's evidence. */}
                <p className="mt-1 text-sm font-serif tabular text-ink" data-evidence>
                  {value}
                </p>
                {fieldScore !== null && (
                  <span
                    className={confidenceClass(fieldScore)}
                    aria-label={
                      fieldScore < 0.5
                        ? `${field.label} confidence: ${Math.round(fieldScore * 100)}%, low confidence`
                        : undefined
                    }
                  >
                    {Math.round(fieldScore * 100)}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Reviewing / confirming phase: editable inputs + action row
  const isConfirming = phase === "confirming";
  const statusBadge =
    extractionRecordStatus !== null
      ? getStatusBadge(extractionRecordStatus)
      : null;

  return (
    <div
      role="region"
      aria-label={`Extracted fields for ${entityTypeLabel}`}
      className="border-t"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-muted border-b">
        <span className="text-sm font-semibold text-foreground">
          {entityTypeLabel}
        </span>
        <div className="flex items-center gap-2">
          {confidenceScore !== null && (
            <span className="text-xs text-muted-foreground">
              {Math.round(confidenceScore * 100)}% overall
            </span>
          )}
          {statusBadge !== null && (
            <Badge
              variant={statusBadge.variant}
              className={["shrink-0 text-xs", statusBadge.className]
                .filter(Boolean)
                .join(" ")}
            >
              {extractionRecordStatus}
            </Badge>
          )}
        </div>
      </div>

      {/* Field rows — editable */}
      <div className="px-4 py-3 space-y-3">
        {fields.map((field) => {
          const fieldScore = getFieldScore(confidenceBreakdown, field.key);

          return (
            <div key={field.key}>
              <p className="text-2xs font-semibold uppercase tracking-wide text-pencil">
                {field.label}
                {field.isRequired && (
                  <span
                    className={REQUIRED_MARK}
                    aria-label={`${field.label} (required)`}
                  >
                    *
                  </span>
                )}
              </p>
              {/* Evidence: the value under review came off the document. */}
              <Input
                className="h-8 text-sm font-serif tabular"
                data-evidence
                value={fieldValues[field.key] ?? ""}
                onChange={(e) => onFieldChange(field.key, e.target.value)}
                aria-label={field.label}
                aria-required={field.isRequired}
              />
              {fieldScore !== null && (
                <span
                  className={confidenceClass(fieldScore)}
                  aria-label={
                    fieldScore < 0.5
                      ? `${field.label} confidence: ${Math.round(fieldScore * 100)}%, low confidence`
                      : undefined
                  }
                >
                  {Math.round(fieldScore * 100)}%
                </span>
              )}
            </div>
          );
        })}

        {/* Action row */}
        <div className="flex items-center gap-2 pt-3 border-t mt-3">
          <Button
            variant="default"
            size="sm"
            aria-label="Confirm Fields"
            onClick={onConfirm}
            disabled={isConfirming}
          >
            Confirm Fields
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Discard extraction results"
            onClick={onDiscard}
          >
            Discard Fields
          </Button>
        </div>
      </div>
    </div>
  );
}
