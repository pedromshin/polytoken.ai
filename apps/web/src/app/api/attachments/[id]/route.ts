/**
 * apps/web/src/app/api/attachments/[id]/route.ts — signed-URL download proxy
 * for email_attachments (Phase 44 Plan 07, TENA-03).
 *
 * Phase 44: this route previously had ZERO tenant scoping — any request
 * (authenticated or not) that guessed/enumerated a valid attachment uuid
 * could mint a signed download URL for it (T-44-07-03, an IDOR). It now:
 *   (a) resolves the acting user server-side via `~/lib/supabase/server`
 *       createClient().auth.getUser() — 401 on null user (mirrors the
 *       43-04 promote route's getUser() pattern, NEVER getSession(), which
 *       is an unverified cookie parse);
 *   (b) asserts the attachment's importer is owned by that user via
 *       @polytoken/db/ownership's assertImporterOwnership — OwnershipError
 *       maps to 404 (fail-closed, no existence oracle distinguishing
 *       "not found" from "not yours") BEFORE any signed URL is minted.
 */

import { createClient as createServiceRoleClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { db } from "@polytoken/db/client";
import { EmailAttachments } from "@polytoken/db/schema";
import { assertImporterOwnership, OwnershipError } from "@polytoken/db/ownership";

import { createClient as createSupabaseServerClient } from "~/lib/supabase/server";

// UUID v4 regex — validates the path param before hitting the DB
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  // ── Input validation ───────────────────────────────────────────────────────
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: "Invalid attachment id" },
      { status: 400 },
    );
  }

  // ── Missing-secret guard (T-05-09) ─────────────────────────────────────────
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "[attachments/[id]] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured",
    );
    return NextResponse.json(
      { error: "Storage is not configured" },
      { status: 500 },
    );
  }

  // ── Session identity (T-44-07-04) ───────────────────────────────────────────
  // AUTH-04-style: server-verified getUser() only, never getSession().
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── DB lookup — storageKey + importerId ─────────────────────────────────────
  let storageKey: string | null;
  let importerId: string;

  try {
    const rows = await db
      .select({
        storageKey: EmailAttachments.storageKey,
        importerId: EmailAttachments.importerId,
      })
      .from(EmailAttachments)
      .where(eq(EmailAttachments.id, id))
      .limit(1);

    if (!rows[0]) {
      return NextResponse.json(
        { error: "Attachment not found" },
        { status: 404 },
      );
    }

    storageKey = rows[0].storageKey;
    importerId = rows[0].importerId;
  } catch (err) {
    console.error("[attachments/[id]] DB error:", err);
    return NextResponse.json(
      { error: "Failed to generate download link" },
      { status: 500 },
    );
  }

  if (!storageKey) {
    return NextResponse.json(
      { error: "Attachment not found" },
      { status: 404 },
    );
  }

  // ── Ownership gate (T-44-07-03) ─────────────────────────────────────────────
  // Fail-closed: OwnershipError (missing importer OR belongs to another
  // user) maps to the SAME 404 as "attachment not found" above — no
  // existence oracle.
  try {
    await assertImporterOwnership(db, importerId, user.id);
  } catch (err) {
    if (err instanceof OwnershipError) {
      return NextResponse.json(
        { error: "Attachment not found" },
        { status: 404 },
      );
    }
    console.error("[attachments/[id]] Ownership check error:", err);
    return NextResponse.json(
      { error: "Failed to generate download link" },
      { status: 500 },
    );
  }

  // ── Signed URL generation ──────────────────────────────────────────────────
  // 3600s TTL; cached on the client for 55 min (T-05-08)
  const storageClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await storageClient.storage
    .from("email-attachments")
    .createSignedUrl(storageKey, 3600);

  if (error) {
    console.error("[attachments/[id]] Storage error:", error);
    return NextResponse.json(
      { error: "Failed to generate download link" },
      { status: 500 },
    );
  }

  // Only { url } reaches the browser — service-role key never leaves the server
  return NextResponse.json({ url: data.signedUrl });
}
