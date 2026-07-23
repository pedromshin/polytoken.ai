/**
 * spreadsheets.test.ts — CV-03 schema-shape guard for the `spreadsheets` table.
 *
 * The migration itself is verified to parse by `drizzle-kit check` (0044). This
 * is the belt-and-suspenders schema-shape unit test the migration workflow calls
 * for when a live DB isn't available: it pins the table's public shape (columns,
 * types, the direct user_id ownership anchor, JSONB columns/rows, timestamps) so
 * a schema edit that would silently diverge from the migration trips here.
 */
import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";

import { Spreadsheets } from "./schema/spreadsheets";

describe("spreadsheets table shape (CV-03)", () => {
  it("is named 'spreadsheets'", () => {
    expect(getTableName(Spreadsheets)).toBe("spreadsheets");
  });

  it("declares exactly the CV-03 columns", () => {
    const cols = getTableColumns(Spreadsheets);
    expect(Object.keys(cols).sort()).toEqual(
      ["columns", "createdAt", "id", "rows", "title", "updatedAt", "userId"].sort(),
    );
  });

  it("anchors ownership directly on a NOT NULL user_id (INV-8/9)", () => {
    const cols = getTableColumns(Spreadsheets);
    expect(cols.userId.name).toBe("user_id");
    expect(cols.userId.notNull).toBe(true);
  });

  it("stores columns and rows as jsonb (the whole-document persistence shape)", () => {
    const cols = getTableColumns(Spreadsheets);
    expect(cols.columns.dataType).toBe("json");
    expect(cols.rows.dataType).toBe("json");
    expect(cols.columns.notNull).toBe(true);
    expect(cols.rows.notNull).toBe(true);
  });

  it("carries created/updated timestamps and a default title", () => {
    const cols = getTableColumns(Spreadsheets);
    expect(cols.createdAt.name).toBe("created_at");
    expect(cols.updatedAt.name).toBe("updated_at");
    expect(cols.title.default).toBe("Untitled table");
  });
});
