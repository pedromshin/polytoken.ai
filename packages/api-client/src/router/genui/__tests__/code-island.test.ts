/**
 * code-island.test.ts — vitest unit tests for the genui.codeIslandGenerate tRPC procedure.
 *
 * Contract:
 *   - Proxies to POST /v1/genui/code-island/generate with { intent, raw_content, importer_id }.
 *   - Reads the ApiResponse envelope body.data.{code,outcome,attempts}.
 *   - Non-2xx / network / parse / missing-code failures return a non-empty fallback code string
 *     with outcome "fallback" and a friendly reason (no leaked detail).
 *   - Unlike genui.generate, there is NO spec re-validation — island code is free-form (gated
 *     client-side by the AST allowlist + repair loop).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appRouter } from "../../../root";

function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

// Phase 44 (TENA-03): genui.codeIslandGenerate is protectedProcedure
// (auth-gate only — no ownership scoping, mirrors generate.ts).
const TEST_USER = { id: "10000000-0000-0000-0000-00000000000a" };

function makeCaller(user: { id: string } | null = TEST_USER) {
  return appRouter.createCaller({
    db: {} as never,
    headers: new Headers(),
    user,
  });
}

const OK_ENVELOPE = {
  success: true,
  data: { code: "document.getElementById('island-root').textContent='hi';", language: "javascript", outcome: "ok", attempts: 1 },
  error: null,
};

describe("genui.codeIslandGenerate", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.EMAIL_LISTENER_URL = "http://listener.test";
    process.env.EMAIL_LISTENER_API_KEY = "test-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns the generated code + outcome from the envelope", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(OK_ENVELOPE)) as unknown as typeof fetch;
    const res = await makeCaller().genui.codeIslandGenerate({ intent: "a counter widget" });
    expect(res.outcome).toBe("ok");
    expect(res.attempts).toBe(1);
    expect(res.code).toContain("island-root");
  });

  it("sends intent, raw_content, and importer_id to FastAPI", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(OK_ENVELOPE));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await makeCaller().genui.codeIslandGenerate({ intent: "x", rawContent: "doc", importerId: "imp-1" });
    const [urlArg, initArg] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(urlArg).toContain("/v1/genui/code-island/generate");
    const body = JSON.parse(String(initArg.body));
    expect(body).toMatchObject({ intent: "x", raw_content: "doc", importer_id: "imp-1" });
  });

  it("falls back with non-empty code on a non-2xx response (no leaked detail)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse({ error: "boom" }, 500)) as unknown as typeof fetch;
    const res = await makeCaller().genui.codeIslandGenerate({ intent: "x" });
    expect(res.outcome).toBe("fallback");
    expect(res.code.length).toBeGreaterThan(0);
    expect(res.reason).toBeTruthy();
    expect(res.reason).not.toContain("boom");
  });

  it("falls back on a network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONN")) as unknown as typeof fetch;
    const res = await makeCaller().genui.codeIslandGenerate({ intent: "x" });
    expect(res.outcome).toBe("fallback");
    expect(res.code.length).toBeGreaterThan(0);
  });

  it("falls back when the envelope is missing the code field", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockResponse({ success: true, data: { outcome: "ok" }, error: null })) as unknown as typeof fetch;
    const res = await makeCaller().genui.codeIslandGenerate({ intent: "x" });
    expect(res.outcome).toBe("fallback");
  });

  it("Phase 44 (T-44-07-04): rejects a sessionless call with UNAUTHORIZED", async () => {
    await expect(
      makeCaller(null).genui.codeIslandGenerate({ intent: "x" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
