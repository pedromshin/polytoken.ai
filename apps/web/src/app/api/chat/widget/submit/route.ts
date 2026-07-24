/**
 * apps/web/src/app/api/chat/widget/submit/route.ts — SSE proxy for POST
 * /v1/chat/widget/submit (Task 3, 24-03, DCUI-03, T-24-13).
 *
 * Copies apps/web/src/app/api/chat/stream/route.ts's structure verbatim
 * (request-time env read, Zod body validation, upstream pipe, jsonError
 * helper) — EMAIL_LISTENER_API_KEY is read ONLY here, at request time, and
 * never reaches client-importable code (T-24-13, mirrors T-22-29).
 *
 * Unlike the plain stream proxy, a 404/409/422 from FastAPI here is
 * MEANINGFUL to the widget UI (not_found/stale/conflict/invalid — D-10/D-11/
 * D-12) — this route reads the upstream JSON body (FastAPI's HTTPException
 * `{"detail": "..."}`) and passes the REAL status + a friendly `error` + the
 * upstream `reason` straight through, never flattening a 4xx to a generic
 * 502. A genuine 5xx (upstream unreachable, etc.) keeps the existing
 * `stream/route.ts` 502-mapping posture.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";

import { createClient } from "~/lib/supabase/server";

const CHAT_WIDGET_SUBMIT_REQUEST_SCHEMA = z.object({
  conversation_id: z.string().uuid(),
  interaction_id: z.string().uuid(),
  model_id: z.string().min(1),
  result: z.record(z.unknown()),
  // Per-conversation reasoning dials (use-model-settings.ts) — a widget-submit
  // continuation is a model turn too, so it carries the same dials. Optional +
  // forwarded verbatim; see the stream route for the FastAPI-compat rationale.
  model_mode: z.enum(["standard", "thinking"]).optional(),
  reasoning_effort: z.enum(["low", "medium", "high"]).optional(),
});

interface ListenerConfig {
  readonly url: string;
  readonly apiKey: string;
}

// T-24-13 — read at request time (not module init), never a public env var.
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

function jsonError(message: string, status: number, reason?: string): Response {
  return new Response(
    JSON.stringify(reason !== undefined ? { error: message, reason } : { error: message }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  );
}

/** Friendly, non-leaking messages per rejection status (CLAUDE.md guardrail:
 * detailed errors logged server-side only, friendly text client-side). */
const REJECTION_MESSAGES: Readonly<Record<number, string>> = {
  404: "This widget could not be found.",
  409: "This widget has already been answered or is no longer active.",
  422: "This response couldn't be saved. Please try again.",
};

async function extractUpstreamDetail(upstream: Response): Promise<string | undefined> {
  try {
    const body = (await upstream.json()) as { detail?: unknown };
    return typeof body.detail === "string" ? body.detail : undefined;
  } catch {
    return undefined;
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  let listenerConfig: ListenerConfig;
  try {
    listenerConfig = getListenerConfig();
  } catch (error) {
    console.error("[api/chat/widget/submit] listener config missing:", error);
    return jsonError("Chat streaming is not configured", 500);
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError("Invalid request body", 400);
  }

  const parsed = CHAT_WIDGET_SUBMIT_REQUEST_SCHEMA.safeParse(rawBody);
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
    upstream = await fetch(`${listenerConfig.url}/v1/chat/widget/submit`, {
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
    console.error("[api/chat/widget/submit] upstream fetch failed:", error);
    return jsonError("Widget submit request failed", 502);
  }

  if (!upstream.ok || !upstream.body) {
    // 404/409/422 are MEANINGFUL to the widget UI (D-10/D-11/D-12) — pass the
    // REAL status + reason through, never flattened to 502.
    if (upstream.status === 404 || upstream.status === 409 || upstream.status === 422) {
      const reason = await extractUpstreamDetail(upstream);
      console.error(`[api/chat/widget/submit] upstream ${upstream.status}:`, reason);
      return jsonError(
        REJECTION_MESSAGES[upstream.status] ?? "This request was rejected.",
        upstream.status,
        reason,
      );
    }
    const detail = await upstream.text().catch(() => "");
    console.error(`[api/chat/widget/submit] upstream ${upstream.status}:`, detail);
    return jsonError("Widget submit request failed", upstream.status || 502);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
