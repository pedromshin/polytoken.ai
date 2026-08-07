/**
 * pipeline-health.test.ts — behavior tests for the pipeline-health parsing +
 * shaping pure layer (the inbox Pipeline health panel's data contract).
 */

import { describe, expect, it } from "vitest";

import {
  shapeLearningSummary,
  shapePipelineHealth,
  type LearningSummaryLike,
} from "./pipeline-health";

const VALID_PAYLOAD = {
  importers: [
    {
      importer_id: "11111111-2222-3333-4444-555555555555",
      label: "acme.com",
      received: 12,
      fully_analyzed: 9,
      failed_by_stage: { ocr: 2, extraction: 1 },
    },
  ],
};

describe("shapePipelineHealth", () => {
  it("shapes a valid payload into camelCase rows with a failed total", () => {
    const rows = shapePipelineHealth(VALID_PAYLOAD);

    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({
      importerId: "11111111-2222-3333-4444-555555555555",
      displayName: "acme.com",
      received: 12,
      fullyAnalyzed: 9,
      failedTotal: 3,
    });
  });

  it("sorts stage failures worst-first, dropping zero-count stages", () => {
    const rows = shapePipelineHealth({
      importers: [
        {
          importer_id: "a",
          received: 5,
          fully_analyzed: 1,
          failed_by_stage: { parse: 1, ocr: 3, embed: 0 },
        },
      ],
    });

    expect(rows![0]!.failedByStage).toEqual([
      { stage: "ocr", count: 3 },
      { stage: "parse", count: 1 },
    ]);
  });

  it("breaks stage-count ties alphabetically (deterministic render order)", () => {
    const rows = shapePipelineHealth({
      importers: [
        {
          importer_id: "a",
          received: 4,
          fully_analyzed: 2,
          failed_by_stage: { zeta: 1, alpha: 1 },
        },
      ],
    });

    expect(rows![0]!.failedByStage.map((f) => f.stage)).toEqual(["alpha", "zeta"]);
  });

  it("falls back to a shortened importer id when label is missing or empty", () => {
    const rows = shapePipelineHealth({
      importers: [
        {
          importer_id: "11111111-2222-3333-4444-555555555555",
          received: 1,
          fully_analyzed: 1,
        },
        {
          importer_id: "short",
          label: "",
          received: 0,
          fully_analyzed: 0,
        },
      ],
    });

    expect(rows![0]!.displayName).toBe("11111111…");
    expect(rows![1]!.displayName).toBe("short");
  });

  it("defaults failed_by_stage to empty when the field is absent", () => {
    const rows = shapePipelineHealth({
      importers: [{ importer_id: "a", received: 2, fully_analyzed: 2 }],
    });

    expect(rows![0]!.failedTotal).toBe(0);
    expect(rows![0]!.failedByStage).toEqual([]);
  });

  it("returns null (never throws, never NaN) on contract drift", () => {
    expect(shapePipelineHealth(null)).toBeNull();
    expect(shapePipelineHealth({})).toBeNull();
    expect(shapePipelineHealth({ importers: [{ importer_id: "a" }] })).toBeNull();
    expect(
      shapePipelineHealth({
        importers: [
          {
            importer_id: "a",
            received: -1,
            fully_analyzed: 0,
          },
        ],
      }),
    ).toBeNull();
    expect(
      shapePipelineHealth({
        importers: [
          {
            importer_id: "a",
            received: "12",
            fully_analyzed: 0,
          },
        ],
      }),
    ).toBeNull();
  });

  it("handles an empty importer list (the panel's honest empty state)", () => {
    expect(shapePipelineHealth({ importers: [] })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// shapeLearningSummary (WEDG-03)
// ---------------------------------------------------------------------------

const ZERO_SUMMARY: LearningSummaryLike = {
  correctionsMade: 0,
  typeCorrections: 0,
  mergeCascades: 0,
  emailsRelabeled: 0,
  relabelsPerCorrection: null,
  stickRate: null,
};

describe("shapeLearningSummary", () => {
  it("shapes the all-zeros pre-flip state: no activity, em-dash rates, no NaN", () => {
    const view = shapeLearningSummary(ZERO_SUMMARY);

    expect(view).toEqual({
      correctionsMade: 0,
      emailsRelabeled: 0,
      relabelsPerCorrectionLabel: "—",
      stickRateLabel: "—",
      hasActivity: false,
    });
  });

  it("shapes a live summary into display labels (percent rounded, ratio trimmed)", () => {
    const view = shapeLearningSummary({
      correctionsMade: 12,
      typeCorrections: 9,
      mergeCascades: 3,
      emailsRelabeled: 30,
      relabelsPerCorrection: 10,
      stickRate: 0.857,
    });

    expect(view).toEqual({
      correctionsMade: 12,
      emailsRelabeled: 30,
      relabelsPerCorrectionLabel: "10",
      stickRateLabel: "86%",
      hasActivity: true,
    });
  });

  it("keeps one decimal on a fractional leverage ('2.5'), trims '.0' ('4')", () => {
    expect(
      shapeLearningSummary({
        ...ZERO_SUMMARY,
        correctionsMade: 2,
        mergeCascades: 2,
        emailsRelabeled: 5,
        relabelsPerCorrection: 2.5,
        stickRate: 1,
      }).relabelsPerCorrectionLabel,
    ).toBe("2.5");
    expect(
      shapeLearningSummary({
        ...ZERO_SUMMARY,
        correctionsMade: 1,
        mergeCascades: 1,
        emailsRelabeled: 4,
        relabelsPerCorrection: 4,
        stickRate: 1,
      }).relabelsPerCorrectionLabel,
    ).toBe("4");
  });

  it("renders a null leverage as an em-dash even when type corrections exist", () => {
    const view = shapeLearningSummary({
      ...ZERO_SUMMARY,
      correctionsMade: 2,
      typeCorrections: 2,
      relabelsPerCorrection: null,
      stickRate: 0.5,
    });

    expect(view.relabelsPerCorrectionLabel).toBe("—");
    expect(view.stickRateLabel).toBe("50%");
    expect(view.hasActivity).toBe(true);
  });

  it("a 0% stick rate is a real reading (0), distinct from the null em-dash", () => {
    const view = shapeLearningSummary({
      ...ZERO_SUMMARY,
      correctionsMade: 2,
      typeCorrections: 2,
      stickRate: 0,
    });

    expect(view.stickRateLabel).toBe("0%");
  });
});
