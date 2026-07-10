/**
 * history.test.ts — vitest unit tests for genui.historyList and genui.historyById tRPC procedures.
 *
 * Phase 16-03, STDO-05/STDO-06 (TDD RED):
 *
 * Security contracts:
 *   D-17: tRPC re-validates FastAPI output with HistoryRowSchema / HistoryDetailSchema
 *     at the web boundary — never trusts FastAPI output blindly.
 *   D-15: Network/non-2xx errors from FastAPI → return empty list [] (historyList) or null
 *     (historyById) — never throw to the caller.
 *   T-06-07 / T-07-01: EMAIL_LISTENER_API_KEY is read server-side via getListenerConfig()
 *     at call time — never at module init, never NEXT_PUBLIC_.
 *   T-13-19: Non-2xx response bodies are logged server-side only; friendly/empty response
 *     is returned to the caller — no internal error detail is leaked.
 *
 * Phase 44 (TENA-03, closes backlog 999.1):
 *   Both procedures require a session (protectedProcedure). `@polytoken/db/ownership`'s
 *   `userOwnedImporterIds` is mocked at the module boundary (its own correctness is
 *   covered by packages/db/src/ownership.test.ts, 44-02) — these tests prove the
 *   WIRING: historyList NEVER forwards importer_id omitted (it fans out one FastAPI
 *   call per owned importer and merges); historyById re-checks the returned row's
 *   ui_spec_templates.importer_id (via a direct Drizzle lookup, mocked through
 *   `ctx.db.select`) against the caller's owned set — NOT_FOUND for a foreign or
 *   NULL importer.
 *
 * Test strategy: stub globalThis.fetch per test, set env vars in beforeEach, call via appRouter caller.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@polytoken/db/ownership", async () => {
  const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
    "@polytoken/db/ownership",
  );
  return {
    ...actual,
    userOwnedImporterIds: vi.fn(),
  };
});

import { userOwnedImporterIds } from "@polytoken/db/ownership";

import { appRouter } from "../../../root";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock Response with arbitrary JSON body and status. */
function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const USER_A = { id: "10000000-0000-0000-0000-00000000000a" };
const IMPORTER_A = "30000000-0000-0000-0000-000000000a01";
const IMPORTER_B = "30000000-0000-0000-0000-000000000b02";

type FakeRow = Record<string, unknown>;

function createFakeChain(rows: ReadonlyArray<FakeRow>) {
  const chain = {
    from() {
      return chain;
    },
    where() {
      return chain;
    },
    limit() {
      return Promise.resolve(rows);
    },
  };
  return chain;
}

/**
 * Create a tRPC caller with a stub ctx. `dbRows` seeds the fake
 * `ctx.db.select` chain used by historyById's Phase 44 ownership lookup
 * (irrelevant for historyList, which only calls the mocked
 * `userOwnedImporterIds`).
 */
function makeCaller(
  user: { id: string } | null = USER_A,
  dbRows: ReadonlyArray<FakeRow> = [],
) {
  const db = { select: () => createFakeChain(dbRows) };
  return appRouter.createCaller({
    db: db as never,
    headers: new Headers(),
    user,
  });
}

// Default: the caller owns exactly IMPORTER_A. Individual tests override via
// mockResolvedValueOnce for the non-owned / owner-less / multi-importer cases.
beforeEach(() => {
  vi.mocked(userOwnedImporterIds).mockResolvedValue([IMPORTER_A]);
});

afterEach(() => {
  vi.mocked(userOwnedImporterIds).mockReset();
});

// ---------------------------------------------------------------------------
// Session requirement (T-44-07-04)
// ---------------------------------------------------------------------------

describe("genui history — session requirement (T-44-07-04)", () => {
  it("Test S1: historyList rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(caller.genui.historyList({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("Test S2: historyById rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = makeCaller(null);
    await expect(
      caller.genui.historyById({ id: "some-id" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ---------------------------------------------------------------------------
// Sample data — matching ApiResponse envelope from FastAPI
// ---------------------------------------------------------------------------

const SAMPLE_ID = "22222222-2222-2222-2222-222222222222";
const SAMPLE_SPEC_JSON = { v: 1, root: { type: "card", title: "Invoice" } };

/** Valid ApiResponse envelope for history list endpoint */
const VALID_LIST_ENVELOPE = {
  success: true,
  data: [
    {
      id: SAMPLE_ID,
      intent_text: "show invoice details",
      created_at: "2026-06-01T12:00:00+00:00",
      registry_version: "abc123",
      use_count: 3,
      validation_status: "validated",
    },
  ],
  error: null,
};

/** Valid ApiResponse envelope for history detail endpoint */
const VALID_DETAIL_ENVELOPE = {
  success: true,
  data: {
    id: SAMPLE_ID,
    intent_text: "show invoice details",
    created_at: "2026-06-01T12:00:00+00:00",
    registry_version: "abc123",
    use_count: 3,
    validation_status: "validated",
    spec_json: SAMPLE_SPEC_JSON,
  },
  error: null,
};

/** FastAPI 404 response */
const NOT_FOUND_RESPONSE = {
  detail: "Template not found",
};

// ---------------------------------------------------------------------------
// Test env constants
// ---------------------------------------------------------------------------

const URL_BASE = "http://listener.test";
const API_KEY = "test-api-key-123";

// ---------------------------------------------------------------------------
// genui.historyList tests (STDO-05)
// ---------------------------------------------------------------------------

describe("genui.historyList — happy path", () => {
  beforeEach(() => {
    process.env.EMAIL_LISTENER_URL = URL_BASE;
    process.env.EMAIL_LISTENER_API_KEY = API_KEY;
  });

  afterEach(() => {
    delete process.env.EMAIL_LISTENER_URL;
    delete process.env.EMAIL_LISTENER_API_KEY;
    vi.restoreAllMocks();
  });

  it("Test 1: returns parsed list when FastAPI returns valid ApiResponse envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(VALID_LIST_ENVELOPE)));

    const caller = makeCaller();
    const result = await caller.genui.historyList({});

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: SAMPLE_ID,
      intentText: "show invoice details",
      useCount: 3,
      validationStatus: "validated",
    });
    // D-14: list items must NOT include spec_json
    expect(result[0]).not.toHaveProperty("specJson");
  });

  it("Test 2: issues GET to /v1/genui/history with X-API-Key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(VALID_LIST_ENVELOPE));
    vi.stubGlobal("fetch", fetchMock);

    const caller = makeCaller();
    await caller.genui.historyList({});

    expect(fetchMock).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain("/v1/genui/history");
    expect(calledInit.method).toBe("GET");
    expect((calledInit.headers as Record<string, string>)["X-API-Key"]).toBe(API_KEY);
  });

  it("Test 3: forwards limit and offset as query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ success: true, data: [], error: null }));
    vi.stubGlobal("fetch", fetchMock);

    const caller = makeCaller();
    await caller.genui.historyList({ limit: 5, offset: 10 });

    const [calledUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain("limit=5");
    expect(calledUrl).toContain("offset=10");
  });

  it("Test 4 (Phase 44): forwards the caller's OWNED importer_id — not an arbitrary client-passed one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ success: true, data: [], error: null }));
    vi.stubGlobal("fetch", fetchMock);

    const caller = makeCaller();
    await caller.genui.historyList({ importerId: IMPORTER_A });

    const [calledUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain(`importer_id=${IMPORTER_A}`);
  });

  it("Test 4b (Phase 44): a non-owned importerId filter is rejected — empty list, zero fetch calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const caller = makeCaller();
    const result = await caller.genui.historyList({ importerId: IMPORTER_B });

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Test 4c (Phase 44): an owner-less caller gets an empty list, zero fetch calls", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValueOnce([]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const caller = makeCaller();
    const result = await caller.genui.historyList({});

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Test 4d (Phase 44): no importerId filter fans out to EVERY owned importer and merges, sorted by createdAt desc", async () => {
    vi.mocked(userOwnedImporterIds).mockResolvedValueOnce([IMPORTER_A, IMPORTER_B]);
    const rowFor = (id: string, importerId: string, createdAt: string) => ({
      id,
      intent_text: `from ${importerId}`,
      created_at: createdAt,
      registry_version: "v1",
      use_count: 1,
      validation_status: "validated",
    });

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes(`importer_id=${IMPORTER_A}`)) {
        return Promise.resolve(
          mockResponse({
            success: true,
            data: [rowFor("row-a", IMPORTER_A, "2026-06-01T10:00:00+00:00")],
            error: null,
          }),
        );
      }
      if (url.includes(`importer_id=${IMPORTER_B}`)) {
        return Promise.resolve(
          mockResponse({
            success: true,
            data: [rowFor("row-b", IMPORTER_B, "2026-06-02T10:00:00+00:00")],
            error: null,
          }),
        );
      }
      return Promise.resolve(mockResponse({ success: true, data: [], error: null }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const caller = makeCaller();
    const result = await caller.genui.historyList({});

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // row-b is newer (2026-06-02) — sorted first.
    expect(result.map((r) => r.id)).toEqual(["row-b", "row-a"]);
  });

  it("Test 5: returns empty array when FastAPI returns empty list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse({ success: true, data: [], error: null })));

    const caller = makeCaller();
    const result = await caller.genui.historyList({});

    expect(result).toEqual([]);
  });
});

describe("genui.historyList — error handling (D-15, T-13-19)", () => {
  beforeEach(() => {
    process.env.EMAIL_LISTENER_URL = URL_BASE;
    process.env.EMAIL_LISTENER_API_KEY = API_KEY;
  });

  afterEach(() => {
    delete process.env.EMAIL_LISTENER_URL;
    delete process.env.EMAIL_LISTENER_API_KEY;
    vi.restoreAllMocks();
  });

  it("Test 6: non-2xx FastAPI response → returns [] (D-15 best-effort, no throw)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse({ detail: "server error" }, 500)));

    const caller = makeCaller();
    const result = await caller.genui.historyList({});

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it("Test 7: network error → returns [] (D-15 best-effort, no throw)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network failure")));

    const caller = makeCaller();
    const result = await caller.genui.historyList({});

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});

describe("genui.historyList — env guard", () => {
  it("Test 8: throws when EMAIL_LISTENER_URL is missing", async () => {
    delete process.env.EMAIL_LISTENER_URL;
    delete process.env.EMAIL_LISTENER_API_KEY;

    const caller = makeCaller();
    await expect(caller.genui.historyList({})).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// genui.historyById tests (STDO-06)
// ---------------------------------------------------------------------------

describe("genui.historyById — happy path", () => {
  beforeEach(() => {
    process.env.EMAIL_LISTENER_URL = URL_BASE;
    process.env.EMAIL_LISTENER_API_KEY = API_KEY;
  });

  afterEach(() => {
    delete process.env.EMAIL_LISTENER_URL;
    delete process.env.EMAIL_LISTENER_API_KEY;
    vi.restoreAllMocks();
  });

  it("Test 9: returns parsed detail with specJson when FastAPI returns valid envelope and the row is owned", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(VALID_DETAIL_ENVELOPE)));

    const caller = makeCaller(USER_A, [{ importerId: IMPORTER_A }]);
    const result = await caller.genui.historyById({ id: SAMPLE_ID });

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      id: SAMPLE_ID,
      intentText: "show invoice details",
      useCount: 3,
      validationStatus: "validated",
    });
    // D-14: detail includes specJson
    expect(result).toHaveProperty("specJson");
    expect(result!.specJson).toEqual(SAMPLE_SPEC_JSON);
  });

  it("Test 10: issues GET to /v1/genui/history/{id} with X-API-Key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(VALID_DETAIL_ENVELOPE));
    vi.stubGlobal("fetch", fetchMock);

    const caller = makeCaller(USER_A, [{ importerId: IMPORTER_A }]);
    await caller.genui.historyById({ id: SAMPLE_ID });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain(`/v1/genui/history/${SAMPLE_ID}`);
    expect(calledInit.method).toBe("GET");
    expect((calledInit.headers as Record<string, string>)["X-API-Key"]).toBe(API_KEY);
  });

  it("Test 11: returns null when FastAPI returns 404 (D-15 best-effort)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(NOT_FOUND_RESPONSE, 404)));

    const caller = makeCaller();
    const result = await caller.genui.historyById({ id: SAMPLE_ID });

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 44 — historyById ownership gate (T-44-07-02)
// ---------------------------------------------------------------------------

describe("genui.historyById — Phase 44 ownership gate (T-44-07-02)", () => {
  beforeEach(() => {
    process.env.EMAIL_LISTENER_URL = URL_BASE;
    process.env.EMAIL_LISTENER_API_KEY = API_KEY;
  });

  afterEach(() => {
    delete process.env.EMAIL_LISTENER_URL;
    delete process.env.EMAIL_LISTENER_API_KEY;
    vi.restoreAllMocks();
  });

  it("Test 12: NOT_FOUND when the row's importer belongs to another user", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(VALID_DETAIL_ENVELOPE)));

    const caller = makeCaller(USER_A, [{ importerId: IMPORTER_B }]);
    await expect(
      caller.genui.historyById({ id: SAMPLE_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("Test 13: NOT_FOUND when the row has a NULL importer_id (system-level, not user-browsable)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(VALID_DETAIL_ENVELOPE)));

    const caller = makeCaller(USER_A, [{ importerId: null }]);
    await expect(
      caller.genui.historyById({ id: SAMPLE_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("genui.historyById — error handling (D-15, T-13-19)", () => {
  beforeEach(() => {
    process.env.EMAIL_LISTENER_URL = URL_BASE;
    process.env.EMAIL_LISTENER_API_KEY = API_KEY;
  });

  afterEach(() => {
    delete process.env.EMAIL_LISTENER_URL;
    delete process.env.EMAIL_LISTENER_API_KEY;
    vi.restoreAllMocks();
  });

  it("Test 14: non-2xx (non-404) FastAPI response → returns null (D-15 best-effort)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse({ detail: "server error" }, 500)));

    const caller = makeCaller();
    const result = await caller.genui.historyById({ id: SAMPLE_ID });

    expect(result).toBeNull();
  });

  it("Test 15: network error → returns null (D-15 best-effort, no throw)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network failure")));

    const caller = makeCaller();
    const result = await caller.genui.historyById({ id: SAMPLE_ID });

    expect(result).toBeNull();
  });
});

describe("genui.historyById — env guard", () => {
  it("Test 16: throws when EMAIL_LISTENER_URL is missing", async () => {
    delete process.env.EMAIL_LISTENER_URL;
    delete process.env.EMAIL_LISTENER_API_KEY;

    const caller = makeCaller();
    await expect(caller.genui.historyById({ id: SAMPLE_ID })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// CR-03 regression: parse-failure path returns SAFE_FALLBACK_SPEC (D-17)
// ---------------------------------------------------------------------------

describe("genui.historyById — CR-03 regression: parse failure → SAFE_FALLBACK_SPEC (D-17)", () => {
  beforeEach(() => {
    process.env.EMAIL_LISTENER_URL = URL_BASE;
    process.env.EMAIL_LISTENER_API_KEY = API_KEY;
  });

  afterEach(() => {
    delete process.env.EMAIL_LISTENER_URL;
    delete process.env.EMAIL_LISTENER_API_KEY;
    vi.restoreAllMocks();
  });

  it("Test 17 (CR-03): schema parse failure → returns non-null detail with specJson === SAFE_FALLBACK_SPEC", async () => {
    // FastAPI returns a valid 2xx envelope, but the detail row is malformed
    // (missing required fields like registry_version, spec_json).
    const malformedDetailEnvelope = {
      success: true,
      data: {
        id: SAMPLE_ID,
        intent_text: "show invoice details",
        created_at: "2026-06-01T12:00:00+00:00",
        // MISSING: registry_version, use_count, validation_status, spec_json
        // This causes FastApiHistoryDetailSchema.safeParse to fail.
        broken_extra_field: true,
      },
      error: null,
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(malformedDetailEnvelope)));

    const caller = makeCaller(USER_A, [{ importerId: IMPORTER_A }]);
    const result = await caller.genui.historyById({ id: SAMPLE_ID });

    // D-17 contract: must NOT be null — must degrade to SAFE_FALLBACK_SPEC
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("specJson");
    // SAFE_FALLBACK_SPEC is { v: 1, root: { type: "alert", title: "..." } }
    const specJson = result!.specJson as Record<string, unknown>;
    expect(specJson["v"]).toBe(1);
    const root = specJson["root"] as Record<string, unknown>;
    expect(root["type"]).toBe("alert");
  });

  it("Test 18 (CR-03): valid spec_json in malformed envelope still degrades via SAFE_FALLBACK_SPEC (missing use_count)", async () => {
    // A detail response where spec_json is valid but envelope fields are wrong
    const badEnvelope = {
      success: true,
      data: {
        id: SAMPLE_ID,
        intent_text: "show invoice details",
        created_at: "2026-06-01T12:00:00+00:00",
        registry_version: "abc123",
        // MISSING: use_count (number required)
        validation_status: "validated",
        spec_json: { v: 1, root: { type: "text", value: "Hello" } },
      },
      error: null,
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(badEnvelope)));

    const caller = makeCaller(USER_A, [{ importerId: IMPORTER_A }]);
    const result = await caller.genui.historyById({ id: SAMPLE_ID });

    expect(result).not.toBeNull();
    expect(result).toHaveProperty("specJson");
    const specJson = result!.specJson as Record<string, unknown>;
    expect(specJson["v"]).toBe(1);
    const root = specJson["root"] as Record<string, unknown>;
    expect(root["type"]).toBe("alert");
  });
});

// ---------------------------------------------------------------------------
// WR-01 regression: network/5xx errors must surface as isError (not null)
// ---------------------------------------------------------------------------

describe("genui.historyById — WR-01 regression: non-2xx errors return null (procedure-level contract)", () => {
  /**
   * WR-01 context: At the tRPC procedure level, D-15 says non-2xx → null.
   * The UI layer (history-island.tsx) must distinguish this null from a
   * genuine parse-failure (now SAFE_FALLBACK_SPEC) via isError handling.
   *
   * This test suite documents that 5xx → null at the procedure level.
   * The UI-level isError distinction (WR-01) is enforced by history-island.tsx.
   * If the procedure throws instead of returning null, the tRPC client sets
   * isError=true automatically.
   */
  beforeEach(() => {
    process.env.EMAIL_LISTENER_URL = URL_BASE;
    process.env.EMAIL_LISTENER_API_KEY = API_KEY;
  });

  afterEach(() => {
    delete process.env.EMAIL_LISTENER_URL;
    delete process.env.EMAIL_LISTENER_API_KEY;
    vi.restoreAllMocks();
  });

  it("Test 19 (WR-01): 5xx response → returns null without throwing (D-15 best-effort, UI handles isError)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse({ detail: "Internal Server Error" }, 500)));

    const caller = makeCaller();
    // Procedure itself must not throw — isError is set on the tRPC client side
    const result = await caller.genui.historyById({ id: SAMPLE_ID });

    expect(result).toBeNull();
  });

  it("Test 20 (WR-01): network failure → returns null without throwing (D-15 best-effort)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const caller = makeCaller();
    const result = await caller.genui.historyById({ id: SAMPLE_ID });

    // Network errors are caught and null is returned — isError is set client-side
    expect(result).toBeNull();
  });
});
