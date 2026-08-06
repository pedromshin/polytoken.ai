import type { Task } from "graphile-worker";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  callPython,
  fanOutMorningBoards,
  fanOutRecipeRecomputes,
  makeProjectionWriter,
  morningJobKey,
  parseRecipeSourceRef,
  projectSpreadsheetForPublish,
  recipeJobKey,
  recomputeCanvasRecipe,
  recomputeStampUtc,
  taskList,
  todayUtc,
  type ProjectionWriteArgs,
  type QueryFn,
} from "../tasks";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.API_KEY;
  delete process.env.LISTENER_INTERNAL_URL;
});

describe("callPython", () => {
  it("POSTs JSON to the internal route with the api-key header and resolves on 2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    process.env.API_KEY = "secret-key";
    process.env.LISTENER_INTERNAL_URL = "http://localhost:8000";

    await callPython("/v1/emails/ingest-job", { ses_message_id: "m1" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("http://localhost:8000/v1/emails/ingest-job");
    expect(opts.method).toBe("POST");
    expect(opts.headers["content-type"]).toBe("application/json");
    expect(opts.headers["x-api-key"]).toBe("secret-key");
    expect(JSON.parse(opts.body as string)).toEqual({ ses_message_id: "m1" });
  });

  it("throws on a non-2xx response so graphile-worker records a failed attempt", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "pipeline boom" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(callPython("/v1/emails/ingest-job", {})).rejects.toThrow(/500/);
  });
});

/** Invoke a taskList handler with a no-op helpers stub (handlers under test ignore helpers). */
function invokeTask(task: Task, payload: unknown): Promise<void> {
  return (task as (p: unknown, h: unknown) => Promise<void>)(payload, {} as never);
}

describe("assemble_morning_board handler (MORN-03 worker side)", () => {
  it("POSTs the { user_id } payload to /v1/home/assemble-job with the api-key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    process.env.API_KEY = "secret-key";
    process.env.LISTENER_INTERNAL_URL = "http://localhost:8000";

    await invokeTask(taskList.assemble_morning_board as Task, { user_id: "user-1" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("http://localhost:8000/v1/home/assemble-job");
    expect(opts.method).toBe("POST");
    expect(opts.headers["x-api-key"]).toBe("secret-key");
    expect(JSON.parse(opts.body as string)).toEqual({ user_id: "user-1" });
  });

  it("throws on a non-2xx response (no swallow) so graphile-worker retries → dead-letters", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => "assembly boom" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(invokeTask(taskList.assemble_morning_board as Task, { user_id: "u" })).rejects.toThrow(/502/);
  });
});

describe("fanOutMorningBoards (MORN-02)", () => {
  it("enqueues exactly one assemble_morning_board job per user with morning:<uid>:<day> keys", async () => {
    const calls: Array<{ identifier: string; payload: unknown; jobKey: string }> = [];
    const enqueue = async (identifier: string, payload: unknown, jobKey: string): Promise<void> => {
      calls.push({ identifier, payload, jobKey });
    };
    const now = new Date("2026-07-26T05:00:00.000Z");

    const n = await fanOutMorningBoards(["a", "b", "c"], enqueue, now);

    expect(n).toBe(3);
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.identifier === "assemble_morning_board")).toBe(true);
    expect(calls.map((c) => c.jobKey)).toEqual([
      "morning:a:2026-07-26",
      "morning:b:2026-07-26",
      "morning:c:2026-07-26",
    ]);
    expect(calls[0].payload).toEqual({ user_id: "a" });
  });

  it("N users → N jobs; empty user set → zero enqueues", async () => {
    const calls: unknown[] = [];
    const enqueue = async (): Promise<void> => {
      calls.push(1);
    };
    expect(await fanOutMorningBoards([], enqueue)).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("is idempotent per day: same-day re-run yields identical keys; next day differs", () => {
    const lateNight = new Date("2026-07-26T23:59:00.000Z");
    const nextMorning = new Date("2026-07-27T00:01:00.000Z");

    // Same day → identical key (graphile job_key REPLACES the pending job, never duplicates).
    expect(morningJobKey("a", todayUtc(lateNight))).toBe("morning:a:2026-07-26");
    expect(morningJobKey("a", todayUtc(lateNight))).toBe(morningJobKey("a", todayUtc(lateNight)));
    // Next UTC day → distinct key (a fresh board is enqueued).
    expect(morningJobKey("a", todayUtc(nextMorning))).toBe("morning:a:2026-07-27");
  });
});

// ---------------------------------------------------------------------------
// Phase 75 (75-04) — cascade_relabel worker leg
// ---------------------------------------------------------------------------

describe("cascade_relabel handler (75-04 worker side)", () => {
  it("is registered under the EXACT identifier the listener enqueues (cascade_correction.py _RELABEL_IDENTIFIER)", () => {
    expect(Object.keys(taskList)).toContain("cascade_relabel");
  });

  it("POSTs the cascade payload to /v1/emails/relabel-job with the api-key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    process.env.API_KEY = "secret-key";
    process.env.LISTENER_INTERNAL_URL = "http://localhost:8000";

    const payload = { survivor_id: "s-1", absorbed_id: "t-1", email_ids: ["e-1", "e-2"] };
    await invokeTask(taskList.cascade_relabel as Task, payload);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("http://localhost:8000/v1/emails/relabel-job");
    expect(opts.method).toBe("POST");
    expect(opts.headers["x-api-key"]).toBe("secret-key");
    expect(JSON.parse(opts.body as string)).toEqual(payload);
  });

  it("throws on a non-2xx response (no swallow) so graphile-worker retries → dead-letters", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => "relabel boom" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(invokeTask(taskList.cascade_relabel as Task, { survivor_id: "s" })).rejects.toThrow(/502/);
  });
});

// ---------------------------------------------------------------------------
// Phase 73 Wave C (LCAN-09) — durable recipe recompute
// ---------------------------------------------------------------------------

const RECIPE_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const CONVERSATION_ID = "33333333-3333-3333-3333-333333333333";
const SPREADSHEET_ID = "44444444-4444-4444-4444-444444444444";

const validSourceRef = {
  version: 1,
  reads: [{ kind: "spreadsheet", nodeId: "spreadsheet:rent", spreadsheetId: SPREADSHEET_ID }],
};

/** A sequenced QueryFn stub: shifts one canned response per call, records every call. */
function makeQueryStub(responses: Array<{ rows: Array<Record<string, unknown>> }>): {
  query: QueryFn;
  calls: Array<{ text: string; values: unknown[] | undefined }>;
} {
  const calls: Array<{ text: string; values: unknown[] | undefined }> = [];
  const query: QueryFn = async (text, values) => {
    calls.push({ text, values });
    return responses.shift() ?? { rows: [] };
  };
  return { query, calls };
}

describe("parseRecipeSourceRef (LCAN-09 descriptor boundary)", () => {
  it("parses a valid v1 spreadsheet descriptor", () => {
    const parsed = parseRecipeSourceRef(validSourceRef);
    expect(parsed).toEqual({
      version: 1,
      reads: [{ kind: "spreadsheet", nodeId: "spreadsheet:rent", spreadsheetId: SPREADSHEET_ID }],
    });
  });

  it.each([
    ["non-object", "nope"],
    ["missing version", { reads: [] }],
    ["wrong version", { version: 2, reads: [] }],
    ["reads not an array", { version: 1, reads: {} }],
    ["unknown read kind", { version: 1, reads: [{ kind: "webhook", nodeId: "n", spreadsheetId: SPREADSHEET_ID }] }],
    ["non-uuid spreadsheetId", { version: 1, reads: [{ kind: "spreadsheet", nodeId: "n", spreadsheetId: "abc" }] }],
    ["empty nodeId", { version: 1, reads: [{ kind: "spreadsheet", nodeId: "", spreadsheetId: SPREADSHEET_ID }] }],
    // A dotted nodeId would SPLIT the store path (`shared.published.{nodeId}` is walked
    // dotted-segment-wise by resolveCanvasPath) — fail closed.
    ["dotted nodeId", { version: 1, reads: [{ kind: "spreadsheet", nodeId: "a.b", spreadsheetId: SPREADSHEET_ID }] }],
    // Forbidden-key guard (mirrors the sharedState pollution guard the UI save re-validates).
    ["__proto__ nodeId", { version: 1, reads: [{ kind: "spreadsheet", nodeId: "__proto__", spreadsheetId: SPREADSHEET_ID }] }],
  ])("throws (fail-closed) on %s", (_label, bad) => {
    expect(() => parseRecipeSourceRef(bad)).toThrow(/source_ref/);
  });
});

describe("projectSpreadsheetForPublish — parity with the UI publish projection", () => {
  it("mirrors the UI shape { label, columns, rowCount, sample } with an 8-row sample cap", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, data: { month: `m${i}`, amount: i } }));
    const projection = projectSpreadsheetForPublish({
      title: "Rent 2026",
      columns: [
        { name: "month", type: "text", required: true },
        { name: "amount", type: "number" },
      ],
      rows,
    });

    expect(projection).toMatchObject({
      label: "Rent 2026",
      columns: [
        { name: "month", type: "text" },
        { name: "amount", type: "number" },
      ],
      rowCount: 12,
    });
    expect((projection as { sample: unknown[] }).sample).toHaveLength(8);
    expect((projection as { sample: Array<Record<string, unknown>> }).sample[0]).toEqual({ month: "m0", amount: 0 });
  });

  it("tolerates malformed jsonb defensively: junk columns dropped, non-array rows → empty", () => {
    const projection = projectSpreadsheetForPublish({
      title: 42, // not a string → fallback label
      columns: [null, "junk", { name: "ok", type: "text" }],
      rows: "not-an-array",
    });
    expect(projection).toMatchObject({
      label: "Untitled table",
      columns: [{ name: "ok", type: "text" }],
      rowCount: 0,
      sample: [],
    });
  });
});

describe("fanOutRecipeRecomputes (LCAN-09 dispatcher fan-out)", () => {
  it("enqueues one recompute_canvas_recipe job per recipe with recipe:<id>:<stamp> keys", async () => {
    const calls: Array<{ identifier: string; payload: unknown; jobKey: string }> = [];
    const enqueue = async (identifier: string, payload: unknown, jobKey: string): Promise<void> => {
      calls.push({ identifier, payload, jobKey });
    };
    const now = new Date("2026-08-06T05:00:30.000Z");

    const n = await fanOutRecipeRecomputes(["r1", "r2"], enqueue, now);

    expect(n).toBe(2);
    expect(calls.every((c) => c.identifier === "recompute_canvas_recipe")).toBe(true);
    expect(calls.map((c) => c.jobKey)).toEqual([
      "recipe:r1:2026-08-06T05:00",
      "recipe:r2:2026-08-06T05:00",
    ]);
    expect(calls[0].payload).toEqual({ recipe_id: "r1" });
  });

  it("empty recipe set → zero enqueues; same-minute re-run yields identical keys", async () => {
    expect(await fanOutRecipeRecomputes([], async () => undefined)).toBe(0);
    const withinMinute = new Date("2026-08-06T05:00:59.000Z");
    expect(recipeJobKey("r1", recomputeStampUtc(withinMinute))).toBe("recipe:r1:2026-08-06T05:00");
    const nextMinute = new Date("2026-08-06T05:01:00.000Z");
    expect(recipeJobKey("r1", recomputeStampUtc(nextMinute))).toBe("recipe:r1:2026-08-06T05:01");
  });
});

describe("dispatch_recipe_recomputes task (LCAN-09 cron dispatcher)", () => {
  it("enumerates source-bearing recipes and enqueues each through the guarded public.enqueue_job wrapper", async () => {
    const { query, calls } = makeQueryStub([{ rows: [{ id: "r1" }, { id: "r2" }] }, { rows: [] }, { rows: [] }]);
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    await (taskList.dispatch_recipe_recomputes as (p: unknown, h: unknown) => Promise<void>)(
      {},
      { query, logger },
    );

    expect(calls[0].text).toContain("source_ref IS NOT NULL");
    expect(calls).toHaveLength(3);
    expect(calls[1].text).toContain("public.enqueue_job");
    expect(calls[1].values?.[0]).toBe("recompute_canvas_recipe");
    expect(JSON.parse(calls[1].values?.[1] as string)).toEqual({ recipe_id: "r1" });
    expect(calls[1].values?.[2]).toMatch(/^recipe:r1:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(calls[2].values?.[2]).toMatch(/^recipe:r2:/);
  });
});

describe("recomputeCanvasRecipe (LCAN-09 per-recipe job)", () => {
  const recipeRow = {
    id: RECIPE_ID,
    user_id: USER_ID,
    conversation_id: CONVERSATION_ID,
    source_ref: validSourceRef,
  };
  const sheetRow = {
    title: "Rent",
    columns: [{ name: "month", type: "text" }],
    rows: [{ id: "r0", data: { month: "jan" } }],
  };

  it("re-polls the sheet (tenancy-scoped) and writes the bounded projection to the published slot", async () => {
    const { query, calls } = makeQueryStub([{ rows: [recipeRow] }, { rows: [sheetRow] }]);
    const writes: ProjectionWriteArgs[] = [];
    const written = await recomputeCanvasRecipe(RECIPE_ID, {
      query,
      writeProjection: async (args) => {
        writes.push(args);
        return true;
      },
      log: () => undefined,
    });

    expect(written).toBe(1);
    // The sheet re-poll re-asserts ownership in SQL: id AND user_id.
    expect(calls[1].values).toEqual([SPREADSHEET_ID, USER_ID]);
    expect(writes).toHaveLength(1);
    expect(writes[0].conversationId).toBe(CONVERSATION_ID);
    expect(writes[0].nodeId).toBe("spreadsheet:rent");
    expect(writes[0].projection).toMatchObject({ label: "Rent", rowCount: 1 });
  });

  it("recipe deleted since dispatch → clean no-op (0 writes, no throw)", async () => {
    const { query } = makeQueryStub([{ rows: [] }]);
    const written = await recomputeCanvasRecipe(RECIPE_ID, {
      query,
      writeProjection: async () => true,
      log: () => undefined,
    });
    expect(written).toBe(0);
  });

  it("null source_ref → clean no-op (nothing to re-poll)", async () => {
    const { query } = makeQueryStub([{ rows: [{ ...recipeRow, source_ref: null }] }]);
    const written = await recomputeCanvasRecipe(RECIPE_ID, {
      query,
      writeProjection: async () => true,
      log: () => undefined,
    });
    expect(written).toBe(0);
  });

  it("malformed source_ref → throws (fail loud → retry → dead-letter surfaces it)", async () => {
    const { query } = makeQueryStub([{ rows: [{ ...recipeRow, source_ref: { version: 99 } }] }]);
    await expect(
      recomputeCanvasRecipe(RECIPE_ID, { query, writeProjection: async () => true, log: () => undefined }),
    ).rejects.toThrow(/source_ref/);
  });

  it("source spreadsheet missing / not owned → throws (never silently 200s)", async () => {
    const { query } = makeQueryStub([{ rows: [recipeRow] }, { rows: [] }]);
    await expect(
      recomputeCanvasRecipe(RECIPE_ID, { query, writeProjection: async () => true, log: () => undefined }),
    ).rejects.toThrow(/spreadsheet/);
  });

  it("projection write refused (no layout row / size cap) → throws", async () => {
    const { query } = makeQueryStub([{ rows: [recipeRow] }, { rows: [sheetRow] }]);
    await expect(
      recomputeCanvasRecipe(RECIPE_ID, { query, writeProjection: async () => false, log: () => undefined }),
    ).rejects.toThrow(/projection/);
  });
});

describe("makeProjectionWriter — the LWW-safe single-key jsonb_set write", () => {
  it("issues ONE atomic UPDATE (jsonb_set, size-capped) scoped by conversation_id, true when a row landed", async () => {
    const { query, calls } = makeQueryStub([{ rows: [{ id: "layout-1" }] }]);
    const write = makeProjectionWriter(query);

    const ok = await write({
      conversationId: CONVERSATION_ID,
      nodeId: "spreadsheet:rent",
      projection: { label: "Rent", rowCount: 1 },
    });

    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("jsonb_set");
    expect(calls[0].text).toContain("chat_canvas_layouts");
    // Never a whole-blob write: the patch targets exactly shared.published.<nodeId>.
    expect(calls[0].text).toContain("'shared', 'published'");
    expect(calls[0].values).toEqual([
      CONVERSATION_ID,
      "spreadsheet:rent",
      JSON.stringify({ label: "Rent", rowCount: 1 }),
    ]);
  });

  it("returns false when no row was updated (missing layout row or size cap tripped)", async () => {
    const { query } = makeQueryStub([{ rows: [] }]);
    const write = makeProjectionWriter(query);
    expect(await write({ conversationId: CONVERSATION_ID, nodeId: "n", projection: {} })).toBe(false);
  });
});

describe("recompute_canvas_recipe task payload boundary", () => {
  it("throws on a malformed payload (missing/non-uuid recipe_id)", async () => {
    const { query } = makeQueryStub([]);
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    await expect(
      (taskList.recompute_canvas_recipe as (p: unknown, h: unknown) => Promise<void>)(
        { recipe_id: "not-a-uuid" },
        { query, logger },
      ),
    ).rejects.toThrow(/recipe_id/);
  });
});
