/**
 * delete.test.ts — vitest unit tests for POST /api/account/delete.
 *
 * Pins the load-bearing, adversarial-review-hardened properties:
 *   Test 1: 401 when no session — nothing deleted.
 *   Test 2: the listener is called with X-User-Id (scope self-derived — NO
 *           ids/keys are sent), then the auth-user delete runs LAST.
 *   Test 3: a listener failure ABORTS with 502 and NEVER deletes the auth user
 *           (retry-safe — no stranding behind a destroyed pointer).
 *   Test 4: a listener 'incomplete: true' erasure ABORTS with 502, no cascade.
 *   Test 5: a vault-blob failure ABORTS with 502, no cascade.
 *   Test 6: 500 when the capture phase fails, without deleting the auth user.
 *
 * Mirrors api/attachments's mocking; no @testing-library — POST is called directly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("~/lib/supabase/admin", () => ({
  createServiceRoleAdminClient: vi.fn(),
  VAULT_BUCKET: "user-files",
}));
vi.mock("@polytoken/db/client", () => ({ db: { delete: vi.fn() } }));
vi.mock("@polytoken/db/ownership", () => ({ userOwnedImporterIds: vi.fn() }));
vi.mock("@polytoken/db/schema", () => ({
  GenuiGenerationEvents: { importerId: "genui.importer_id" },
  UiSpecTemplates: { importerId: "ui_spec.importer_id" },
  AutofillRetrievalEvents: { importerId: "autofill.importer_id" },
}));

import { db } from "@polytoken/db/client";
import { userOwnedImporterIds } from "@polytoken/db/ownership";

import { createServiceRoleAdminClient } from "~/lib/supabase/admin";
import { createClient as createSupabaseServerClient } from "~/lib/supabase/server";

import { POST } from "../delete/route";

const USER_ID = "30000000-0000-0000-0000-00000000000a";
const IMPORTER_IDS = ["20000000-0000-0000-0000-000000000001"];

function mockSession(user: { id: string } | null) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  } as never);
}

function mockTelemetryDelete(order: string[]) {
  vi.mocked(db.delete).mockImplementation((table: unknown) => {
    return {
      where() {
        order.push(`telemetry:${String((table as { importerId: string }).importerId)}`);
        return Promise.resolve(undefined);
      },
    } as never;
  });
}

function mockAdmin(order: string[], opts?: { vaultRemoveError?: boolean; deleteUserError?: unknown }) {
  let listCalls = 0;
  const remove = vi.fn().mockImplementation((keys: string[]) => {
    order.push(`vault:remove:${keys.join(",")}`);
    return Promise.resolve({ error: opts?.vaultRemoveError ? { message: "vault boom" } : null });
  });
  const list = vi.fn().mockImplementation(() => {
    listCalls += 1;
    if (listCalls === 1) {
      return Promise.resolve({ data: [{ name: "file.pdf", id: "obj-1" }], error: null });
    }
    return Promise.resolve({ data: [], error: null });
  });
  const deleteUser = vi.fn().mockImplementation((id: string) => {
    order.push(`auth:deleteUser:${id}`);
    return Promise.resolve({ error: opts?.deleteUserError ?? null });
  });
  vi.mocked(createServiceRoleAdminClient).mockReturnValue({
    storage: { from: vi.fn().mockReturnValue({ list, remove }) },
    auth: { admin: { deleteUser } },
  } as never);
  return { deleteUser, remove, list };
}

/** Default listener response: 200 + complete:true. */
function listenerResponse(over?: { ok?: boolean; status?: number; complete?: unknown }) {
  return {
    ok: over?.ok ?? true,
    status: over?.status ?? 200,
    json: () => Promise.resolve({ complete: over?.complete ?? true }),
    text: () => Promise.resolve(""),
  };
}

describe("POST /api/account/delete", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.EMAIL_LISTENER_URL = "http://listener.test";
    process.env.EMAIL_LISTENER_API_KEY = "listener-key";
    fetchMock = vi.fn().mockResolvedValue(listenerResponse());
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(userOwnedImporterIds).mockResolvedValue([...IMPORTER_IDS]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.EMAIL_LISTENER_URL;
    delete process.env.EMAIL_LISTENER_API_KEY;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.mocked(userOwnedImporterIds).mockReset();
    vi.mocked(db.delete).mockReset();
    vi.mocked(createServiceRoleAdminClient).mockReset();
  });

  it("Test 1: 401 when there is no session and deletes nothing", async () => {
    mockSession(null);
    const { deleteUser } = mockAdmin([]);

    const res = await POST({} as never);

    expect(res.status).toBe(401);
    expect(userOwnedImporterIds).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Test 2: calls the listener with X-User-Id (no ids/keys sent), deletes auth user LAST", async () => {
    mockSession({ id: USER_ID });
    const order: string[] = [];
    fetchMock.mockImplementation(() => {
      order.push("listener:fetch");
      return Promise.resolve(listenerResponse());
    });
    mockTelemetryDelete(order);
    const { deleteUser } = mockAdmin(order);

    const res = await POST({} as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://listener.test/v1/importers/delete-data");
    expect((init.headers as Record<string, string>)["X-User-Id"]).toBe(USER_ID);
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("listener-key");
    // Scope is self-derived server-side — the body carries NO importer_ids/keys.
    expect(JSON.parse(init.body as string)).toEqual({});

    const deleteIdx = order.indexOf(`auth:deleteUser:${USER_ID}`);
    expect(deleteIdx).toBe(order.length - 1); // cascade is LAST
    expect(order.indexOf("listener:fetch")).toBeLessThan(deleteIdx);
    expect(order.indexOf(`vault:remove:${USER_ID}/file.pdf`)).toBeLessThan(deleteIdx);
    expect(order.indexOf("telemetry:genui.importer_id")).toBeLessThan(deleteIdx);
  });

  it("Test 3: a listener failure ABORTS with 502 and never deletes the auth user", async () => {
    mockSession({ id: USER_ID });
    const { deleteUser } = mockAdmin([]);
    fetchMock.mockRejectedValue(new Error("listener unreachable"));

    const res = await POST({} as never);

    expect(res.status).toBe(502);
    expect(deleteUser).not.toHaveBeenCalled(); // no irreversible step ran
  });

  it("Test 4: an incomplete listener erasure ABORTS with 502, no cascade", async () => {
    mockSession({ id: USER_ID });
    const { deleteUser } = mockAdmin([]);
    fetchMock.mockResolvedValue(listenerResponse({ complete: false }));

    const res = await POST({} as never);

    expect(res.status).toBe(502);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("Test 5: a vault-blob failure ABORTS with 502, no cascade", async () => {
    mockSession({ id: USER_ID });
    const { deleteUser } = mockAdmin([], { vaultRemoveError: true });

    const res = await POST({} as never);

    expect(res.status).toBe(502);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("Test 6: 500 without deleting the auth user when the capture phase fails", async () => {
    mockSession({ id: USER_ID });
    vi.mocked(userOwnedImporterIds).mockRejectedValue(new Error("db down"));
    const { deleteUser } = mockAdmin([]);

    const res = await POST({} as never);

    expect(res.status).toBe(500);
    expect(deleteUser).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
