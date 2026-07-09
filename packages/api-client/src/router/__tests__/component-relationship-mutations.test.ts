/**
 * component-relationship-mutations.test.ts — vitest coverage for the Phase 9
 * (09-04) component relationship + review mutations:
 *   setRole, setEntityType, setFieldRelationship, autofillFields, denyField,
 *   confirmField
 *
 * Test strategy mirrors mutations.test.ts: build an appRouter caller with a
 * stubbed ctx.db (these mutations don't use ctx.db), stub globalThis.fetch, and
 * set/unset env vars per test.
 *
 * Security gates verified:
 *   T-09-30: env guard fires before any fetch when EMAIL_LISTENER_API_KEY unset.
 *   T-09-31: every mutation carries the X-API-Key header (key server-side only).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appRouter } from "../../root";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function makeCaller() {
  return appRouter.createCaller({
    db: {} as never,
    headers: new Headers(),
    user: null,
  });
}

const URL = "http://listener.test";
const API_KEY = "test-api-key";
const COMPONENT_ID = "00000000-0000-0000-0000-0000000000a1";
const ENTITY_TYPE_ID = "00000000-0000-0000-0000-0000000000b2";
const PARENT_ID = "00000000-0000-0000-0000-0000000000c3";
const FIELD_ID = "00000000-0000-0000-0000-0000000000d4";

function headerOf(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string>)[name];
}

function bodyOf(init: RequestInit): Record<string, unknown> {
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("component relationship mutations (09-04)", () => {
  beforeEach(() => {
    process.env.EMAIL_LISTENER_URL = URL;
    process.env.EMAIL_LISTENER_API_KEY = API_KEY;
  });

  afterEach(() => {
    delete process.env.EMAIL_LISTENER_URL;
    delete process.env.EMAIL_LISTENER_API_KEY;
    vi.restoreAllMocks();
  });

  it("setRole: PATCH /role with X-API-Key + {role} body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockResponse({ data: { component_id: COMPONENT_ID } }));
    vi.stubGlobal("fetch", fetchMock);

    await makeCaller().emails.setRole({
      componentId: COMPONENT_ID,
      role: "entity",
    });

    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${URL}/v1/components/${COMPONENT_ID}/role`);
    expect(init.method).toBe("PATCH");
    expect(headerOf(init, "X-API-Key")).toBe(API_KEY);
    expect(bodyOf(init)).toEqual({ role: "entity" });
  });

  it("setRole: role=null is serialized as { role: null }", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await makeCaller().emails.setRole({ componentId: COMPONENT_ID, role: null });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(bodyOf(init)).toEqual({ role: null });
  });

  it("setEntityType: PATCH /entity-type with snake_cased {entity_type_id} body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await makeCaller().emails.setEntityType({
      componentId: COMPONENT_ID,
      entityTypeId: ENTITY_TYPE_ID,
    });

    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${URL}/v1/components/${COMPONENT_ID}/entity-type`);
    expect(init.method).toBe("PATCH");
    expect(headerOf(init, "X-API-Key")).toBe(API_KEY);
    expect(bodyOf(init)).toEqual({ entity_type_id: ENTITY_TYPE_ID });
  });

  it("setFieldRelationship: PATCH /field-relationship with snake_cased body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await makeCaller().emails.setFieldRelationship({
      componentId: COMPONENT_ID,
      parentComponentId: PARENT_ID,
      entityTypeFieldId: FIELD_ID,
    });

    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(
      `${URL}/v1/components/${COMPONENT_ID}/field-relationship`,
    );
    expect(init.method).toBe("PATCH");
    expect(headerOf(init, "X-API-Key")).toBe(API_KEY);
    expect(bodyOf(init)).toEqual({
      parent_component_id: PARENT_ID,
      entity_type_field_id: FIELD_ID,
    });
  });

  it("autofillFields: POST /autofill-fields with X-API-Key + empty body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockResponse({ data: { fields: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    await makeCaller().emails.autofillFields({
      entityComponentId: COMPONENT_ID,
    });

    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(
      `${URL}/v1/components/${COMPONENT_ID}/autofill-fields`,
    );
    expect(init.method).toBe("POST");
    expect(headerOf(init, "X-API-Key")).toBe(API_KEY);
    expect(bodyOf(init)).toEqual({});
  });

  it("denyField: POST /deny with X-API-Key + empty body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await makeCaller().emails.denyField({ componentId: COMPONENT_ID });

    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${URL}/v1/components/${COMPONENT_ID}/deny`);
    expect(init.method).toBe("POST");
    expect(headerOf(init, "X-API-Key")).toBe(API_KEY);
    expect(bodyOf(init)).toEqual({});
  });

  it("confirmField: POST /confirm with snake_cased {corrected_fields}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await makeCaller().emails.confirmField({
      componentId: COMPONENT_ID,
      correctedFields: { shipper_name: "Acme" },
    });

    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${URL}/v1/components/${COMPONENT_ID}/confirm`);
    expect(bodyOf(init)).toEqual({
      corrected_fields: { shipper_name: "Acme" },
    });
  });

  it("confirmField: omitted correctedFields becomes { corrected_fields: null }", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await makeCaller().emails.confirmField({ componentId: COMPONENT_ID });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(bodyOf(init)).toEqual({ corrected_fields: null });
  });

  it("error path: non-2xx throws with parsed FastAPI {detail}", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockResponse({ detail: "Component not found" }, 404));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      makeCaller().emails.setRole({ componentId: COMPONENT_ID, role: "field" }),
    ).rejects.toThrow("Component not found");
  });

  it("error path: non-2xx without {detail} falls back to mutation label", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockResponse({ message: "boom" }, 500));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      makeCaller().emails.denyField({ componentId: COMPONENT_ID }),
    ).rejects.toThrow("denyField failed");
  });

  it("env guard (T-09-30): missing API key throws before any fetch", async () => {
    process.env.EMAIL_LISTENER_URL = URL;
    delete process.env.EMAIL_LISTENER_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      makeCaller().emails.autofillFields({ entityComponentId: COMPONENT_ID }),
    ).rejects.toThrow("is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("input validation (T-09-31): non-uuid componentId is rejected before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      makeCaller().emails.setRole({
        componentId: "not-a-uuid",
        role: "entity",
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
