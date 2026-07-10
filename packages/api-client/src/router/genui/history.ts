/**
 * genui/history.ts — tRPC procedures: genui.historyList + genui.historyById
 *
 * Phase 16-03 (STDO-05/STDO-06): Read-only history spine proxying to FastAPI
 * history endpoints. Re-validates responses at the web boundary (D-17).
 *
 * Phase 44 (TENA-03, closes backlog 999.1): both procedures require a
 * session (protectedProcedure). historyList NEVER forwards importer_id
 * omitted to FastAPI — it derives the caller's owned importer set via
 * `userOwnedImporterIds` (@polytoken/db/ownership) and fans out one FastAPI
 * call per owned importer id (merging + re-sorting client-side by
 * createdAt), closing the "returns all importers' rows" gap. historyById
 * re-checks the returned row's `ui_spec_templates.importer_id` directly via
 * Drizzle (the FastAPI detail view does not carry importer_id) against the
 * caller's owned set — a NULL-importer or foreign-importer row is
 * NOT_FOUND. The genui GENERATION CACHE itself stays deliberately unscoped
 * (Plan 01) — this ownership gate applies only to the history browsing
 * surface, never to cache-hit reuse.
 *
 * Security contracts:
 *   D-17: Re-validates FastAPI output with Zod schemas at the web boundary.
 *     Never trusts FastAPI output blindly.
 *   D-15: Best-effort — network/non-2xx errors → [] (historyList) or null
 *     (historyById). The Phase 44 ownership gate (historyById NOT_FOUND) and
 *     the protectedProcedure session gate (UNAUTHORIZED) are intentional
 *     exceptions to D-15's "never throw" posture — both new in Plan 07.
 *   T-06-07 / T-07-01: EMAIL_LISTENER_API_KEY is read server-side via
 *     getListenerConfig() at call time — never at module init, never NEXT_PUBLIC_.
 *   T-13-19: Non-2xx response bodies are logged server-side only; empty/null
 *     is returned to the caller — no internal error detail leaked.
 *   D-14: historyList returns rows WITHOUT spec_json (lightweight list payload);
 *     historyById returns full detail WITH specJson.
 *   D-16: These procedures surface ONLY ui_spec_templates rows via the
 *     repository port on the FastAPI side.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";

import { TRPCError } from "@trpc/server";

import { SAFE_FALLBACK_SPEC } from "@polytoken/genui/schema";
import { UiSpecTemplates } from "@polytoken/db/schema";
import { userOwnedImporterIds } from "@polytoken/db/ownership";

import { protectedProcedure } from "../../trpc";
import { getListenerConfig } from "../_listener-config";
import { resolveListScope } from "../_scope";

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
// fetchHistoryPage — one FastAPI GET /v1/genui/history call scoped to a
// SINGLE owned importerId (Phase 44 fan-out unit). Best-effort (D-15): any
// failure for THIS page resolves to [] rather than throwing, so a partial
// FastAPI outage for one importer never blocks the caller's other pages.
// ---------------------------------------------------------------------------

async function fetchHistoryPage(page: {
  readonly importerId: string;
  readonly limit: number;
  readonly offset?: number;
}): Promise<HistoryRow[]> {
  const { url, apiKey } = getListenerConfig();

  const params = new URLSearchParams();
  params.set("limit", String(page.limit));
  if (page.offset !== undefined) params.set("offset", String(page.offset));
  // Phase 44 (TENA-03/999.1): ALWAYS a caller-owned importer id — never
  // omitted (omitting it returns every importer's rows on the FastAPI side).
  params.set("importer_id", page.importerId);

  const endpoint = `${url}/v1/genui/history?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
      },
    });
  } catch (networkErr) {
    // D-15: network failure → best-effort empty page; no throw
    logError("genui.historyList", "genui_history_list_network_error", networkErr);
    return [];
  }

  // T-13-19 / D-15: non-2xx → log server-side, return empty page
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
}

// ---------------------------------------------------------------------------
// historyListProcedure — GET /v1/genui/history (STDO-05, Phase 44 user-scoped)
// ---------------------------------------------------------------------------

export const historyListProcedure = protectedProcedure
  .input(HistoryListInput)
  .output(z.array(HistoryRowSchema))
  .query(async ({ ctx, input }) => {
    // Phase 44 (TENA-03/999.1): derive the caller's owned importer scope —
    // an unowned/absent client-supplied importerId filter or an owner-less
    // caller resolves to an empty page, with ZERO FastAPI calls issued.
    const owned = await userOwnedImporterIds(ctx.db, ctx.user.id);
    const scope = resolveListScope(owned, input.importerId);
    if (!scope.ok) {
      return [];
    }

    const limit = input.limit ?? 20;

    // Fan out one FastAPI call per owned importer (FastAPI's importer_id
    // filter is single-valued) and merge, re-sorted by createdAt desc, back
    // down to the requested page size.
    const pages = await Promise.all(
      scope.importerIds.map((importerId) =>
        fetchHistoryPage({ importerId, limit, offset: input.offset }),
      ),
    );

    const merged = pages.flat();
    merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return merged.slice(0, limit);
  });

// ---------------------------------------------------------------------------
// historyByIdProcedure — GET /v1/genui/history/{id} (STDO-06, Phase 44 gated)
// ---------------------------------------------------------------------------

export const historyByIdProcedure = protectedProcedure
  .input(HistoryByIdInput)
  .output(HistoryDetailSchema.nullable())
  .query(async ({ ctx, input }) => {
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

    // Phase 44 (TENA-03/999.1): ownership gate — verify the row's
    // ui_spec_templates.importer_id belongs to the caller BEFORE returning
    // either the real detail or the parse-failure fallback below. The
    // FastAPI detail view does not carry importer_id, so this is a direct,
    // parallel Drizzle lookup (T-44-07-02). A NULL-importer (system-level)
    // generation is not user-browsable — fail-closed NOT_FOUND, same as a
    // foreign-owned row (no existence oracle).
    const [ownershipRow] = await ctx.db
      .select({ importerId: UiSpecTemplates.importerId })
      .from(UiSpecTemplates)
      .where(eq(UiSpecTemplates.id, input.id))
      .limit(1);
    const importerId = ownershipRow?.importerId ?? null;
    if (importerId === null) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    const owned = await userOwnedImporterIds(ctx.db, ctx.user.id);
    if (!owned.includes(importerId)) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }

    // D-17: re-validate at the web boundary.
    // CR-03: On parse failure, degrade to SAFE_FALLBACK_SPEC (D-17 requirement).
    // We still return a HistoryDetail so the UI can render the fallback spec
    // with contextual metadata (id, intentText, etc.) rather than a 404 message.
    // The UI-layer parseSpecSafe() also guards the spec field, but the procedure
    // must supply a non-null detail for that guard to fire (T-16-05-T).
    const parsed = FastApiHistoryDetailSchema.safeParse(dataField);
    if (!parsed.success) {
      logError(
        "genui.historyById",
        "genui_history_detail_validation_failed",
        JSON.stringify(parsed.error.issues),
      );
      // Substitute SAFE_FALLBACK_SPEC for the malformed spec_json field.
      // All other envelope fields are extracted from the raw dataField if present,
      // falling back to safe defaults so mapDetail can produce a well-typed object.
      const fallbackRaw = {
        id: typeof dataField["id"] === "string" ? dataField["id"] : input.id,
        intent_text: typeof dataField["intent_text"] === "string" ? dataField["intent_text"] : "",
        created_at: typeof dataField["created_at"] === "string" ? dataField["created_at"] : new Date().toISOString(),
        registry_version: typeof dataField["registry_version"] === "string" ? dataField["registry_version"] : "unknown",
        use_count: typeof dataField["use_count"] === "number" ? dataField["use_count"] : 0,
        validation_status: typeof dataField["validation_status"] === "string" ? dataField["validation_status"] : "unknown",
        spec_json: SAFE_FALLBACK_SPEC as Record<string, unknown>,
      };
      return mapDetail(fallbackRaw);
    }

    return mapDetail(parsed.data);
  });
