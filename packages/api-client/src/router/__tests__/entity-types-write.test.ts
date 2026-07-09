/**
 * entity-types-write.test.ts — vitest coverage for the Phase 9 (09-04)
 * entity-type write mutations (D-26):
 *   create, update, createField, updateField, deleteField, reorderFields
 *
 * Same fetch-mock + env-stub strategy as mutations.test.ts. Verifies correct
 * URL/method/header/snake_cased body, the field_type Zod allowlist (T-09-32),
 * uuid validation (T-09-31), and the env guard (T-09-30).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appRouter } from "../../root";

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
const ENTITY_TYPE_ID = "00000000-0000-0000-0000-0000000000e1";
const FIELD_ID = "00000000-0000-0000-0000-0000000000f2";

function headerOf(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string>)[name];
}

function bodyOf(init: RequestInit): Record<string, unknown> {
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("entity-types write mutations (09-04)", () => {
  beforeEach(() => {
    process.env.EMAIL_LISTENER_URL = URL;
    process.env.EMAIL_LISTENER_API_KEY = API_KEY;
  });

  afterEach(() => {
    delete process.env.EMAIL_LISTENER_URL;
    delete process.env.EMAIL_LISTENER_API_KEY;
    vi.restoreAllMocks();
  });

  it("create: POST /v1/entity-types with X-API-Key + {slug,label}", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockResponse({ data: { id: ENTITY_TYPE_ID } }));
    vi.stubGlobal("fetch", fetchMock);

    await makeCaller().entityTypes.create({
      slug: "purchase_order",
      label: "Purchase Order",
    });

    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${URL}/v1/entity-types`);
    expect(init.method).toBe("POST");
    expect(headerOf(init, "X-API-Key")).toBe(API_KEY);
    expect(bodyOf(init)).toEqual({
      slug: "purchase_order",
      label: "Purchase Order",
    });
  });

  it("update: PATCH /v1/entity-types/{id} with snake_cased {is_active}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await makeCaller().entityTypes.update({
      entityTypeId: ENTITY_TYPE_ID,
      label: "Renamed",
      isActive: false,
    });

    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${URL}/v1/entity-types/${ENTITY_TYPE_ID}`);
    expect(init.method).toBe("PATCH");
    expect(bodyOf(init)).toEqual({ label: "Renamed", is_active: false });
  });

  it("createField: POST /{id}/fields with snake_cased field_type body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await makeCaller().entityTypes.createField({
      entityTypeId: ENTITY_TYPE_ID,
      slug: "order_date",
      label: "Order Date",
      fieldType: "date",
      isRequired: true,
      isIdentifier: false,
    });

    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${URL}/v1/entity-types/${ENTITY_TYPE_ID}/fields`);
    expect(init.method).toBe("POST");
    expect(headerOf(init, "X-API-Key")).toBe(API_KEY);
    expect(bodyOf(init)).toEqual({
      slug: "order_date",
      label: "Order Date",
      field_type: "date",
      is_required: true,
      is_identifier: false,
    });
  });

  it("updateField: PATCH /fields/{id} with only provided keys snake_cased", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await makeCaller().entityTypes.updateField({
      fieldId: FIELD_ID,
      fieldType: "number",
    });

    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${URL}/v1/entity-types/fields/${FIELD_ID}`);
    expect(init.method).toBe("PATCH");
    expect(bodyOf(init)).toEqual({ field_type: "number" });
  });

  it("deleteField: DELETE /fields/{id} with X-API-Key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockResponse({ data: { field_id: FIELD_ID, hard_deleted: true } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await makeCaller().entityTypes.deleteField({ fieldId: FIELD_ID });

    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${URL}/v1/entity-types/fields/${FIELD_ID}`);
    expect(init.method).toBe("DELETE");
    expect(headerOf(init, "X-API-Key")).toBe(API_KEY);
  });

  it("reorderFields: POST /{id}/fields/reorder with {ordered_field_ids}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    const ids = [FIELD_ID, "00000000-0000-0000-0000-0000000000f3"];
    await makeCaller().entityTypes.reorderFields({
      entityTypeId: ENTITY_TYPE_ID,
      orderedFieldIds: ids,
    });

    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(
      `${URL}/v1/entity-types/${ENTITY_TYPE_ID}/fields/reorder`,
    );
    expect(bodyOf(init)).toEqual({ ordered_field_ids: ids });
  });

  it("createField rejects an out-of-allowlist fieldType at the Zod boundary (T-09-32)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      makeCaller().entityTypes.createField({
        entityTypeId: ENTITY_TYPE_ID,
        slug: "weird",
        label: "Weird",
        // @ts-expect-error — intentionally invalid to assert the schema rejects it
        fieldType: "boolean",
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("create rejects a non-uuid entityTypeId on update before fetch (T-09-31)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      makeCaller().entityTypes.update({
        entityTypeId: "not-a-uuid",
        label: "x",
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("error path: slug-conflict 409 surfaces the FastAPI {detail}", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockResponse({ detail: "Slug already exists" }, 409));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      makeCaller().entityTypes.create({ slug: "dup", label: "Dup" }),
    ).rejects.toThrow("Slug already exists");
  });

  it("env guard (T-09-30): missing API key throws before any fetch", async () => {
    process.env.EMAIL_LISTENER_URL = URL;
    delete process.env.EMAIL_LISTENER_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      makeCaller().entityTypes.deleteField({ fieldId: FIELD_ID }),
    ).rejects.toThrow("is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
