/**
 * apps/web/src/app/api/account/delete/route.ts — POST /api/account/delete.
 *
 * Erases ALL of one user's data, to the DELETION CONTRACT. The Supabase auth
 * user's deletion cascade-deletes ~all Postgres rows (every user_id table +
 * importers + every importer-anchored table + embeddings). This route deletes
 * the things that do NOT cascade, in the ONE order that survives the cascade,
 * and then triggers it LAST:
 *
 *   1. CAPTURE the importer ids (for the orphan-telemetry step) BEFORE deleting
 *      anything — the cascade destroys them. (The listener self-derives its own
 *      blob scope from X-User-Id, so we do NOT send it ids/keys.)
 *   2. LISTENER blobs (listener-owned, no FK to auth): POST X-User-Id to the
 *      email-listener's internal delete-data endpoint; it self-derives + erases
 *      the raw MIME + attachment blobs and reports `complete`. BLOCKING: if it
 *      is unreachable, errors, or reports incomplete, we ABORT before the
 *      cascade (502) so nothing is stranded — retry re-derives + re-deletes
 *      (idempotent).
 *   3. VAULT blobs (web-owned): every object under `{userId}/` of the
 *      'user-files' bucket, INCLUDING the `.versions` / `.trash` parks. BLOCKING
 *      too — a failure aborts before the cascade (502). Idempotent.
 *   4. ORPHAN TELEMETRY (no FK — these three tables carry a bare importer_id
 *      and do NOT cascade): delete WHERE importer_id = ANY(capturedIds). MUST
 *      run BEFORE the auth-user delete, because after the cascade the importer
 *      ids are gone and these rows would be permanently orphaned.
 *   5. AUTH USER, LAST: `auth.admin.deleteUser` — the single act that triggers
 *      the whole Postgres cascade, reached ONLY after the blobs are gone. If
 *      THIS fails the deletion did not happen; return 500 so the client retries.
 *
 * Retry-safety: no irreversible step (the cascade) runs until every blob store
 * is confirmed erased, and every blob delete is idempotent — so a transient
 * failure aborts cleanly and a retry completes, never stranding data behind a
 * destroyed pointer.
 *
 * Identity is server-verified via `getUser()` (never `getSession()`), exactly
 * as the sibling `api/pipeline/health` proxy and `api/attachments/[id]` route.
 * The service-role admin client is minted inside this Node handler and never
 * reaches client code (see `~/lib/supabase/admin`).
 */

import { inArray } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@polytoken/db/client";
import { userOwnedImporterIds } from "@polytoken/db/ownership";
import {
  AutofillRetrievalEvents,
  GenuiGenerationEvents,
  UiSpecTemplates,
} from "@polytoken/db/schema";

import { createServiceRoleAdminClient, VAULT_BUCKET } from "~/lib/supabase/admin";
import { createClient } from "~/lib/supabase/server";

// Node runtime: the service-role admin client + drizzle need the Node APIs;
// this handler must never run on the edge.
export const runtime = "nodejs";

/** Supabase Storage `.list()` page size while walking the vault for deletion. */
const VAULT_LIST_PAGE_SIZE = 500;
/** `.remove()` takes exact keys; batch them rather than one call per object. */
const VAULT_REMOVE_BATCH_SIZE = 100;
/** Bound the recursive walk so a crafted deep tree is not a listing amplifier. */
const VAULT_MAX_DEPTH = 32;

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Read at request time (never module init, never a public env var). */
function getListenerConfig(): { url: string; apiKey: string } | null {
  const url = process.env.EMAIL_LISTENER_URL;
  const apiKey = process.env.EMAIL_LISTENER_API_KEY;
  if (!url || !apiKey) return null;
  return { url, apiKey };
}

/**
 * Every leaf object key under a prefix, paging each level and bounded at
 * VAULT_MAX_DEPTH. Mirrors the files router's `collectKeysUnder`: a folder
 * (`id === null`) is descended; a leaf (`id !== null`) is a key. `visited`
 * guards against a self-referential listing turning DELETE into an infinite
 * loop. `${prefix}/${name}` is descent through a subtree rooted at `{userId}/`
 * — never construction from an input.
 */
async function collectKeysUnder(
  storage: ReturnType<ReturnType<typeof createServiceRoleAdminClient>["storage"]["from"]>,
  prefix: string,
  depth: number,
  visited: Set<string>,
): Promise<string[]> {
  if (depth > VAULT_MAX_DEPTH) return [];
  if (visited.has(prefix)) return [];
  visited.add(prefix);

  const keys: string[] = [];
  const folders: string[] = [];

  for (let offset = 0; ; offset += VAULT_LIST_PAGE_SIZE) {
    const { data, error } = await storage.list(prefix, {
      limit: VAULT_LIST_PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`vault list failed: ${error.message}`);
    const page = data ?? [];
    for (const entry of page) {
      const childKey = `${prefix}/${entry.name}`;
      // `id === null` ⇒ folder (Supabase Storage convention).
      if (entry.id === null) folders.push(childKey);
      else keys.push(childKey);
    }
    if (page.length < VAULT_LIST_PAGE_SIZE) break;
  }

  for (const folder of folders) {
    keys.push(...(await collectKeysUnder(storage, folder, depth + 1, visited)));
  }

  return keys;
}

/**
 * Delete every vault object under `{userId}/` — live files, folders, AND the
 * `.versions` / `.trash` parks (the walk descends into dot-prefixed folders
 * too). Returns true only if the whole subtree was confirmed removed; on ANY
 * failure it logs and returns false so the caller ABORTS before the irreversible
 * cascade (never strands vault blobs). Idempotent: an absent key removes as a
 * no-op, so a retry completes.
 */
async function deleteVaultBlobs(
  admin: ReturnType<typeof createServiceRoleAdminClient>,
  userId: string,
): Promise<boolean> {
  const storage = admin.storage.from(VAULT_BUCKET);
  let keys: string[];
  try {
    keys = await collectKeysUnder(storage, userId, 0, new Set<string>());
  } catch (error) {
    console.error("[api/account/delete] vault walk failed:", error);
    return false;
  }

  for (let i = 0; i < keys.length; i += VAULT_REMOVE_BATCH_SIZE) {
    const batch = keys.slice(i, i + VAULT_REMOVE_BATCH_SIZE);
    const { error } = await storage.remove(batch);
    if (error) {
      console.error("[api/account/delete] vault remove failed:", error.message);
      return false;
    }
  }
  return true;
}

/**
 * Erase the listener-owned blobs (raw MIME + attachments) for this user. The
 * listener SELF-DERIVES the scope from X-User-Id, so we send only that header —
 * no ids/keys it could be tricked into trusting. Returns true only on a 200 with
 * `complete: true`; anything else (unconfigured, unreachable, non-200, or an
 * incomplete erasure) returns false so the caller ABORTS before the cascade.
 */
async function deleteListenerBlobs(userId: string): Promise<boolean> {
  const listener = getListenerConfig();
  if (!listener) {
    console.error("[api/account/delete] EMAIL_LISTENER_URL/API_KEY not configured");
    return false;
  }
  try {
    const upstream = await fetch(`${listener.url}/v1/importers/delete-data`, {
      method: "POST",
      headers: {
        "X-API-Key": listener.apiKey,
        "X-User-Id": userId,
        "Content-Type": "application/json",
      },
      body: "{}",
      cache: "no-store",
    });
    if (!upstream.ok) {
      console.error(`[api/account/delete] listener delete-data ${upstream.status}`);
      return false;
    }
    const body = (await upstream.json().catch(() => null)) as { complete?: unknown } | null;
    if (body?.complete !== true) {
      console.error("[api/account/delete] listener reported incomplete erasure:", body);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[api/account/delete] listener delete-data failed:", error);
    return false;
  }
}

export async function POST(_req: NextRequest): Promise<Response> {
  // ── Server-verified identity (getUser, never getSession) ──────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }
  const userId = user.id;

  // ── (1) CAPTURE importer ids (for the orphan-telemetry step) — the cascade
  // destroys them, so read first. A failure here is pre-cascade fatal (500;
  // nothing deleted).
  let importerIds: string[];
  try {
    importerIds = await userOwnedImporterIds(db, userId);
  } catch (error) {
    console.error("[api/account/delete] capture phase failed:", error);
    return jsonError("Account deletion failed", 500);
  }

  // ── Admin client — minted once, reused for the vault sweep + the cascade ──
  // If the service-role secret is missing this throws BEFORE any deletion, so
  // it is a pre-cascade 500.
  let admin: ReturnType<typeof createServiceRoleAdminClient>;
  try {
    admin = createServiceRoleAdminClient();
  } catch (error) {
    console.error("[api/account/delete] admin client unavailable:", error);
    return jsonError("Account deletion failed", 500);
  }

  // ── (2) LISTENER blobs — BLOCKING. If they aren't confirmed erased, abort
  // before the irreversible cascade so nothing is stranded (retry re-derives).
  if (!(await deleteListenerBlobs(userId))) {
    return jsonError("Account deletion could not complete; please try again.", 502);
  }

  // ── (3) VAULT blobs — BLOCKING, same reasoning ────────────────────────────
  if (!(await deleteVaultBlobs(admin, userId))) {
    return jsonError("Account deletion could not complete; please try again.", 502);
  }

  // ── (4) ORPHAN TELEMETRY — no FK, so it does NOT cascade. MUST run before ─
  // the auth-user delete (after the cascade the importer ids are gone). A
  // failure aborts before the cascade (retry re-runs — DELETE is idempotent).
  if (importerIds.length > 0) {
    try {
      await db
        .delete(GenuiGenerationEvents)
        .where(inArray(GenuiGenerationEvents.importerId, importerIds));
      await db.delete(UiSpecTemplates).where(inArray(UiSpecTemplates.importerId, importerIds));
      await db
        .delete(AutofillRetrievalEvents)
        .where(inArray(AutofillRetrievalEvents.importerId, importerIds));
    } catch (error) {
      console.error("[api/account/delete] orphan telemetry delete failed:", error);
      return jsonError("Account deletion could not complete; please try again.", 502);
    }
  }

  // ── (5) AUTH USER, LAST — triggers the full Postgres cascade, reached only
  // after every blob store is confirmed erased ─────────────────────────────
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error("[api/account/delete] auth user delete failed:", deleteError);
    return jsonError("Account deletion failed", 500);
  }

  return new Response(JSON.stringify({ deleted: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
