/**
 * TEMPORARY prod DB diagnostic (2026-07-21). Public, read-only: runs `select 1`
 * through the app's own Drizzle client and returns the exact connection error +
 * which hosts are configured (passwords masked). Lets us SEE the real runtime
 * error without auth/logs. DELETE once the prod-500 is resolved.
 */
import { sql } from "drizzle-orm";

import { db } from "@polytoken/db/client";

export const dynamic = "force-dynamic";

function hostOf(u?: string): string | null {
  if (!u) return null;
  const m = u.match(/@([^/:@]+):(\d+)/);
  return m ? `${m[1]}:${m[2]}` : "unparsed";
}

export async function GET() {
  const info = {
    onVercel: !!process.env.VERCEL,
    postgresUrlHost: hostOf(process.env.POSTGRES_URL),
    nonPoolingHost: hostOf(process.env.POSTGRES_URL_NON_POOLING),
  };
  try {
    const r = await db.execute(sql`select 1 as ok`);
    return Response.json({ ok: true, info, rows: r });
  } catch (e: unknown) {
    // Drizzle wraps the real driver error in `.cause`; dig it out fully.
    const chain: Record<string, unknown>[] = [];
    let cur: unknown = e;
    for (let i = 0; i < 4 && cur; i++) {
      const c = cur as Record<string, unknown>;
      chain.push({
        message: c.message,
        code: c.code,
        errno: c.errno,
        severity: c.severity,
        routine: c.routine,
        detail: c.detail,
        name: c.name,
      });
      cur = c.cause;
    }
    return Response.json({ ok: false, info, chain }, { status: 500 });
  }
}
