/**
 * pipeline-health.test.ts — behavior tests for the pipeline-health parsing +
 * shaping pure layer (the inbox Pipeline health panel's data contract).
 */

import { describe, expect, it } from "vitest";

import { shapePipelineHealth } from "./pipeline-health";

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
