/**
 * TEMPORARY prod DB diagnostic (2026-07-21). Public, read-only: runs `select 1`
 * through the app's OWN Drizzle client (the same one every tRPC procedure uses)
 * and returns ok/error. Confirms the prod DB connection is healthy end-to-end.
 * DELETE once verified.
 */
import { sql } from "drizzle-orm";

import { db } from "@polytoken/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await db.execute(sql`select 1 as ok`);
    return Response.json({ ok: true, rows });
  } catch (e: unknown) {
    const err = e as { cause?: { message?: string }; message?: string };
    return Response.json(
      { ok: false, error: err?.cause?.message ?? err?.message ?? String(e) },
      { status: 500 },
    );
  }
}
