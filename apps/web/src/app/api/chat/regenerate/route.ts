/**
 * apps/web/src/app/api/chat/regenerate/route.ts — SSE proxy for POST
 * /v1/chat/regenerate (D-24, CHAT-04, T-22-29).
 *
 * Identical contract to ../stream/route.ts (see that file's header for the
 * full rationale): EMAIL_LISTENER_API_KEY is read only here, at request
 * time, injected as X-API-Key, never reaching client-importable code or a
 * public/browser-visible env var. The request body is Zod-validated
 * (mirroring FastAPI's Pydantic ChatRegenerateRequest) before forwarding;
 * the upstream body is piped straight through as text/event-stream.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";

import { createClient } from "~/lib/supabase/server";

const CHAT_REGENERATE_REQUEST_SCHEMA = z.object({
  conversation_id: z.string().uuid(),
  assistant_message_id: z.string().uuid(),
  model_id: z.string().min(1),
  // Per-conversation reasoning dials (use-model-settings.ts). Optional +
  // forwarded verbatim; see the stream route for the FastAPI-compat rationale.
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
    console.error("[api/chat/regenerate] listener config missing:", error);
    return jsonError("Chat streaming is not configured", 500);
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError("Invalid request body", 400);
  }

  const parsed = CHAT_REGENERATE_REQUEST_SCHEMA.safeParse(rawBody);
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
    upstream = await fetch(`${listenerConfig.url}/v1/chat/regenerate`, {
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
    console.error("[api/chat/regenerate] upstream fetch failed:", error);
    return jsonError("Chat stream request failed", 502);
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    console.error(
      `[api/chat/regenerate] upstream ${upstream.status}:`,
      detail,
    );
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
