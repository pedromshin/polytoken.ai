/**
 * apps/web/src/app/api/chat/stream/route.ts — SSE proxy for POST
 * /v1/chat/stream (D-24, STREAM-01, T-22-29).
 *
 * Bypasses tRPC: a streaming Response body isn't tRPC-shaped, so this is a
 * plain Next.js route handler. EMAIL_LISTENER_API_KEY is read ONLY here, at
 * request time, and injected as X-API-Key when calling FastAPI — it never
 * reaches client-importable code and is never exposed as a public,
 * browser-visible env var. This mirrors
 * packages/api-client/src/router/_listener-config.ts's contract exactly;
 * duplicated (not imported) because that helper is package-private to
 * @polytoken/api-client's own tRPC router files, not re-exported from its
 * public index.ts.
 *
 * The request body is Zod-validated (defense-in-depth mirroring FastAPI's
 * own Pydantic ChatStreamRequest, apps/email-listener/app/presentation/api/
 * v1/chat_stream.py) before forwarding. The upstream response body is piped
 * straight through as text/event-stream — this route does zero SSE parsing
 * itself (that is useChatStream's job, client-side).
 */

import type { NextRequest } from "next/server";
import { z } from "zod";

import { createClient } from "~/lib/supabase/server";

const CHAT_STREAM_REQUEST_SCHEMA = z.object({
  conversation_id: z.string().uuid(),
  user_text: z.string().min(1).max(8_000),
  model_id: z.string().min(1),
  // Per-conversation reasoning dials (use-model-settings.ts). Optional so a
  // pre-dial client sends the unchanged body; forwarded verbatim to FastAPI
  // (which ignores unknown fields today — Pydantic default extra="ignore").
  model_mode: z.enum(["standard", "thinking"]).optional(),
  reasoning_effort: z.enum(["low", "medium", "high"]).optional(),
});

interface ListenerConfig {
  readonly url: string;
  readonly apiKey: string;
}

// T-22-29 — read at request time (not module init), never a public env var.
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

export async function POST(req: NextRequest): Promise<Response> {
  let listenerConfig: ListenerConfig;
  try {
    listenerConfig = getListenerConfig();
  } catch (error) {
    console.error("[api/chat/stream] listener config missing:", error);
    return jsonError("Chat streaming is not configured", 500);
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError("Invalid request body", 400);
  }

  const parsed = CHAT_STREAM_REQUEST_SCHEMA.safeParse(rawBody);
  if (!parsed.success) {
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
    upstream = await fetch(`${listenerConfig.url}/v1/chat/stream`, {
      method: "POST",
      headers: {
        "X-API-Key": listenerConfig.apiKey,
        "X-User-Id": user.id,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parsed.data),
      signal: req.signal,
    });
  } catch (error) {
    console.error("[api/chat/stream] upstream fetch failed:", error);
    return jsonError("Chat stream request failed", 502);
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    console.error(`[api/chat/stream] upstream ${upstream.status}:`, detail);
    return jsonError("Chat stream request failed", upstream.status || 502);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
