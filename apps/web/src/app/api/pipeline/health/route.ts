/**
 * apps/web/src/app/api/pipeline/health/route.ts — server-side-keyed proxy for
 * GET /v1/pipeline/health (the inbox Pipeline health panel's data source).
 *
 * Copies apps/web/src/app/api/knowledge/edges/[edgeId]/promote/route.ts's
 * structure: request-time env read (never module-init, never a public
 * NEXT_PUBLIC var), a jsonError helper, server-verified auth (getUser, never
 * getSession/inbound header), and non-leaking error messages.
 * EMAIL_LISTENER_API_KEY is read ONLY here, at request time, and never
 * reaches client-importable code.
 *
 * ==========================================================================
 * INTEGRATION POINT (sibling lane): the upstream FastAPI endpoint
 * `GET /v1/pipeline/health` is being built in the listener lane (contract:
 * per-importer counts of received / fully-analyzed / failed-at-stage-X, see
 * src/lib/pipeline-health.ts). Until it lands, this proxy returns 502 with a
 * friendly message and the panel shows its honest error state. The path
 * follows the repo's listener prefix convention (`/v1/...` — same as every
 * other proxy here); if the sibling mounts it elsewhere, this is the ONLY
 * line to change.
 * ==========================================================================
 */

import type { NextRequest } from "next/server";

import { createClient } from "~/lib/supabase/server";

interface ListenerConfig {
  readonly url: string;
  readonly apiKey: string;
}

// Read at request time (not module init), never a public env var.
function getListenerConfig(): ListenerConfig {
  const url = process.env.EMAIL_LISTENER_URL;
  const apiKey = process.env.EMAIL_LISTENER_API_KEY;
  if (!url || !apiKey) {
    throw new Error(
      "EMAIL_LISTENER_URL or EMAIL_LISTENER_API_KEY is not configured",
    );
  }
  return { url, apiKey };
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  let listenerConfig: ListenerConfig;
  try {
    listenerConfig = getListenerConfig();
  } catch (error) {
    console.error("[api/pipeline/health] listener config missing:", error);
    return jsonError("Pipeline health is not configured", 500);
  }

  // Server-verified identity (getUser, never getSession / an inbound header),
  // forwarded to FastAPI as X-User-Id alongside the unchanged X-API-Key —
  // the listener scopes the per-importer counts to this user's ownership.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${listenerConfig.url}/v1/pipeline/health`, {
      method: "GET",
      headers: {
        "X-API-Key": listenerConfig.apiKey,
        "X-User-Id": user.id,
      },
      signal: req.signal,
      cache: "no-store",
    });
  } catch (error) {
    console.error("[api/pipeline/health] upstream fetch failed:", error);
    return jsonError("Pipeline health request failed", 502);
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    console.error(`[api/pipeline/health] upstream ${upstream.status}:`, detail);
    // Raw upstream detail is server-log-only — never returned to the client.
    return jsonError("Pipeline health request failed", upstream.status || 502);
  }

  const upstreamJson: unknown = await upstream.json().catch(() => null);
  if (upstreamJson === null) {
    return jsonError("Pipeline health request failed", 502);
  }

  return new Response(JSON.stringify(upstreamJson), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
