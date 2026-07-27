/**
 * spreadsheets-list.test.tsx — the /spreadsheets registry surface (Stream A —
 * CV-03). jsdom-only: BEHAVIOUR + structure, not layout (CLAUDE.md: jsdom does
 * no layout; the geometry/screenshot gates own the visual claim).
 *
 * Covered:
 *   1. ROWS — renders one row per table from a mocked owner-scoped list, in the
 *      server's order (newest-first is the server's job, preserved here).
 *   2. EMPTY — `[]` yields the "No tables yet" panel that teaches the next
 *      action (a link to /chat), not a bare message.
 *   3. ERROR — an errored query yields the framed error state carrying the
 *      message, never a blank surface.
 *   4. LOADING — a pending query yields a busy skeleton, not empty rows.
 *   5. IDENTITY — each title is serif + `data-evidence` (law 2: the user's own
 *      material speaks serif), each timestamp is `tabular` (law: amounts/dates).
 *
 * `~/trpc/react` is mocked as a plain object exposing `spreadsheets.list.useQuery`
 * whose return value is swapped per test (mirrors send-to.test.tsx's convention).
 * Harness: jsdom + createRoot + `act` — this app's real component-test convention
 * (see vault-listing.test.tsx).
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface QueryResult {
  isPending: boolean;
  isError: boolean;
  error?: { message: string };
  data?: ReadonlyArray<{
    id: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

let queryResult: QueryResult = { isPending: true, isError: false };

vi.mock("~/trpc/react", () => ({
  api: {
    spreadsheets: {
      list: {
        useQuery: () => queryResult,
      },
    },
  },
}));

// Imported AFTER the mock is declared (vi.mock is hoisted, so order is safe,
// but keep the import below the mock for readability).
import { SpreadsheetsList } from "../spreadsheets-list";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  queryResult = { isPending: true, isError: false };
});

function mount() {
  act(() => root.render(<SpreadsheetsList />));
}

const rows = () =>
  Array.from(
    container.querySelectorAll<HTMLElement>("[data-slot='spreadsheet-row']"),
  );

const now = new Date("2026-07-27T12:00:00Z");

const TABLES = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    title: "Q3 revenue",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    title: "Supplier contacts",
    createdAt: now,
    updatedAt: now,
  },
];

describe("rows render from the mocked owner-scoped list", () => {
  it("renders one row per table, in the order handed over", () => {
    queryResult = { isPending: false, isError: false, data: TABLES };
    mount();

    expect(rows()).toHaveLength(2);
    expect(rows().map((r) => r.textContent)).toEqual([
      expect.stringContaining("Q3 revenue"),
      expect.stringContaining("Supplier contacts"),
    ]);
  });

  it("titles are serif + data-evidence, timestamps are tabular (identity law)", () => {
    queryResult = { isPending: false, isError: false, data: TABLES };
    mount();

    const title = rows()[0]?.querySelector("[data-evidence]");
    expect(title?.getAttribute("class") ?? "").toMatch(/font-serif/);
    expect(title?.textContent).toBe("Q3 revenue");

    const time = rows()[0]?.querySelector("time");
    expect(time?.getAttribute("class") ?? "").toMatch(/\btabular\b/);
    // A machine-readable timestamp is always present, never just the label.
    expect(time?.getAttribute("datetime")).toBeTruthy();
  });
});

describe("empty state teaches the next action", () => {
  it("shows the 'No tables yet' panel and a link to chat on []", () => {
    queryResult = { isPending: false, isError: false, data: [] };
    mount();

    expect(rows()).toHaveLength(0);
    expect(container.textContent).toContain("No tables yet");

    const link = container.querySelector<HTMLAnchorElement>("a[href='/chat']");
    expect(link).not.toBeNull();
  });
});

describe("error state is framed, never blank", () => {
  it("surfaces the error message", () => {
    queryResult = {
      isPending: false,
      isError: true,
      error: { message: "boom" },
    };
    mount();

    expect(rows()).toHaveLength(0);
    expect(container.textContent).toContain("Couldn’t load your tables");
    expect(container.textContent).toContain("boom");
  });
});

describe("loading state is busy, not empty", () => {
  it("renders a busy skeleton while pending", () => {
    queryResult = { isPending: true, isError: false };
    mount();

    expect(rows()).toHaveLength(0);
    expect(container.querySelector("[aria-busy]")).not.toBeNull();
  });
});
