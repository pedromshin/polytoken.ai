/**
 * entities-table.test.tsx — EN-01: the entity table now renders through the
 * spreadsheet-grid. jsdom does no layout, so this pins the BEHAVIOUR worth
 * pinning — the pure GalleryItem[] -> grid-model mapping (columns, rows,
 * conditional-formatting for "needs review" states) — plus a smoke render that
 * the grid mounts without throwing.
 */
import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

// EntitiesTable calls next/navigation's useRouter (row-number click -> detail).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The repo's dependency-free render helper (mirrors inbox-structure.test.tsx):
 * createRoot + act, no @testing-library. */
async function mount(element: React.ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return container;
}

import {
  buildEntityGridRows,
  EntitiesTable,
  ENTITY_GRID_COLUMNS,
  ENTITY_GRID_FORMATTING,
  entityToRow,
  type GalleryItem,
} from "../entities-table";

const CONFIRMED: GalleryItem = {
  id: "11111111-1111-1111-1111-111111111111",
  displayName: "Acme Corp",
  entityTypeId: "type-1",
  entityTypeLabel: "Company",
  keyIdentifiers: { domain: "acme.com", vat: "" },
  occurrenceCount: 12,
  pendingDuplicatesCount: 0,
  lastSeen: new Date("2026-07-01T00:00:00.000Z"),
  status: "confirmed",
};

const NEEDS_REVIEW: GalleryItem = {
  id: "22222222-2222-2222-2222-222222222222",
  displayName: "Acme Corporation",
  entityTypeId: "type-1",
  entityTypeLabel: null,
  keyIdentifiers: {},
  occurrenceCount: 3,
  pendingDuplicatesCount: 2,
  lastSeen: null,
  status: "candidate",
};

describe("entityToRow — GalleryItem -> grid row", () => {
  it("keys cells by column name and carries the entity id as the row id", () => {
    const row = entityToRow(CONFIRMED);
    expect(row.id).toBe(CONFIRMED.id);
    expect(row.data).toMatchObject({
      "Display name": "Acme Corp",
      "Entity type": "Company",
      Occurrences: 12,
      Status: "confirmed",
      Duplicates: 0,
    });
  });

  it("joins non-empty key identifiers and drops blanks", () => {
    expect(entityToRow(CONFIRMED).data["Key identifiers"]).toBe("acme.com");
  });

  it("serializes lastSeen to an ISO string, or null when absent", () => {
    expect(entityToRow(CONFIRMED).data["Last seen"]).toBe("2026-07-01T00:00:00.000Z");
    expect(entityToRow(NEEDS_REVIEW).data["Last seen"]).toBeNull();
  });

  it("renders a missing entity type label as an empty cell (never 'null')", () => {
    expect(entityToRow(NEEDS_REVIEW).data["Entity type"]).toBe("");
  });
});

describe("buildEntityGridRows + grid model", () => {
  it("maps every item to a row, preserving order and count", () => {
    const rows = buildEntityGridRows([CONFIRMED, NEEDS_REVIEW]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).toEqual([CONFIRMED.id, NEEDS_REVIEW.id]);
  });

  it("declares the seven entity columns with grid field types", () => {
    expect(ENTITY_GRID_COLUMNS.map((c) => c.name)).toEqual([
      "Display name",
      "Entity type",
      "Key identifiers",
      "Occurrences",
      "Last seen",
      "Status",
      "Duplicates",
    ]);
    expect(ENTITY_GRID_COLUMNS.find((c) => c.name === "Occurrences")?.type).toBe("number");
  });

  it("flags the 'needs review' states via conditional formatting (candidate + pending duplicates)", () => {
    expect(ENTITY_GRID_FORMATTING.Status?.[0]).toMatchObject({
      condition: "equals",
      value: "candidate",
    });
    expect(ENTITY_GRID_FORMATTING.Duplicates?.[0]).toMatchObject({
      condition: "greater_than",
      value: 0,
    });
  });
});

describe("EntitiesTable — smoke render (grid mounts through the spreadsheet-grid)", () => {
  it("renders without throwing and shows the record-count footer", async () => {
    const container = await mount(
      <EntitiesTable items={[CONFIRMED, NEEDS_REVIEW]} sort="last_seen" onSortChange={vi.fn()} />,
    );
    expect(container.querySelector('[aria-label="Entities"]')).not.toBeNull();
    // SpreadsheetGrid's footer renders with the record count once mounted.
    expect(container.textContent).toMatch(/of 2 records/i);
  });
});
