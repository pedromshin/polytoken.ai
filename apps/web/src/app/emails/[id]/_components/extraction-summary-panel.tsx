"use client";

/**
 * extraction-summary-panel.tsx — a read-only, document-wide summary of everything
 * extracted from THIS email: each entity, its type/status, and its field
 * values. The single place a user can look to know "what did we pull out of this
 * document" — independent of canvas selection and of the /entities gallery
 * (which only shows CONFIRMED entities).
 *
 * Reuses the same `LayersComponent[]` the layers tree consumes, so it needs no
 * extra query. All entity/field strings render as React text nodes (auto-escaped).
 */

import * as React from "react";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@polytoken/ui/button";
import { ScrollArea } from "@polytoken/ui/scroll-area";

import type { LayersComponent } from "./layers-panel";

interface ExtractionSummaryPanelProps {
  readonly components: readonly LayersComponent[];
  /**
   * Confirm a candidate ENTITY region → promotes it to the /entities gallery
   * (POST /v1/components/{id}/confirm). Without this, an entity can only be
   * "accepted" (→candidate) and never reaches the gallery.
   */
  readonly onConfirmEntity?: (componentId: string) => void;
  /** Entity component ids with a confirm in flight (for the button spinner). */
  readonly confirmingEntityIds?: ReadonlySet<string>;
}

/** Rows we never surface (mirror the layers tree's visible filter). */
const HIDDEN_STATUSES = new Set(["rejected", "superseded"]);

/**
 * A FIELD is worth surfacing in the summary only when it carries an extracted
 * value OR is mapped to a property. Unmapped, value-less drawn boxes (often
 * hundreds of raw-OCR regions) are noise here — they belong in the canvas, not
 * in the "what did we extract" summary.
 */
function isMeaningfulField(c: LayersComponent): boolean {
  return c.candidateValue !== null || c.entityTypeFieldId !== null;
}

type StatusTone = "confirmed" | "candidate" | "other";

function statusTone(status: string): StatusTone {
  if (status === "confirmed") return "confirmed";
  if (status === "candidate") return "candidate";
  return "other";
}

const TONE_DOT: Record<StatusTone, string> = {
  confirmed: "bg-success",
  candidate: "bg-graph-email-component",
  other: "bg-muted-foreground/50",
};

const TONE_LABEL: Record<StatusTone, string> = {
  confirmed: "Confirmed",
  candidate: "Candidate",
  other: "—",
};

function StatusDot({ status }: { status: string }) {
  const tone = statusTone(status);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]}`}
        aria-hidden
      />
      <span className="sr-only">{TONE_LABEL[tone]}</span>
    </span>
  );
}

/** A single field row: property label (or detected text) → extracted value. */
function FieldRow({ field }: { field: LayersComponent }) {
  const label = field.propertyLabel ?? field.contentText ?? "Unmapped field";
  const value = field.candidateValue;
  return (
    <li className="flex items-start justify-between gap-2 py-1">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-foreground">{label}</p>
        <p className="break-words text-sm text-muted-foreground">
          {value !== null && value !== "" ? value : <span className="italic">no value</span>}
        </p>
      </div>
      <StatusDot status={field.extractionStatus} />
    </li>
  );
}

export function ExtractionSummaryPanel({
  components,
  onConfirmEntity,
  confirmingEntityIds,
}: ExtractionSummaryPanelProps) {
  const visible = components.filter(
    (c) => c.sourceType === "region" && !HIDDEN_STATUSES.has(c.extractionStatus),
  );

  const entities = visible.filter((c) => c.role === "entity");

  const meaningfulFields = visible.filter(
    (c) => c.role === "field" && isMeaningfulField(c),
  );

  const fieldsByParent = new Map<string, LayersComponent[]>();
  for (const c of meaningfulFields) {
    if (c.parentComponentId === null) continue;
    const bucket = fieldsByParent.get(c.parentComponentId) ?? [];
    bucket.push(c);
    fieldsByParent.set(c.parentComponentId, bucket);
  }

  // Meaningful fields not nested under any entity (drawn but not yet related).
  const orphanFields = meaningfulFields.filter(
    (c) =>
      c.parentComponentId === null ||
      !entities.some((e) => e.id === c.parentComponentId),
  );

  const isEmpty = entities.length === 0 && orphanFields.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">Extracted from this document</h2>
        <p className="text-xs text-muted-foreground">
          {entities.length} {entities.length === 1 ? "entity" : "entities"}
          {orphanFields.length > 0
            ? ` · ${orphanFields.length} unlinked field${orphanFields.length === 1 ? "" : "s"}`
            : ""}
        </p>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-3 p-3">
          {isEmpty ? (
            <p className="text-sm text-muted-foreground">
              Nothing extracted yet. Draw and classify regions, or run autofill,
              to populate this summary.
            </p>
          ) : null}

          {entities.map((entity) => {
            const fields = fieldsByParent.get(entity.id) ?? [];
            return (
              <section
                key={entity.id}
                className="rounded-md border border-graph-entity/30 bg-graph-entity/10"
              >
                <header className="flex items-center justify-between gap-2 border-b border-graph-entity/30 px-3 py-2">
                  <p className="truncate text-sm font-semibold text-graph-entity">
                    {entity.entityTypeLabel ?? "Unclassified entity"}
                  </p>
                  <StatusDot status={entity.extractionStatus} />
                </header>
                {entity.extractionStatus === "confirmed" ? (
                  <p className="flex items-center gap-1.5 px-3 pt-2 text-xs font-medium text-success">
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    In the entities gallery
                  </p>
                ) : onConfirmEntity ? (
                  <div className="px-3 pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-full text-xs"
                      disabled={confirmingEntityIds?.has(entity.id) ?? false}
                      onClick={() => onConfirmEntity(entity.id)}
                    >
                      {confirmingEntityIds?.has(entity.id) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Check className="h-3.5 w-3.5" aria-hidden />
                      )}
                      Confirm → add to gallery
                    </Button>
                  </div>
                ) : null}
                {fields.length > 0 ? (
                  <ul className="divide-y divide-border/60 px-3 py-1">
                    {fields.map((field) => (
                      <FieldRow key={field.id} field={field} />
                    ))}
                  </ul>
                ) : (
                  <p className="px-3 py-2 text-xs italic text-muted-foreground">
                    No fields extracted for this entity yet.
                  </p>
                )}
              </section>
            );
          })}

          {orphanFields.length > 0 ? (
            <section className="rounded-md border">
              <header className="border-b px-3 py-2">
                <p className="text-sm font-semibold text-muted-foreground">
                  Unlinked fields
                </p>
              </header>
              <ul className="divide-y divide-border/60 px-3 py-1">
                {orphanFields.map((field) => (
                  <FieldRow key={field.id} field={field} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
