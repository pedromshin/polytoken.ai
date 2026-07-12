/**
 * retheme.test.ts — vitest unit tests for the genui.resolveRetheme tRPC procedure.
 *
 * Security contract (GEN-03/D-08, T-52-05-01/02):
 *   - A well-formed FastAPI response is re-validated with
 *     RethemeResolutionSchema.safeParse and returned as
 *     { ok:true, stylePackId, tokenOverrides }.
 *   - An unknown style_pack_id, a disallowed token_overrides key, or a
 *     malformed value (HSL / radius) is rejected at the web boundary,
 *     regardless of what FastAPI's own `outcome` field claims -> { ok:false }.
 *   - A non-2xx / network / parse error returns a friendly
 *     { ok:false, reason } with no leaked raw error text.
 *
 * Test strategy: stub globalThis.fetch, set env vars per-test, call via
 * appRouter caller (mirrors generate.test.ts's harness).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appRouter } from "../../../root";

/** Build a mock Response with arbitrary JSON body and status. */
function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

// genui.resolveRetheme is protectedProcedure (auth-gate only, mirrors
// generate.ts/code-island.ts) — a valid session user is required.
const TEST_USER = { id: "10000000-0000-0000-0000-00000000000a" };

function makeCaller() {
  return appRouter.createCaller({
    db: {} as never,
    headers: new Headers(),
    user: TEST_USER,
  });
}

const URL = "http://listener.test";
const API_KEY = "test-api-key-123";

const VALID_ENVELOPE = {
  success: true,
  data: {
    style_pack_id: "linear-clean",
    token_overrides: { primary: "220 14% 10%" },
    outcome: "ok",
  },
  error: null,
};

// ---------------------------------------------------------------------------
// Well-formed FastAPI response
// ---------------------------------------------------------------------------

describe("genui.resolveRetheme — well-formed response", () => {
  beforeEach(() => {
    process.env.EMAIL_LISTENER_URL = URL;
    process.env.EMAIL_LISTENER_API_KEY = API_KEY;
  });

  afterEach(() => {
    delete process.env.EMAIL_LISTENER_URL;
    delete process.env.EMAIL_LISTENER_API_KEY;
    vi.restoreAllMocks();
  });

  it("returns ok:true with stylePackId + tokenOverrides for a valid FastAPI envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(VALID_ENVELOPE)));

    const caller = makeCaller();
    const result = await caller.genui.resolveRetheme({ instruction: "make it cleaner" });

    expect(result).toEqual({
      ok: true,
      stylePackId: "linear-clean",
      tokenOverrides: { primary: "220 14% 10%" },
    });
  });

  it("issues POST to /v1/genui/retheme with X-API-Key header and the expected body shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(VALID_ENVELOPE));
    vi.stubGlobal("fetch", fetchMock);

    const caller = makeCaller();
    await caller.genui.resolveRetheme({ instruction: "cleaner", currentStylePackId: "polytoken-teal" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${URL}/v1/genui/retheme`);
    expect(calledInit.method).toBe("POST");
    expect((calledInit.headers as Record<string, string>)["X-API-Key"]).toBe(API_KEY);
    expect((calledInit.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    const sentBody = JSON.parse(calledInit.body as string) as Record<string, unknown>;
    expect(sentBody).toEqual({ instruction: "cleaner", current_style_pack_id: "polytoken-teal" });
  });

  it("sends current_style_pack_id: null when currentStylePackId is omitted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(VALID_ENVELOPE));
    vi.stubGlobal("fetch", fetchMock);

    const caller = makeCaller();
    await caller.genui.resolveRetheme({ instruction: "cleaner" });

    const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(calledInit.body as string) as Record<string, unknown>;
    expect(sentBody).toHaveProperty("current_style_pack_id", null);
  });

  it("accepts an empty token_overrides object (pack swap only, no nudges)", async () => {
    const envelope = {
      success: true,
      data: { style_pack_id: "brutalist", token_overrides: {}, outcome: "ok" },
      error: null,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(envelope)));

    const caller = makeCaller();
    const result = await caller.genui.resolveRetheme({ instruction: "bolder" });

    expect(result).toEqual({ ok: true, stylePackId: "brutalist", tokenOverrides: {} });
  });

  it("accepts a valid radius override alongside a valid color override", async () => {
    const envelope = {
      success: true,
      data: {
        style_pack_id: "playful-rounded",
        token_overrides: { radius: "1.5rem", accent: "320 85% 60%" },
        outcome: "ok",
      },
      error: null,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(envelope)));

    const caller = makeCaller();
    const result = await caller.genui.resolveRetheme({ instruction: "rounder and pinker" });

    expect(result).toEqual({
      ok: true,
      stylePackId: "playful-rounded",
      tokenOverrides: { radius: "1.5rem", accent: "320 85% 60%" },
    });
  });
});

// ---------------------------------------------------------------------------
// Web-boundary rejection (GEN-03/D-08, T-52-05-01/02)
// ---------------------------------------------------------------------------

describe("genui.resolveRetheme — web-boundary rejection (GEN-03/D-08, T-52-05-01/02)", () => {
  beforeEach(() => {
    process.env.EMAIL_LISTENER_URL = URL;
    process.env.EMAIL_LISTENER_API_KEY = API_KEY;
  });

  afterEach(() => {
    delete process.env.EMAIL_LISTENER_URL;
    delete process.env.EMAIL_LISTENER_API_KEY;
    vi.restoreAllMocks();
  });

  it("rejects an unknown style_pack_id -> ok:false, no leaked raw value", async () => {
    const envelope = {
      success: true,
      data: { style_pack_id: "hallucinated-pack", token_overrides: {}, outcome: "ok" },
      error: null,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(envelope)));

    const caller = makeCaller();
    const result = await caller.genui.resolveRetheme({ instruction: "x" });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("hallucinated-pack");
  });

  it("rejects a disallowed token_overrides key -> ok:false, no leaked key/value", async () => {
    const envelope = {
      success: true,
      data: {
        style_pack_id: "linear-clean",
        token_overrides: { "background-image": "url(evil)" },
        outcome: "ok",
      },
      error: null,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(envelope)));

    const caller = makeCaller();
    const result = await caller.genui.resolveRetheme({ instruction: "x" });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("background-image");
    expect(JSON.stringify(result)).not.toContain("evil");
  });

  it("rejects a malformed HSL value (hex code, not a channel triplet) -> ok:false", async () => {
    const envelope = {
      success: true,
      data: {
        style_pack_id: "linear-clean",
        token_overrides: { primary: "#ff0000" },
        outcome: "ok",
      },
      error: null,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(envelope)));

    const caller = makeCaller();
    const result = await caller.genui.resolveRetheme({ instruction: "x" });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("#ff0000");
  });

  it("rejects a malformed radius value (not a rem/px string) -> ok:false", async () => {
    const envelope = {
      success: true,
      data: {
        style_pack_id: "linear-clean",
        token_overrides: { radius: "huge" },
        outcome: "ok",
      },
      error: null,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(envelope)));

    const caller = makeCaller();
    const result = await caller.genui.resolveRetheme({ instruction: "x" });

    expect(result.ok).toBe(false);
  });

  it("rejects a malformed spacing-density value (missing rem unit) -> ok:false", async () => {
    const envelope = {
      success: true,
      data: {
        style_pack_id: "linear-clean",
        token_overrides: { "spacing-density": "16px" },
        outcome: "ok",
      },
      error: null,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(envelope)));

    const caller = makeCaller();
    const result = await caller.genui.resolveRetheme({ instruction: "x" });

    expect(result.ok).toBe(false);
  });

  it("outcome='ok' from FastAPI does not override a web-boundary schema failure", async () => {
    // Mirrors generate.test.ts's D-05.4 — safeParse is authoritative regardless
    // of what FastAPI's own outcome field claims.
    const envelope = {
      success: true,
      data: { style_pack_id: "not-a-real-pack", token_overrides: {}, outcome: "ok" },
      error: null,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(envelope)));

    const caller = makeCaller();
    const result = await caller.genui.resolveRetheme({ instruction: "x" });

    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Transport errors (no leaked detail)
// ---------------------------------------------------------------------------

describe("genui.resolveRetheme — transport errors (no leaked detail)", () => {
  beforeEach(() => {
    process.env.EMAIL_LISTENER_URL = URL;
    process.env.EMAIL_LISTENER_API_KEY = API_KEY;
  });

  afterEach(() => {
    delete process.env.EMAIL_LISTENER_URL;
    delete process.env.EMAIL_LISTENER_API_KEY;
    vi.restoreAllMocks();
  });

  it("non-2xx FastAPI response -> friendly ok:false with no leaked detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse({ detail: "Internal Bedrock error: secret-key=xyz" }, 500),
      ),
    );

    const caller = makeCaller();
    const result = await caller.genui.resolveRetheme({ instruction: "x" });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret-key=xyz");
    expect(JSON.stringify(result)).not.toContain("Internal Bedrock error");
  });

  it("network failure -> friendly ok:false fallback, no leaked error text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const caller = makeCaller();
    const result = await caller.genui.resolveRetheme({ instruction: "x" });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("ECONNREFUSED");
  });

  it("unreadable JSON body -> friendly ok:false fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error("bad json")),
      } as unknown as Response),
    );

    const caller = makeCaller();
    const result = await caller.genui.resolveRetheme({ instruction: "x" });

    expect(result.ok).toBe(false);
  });

  it("missing data field in envelope -> friendly ok:false fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockResponse({ success: false, data: null, error: "boom" })),
    );

    const caller = makeCaller();
    const result = await caller.genui.resolveRetheme({ instruction: "x" });

    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Input boundary (T-52-05-04: instruction capped at 280 chars)
// ---------------------------------------------------------------------------

describe("genui.resolveRetheme — input boundary", () => {
  it("rejects an instruction over 280 characters", async () => {
    const caller = makeCaller();
    const tooLong = "a".repeat(281);

    await expect(caller.genui.resolveRetheme({ instruction: tooLong })).rejects.toThrow();
  });

  it("rejects an empty instruction", async () => {
    const caller = makeCaller();

    await expect(caller.genui.resolveRetheme({ instruction: "" })).rejects.toThrow();
  });

  it("rejects an unknown currentStylePackId", async () => {
    const caller = makeCaller();
    const invalidInput = { instruction: "x", currentStylePackId: "not-a-pack" } as unknown as Parameters<
      typeof caller.genui.resolveRetheme
    >[0];

    await expect(caller.genui.resolveRetheme(invalidInput)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Session requirement (auth-gate only, mirrors generate.ts)
// ---------------------------------------------------------------------------

describe("genui.resolveRetheme — session requirement", () => {
  it("rejects a sessionless call with UNAUTHORIZED", async () => {
    const caller = appRouter.createCaller({
      db: {} as never,
      headers: new Headers(),
      user: null,
    });

    await expect(caller.genui.resolveRetheme({ instruction: "test" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
