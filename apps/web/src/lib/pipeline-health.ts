/**
 * pipeline-health.ts — parsing + shaping for the listener's pipeline-health
 * report (the inbox Pipeline health panel's pure data layer).
 *
 * ==========================================================================
 * INTEGRATION POINT (sibling lane): the FastAPI endpoint
 * `GET /v1/pipeline/health` is being built in the listener lane with this
 * contract: per-importer counts of emails received, fully analyzed, and
 * failed-at-stage-X. This module parses that JSON shape DEFENSIVELY (zod
 * safeParse, never throw): if the endpoint's final field names drift, update
 * `rawImporterHealthSchema` here — the panel component and its tests only
 * ever see the shaped `PipelineHealthRow`.
 * ==========================================================================
 *
 * Expected upstream JSON (snake_case, FastAPI convention):
 *   {
 *     "importers": [
 *       {
 *         "importer_id": "uuid",
 *         "label": "acme.com" | null,        // optional display name
 *         "received": 12,
 *         "fully_analyzed": 9,
 *         "failed_by_stage": { "ocr": 2, "extraction": 1 }
 *       }
 *     ]
 *   }
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Raw upstream schema
// ---------------------------------------------------------------------------

const count = z.number().int().nonnegative();

const rawImporterHealthSchema = z.object({
  importer_id: z.string().min(1),
  label: z.string().nullish(),
  received: count,
  fully_analyzed: count,
  failed_by_stage: z.record(z.string(), count).default({}),
});

export const pipelineHealthResponseSchema = z.object({
  importers: z.array(rawImporterHealthSchema),
});

// ---------------------------------------------------------------------------
// Shaped row — what the panel renders
// ---------------------------------------------------------------------------

export interface PipelineStageFailure {
  readonly stage: string;
  readonly count: number;
}

export interface PipelineHealthRow {
  readonly importerId: string;
  /** label when the listener provides one, else a shortened importer id. */
  readonly displayName: string;
  readonly received: number;
  readonly fullyAnalyzed: number;
  readonly failedTotal: number;
  /** Sorted by count descending, then stage name — worst stage first. */
  readonly failedByStage: ReadonlyArray<PipelineStageFailure>;
}

// ---------------------------------------------------------------------------
// Learning summary (WEDG-03) — pure shaping for the `learning.summary` read
// ---------------------------------------------------------------------------

/**
 * Structural mirror of the tRPC `learning.summary` payload (the router's
 * `LearningSummary` in `packages/api-client/src/router/learning`). Declared
 * structurally here so this pure layer stays dependency-free, matching the
 * rest of this module.
 */
export interface LearningSummaryLike {
  readonly correctionsMade: number;
  readonly typeCorrections: number;
  readonly mergeCascades: number;
  readonly emailsRelabeled: number;
  readonly relabelsPerCorrection: number | null;
  readonly stickRate: number | null;
}

export interface LearningSummaryView {
  readonly correctionsMade: number;
  readonly emailsRelabeled: number;
  /** "—" until any cascade exists; else e.g. "3.5" (1 decimal, ".0" trimmed). */
  readonly relabelsPerCorrectionLabel: string;
  /** "—" until any correction exists; else e.g. "86%". */
  readonly stickRateLabel: string;
  /** false while every counter is zero — the honest pre-flag-flip state. */
  readonly hasActivity: boolean;
}

/** One decimal place, trailing ".0" trimmed ("4", "2.5") — never NaN text. */
function formatRatio(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * shapeLearningSummary — display shaping for the learning-loop metrics. The
 * null rates (no cascades yet / no corrections yet) render as an em-dash, not
 * a fake 0%: an unread meter is not a zero meter. Pure; never mutates.
 */
export function shapeLearningSummary(summary: LearningSummaryLike): LearningSummaryView {
  return {
    correctionsMade: summary.correctionsMade,
    emailsRelabeled: summary.emailsRelabeled,
    relabelsPerCorrectionLabel:
      summary.relabelsPerCorrection === null
        ? "—"
        : formatRatio(summary.relabelsPerCorrection),
    stickRateLabel:
      summary.stickRate === null ? "—" : `${Math.round(summary.stickRate * 100)}%`,
    hasActivity: summary.correctionsMade > 0 || summary.emailsRelabeled > 0,
  };
}

/** Short importer-id fallback: first 8 chars (uuid prefix) — never a blank row. */
function shortImporterId(importerId: string): string {
  return importerId.length > 8 ? `${importerId.slice(0, 8)}…` : importerId;
}

/**
 * shapePipelineHealth — parse + shape the upstream payload.
 *
 * Returns `null` when the payload does not match the contract (the panel
 * shows an honest error state, never NaN counts) and a shaped, sorted row
 * list otherwise. Pure; never throws; never mutates the input.
 */
export function shapePipelineHealth(raw: unknown): PipelineHealthRow[] | null {
  const parsed = pipelineHealthResponseSchema.safeParse(raw);
  if (!parsed.success) return null;

  return parsed.data.importers.map((importer) => {
    const failedByStage = Object.entries(importer.failed_by_stage)
      .map(([stage, stageCount]) => ({ stage, count: stageCount }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count || a.stage.localeCompare(b.stage));

    const failedTotal = failedByStage.reduce((sum, entry) => sum + entry.count, 0);

    return {
      importerId: importer.importer_id,
      displayName:
        importer.label != null && importer.label.length > 0
          ? importer.label
          : shortImporterId(importer.importer_id),
      received: importer.received,
      fullyAnalyzed: importer.fully_analyzed,
      failedTotal,
      failedByStage,
    };
  });
}
