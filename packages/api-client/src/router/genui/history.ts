/**
 * genui/history.ts — tRPC procedures: genui.historyList + genui.historyById
 *
 * Phase 16-03 (STDO-05/STDO-06): Read-only history spine proxying to FastAPI
 * history endpoints. Re-validates responses at the web boundary (D-17).
 *
 * Security contracts:
 *   D-17: Re-validates FastAPI output with Zod schemas at the web boundary.
 *     Never trusts FastAPI output blindly.
 *   D-15: Best-effort — network/non-2xx errors → [] (historyList) or null
 *     (historyById). No exceptions thrown to the caller.
 *   T-06-07 / T-07-01: EMAIL_LISTENER_API_KEY is read server-side via
 *     getListenerConfig() at call time — never at module init, never NEXT_PUBLIC_.
 *   T-13-19: Non-2xx response bodies are logged server-side only; empty/null
 *     is returned to the caller — no internal error detail leaked.
 *   D-14: historyList returns rows WITHOUT spec_json (lightweight list payload);
 *     historyById returns full detail WITH specJson.
 *   D-16: These procedures surface ONLY ui_spec_templates rows via the
 *     repository port on the FastAPI side.
 */

import { z } from "zod";

import { publicProcedure } from "../../trpc";
import { getListenerConfig } from "../_listener-config";

// ---------------------------------------------------------------------------
// Structured server-side logger (WR-03)
// ---------------------------------------------------------------------------

function logError(procedure: string, event: string, detail: unknown): void {
  process.stderr.write(
    JSON.stringify({
      procedure,
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
// Output schemas (web-boundary re-validation — D-17)
// ---------------------------------------------------------------------------

/**
 * Lightweight summary row — no specJson (D-14).
 * Maps snake_case FastAPI fields to camelCase for TypeScript consumers.
 */
const HistoryRowSchema = z.object({
  id: z.string(),
  intentText: z.string(),
  createdAt: z.string(),
  registryVersion: z.string(),
  useCount: z.number().int().nonnegative(),
  validationStatus: z.string(),
});

export type HistoryRow = z.infer<typeof HistoryRowSchema>;

/**
 * Full detail row — includes specJson (D-14).
 */
const HistoryDetailSchema = z.object({
  id: z.string(),
  intentText: z.string(),
  createdAt: z.string(),
  registryVersion: z.string(),
  useCount: z.number().int().nonnegative(),
  validationStatus: z.string(),
  specJson: z.record(z.unknown()),
});

export type HistoryDetail = z.infer<typeof HistoryDetailSchema>;

// ---------------------------------------------------------------------------
// FastAPI response shape (snake_case from API)
// Parsed before remapping to camelCase output schema.
// ---------------------------------------------------------------------------

const FastApiHistoryRowSchema = z.object({
  id: z.string(),
  intent_text: z.string(),
  created_at: z.string(),
  registry_version: z.string(),
  use_count: z.number().int().nonnegative(),
  validation_status: z.string(),
});

const FastApiHistoryDetailSchema = z.object({
  id: z.string(),
  intent_text: z.string(),
  created_at: z.string(),
  registry_version: z.string(),
  use_count: z.number().int().nonnegative(),
  validation_status: z.string(),
  spec_json: z.record(z.unknown()),
});

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const HistoryListInput = z.object({
  /** Number of rows to return. Defaults to 20; FastAPI clamps to [1, 100]. */
  limit: z.number().int().min(1).max(100).optional(),
  /** Zero-based row offset. Defaults to 0. */
  offset: z.number().int().nonnegative().optional(),
  /** Optional filter by importer UUID. */
  importerId: z.string().optional(),
});

const HistoryByIdInput = z.object({
  /** Primary key UUID of the ui_spec_templates row. */
  id: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Helper: map FastAPI snake_case row to camelCase HistoryRow
// ---------------------------------------------------------------------------

function mapRow(raw: z.infer<typeof FastApiHistoryRowSchema>): HistoryRow {
  return {
    id: raw.id,
    intentText: raw.intent_text,
    createdAt: raw.created_at,
    registryVersion: raw.registry_version,
    useCount: raw.use_count,
    validationStatus: raw.validation_status,
  };
}

function mapDetail(raw: z.infer<typeof FastApiHistoryDetailSchema>): HistoryDetail {
  return {
    id: raw.id,
    intentText: raw.intent_text,
    createdAt: raw.created_at,
    registryVersion: raw.registry_version,
    useCount: raw.use_count,
    validationStatus: raw.validation_status,
    specJson: raw.spec_json,
  };
}

// ---------------------------------------------------------------------------
// historyListProcedure — GET /v1/genui/history (STDO-05)
// ---------------------------------------------------------------------------

export const historyListProcedure = publicProcedure
  .input(HistoryListInput)
  .output(z.array(HistoryRowSchema))
  .query(async ({ input }) => {
    const { url, apiKey } = getListenerConfig();

    // Build query string
    const params = new URLSearchParams();
    if (input.limit !== undefined) params.set("limit", String(input.limit));
    if (input.offset !== undefined) params.set("offset", String(input.offset));
    if (input.importerId !== undefined) params.set("importer_id", input.importerId);

    const queryString = params.toString();
    const endpoint = `${url}/v1/genui/history${queryString ? `?${queryString}` : ""}`;

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "GET",
        headers: {
          "X-API-Key": apiKey,
        },
      });
    } catch (networkErr) {
      // D-15: network failure → best-effort empty list; no throw
      logError("genui.historyList", "genui_history_list_network_error", networkErr);
      return [];
    }

    // T-13-19 / D-15: non-2xx → log server-side, return empty list
    if (!res.ok) {
      let rawDetail: unknown = "(unreadable)";
      try {
        rawDetail = await res.json();
      } catch {
        // ignore parse failure
      }
      logError(
        "genui.historyList",
        "genui_history_list_non2xx_response",
        `status=${res.status} detail=${JSON.stringify(rawDetail)}`,
      );
      return [];
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (parseErr) {
      logError("genui.historyList", "genui_history_list_json_parse_error", parseErr);
      return [];
    }

    // Extract data from ApiResponse envelope: { success, data: [...], error }
    const dataField =
      body !== null &&
      typeof body === "object" &&
      "data" in body &&
      Array.isArray((body as Record<string, unknown>)["data"])
        ? ((body as Record<string, unknown>)["data"] as unknown[])
        : undefined;

    if (dataField === undefined) {
      logError("genui.historyList", "genui_history_list_missing_data_field", JSON.stringify(body));
      return [];
    }

    // D-17: re-validate each row at the web boundary; silently drop malformed rows
    const rows: HistoryRow[] = [];
    for (const rawRow of dataField) {
      const parsed = FastApiHistoryRowSchema.safeParse(rawRow);
      if (parsed.success) {
        rows.push(mapRow(parsed.data));
      } else {
        logError(
          "genui.historyList",
          "genui_history_list_row_validation_failed",
          JSON.stringify(parsed.error.issues),
        );
      }
    }

    return rows;
  });

// ---------------------------------------------------------------------------
// historyByIdProcedure — GET /v1/genui/history/{id} (STDO-06)
// ---------------------------------------------------------------------------

export const historyByIdProcedure = publicProcedure
  .input(HistoryByIdInput)
  .output(HistoryDetailSchema.nullable())
  .query(async ({ input }) => {
    const { url, apiKey } = getListenerConfig();

    const endpoint = `${url}/v1/genui/history/${encodeURIComponent(input.id)}`;

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "GET",
        headers: {
          "X-API-Key": apiKey,
        },
      });
    } catch (networkErr) {
      // D-15: network failure → best-effort null; no throw
      logError("genui.historyById", "genui_history_detail_network_error", networkErr);
      return null;
    }

    // D-15: 404 → null (not found); other non-2xx → log + return null
    if (!res.ok) {
      if (res.status !== 404) {
        let rawDetail: unknown = "(unreadable)";
        try {
          rawDetail = await res.json();
        } catch {
          // ignore
        }
        logError(
          "genui.historyById",
          "genui_history_detail_non2xx_response",
          `status=${res.status} detail=${JSON.stringify(rawDetail)}`,
        );
      }
      return null;
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (parseErr) {
      logError("genui.historyById", "genui_history_detail_json_parse_error", parseErr);
      return null;
    }

    // Extract data from ApiResponse envelope: { success, data: {...}, error }
    const dataField =
      body !== null &&
      typeof body === "object" &&
      "data" in body &&
      (body as Record<string, unknown>)["data"] !== null &&
      typeof (body as Record<string, unknown>)["data"] === "object" &&
      !Array.isArray((body as Record<string, unknown>)["data"])
        ? ((body as Record<string, unknown>)["data"] as Record<string, unknown>)
        : undefined;

    if (dataField === undefined) {
      logError("genui.historyById", "genui_history_detail_missing_data_field", JSON.stringify(body));
      return null;
    }

    // D-17: re-validate at the web boundary
    const parsed = FastApiHistoryDetailSchema.safeParse(dataField);
    if (!parsed.success) {
      logError(
        "genui.historyById",
        "genui_history_detail_validation_failed",
        JSON.stringify(parsed.error.issues),
      );
      return null;
    }

    return mapDetail(parsed.data);
  });
