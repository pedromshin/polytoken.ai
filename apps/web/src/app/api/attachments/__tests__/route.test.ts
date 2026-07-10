/**
 * route.test.ts — vitest unit tests for GET /api/attachments/[id] (Phase 44
 * Plan 07, TENA-03).
 *
 * Phase 44: this route previously had ZERO tenant scoping (any request —
 * authenticated or not — that guessed/enumerated a valid attachment uuid
 * could mint a signed download URL for it, T-44-07-03). It now:
 *   (a) resolves the acting user server-side via `~/lib/supabase/server`
 *       createClient().auth.getUser() — 401 on null user;
 *   (b) asserts the attachment's importer is owned by that user via
 *       @polytoken/db/ownership's assertImporterOwnership — 404 on
 *       OwnershipError (fail-closed, no existence oracle) BEFORE any
 *       signed URL is minted.
 *
 * Test plan:
 *   Test 1: 401 when there is no session (getUser returns null).
 *   Test 2: 404 when the attachment's importer belongs to another user.
 *   Test 3: 200 + { url } for the owner.
 *   Test 4: 400 for a non-uuid id (pre-existing contract, unchanged).
 *   Test 5: 404 when the attachment row does not exist.
 *   Test 6: 500 when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is missing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@polytoken/db/client", () => ({
  db: { select: vi.fn() },
}));

vi.mock("@polytoken/db/ownership", async () => {
  const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
    "@polytoken/db/ownership",
  );
  return {
    ...actual,
    assertImporterOwnership: vi.fn(),
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

import { createClient as createServiceRoleClient } from "@supabase/supabase-js";

import { db } from "@polytoken/db/client";
import { assertImporterOwnership, OwnershipError } from "@polytoken/db/ownership";

import { createClient as createSupabaseServerClient } from "~/lib/supabase/server";

import { GET } from "../[id]/route";

const ATTACHMENT_ID = "10000000-0000-0000-0000-000000000001";
const IMPORTER_ID = "20000000-0000-0000-0000-000000000001";
const USER_A = { id: "30000000-0000-0000-0000-00000000000a" };
const STORAGE_KEY = "importers/x/attachment.pdf";

function makeRequest(id: string = ATTACHMENT_ID): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function mockDbSelect(rows: ReadonlyArray<Record<string, unknown>>) {
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
  vi.mocked(db.select).mockReturnValue(chain as never);
}

function mockSession(user: { id: string } | null) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  } as never);
}

function mockStorageSignedUrl(result: { data?: { signedUrl: string }; error?: unknown }) {
  vi.mocked(createServiceRoleClient).mockReturnValue({
    storage: {
      from: () => ({
        createSignedUrl: vi.fn().mockResolvedValue(result),
      }),
    },
  } as never);
}

describe("GET /api/attachments/[id]", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "http://supabase.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  });

  afterEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    vi.mocked(assertImporterOwnership).mockReset();
    vi.restoreAllMocks();
  });

  it("Test 1: returns 401 when there is no session", async () => {
    mockSession(null);

    const res = await GET({} as never, makeRequest());

    expect(res.status).toBe(401);
    expect(assertImporterOwnership).not.toHaveBeenCalled();
  });

  it("Test 2: returns 404 when the attachment's importer belongs to another user", async () => {
    mockSession(USER_A);
    mockDbSelect([{ storageKey: STORAGE_KEY, importerId: IMPORTER_ID }]);
    vi.mocked(assertImporterOwnership).mockRejectedValueOnce(
      new OwnershipError("importer", IMPORTER_ID),
    );

    const res = await GET({} as never, makeRequest());

    expect(res.status).toBe(404);
    expect(assertImporterOwnership).toHaveBeenCalledWith(db, IMPORTER_ID, USER_A.id);
  });

  it("Test 3: returns 200 + { url } for the owner", async () => {
    mockSession(USER_A);
    mockDbSelect([{ storageKey: STORAGE_KEY, importerId: IMPORTER_ID }]);
    vi.mocked(assertImporterOwnership).mockResolvedValueOnce(undefined);
    mockStorageSignedUrl({ data: { signedUrl: "https://signed.example/test" } });

    const res = await GET({} as never, makeRequest());
    const body = (await res.json()) as { url: string };

    expect(res.status).toBe(200);
    expect(body).toEqual({ url: "https://signed.example/test" });
  });

  it("Test 4: returns 400 for a non-uuid id", async () => {
    const res = await GET({} as never, makeRequest("not-a-uuid"));
    expect(res.status).toBe(400);
  });

  it("Test 5: returns 404 when the attachment row does not exist", async () => {
    mockSession(USER_A);
    mockDbSelect([]);

    const res = await GET({} as never, makeRequest());

    expect(res.status).toBe(404);
    expect(assertImporterOwnership).not.toHaveBeenCalled();
  });

  it("Test 6: returns 500 when SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY is missing", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const res = await GET({} as never, makeRequest());
    expect(res.status).toBe(500);
  });
});
