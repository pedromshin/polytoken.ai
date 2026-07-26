/**
 * spreadsheet-publish.test.ts — the spreadsheet node's publish projection
 * (Phase 76 summon-loop prereq). Locks the contract: it carries the table's
 * SHAPE (column names+types + true rowCount) plus a small bounded sample, never
 * the whole dataset.
 */

import { describe, expect, it } from "vitest";
import type {
  SpreadsheetColumn,
  SpreadsheetRow,
} from "@polytoken/ui/spreadsheet-grid";

import { projectSheetForPublish } from "../spreadsheet-publish";

const COLUMNS: SpreadsheetColumn[] = [
  { name: "month", type: "text" },
  { name: "amount", type: "number" },
];

function rows(n: number): SpreadsheetRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    data: { month: `M${i}`, amount: i },
  }));
}

describe("projectSheetForPublish", () => {
  it("carries column names + types and the TRUE row count", () => {
    const p = projectSheetForPublish("Rent", COLUMNS, rows(200));
    expect(p.label).toBe("Rent");
    expect(p.columns).toEqual([
      { name: "month", type: "text" },
      { name: "amount", type: "number" },
    ]);
    expect(p.rowCount).toBe(200); // the whole table's count, not the sample size
  });

  it("caps the sample far below a large dataset (never dumps all rows)", () => {
    const p = projectSheetForPublish("Big", COLUMNS, rows(5000));
    expect(p.rowCount).toBe(5000);
    expect(p.sample.length).toBeLessThanOrEqual(8);
    expect(p.sample.length).toBeGreaterThan(0);
    // the sample is the row DATA, in order
    expect(p.sample[0]).toEqual({ month: "M0", amount: 0 });
  });

  it("handles an empty table (shape published, empty sample)", () => {
    const p = projectSheetForPublish("Empty", COLUMNS, []);
    expect(p.rowCount).toBe(0);
    expect(p.sample).toEqual([]);
    expect(p.columns).toHaveLength(2);
  });
});
