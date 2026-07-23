/**
 * table.test.ts — the two CV-03 table capabilities as registry data.
 *
 * Pins the safety-load-bearing facts: the id pair, risk/cost declared as DATA (INV-4), the
 * input-schema validation boundary (column/row bounds, unique column names, prototype-pollution
 * guard, empty-patch refusal), the fails-closed store floor (INV-5), and that execute() is a pure
 * delegation to the injected store port (no persistence in substrate).
 */
import { describe, expect, it, vi } from "vitest";

import { createCapabilityRegistry } from "../capability.js";
import {
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  TABLE_CAPABILITIES,
  failClosedSpreadsheetStore,
  tableCreateCapability,
  tableCreateInputSchema,
  tableUpdateCapability,
  tableUpdateInputSchema,
  type SpreadsheetStore,
  type TableExecCtx,
  type TableScope,
} from "../table.js";

const SPREADSHEET_ID = "00000000-0000-0000-0000-000000000010";

const VALID_CREATE = {
  title: "Invoices",
  columns: [
    { name: "vendor", type: "text" as const },
    { name: "amount", type: "number" as const },
    { name: "due", type: "date" as const },
  ],
  rows: [{ data: { vendor: "Acme", amount: 1200, due: "2026-08-01" } }],
};

describe("table capabilities — the CV-03 pair", () => {
  it("declares exactly the two ids", () => {
    expect([...TABLE_CAPABILITIES].map((c) => c.id).sort()).toEqual([
      "table.create",
      "table.update",
    ]);
  });

  it("declares risk/cost as DATA — both write/free, reversible (no reversibility key)", () => {
    expect(tableCreateCapability).toMatchObject({ risk: "write", cost: "free", source: "builtin", trust: "first-party" });
    expect(tableUpdateCapability).toMatchObject({ risk: "write", cost: "free" });
    expect(tableCreateCapability.reversibility).toBeUndefined();
    expect(tableUpdateCapability.reversibility).toBeUndefined();
  });

  it("folds into a registry and projects an outward manifest (INV-1)", () => {
    const registry = createCapabilityRegistry<TableExecCtx, TableScope>(TABLE_CAPABILITIES);
    expect(registry.get("table.create")).toBeDefined();
    expect(registry.get("table.update")).toBeDefined();
    const listed = registry.list();
    expect(listed.find((e) => e.id === "table.create")).toMatchObject({ risk: "write", cost: "free" });
  });
});

describe("tableCreateInputSchema — the validation boundary", () => {
  it("accepts a well-formed create payload", () => {
    expect(tableCreateInputSchema.safeParse(VALID_CREATE).success).toBe(true);
  });

  it("accepts a schema-only proposal (no rows yet)", () => {
    const { rows: _rows, ...noRows } = VALID_CREATE;
    expect(tableCreateInputSchema.safeParse(noRows).success).toBe(true);
  });

  it("rejects zero columns", () => {
    expect(
      tableCreateInputSchema.safeParse({ title: "x", columns: [] }).success,
    ).toBe(false);
  });

  it("rejects duplicate column names", () => {
    const result = tableCreateInputSchema.safeParse({
      title: "x",
      columns: [
        { name: "a", type: "text" },
        { name: "a", type: "number" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown column type", () => {
    const result = tableCreateInputSchema.safeParse({
      title: "x",
      columns: [{ name: "a", type: "spreadsheet" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects rows whose data carries a prototype-pollution key at any depth (mirrors canvas guard)", () => {
    // JSON.parse makes `__proto__` an OWN enumerable key (the shape real agent/tool JSON arrives
    // in). Nested under a cell value it survives zod's `z.unknown()` pass-through, exactly as the
    // canvas.addNode guard tests it (FOUND-6).
    const rows = JSON.parse('[{"data":{"cell":{"__proto__":{"polluted":true}}}}]') as unknown[];
    const result = tableCreateInputSchema.safeParse({
      title: "x",
      columns: [{ name: "a", type: "text" }],
      rows,
    });
    expect(result.success).toBe(false);
  });

  it("rejects overrunning the column cap", () => {
    const columns = Array.from({ length: MAX_TABLE_COLUMNS + 1 }, (_, i) => ({
      name: `c${i}`,
      type: "text" as const,
    }));
    expect(tableCreateInputSchema.safeParse({ title: "x", columns }).success).toBe(false);
  });

  it("rejects overrunning the row cap", () => {
    const rows = Array.from({ length: MAX_TABLE_ROWS + 1 }, () => ({ data: { a: 1 } }));
    const result = tableCreateInputSchema.safeParse({
      title: "x",
      columns: [{ name: "a", type: "number" }],
      rows,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a stray top-level key (.strict())", () => {
    const result = tableCreateInputSchema.safeParse({ ...VALID_CREATE, smuggled: true });
    expect(result.success).toBe(false);
  });
});

describe("tableUpdateInputSchema — partial patch boundary", () => {
  it("accepts a title-only patch", () => {
    expect(
      tableUpdateInputSchema.safeParse({ spreadsheetId: SPREADSHEET_ID, title: "Renamed" }).success,
    ).toBe(true);
  });

  it("accepts a rows-only patch", () => {
    expect(
      tableUpdateInputSchema.safeParse({
        spreadsheetId: SPREADSHEET_ID,
        rows: [{ data: { a: 1 } }],
      }).success,
    ).toBe(true);
  });

  it("refuses an empty patch (id only, nothing to change)", () => {
    expect(
      tableUpdateInputSchema.safeParse({ spreadsheetId: SPREADSHEET_ID }).success,
    ).toBe(false);
  });

  it("rejects a non-uuid spreadsheetId", () => {
    expect(
      tableUpdateInputSchema.safeParse({ spreadsheetId: "nope", title: "x" }).success,
    ).toBe(false);
  });
});

describe("store port — fails closed (INV-5) and pure delegation", () => {
  it("failClosedSpreadsheetStore refuses both verbs", async () => {
    await expect(failClosedSpreadsheetStore.create(VALID_CREATE)).rejects.toThrow(/no spreadsheet store/i);
    await expect(
      failClosedSpreadsheetStore.update({ spreadsheetId: SPREADSHEET_ID, title: "x" }),
    ).rejects.toThrow(/no spreadsheet store/i);
  });

  it("execute() delegates verbatim to the injected store (no persistence in substrate)", async () => {
    const store: SpreadsheetStore = {
      create: vi.fn().mockResolvedValue({ spreadsheetId: SPREADSHEET_ID, created: true }),
      update: vi.fn().mockResolvedValue({ spreadsheetId: SPREADSHEET_ID, updated: true }),
    };
    const created = await tableCreateCapability.execute(VALID_CREATE, { store });
    expect(created).toEqual({ spreadsheetId: SPREADSHEET_ID, created: true });
    expect(store.create).toHaveBeenCalledWith(VALID_CREATE);

    const scope = tableUpdateCapability.scope({ spreadsheetId: SPREADSHEET_ID, title: "x" });
    expect(scope).toEqual({ action: "table.update", spreadsheetId: SPREADSHEET_ID });
  });
});
