/**
 * apps/web/src/app/api/knowledge/edges/[edgeId]/promote/route.ts — server-side-keyed
 * proxy for POST /v1/knowledge/edges/{edge_id}/promote (Phase-30 TIER-03 closure,
 * 32-03 T-32-06/07/08).
 *
 * Copies apps/web/src/app/api/chat/widget/submit/route.ts's structure verbatim:
 * request-time env read (never module-init, never a public NEXT_PUBLIC var),
 * Zod-validated route param + body, a jsonError helper, and meaningful-4xx
 * pass-through with friendly, non-leaking messages. EMAIL_LISTENER_API_KEY is
 * read ONLY here, at request time, and never reaches client-importable code
 * (T-32-06, mirrors T-24-13).
 *
 * Unlike a streaming proxy, this is a plain JSON request/response — on success
 * the upstream's { edge_id, tier } view is returned as-is (status 200).
 */

import type { NextRequest } from "next/server";
import { z } from "zod";

import { createClient } from "~/lib/supabase/server";

const EDGE_ID_SCHEMA = z.string().uuid();
const PROMOTE_BODY_SCHEMA = z.object({ importerId: z.string().uuid() });

interface ListenerConfig {
  readonly url: string;
  readonly apiKey: string;
}

// T-32-06 — read at request time (not module init), never a public env var.
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

/** Friendly, non-leaking messages per rejection status (T-32-08 — the raw
 * upstream `detail` is never returned to the client, server-log-only). */
const REJECTION_MESSAGES: Readonly<Record<number, string>> = {
  404: "This suggestion could not be found.",
  409: "This suggestion can no longer be promoted.",
  403: "This suggestion belongs to another workspace.",
};

async function extractUpstreamDetail(upstream: Response): Promise<string | undefined> {
  try {
    const body = (await upstream.json()) as { detail?: unknown };
    return typeof body.detail === "string" ? body.detail : undefined;
  } catch {
    return undefined;
  }
}

interface RouteParams {
  readonly params: Promise<{ readonly edgeId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  let listenerConfig: ListenerConfig;
  try {
    listenerConfig = getListenerConfig();
  } catch (error) {
    console.error("[api/knowledge/edges/promote] listener config missing:", error);
    return jsonError("Promotion is not configured", 500);
  }

  const { edgeId: rawEdgeId } = await params;
  const edgeIdResult = EDGE_ID_SCHEMA.safeParse(rawEdgeId);
  if (!edgeIdResult.success) {
    return jsonError("Invalid edge id", 400);
  }
  const edgeId = edgeIdResult.data;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError("Invalid request body", 400);
  }

  const parsedBody = PROMOTE_BODY_SCHEMA.safeParse(rawBody);
  if (!parsedBody.success) {
    return jsonError("Invalid request body", 400);
  }

  // AUTH-04 — the acting user's identity is resolved server-side via the
  // server-verified getUser() (NEVER getSession(), NEVER an inbound header)
  // and forwarded to FastAPI as X-User-Id, alongside the unchanged X-API-Key.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${listenerConfig.url}/v1/knowledge/edges/${edgeId}/promote`,
      {
        method: "POST",
        headers: {
          "X-API-Key": listenerConfig.apiKey,
          "X-User-Id": user.id,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ importer_id: parsedBody.data.importerId }),
        signal: req.signal,
      },
    );
  } catch (error) {
    console.error("[api/knowledge/edges/promote] upstream fetch failed:", error);
    return jsonError("Promote request failed", 502);
  }

  if (!upstream.ok) {
    if (
      upstream.status === 404 ||
      upstream.status === 409 ||
      upstream.status === 403
    ) {
      const reason = await extractUpstreamDetail(upstream);
      console.error(`[api/knowledge/edges/promote] upstream ${upstream.status}:`, reason);
      return jsonError(
        REJECTION_MESSAGES[upstream.status] ?? "This request was rejected.",
        upstream.status,
      );
    }
    const detail = await upstream.text().catch(() => "");
    console.error(`[api/knowledge/edges/promote] upstream ${upstream.status}:`, detail);
    return jsonError("Promote request failed", upstream.status || 502);
  }

  const upstreamJson: unknown = await upstream.json().catch(() => null);
  return new Response(JSON.stringify(upstreamJson), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
