/**
 * mutations.test.ts — vitest coverage for the three new proxy mutations:
 *   autofillComponent, confirmComponent, reprocessEmail
 *
 * Test strategy: create an appRouter caller with stubbed ctx.db (mutations
 * don't use ctx.db), stub globalThis.fetch, and set/unset env vars per test.
 *
 * Security gate (T-07-01): EMAIL_LISTENER_API_KEY never leaks to the caller;
 * Test 5 verifies the env guard fires before any fetch call.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appRouter } from "../../root";

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

/** Create a tRPC caller with a stub ctx that has no real db connection. */
function makeCaller() {
  return appRouter.createCaller({
    db: {} as never,
    headers: new Headers(),
    user: null,
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("componentMutationProcedures — autofillComponent", () => {
  const VALID_COMPONENT_ID = "00000000-0000-0000-0000-000000000001";
  const VALID_ENTITY_SLUG = "bill_of_lading";
  const URL = "http://listener.test";
  const API_KEY = "test-api-key";

  beforeEach(() => {
    process.env.EMAIL_LISTENER_URL = URL;
    process.env.EMAIL_LISTENER_API_KEY = API_KEY;
  });

  afterEach(() => {
    delete process.env.EMAIL_LISTENER_URL;
    delete process.env.EMAIL_LISTENER_API_KEY;
    vi.restoreAllMocks();
  });

  it("Test 1: issues POST to /v1/components/{id}/autofill with correct URL, method, headers, and body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ data: { extracted_fields: {}, confidence_score: 0.9, confidence_breakdown: null } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const caller = makeCaller();
    await caller.emails.autofillComponent({
      componentId: VALID_COMPONENT_ID,
      entityTypeSlug: VALID_ENTITY_SLUG,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(calledUrl).toBe(`${URL}/v1/components/${VALID_COMPONENT_ID}/autofill`);
    expect(calledInit.method).toBe("POST");
    expect((calledInit.headers as Record<string, string>)["X-API-Key"]).toBe(API_KEY);
    expect((calledInit.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    const parsedBody = JSON.parse(calledInit.body as string) as Record<string, unknown>;
    expect(parsedBody).toEqual({ entity_type_slug: VALID_ENTITY_SLUG });
  });
});

describe("componentMutationProcedures — confirmComponent", () => {
  const VALID_COMPONENT_ID = "00000000-0000-0000-0000-000000000002";
  const URL = "http://listener.test";
  const API_KEY = "test-api-key";

  beforeEach(() => {
    process.env.EMAIL_LISTENER_URL = URL;
    process.env.EMAIL_LISTENER_API_KEY = API_KEY;
  });

  afterEach(() => {
    delete process.env.EMAIL_LISTENER_URL;
    delete process.env.EMAIL_LISTENER_API_KEY;
    vi.restoreAllMocks();
  });

  it("Test 2a: issues POST to /v1/components/{id}/confirm with correctedFields object", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ data: { component_id: VALID_COMPONENT_ID, status: "confirmed" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const caller = makeCaller();
    await caller.emails.confirmComponent({
      componentId: VALID_COMPONENT_ID,
      correctedFields: { shipper_name: "Acme Corp" },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${URL}/v1/components/${VALID_COMPONENT_ID}/confirm`);
    expect(calledInit.method).toBe("POST");
    const parsedBody = JSON.parse(calledInit.body as string) as Record<string, unknown>;
    expect(parsedBody).toEqual({ corrected_fields: { shipper_name: "Acme Corp" } });
  });

  it("Test 2b: correctedFields: null is serialized as { corrected_fields: null }", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ data: { component_id: VALID_COMPONENT_ID, status: "confirmed" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const caller = makeCaller();
    await caller.emails.confirmComponent({
      componentId: VALID_COMPONENT_ID,
      correctedFields: null,
    });

    const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse(calledInit.body as string) as Record<string, unknown>;
    expect(parsedBody).toEqual({ corrected_fields: null });
  });
});

describe("componentMutationProcedures — reprocessEmail", () => {
  const VALID_EMAIL_ID = "00000000-0000-0000-0000-000000000003";
  const URL = "http://listener.test";
  const API_KEY = "test-api-key";

  beforeEach(() => {
    process.env.EMAIL_LISTENER_URL = URL;
    process.env.EMAIL_LISTENER_API_KEY = API_KEY;
  });

  afterEach(() => {
    delete process.env.EMAIL_LISTENER_URL;
    delete process.env.EMAIL_LISTENER_API_KEY;
    vi.restoreAllMocks();
  });

  it("Test 3: issues POST to /v1/emails/{id}/reprocess with empty body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ data: { email_id: VALID_EMAIL_ID, superseded_components: 3 } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const caller = makeCaller();
    await caller.emails.reprocessEmail({ emailId: VALID_EMAIL_ID });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${URL}/v1/emails/${VALID_EMAIL_ID}/reprocess`);
    expect(calledInit.method).toBe("POST");
    const parsedBody = JSON.parse(calledInit.body as string) as Record<string, unknown>;
    expect(parsedBody).toEqual({});
  });
});

describe("componentMutationProcedures — error propagation", () => {
  const VALID_COMPONENT_ID = "00000000-0000-0000-0000-000000000001";
  const URL = "http://listener.test";
  const API_KEY = "test-api-key";

  beforeEach(() => {
    process.env.EMAIL_LISTENER_URL = URL;
    process.env.EMAIL_LISTENER_API_KEY = API_KEY;
  });

  afterEach(() => {
    delete process.env.EMAIL_LISTENER_URL;
    delete process.env.EMAIL_LISTENER_API_KEY;
    vi.restoreAllMocks();
  });

  it("Test 4a: non-ok response throws with FastAPI {detail} string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ detail: "Component not found" }, 404),
    );
    vi.stubGlobal("fetch", fetchMock);

    const caller = makeCaller();
    await expect(
      caller.emails.autofillComponent({
        componentId: VALID_COMPONENT_ID,
        entityTypeSlug: "bill_of_lading",
      }),
    ).rejects.toThrow("Component not found");
  });

  it("Test 4b: non-ok response with no {detail} falls back to fallback string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ message: "Server error" }, 500),
    );
    vi.stubGlobal("fetch", fetchMock);

    const caller = makeCaller();
    await expect(
      caller.emails.autofillComponent({
        componentId: VALID_COMPONENT_ID,
        entityTypeSlug: "bill_of_lading",
      }),
    ).rejects.toThrow("autofill failed");
  });
});

describe("componentMutationProcedures — env guard (T-07-01)", () => {
  afterEach(() => {
    delete process.env.EMAIL_LISTENER_URL;
    delete process.env.EMAIL_LISTENER_API_KEY;
    vi.restoreAllMocks();
  });

  it("Test 5a: missing EMAIL_LISTENER_URL throws 'is not configured' before fetch", async () => {
    delete process.env.EMAIL_LISTENER_URL;
    process.env.EMAIL_LISTENER_API_KEY = "key";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const caller = makeCaller();
    await expect(
      caller.emails.autofillComponent({
        componentId: "00000000-0000-0000-0000-000000000001",
        entityTypeSlug: "bill_of_lading",
      }),
    ).rejects.toThrow("is not configured");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Test 5b: missing EMAIL_LISTENER_API_KEY throws 'is not configured' before fetch", async () => {
    process.env.EMAIL_LISTENER_URL = "http://listener.test";
    delete process.env.EMAIL_LISTENER_API_KEY;

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const caller = makeCaller();
    await expect(
      caller.emails.reprocessEmail({
        emailId: "00000000-0000-0000-0000-000000000003",
      }),
    ).rejects.toThrow("is not configured");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
