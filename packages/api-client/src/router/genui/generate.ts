/**
 * genui/generate.ts — tRPC procedure: genui.generate
 *
 * Security contracts:
 *   GEN-03 / D-08: The web layer NEVER trusts FastAPI output blindly.
 *     SpecRootSchema.safeParse() re-validates the returned spec at this
 *     web boundary. On any validation failure, SAFE_FALLBACK_SPEC is
 *     returned and the error is logged server-side. The raw invalid spec
 *     is never returned to the caller.
 *
 *   T-13-19: Non-2xx responses from FastAPI return SAFE_FALLBACK_SPEC
 *     with a friendly, detail-free message. The raw error body from
 *     FastAPI (which may contain internal debug info) is logged
 *     server-side only — never surfaced to the caller.
 *
 *   T-06-07 / T-07-01: EMAIL_LISTENER_API_KEY is server-side only.
 *     Read via getListenerConfig() at call time — never module-init,
 *     never NEXT_PUBLIC_. (D-23)
 *
 *   GEN-04: Non-streaming — buffer the full FastAPI response, run
 *     safeParse on the complete spec, then return. No streaming.
 *
 *   CR-01: Request body includes raw_content (default ""), registry_version
 *     (from REGISTRY_VERSION.version), and importer_id so FastAPI receives
 *     all required GenerateUiSpecRequest fields. raw_content is optional —
 *     empty string enables intent-only generation mode (Phase 15 will supply
 *     real document content).
 *
 *   CR-02: FastAPI wraps responses in ApiResponse envelope:
 *     { success: bool, data: { spec: {...} } | null, error: str | null }
 *     Spec extraction must read body.data.spec, not body.spec.
 *
 *   Phase 44 (TENA-03, T-44-07-04): requires a session (protectedProcedure).
 *   Auth-gate ONLY — the generation cache itself stays deliberately
 *   cross-tenant (exact-match cache reuse across users is intended, Plan 01
 *   SC5); this procedure applies no ownership scoping.
 */

import { SAFE_FALLBACK_SPEC, SpecRootSchema } from "@polytoken/genui/schema";
import { REGISTRY_VERSION } from "@polytoken/genui/registry";
import { STYLE_PACK_IDS } from "@polytoken/genui/theme";
import { z } from "zod";

import { protectedProcedure } from "../../trpc";
import { getListenerConfig } from "../_listener-config";

// ---------------------------------------------------------------------------
// Structured server-side logger (WR-03)
// Writes a single JSON line to stderr — stable event names allow log correlation.
// Replaces bare console.error calls for consistent structured output.
// ---------------------------------------------------------------------------

function logError(event: string, detail: unknown): void {
  process.stderr.write(
    JSON.stringify({
      procedure: "genui.generate",
      event,
      detail: detail instanceof Error
        ? { message: detail.message, name: detail.name }
        : String(detail),
      ts: new Date().toISOString(),
    }) + "\n",
  );
}

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const GenerateInput = z.object({
  /** Free-text prompt that describes the user's intent for the UI view. */
  intent: z.string().min(1).max(4096),
  /**
   * Untrusted raw document content to quarantine and render (Call A).
   * Optional: when omitted, the quarantine step runs with empty content,
   * and the generator uses the intent alone (intent-only generation mode).
   * Phase 15 studio UI will supply this field with actual document content.
   */
  rawContent: z.string().default(""),
  /** Optional importer context forwarded to the audit row (D-19). */
  importerId: z.string().optional(),
  /**
   * Style pack id for the visual theme applied by ThemedRoot (Phase 17-03 / D-04).
   * Validated at the web boundary via z.enum(STYLE_PACK_IDS) — unknown ids are
   * rejected before reaching FastAPI (T-17-04).
   * When omitted, FastAPI uses the default pack ("polytoken-teal").
   * D-08: the "auto" sentinel is NEVER sent to FastAPI — callers must resolve
   * Auto/Surprise to a concrete pack id via pickSurprisePack() before calling.
   */
  stylePackId: z.enum(STYLE_PACK_IDS as [string, ...string[]]).optional(),
});

// ---------------------------------------------------------------------------
// Output schema — flat shape carrying outcome, spec, cacheHit, optional reason
//
// D-05: outcome and cacheHit are now threaded from the FastAPI envelope so the
// web/studio layer can distinguish cache-hit from cold and escalated from ok.
//
// SpecRootSchema.safeParse is the authoritative web-boundary gate (D-08 / D-15):
// if it fails, outcome is ALWAYS overridden to "fallback" regardless of what
// FastAPI reported. A safeParse failure means the spec is invalid — we must
// never return it.
// ---------------------------------------------------------------------------

const GenerateOutputSchema = z.object({
  /** Generation outcome as reported by FastAPI (or overridden to "fallback" on web re-validation failure). */
  outcome: z.enum(["ok", "fallback", "escalated"]),
  /** Validated SpecRoot JSON — always SAFE_FALLBACK_SPEC when outcome="fallback". */
  spec: SpecRootSchema,
  /** True when the spec was served from the server-side cache (D-14). */
  cacheHit: z.boolean(),
  /** Friendly, non-leaking reason — present only when outcome="fallback". */
  reason: z.string().optional(),
});

export type GenerateOutput = z.infer<typeof GenerateOutputSchema>;

// ---------------------------------------------------------------------------
// Procedure
// ---------------------------------------------------------------------------

export const generateProcedure = protectedProcedure
  .input(GenerateInput)
  .output(GenerateOutputSchema)
  .query(async ({ input }) => {
    const { url, apiKey } = getListenerConfig();

    // GEN-04: Proxy to FastAPI (non-streaming — buffer full response)
    // CR-01: Send all required FastAPI fields (raw_content + registry_version)
    let res: Response;
    try {
      res = await fetch(`${url}/v1/genui/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify({
          intent: input.intent,
          raw_content: input.rawContent,
          registry_version: REGISTRY_VERSION.version,
          importer_id: input.importerId ?? null,
          // D-04/D-08: forward validated pack id as snake_case; null when omitted
          // so FastAPI can apply the default pack. "auto" is never sent here —
          // callers must resolve to a concrete pack id before calling (D-08).
          style_pack_id: input.stylePackId ?? null,
        }),
      });
    } catch (networkErr) {
      // Network failure — return fallback (T-13-19: no leaked detail)
      logError("genui_generate_network_error", networkErr);
      return {
        outcome: "fallback" as const,
        spec: SAFE_FALLBACK_SPEC,
        cacheHit: false,
        reason: "The generation service is temporarily unavailable.",
      };
    }

    // T-13-19: Non-2xx response → log server-side, return friendly fallback
    if (!res.ok) {
      let rawDetail: unknown = "(unreadable)";
      try {
        rawDetail = await res.json();
      } catch {
        // ignore parse failure
      }
      logError("genui_generate_non2xx_response", `status=${res.status} detail=${JSON.stringify(rawDetail)}`);
      return {
        outcome: "fallback" as const,
        spec: SAFE_FALLBACK_SPEC,
        cacheHit: false,
        reason: "Could not generate a view for this request. Please try again.",
      };
    }

    // Buffer and parse the FastAPI response body
    let body: unknown;
    try {
      body = await res.json();
    } catch (parseErr) {
      logError("genui_generate_json_parse_error", parseErr);
      return {
        outcome: "fallback" as const,
        spec: SAFE_FALLBACK_SPEC,
        cacheHit: false,
        reason: "Received an unreadable response from the generation service.",
      };
    }

    // CR-02: Extract spec, cache_hit, and outcome from the nested ApiResponse envelope:
    //   { success: bool, data: { spec: {...}, cache_hit: bool, outcome: str } | null, error: str | null }
    // Read body.data.spec — NOT body.spec (the old flat assumption was wrong).
    const dataField =
      body !== null &&
      typeof body === "object" &&
      "data" in body &&
      (body as Record<string, unknown>)["data"] !== null &&
      typeof (body as Record<string, unknown>)["data"] === "object"
        ? ((body as Record<string, unknown>)["data"] as Record<string, unknown>)
        : undefined;

    const rawSpec = dataField !== undefined && "spec" in dataField
      ? dataField["spec"]
      : undefined;

    if (rawSpec === undefined) {
      logError("genui_generate_missing_spec_field", JSON.stringify(body));
      return {
        outcome: "fallback" as const,
        spec: SAFE_FALLBACK_SPEC,
        cacheHit: false,
        reason: "Received an unexpected response structure from the generation service.",
      };
    }

    // D-05: Read cache_hit and outcome from the FastAPI envelope.
    // These are informational — outcome will be overridden to "fallback" if safeParse fails (D-08).
    const fastApiCacheHit: boolean =
      dataField !== undefined &&
      "cache_hit" in dataField &&
      typeof dataField["cache_hit"] === "boolean"
        ? dataField["cache_hit"]
        : false;

    const fastApiOutcome: "ok" | "fallback" | "escalated" =
      dataField !== undefined &&
      "outcome" in dataField &&
      (dataField["outcome"] === "ok" ||
        dataField["outcome"] === "fallback" ||
        dataField["outcome"] === "escalated")
        ? (dataField["outcome"] as "ok" | "fallback" | "escalated")
        : "ok";

    // D-08: Re-validate at web boundary — NEVER trust model output blindly.
    // SpecRootSchema.safeParse is authoritative: a failure overrides outcome to "fallback" (D-15).
    const parsed = SpecRootSchema.safeParse(rawSpec);

    if (!parsed.success) {
      // Log the full validation error server-side (not to caller)
      logError("genui_generate_revalidation_failed", JSON.stringify(parsed.error.issues));
      return {
        outcome: "fallback" as const,
        spec: SAFE_FALLBACK_SPEC,
        cacheHit: false,
        reason: "The generated view could not be verified. Showing a safe fallback.",
      };
    }

    // Spec passed re-validation — safe to return with envelope-sourced outcome and cacheHit
    return {
      outcome: fastApiOutcome,
      spec: parsed.data,
      cacheHit: fastApiCacheHit,
    };
  });
