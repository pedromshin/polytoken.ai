/**
 * TEMPORARY prod DB diagnostic (2026-07-21). Public, read-only. Determines the
 * exact cause of the "password authentication failed for user postgres" prod
 * failure by trying, server-side, several connection strategies against the
 * SAME env the app uses — and reports which succeeds WITHOUT ever returning a
 * secret value. DELETE once resolved.
 */
import postgres from "postgres";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function hostOf(u?: string): string | null {
  if (!u) return null;
  const m = u.match(/@([^/@]+)\//);
  return m ? m[1] : "unparsed";
}

async function tryConn(
  label: string,
  opts: postgres.Options<Record<string, never>> | string,
): Promise<[string, string]> {
  let sqlc: postgres.Sql | null = null;
  try {
    sqlc =
      typeof opts === "string"
        ? postgres(opts, { prepare: false, max: 1, idle_timeout: 3, connect_timeout: 10 })
        : postgres({ ...opts, prepare: false, max: 1, idle_timeout: 3, connect_timeout: 10 });
    await sqlc`select 1 as ok`;
    return [label, "OK"];
  } catch (e: unknown) {
    const err = e as { cause?: { message?: string }; message?: string };
    return [label, err?.cause?.message ?? err?.message ?? String(e)];
  } finally {
    if (sqlc) await sqlc.end({ timeout: 3 }).catch(() => {});
  }
}

export async function GET() {
  const raw = process.env.POSTGRES_URL ?? "";
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const results: Record<string, string> = {};
  const shape: Record<string, unknown> = { host: hostOf(raw) };

  let parsed: URL | null = null;
  try {
    parsed = new URL(raw);
    shape.username = parsed.username;
    shape.pwLen = parsed.password.length;
    shape.pwNonAlnum = (parsed.password.match(/[^A-Za-z0-9]/g) ?? []).length;
    shape.pwHasPctEncoding = /%[0-9A-Fa-f]{2}/.test(parsed.password);
  } catch (e) {
    shape.parseError = String(e);
  }

  // 1) exactly what the app does today
  for (const [k, v] of [await tryConn("urlString", raw)]) results[k] = v;

  // 2) discrete params with the password URL-decoded (fixes an encoding bug)
  if (parsed) {
    const [k, v] = await tryConn("discreteDecoded", {
      host: parsed.hostname,
      port: Number(parsed.port),
      database: parsed.pathname.slice(1) || "postgres",
      username: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
    });
    results[k] = v;
  }

  // 3) is the Supabase secret key itself the DB password? (some setups)
  if (parsed && secret) {
    const [k, v] = await tryConn("secretAsPassword", {
      host: parsed.hostname,
      port: Number(parsed.port),
      database: parsed.pathname.slice(1) || "postgres",
      username: parsed.username,
      password: secret,
    });
    results[k] = v;
  }

  return Response.json({ shape, results }, { status: 200 });
}
