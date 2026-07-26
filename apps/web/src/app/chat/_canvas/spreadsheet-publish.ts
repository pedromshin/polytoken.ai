/**
 * spreadsheet-publish.ts — the pure projection a spreadsheet node publishes to
 * `shared.published.{id}` (Phase 76 summon-loop prereq). Kept free of React /
 * the tRPC client so it is unit-testable on its own; spreadsheet-node.tsx
 * imports it and wires it through `useCanvasPublish`.
 *
 * The projection carries the table's SHAPE (column names+types + the true
 * rowCount) plus a small bounded row sample — NEVER the full dataset. A
 * code-island wired FROM this node reads `window.__ISLAND_DATA__.{targetKey}`
 * and sees `{ label, columns, rowCount, sample }`, enough to compute over the
 * table's structure without the LWW `sharedState` cap ever being blown
 * (`projectForPublish` is the final belt in the store write path).
 */

import type {
  SpreadsheetColumn,
  SpreadsheetRow,
} from "@polytoken/ui/spreadsheet-grid";

/** How many rows the publish projection samples. A published value is a
 * GLANCEABLE summary, never the full sheet — `projectForPublish` clamps arrays
 * to 20 anyway, but a table can hold thousands of rows, so we self-cap the
 * sample small and deliberately here (Phase 73 LCAN-03). A downstream tool
 * reads the shape from `columns` + `rowCount`; the sample is for previewing. */
export const PUBLISH_SAMPLE_ROWS = 8;

export interface SheetPublishProjection {
  readonly label: string;
  readonly columns: ReadonlyArray<{ readonly name: string; readonly type: string }>;
  readonly rowCount: number;
  readonly sample: ReadonlyArray<Record<string, unknown>>;
}

export function projectSheetForPublish(
  label: string,
  columns: readonly SpreadsheetColumn[],
  rows: readonly SpreadsheetRow[],
): SheetPublishProjection {
  return {
    label,
    columns: columns.map((col) => ({ name: col.name, type: col.type })),
    rowCount: rows.length,
    sample: rows.slice(0, PUBLISH_SAMPLE_ROWS).map((row) => row.data),
  };
}
