import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@polytoken/db";

// TEMPORARY prod diagnostic (no secrets — password masked; host/ref are public).
// Localizes "signed-in queries return no data" to the exact Postgres endpoint +
// error the running Vercel function hits. Remove after diagnosis.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function endpointOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const userPrefix = u.username ? `${u.username.split(".")[0]}.***` : "?";
    return `${userPrefix}@${u.hostname}:${u.port || "5432"}/${u.pathname.replace(/^\//, "")}`;
  } catch {
    return "unparseable";
  }
}

interface MaybeErr {
  name?: string;
  message?: string;
  code?: string;
  cause?: { message?: string; code?: string };
}

export async function GET(): Promise<NextResponse> {
  const present = (k: string): boolean => (process.env[k] ?? "") !== "";
  const onVercel = Boolean(process.env.VERCEL);
  const info = {
    onVercel,
    selectedVar: onVercel
      ? "POSTGRES_URL (IPv4 pooler)"
      : "POSTGRES_URL_NON_POOLING (direct)",
    postgres_url_endpoint: endpointOf(process.env.POSTGRES_URL),
    postgres_url_non_pooling_endpoint: endpointOf(
      process.env.POSTGRES_URL_NON_POOLING,
    ),
    env_present: {
      POSTGRES_URL: present("POSTGRES_URL"),
      POSTGRES_URL_NON_POOLING: present("POSTGRES_URL_NON_POOLING"),
      SUPABASE_URL: present("SUPABASE_URL"),
      SUPABASE_SERVICE_ROLE_KEY: present("SUPABASE_SERVICE_ROLE_KEY"),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: present("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      EMAIL_LISTENER_URL: present("EMAIL_LISTENER_URL"),
      EMAIL_LISTENER_API_KEY: present("EMAIL_LISTENER_API_KEY"),
    },
  };
  try {
    await db.execute(sql`select 1 as ok`);
    return NextResponse.json({ db: "ok", ...info });
  } catch (e) {
    const err = e as MaybeErr;
    return NextResponse.json({
      db: "FAIL",
      error: {
        name: err.name ?? null,
        message: String(err.message ?? e),
        code: err.code ?? null,
        causeMessage: err.cause?.message ?? null,
        causeCode: err.cause?.code ?? null,
      },
      ...info,
    });
  }
}
