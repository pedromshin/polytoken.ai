/**
 * chat/models.ts — tRPC query: chat.models
 *
 * Proxies GET /v1/chat/models (FastAPI, 22-02) through the server-side
 * X-API-Key pattern (mirrors genui/generate.ts + _listener-config.ts) so the
 * curated multi-provider registry never requires a client-exposed key
 * (T-22-37). The raw snake_case FastAPI payload is re-validated with Zod at
 * this web boundary — never trust the network blindly, same posture as
 * genui.generate's SpecRootSchema.safeParse — and reshaped to camelCase for
 * the picker (D-04..D-06). Values themselves are never filtered or
 * reinterpreted (T-22-39: the picker renders the server registry verbatim).
 *
 * On any failure (network, non-2xx, malformed JSON, failed re-validation)
 * this procedure fails soft — an empty "unavailable" registry — rather than
 * throwing: a missing model list should degrade the picker to an empty
 * Command list, not crash the /chat page.
 */

import { z } from "zod";

import { publicProcedure } from "../../trpc";
import { getListenerConfig } from "../_listener-config";

// ---------------------------------------------------------------------------
// Structured server-side logger (mirrors genui/generate.ts's logError)
// ---------------------------------------------------------------------------

function logError(event: string, detail: unknown): void {
  process.stderr.write(
    JSON.stringify({
      procedure: "chat.models",
      event,
      detail:
        detail instanceof Error
          ? { message: detail.message, name: detail.name }
          : String(detail),
      ts: new Date().toISOString(),
    }) + "\n",
  );
}

// ---------------------------------------------------------------------------
// Raw (snake_case) response schema — matches chat_models.py's ChatModelsView
// ---------------------------------------------------------------------------

const RawCapabilitiesSchema = z.object({
  tools: z.boolean(),
  genui: z.boolean(),
  streaming: z.boolean(),
  context_tokens: z.number().int().nonnegative(),
});

const RawModelSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  transport: z.enum(["bedrock", "openrouter", "browser"]),
  execution_locus: z.enum(["server", "browser", "remote-peer"]),
  price_in_per_mtok: z.number().nonnegative(),
  price_out_per_mtok: z.number().nonnegative(),
  capabilities: RawCapabilitiesSchema,
  best_for: z.string(),
});

const RawChatModelsSchema = z.object({
  registry_version: z.string(),
  models: z.array(RawModelSchema),
});

// ---------------------------------------------------------------------------
// Output shape — camelCase, what the client consumes
// ---------------------------------------------------------------------------

export const ChatModelCapabilitiesSchema = z.object({
  tools: z.boolean(),
  genui: z.boolean(),
  streaming: z.boolean(),
  contextTokens: z.number().int().nonnegative(),
});

export const ChatModelSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  transport: z.enum(["bedrock", "openrouter", "browser"]),
  executionLocus: z.enum(["server", "browser", "remote-peer"]),
  priceInPerMtok: z.number().nonnegative(),
  priceOutPerMtok: z.number().nonnegative(),
  capabilities: ChatModelCapabilitiesSchema,
  bestFor: z.string(),
});
export type ChatModel = z.infer<typeof ChatModelSchema>;

const ChatModelsOutputSchema = z.object({
  registryVersion: z.string(),
  models: z.array(ChatModelSchema),
});
export type ChatModelsOutput = z.infer<typeof ChatModelsOutputSchema>;

/** Pure, exported mapper — raw snake_case registry entry -> camelCase ChatModel. */
export function toChatModel(raw: z.infer<typeof RawModelSchema>): ChatModel {
  return {
    id: raw.id,
    displayName: raw.display_name,
    transport: raw.transport,
    executionLocus: raw.execution_locus,
    priceInPerMtok: raw.price_in_per_mtok,
    priceOutPerMtok: raw.price_out_per_mtok,
    capabilities: {
      tools: raw.capabilities.tools,
      genui: raw.capabilities.genui,
      streaming: raw.capabilities.streaming,
      contextTokens: raw.capabilities.context_tokens,
    },
    bestFor: raw.best_for,
  };
}

const EMPTY_REGISTRY: ChatModelsOutput = {
  registryVersion: "unavailable",
  models: [],
};

// ---------------------------------------------------------------------------
// Procedure
// ---------------------------------------------------------------------------

export const modelsProcedure = publicProcedure
  .output(ChatModelsOutputSchema)
  .query(async (): Promise<ChatModelsOutput> => {
    const { url, apiKey } = getListenerConfig();

    let res: Response;
    try {
      res = await fetch(`${url}/v1/chat/models`, {
        method: "GET",
        headers: { "X-API-Key": apiKey },
      });
    } catch (networkErr) {
      logError("chat_models_network_error", networkErr);
      return EMPTY_REGISTRY;
    }

    if (!res.ok) {
      let rawDetail: unknown = "(unreadable)";
      try {
        rawDetail = await res.json();
      } catch {
        // ignore parse failure
      }
      logError(
        "chat_models_non2xx_response",
        `status=${res.status} detail=${JSON.stringify(rawDetail)}`,
      );
      return EMPTY_REGISTRY;
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (parseErr) {
      logError("chat_models_json_parse_error", parseErr);
      return EMPTY_REGISTRY;
    }

    // FastAPI envelope: { success, data: { registry_version, models: [...] }, error }
    const dataField =
      body !== null &&
      typeof body === "object" &&
      "data" in body &&
      (body as Record<string, unknown>)["data"] !== null &&
      typeof (body as Record<string, unknown>)["data"] === "object"
        ? ((body as Record<string, unknown>)["data"] as Record<string, unknown>)
        : undefined;

    const parsed = RawChatModelsSchema.safeParse(dataField);
    if (!parsed.success) {
      logError(
        "chat_models_revalidation_failed",
        JSON.stringify(parsed.error.issues),
      );
      return EMPTY_REGISTRY;
    }

    return {
      registryVersion: parsed.data.registry_version,
      models: parsed.data.models.map(toChatModel),
    };
  });
