/**
 * panel-edit.test.ts — vitest unit tests for the genui.applyPanelEdit tRPC
 * procedure (52-03-PLAN.md Task 2, TDD).
 *
 * DB-free / no FastAPI call — mirrors generate.test.ts's caller harness but
 * without any fetch mocking (this procedure operates only on the
 * client-supplied spec, which it fully re-validates itself — FOUND-6 gate,
 * applied here as the panel-edit surface).
 */

import { describe, expect, it } from "vitest";

import { appRouter } from "../../../root";

const TEST_USER = { id: "10000000-0000-0000-0000-00000000000a" };

function makeCaller() {
  return appRouter.createCaller({
    db: {} as never,
    headers: new Headers(),
    user: TEST_USER,
  });
}

const VALID_CARD_SPEC_JSON = JSON.stringify({
  v: 1,
  root: { type: "card", title: "Old title", description: "Old description" },
});

// ---------------------------------------------------------------------------
// Valid base + valid params
// ---------------------------------------------------------------------------

describe("genui.applyPanelEdit — valid base + valid params", () => {
  it("applies a card title param and returns { ok:true, spec } with the new title", async () => {
    const caller = makeCaller();
    const result = await caller.genui.applyPanelEdit({
      currentSpecJson: VALID_CARD_SPEC_JSON,
      params: { title: "New title" },
    });

    expect(result.ok).toBe(true);
    expect(result.spec?.root).toMatchObject({
      type: "card",
      title: "New title",
      description: "Old description",
    });
    expect(result.reason).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Malformed currentSpecJson (T-52-03-04: no leaked raw error text)
// ---------------------------------------------------------------------------

describe("genui.applyPanelEdit — malformed currentSpecJson", () => {
  it("returns { ok:false } with a friendly reason, no raw error text leaked", async () => {
    const caller = makeCaller();
    const result = await caller.genui.applyPanelEdit({
      currentSpecJson: "{ this is not valid json",
      params: {},
    });

    expect(result.ok).toBe(false);
    expect(result.spec).toBeUndefined();
    expect(result.reason).toBeDefined();
    expect(JSON.stringify(result)).not.toContain("SyntaxError");
    expect(JSON.stringify(result)).not.toContain("Unexpected token");
    expect(JSON.stringify(result)).not.toContain("JSON");
  });
});

// ---------------------------------------------------------------------------
// Base fails SpecRootSchema
// ---------------------------------------------------------------------------

describe("genui.applyPanelEdit — base fails SpecRootSchema", () => {
  it("returns { ok:false }, never echoing the invalid base spec", async () => {
    const caller = makeCaller();
    const badBaseJson = JSON.stringify({ v: 1, root: { type: "unregistered-widget" } });
    const result = await caller.genui.applyPanelEdit({
      currentSpecJson: badBaseJson,
      params: {},
    });

    expect(result.ok).toBe(false);
    expect(result.spec).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("unregistered-widget");
  });
});

// ---------------------------------------------------------------------------
// Params that fail schema validation are rejected at the tRPC input gate —
// the SAME posture as every other procedure in this router (e.g.
// generate.test.ts's D-17-04 "unknown stylePackId is rejected ... (rejects
// .toThrow())"). PanelEditParamsSchema IS the procedure's own `.input()`
// params schema (panel-edit-schema.ts, Task 1) — a value that fails it never
// reaches the procedure body, so it never has a chance to reach the
// applyWhitelistedParams -> { ok:false } branch via the wire. That specific
// pure-function branch (a value that bypasses PanelEditParamsSchema but
// still breaks SpecRootSchema) is unit-tested directly in
// panel-edit-schema.test.ts against the exact function this procedure calls
// with zero additional logic in between.
// ---------------------------------------------------------------------------

describe("genui.applyPanelEdit — params that fail schema validation", () => {
  it("rejects an out-of-bound cols value (13) at the tRPC input gate", async () => {
    const caller = makeCaller();
    const gridSpecJson = JSON.stringify({
      v: 1,
      root: { type: "grid", cols: 3, gap: "md", children: [] },
    });

    await expect(
      caller.genui.applyPanelEdit({ currentSpecJson: gridSpecJson, params: { cols: 13 } }),
    ).rejects.toThrow();
  });

  it("rejects an unknown params key (.strict()) at the tRPC input gate", async () => {
    const caller = makeCaller();
    const invalidInput = {
      currentSpecJson: VALID_CARD_SPEC_JSON,
      params: { rawJson: "{}" },
    } as unknown as Parameters<typeof caller.genui.applyPanelEdit>[0];

    await expect(caller.genui.applyPanelEdit(invalidInput)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// A param valid for a DIFFERENT root type is ignored, never applied
// ---------------------------------------------------------------------------

describe("genui.applyPanelEdit — param not whitelisted for this root type", () => {
  it("ignores cols on a card root — { ok:true } with the base title/description unchanged", async () => {
    const caller = makeCaller();
    const result = await caller.genui.applyPanelEdit({
      currentSpecJson: VALID_CARD_SPEC_JSON,
      params: { cols: 6 },
    });

    expect(result.ok).toBe(true);
    expect(result.spec?.root).not.toHaveProperty("cols");
    expect(result.spec?.root).toMatchObject({ title: "Old title", description: "Old description" });
  });
});

// ---------------------------------------------------------------------------
// Session requirement
// ---------------------------------------------------------------------------

describe("genui.applyPanelEdit — session requirement", () => {
  it("rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = appRouter.createCaller({
      db: {} as never,
      headers: new Headers(),
      user: null,
    });

    await expect(
      caller.genui.applyPanelEdit({ currentSpecJson: VALID_CARD_SPEC_JSON, params: {} }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
