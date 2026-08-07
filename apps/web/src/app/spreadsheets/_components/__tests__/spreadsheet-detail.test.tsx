/**
 * spreadsheet-detail.test.tsx — the /spreadsheets/[id] standalone table viewer
 * (vLAUNCH Wave 0.65 lane P2). jsdom-only: BEHAVIOUR + structure, not layout
 * (CLAUDE.md: jsdom does no layout; the real-browser pass happens at BURN-01).
 *
 * Covered:
 *   1. LOADING — a pending query yields a busy skeleton, never a blank page.
 *   2. UNAVAILABLE — error and null (missing-or-not-yours, both NOT_FOUND
 *      server-side) COLLAPSE into one framed state; the grid never mounts.
 *   3. SUCCESS — the grid receives the stored columns/rows READ-ONLY
 *      (isEditable=false — this surface never wires cell editing), keyed by
 *      the spreadsheet id; the back link returns to the registry.
 *   4. NARROWING — malformed jsonb (non-array columns/rows) degrades to empty
 *      arrays handed to the grid, never a throw.
 *   5. IDENTITY — the title is serif + `data-evidence` (law 2), the updated
 *      timestamp is `tabular` with a machine-readable datetime.
 *
 * `~/trpc/react` is mocked as a plain object (the sibling list test's
 * convention). `@polytoken/ui/spreadsheet-grid` is mocked as a props-capturing
 * stub: the grid's own rendering is @polytoken/ui's contract (tested there);
 * THIS surface's contract is what it hands the grid.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface QueryResult {
  isPending: boolean;
  isError: boolean;
  data?: {
    id: string;
    title: string;
    columns: unknown;
    rows: unknown;
    createdAt: Date;
    updatedAt: Date;
  } | null;
}

let queryResult: QueryResult = { isPending: true, isError: false };

vi.mock("~/trpc/react", () => ({
  api: {
    spreadsheets: {
      byId: {
        useQuery: () => queryResult,
      },
    },
  },
}));

/** Props handed to the grid stub on its most recent render. */
let gridProps: Record<string, unknown> | null = null;

vi.mock("@polytoken/ui/spreadsheet-grid", () => ({
  SpreadsheetGrid: (props: Record<string, unknown>) => {
    gridProps = props;
    return <div data-testid="spreadsheet-grid-stub" />;
  },
}));

import { SpreadsheetDetail } from "../spreadsheet-detail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  gridProps = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  queryResult = { isPending: true, isError: false };
});

const SHEET_ID = "11111111-1111-1111-1111-111111111111";

function mount() {
  act(() => root.render(<SpreadsheetDetail id={SHEET_ID} />));
}

const grid = () =>
  container.querySelector("[data-testid='spreadsheet-grid-stub']");

const now = new Date("2026-07-27T12:00:00Z");

const SHEET = {
  id: SHEET_ID,
  title: "Q3 revenue",
  columns: [{ name: "region", type: "text" }],
  rows: [
    { id: "r1", data: { region: "EMEA" } },
    { id: "r2", data: { region: "APAC" } },
  ],
  createdAt: now,
  updatedAt: now,
};

describe("loading state is busy, not blank", () => {
  it("renders a busy skeleton while pending, no grid", () => {
    queryResult = { isPending: true, isError: false };
    mount();

    expect(container.querySelector("[aria-busy]")).not.toBeNull();
    expect(grid()).toBeNull();
  });
});

describe("error and not-found collapse into one unavailable state", () => {
  it("shows the framed unavailable panel on error", () => {
    queryResult = { isPending: false, isError: true };
    mount();

    expect(container.textContent).toContain("This table isn’t available");
    expect(grid()).toBeNull();
  });

  it("shows the same panel when the row is null (missing-or-not-yours)", () => {
    queryResult = { isPending: false, isError: false, data: null };
    mount();

    expect(container.textContent).toContain("This table isn’t available");
    expect(grid()).toBeNull();
  });
});

describe("success hands the stored table to the grid, read-only", () => {
  it("passes columns/rows through, isEditable=false, keyed by the sheet id", () => {
    queryResult = { isPending: false, isError: false, data: SHEET };
    mount();

    expect(grid()).not.toBeNull();
    expect(gridProps?.isEditable).toBe(false);
    expect(gridProps?.dataSourceId).toBe(SHEET_ID);
    expect(gridProps?.columns).toEqual(SHEET.columns);
    expect(gridProps?.rows).toEqual(SHEET.rows);
    expect(gridProps?.totalRecords).toBe(2);
    // Never any of the write callbacks — this viewer has no write path.
    expect(gridProps?.onCellChange).toBeUndefined();
    expect(gridProps?.onRowAdd).toBeUndefined();
    expect(gridProps?.onRowDelete).toBeUndefined();
  });

  it("links back to the /spreadsheets registry", () => {
    queryResult = { isPending: false, isError: false, data: SHEET };
    mount();

    const back = container.querySelector<HTMLAnchorElement>(
      "a[href='/spreadsheets']",
    );
    expect(back).not.toBeNull();
    expect(back?.textContent).toContain("All tables");
  });

  it("title is serif + data-evidence, updated timestamp is tabular (identity law)", () => {
    queryResult = { isPending: false, isError: false, data: SHEET };
    mount();

    const title = container.querySelector("h1[data-evidence]");
    expect(title?.getAttribute("class") ?? "").toMatch(/font-serif/);
    expect(title?.textContent).toBe("Q3 revenue");

    const time = container.querySelector("time");
    expect(time?.getAttribute("class") ?? "").toMatch(/\btabular\b/);
    expect(time?.getAttribute("datetime")).toBe(now.toISOString());
    expect(container.textContent).toContain("2 rows");
  });
});

describe("malformed jsonb degrades, never throws", () => {
  it("hands empty arrays to the grid when columns/rows are not arrays", () => {
    queryResult = {
      isPending: false,
      isError: false,
      data: { ...SHEET, columns: { corrupt: true }, rows: "not-an-array" },
    };
    mount();

    expect(grid()).not.toBeNull();
    expect(gridProps?.columns).toEqual([]);
    expect(gridProps?.rows).toEqual([]);
    expect(gridProps?.totalRecords).toBe(0);
  });
});
