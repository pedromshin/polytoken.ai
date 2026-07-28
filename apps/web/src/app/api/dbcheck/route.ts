import { NextResponse } from "next/server";
import postgres from "postgres";

// TEMPORARY prod diagnostic (no secrets — password masked). Tries a `select 1`
// through EVERY candidate DB-URL env var to find one that authenticates, so a
// stale password on the var the app reads can be fixed by pointing the client at
// a working var (in code) instead of needing Vercel env access. Remove after.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CANDIDATES = [
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NO_SSL",
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "SUPABASE_DB_URL",
  "SUPABASE_POSTGRES_URL",
] as const;

function endpointOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.username || "?"}@${u.hostname}:${u.port || "5432"}/${u.pathname.replace(/^\//, "")}`;
  } catch {
    return "unparseable";
  }
}

function optionsOf(url: string): postgres.Options<Record<string, never>> {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres",
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 12,
  };
}

interface Probe {
  var: string;
  endpoint: string;
  result: "ok" | "fail";
  error?: string;
}

export async function GET(): Promise<NextResponse> {
  const probes: Probe[] = [];
  for (const name of CANDIDATES) {
    const url = process.env[name];
    if (!url) continue;
    const endpoint = endpointOf(url); // username is not secret; password never shown
    let client: postgres.Sql | null = null;
    try {
      client = postgres(optionsOf(url));
      await client`select 1 as ok`;
      probes.push({ var: name, endpoint, result: "ok" });
    } catch (e) {
      const err = e as { message?: string; cause?: { message?: string } };
      probes.push({
        var: name,
        endpoint,
        result: "fail",
        error: String(err.cause?.message ?? err.message ?? e).slice(0, 160),
      });
    } finally {
      if (client) await client.end({ timeout: 2 }).catch(() => {});
    }
  }
  const working = probes.find((p) => p.result === "ok")?.var ?? null;
  return NextResponse.json({
    onVercel: Boolean(process.env.VERCEL),
    workingVar: working,
    probes,
  });
}
