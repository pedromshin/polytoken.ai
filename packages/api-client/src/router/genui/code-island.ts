/**
 * genui/code-island.ts — tRPC procedure: genui.codeIslandGenerate
 *
 * Proxies to FastAPI `POST /v1/genui/code-island/generate`, which emits ARBITRARY
 * JavaScript island code via Bedrock forced-tool-use (Phase 20 full phase). Unlike the
 * declarative `generate` procedure, there is NO spec re-validation here — island code is
 * free-form and is gated instead by the CLIENT-side AST allowlist + repair loop inside the
 * sandboxed frame (@polytoken/genui/sandbox). This procedure only proxies the code string + outcome.
 *
 * Security contracts (mirroring generate.ts):
 *   - EMAIL_LISTENER_API_KEY is server-side only (getListenerConfig(); never NEXT_PUBLIC_).
 *   - Non-2xx / network / parse failures return a friendly, detail-free fallback; the raw
 *     FastAPI error is logged server-side only.
 *   - ApiResponse envelope: { success, data: { code, language, outcome, attempts } | null, error }.
 *   - Phase 44 (TENA-03, T-44-07-04): requires a session (protectedProcedure).
 *     Auth-gate ONLY, mirroring generate.ts — the generation cache stays
 *     deliberately cross-tenant.
 */

import { z } from "zod";

import { protectedProcedure } from "../../trpc";
import { getListenerConfig } from "../_listener-config";

function logError(event: string, detail: unknown): void {
  process.stderr.write(
    JSON.stringify({
      procedure: "genui.codeIslandGenerate",
      event,
      detail:
        detail instanceof Error
          ? { message: detail.message, name: detail.name }
          : String(detail),
      ts: new Date().toISOString(),
    }) + "\n",
  );
}

/** Minimal safe island program shown when generation fails (renders into #island-root). */
const WEB_FALLBACK_CODE =
  "const r=document.getElementById('island-root');" +
  "const d=document.createElement('div');d.setAttribute('role','alert');" +
  "d.textContent='Unable to generate a widget for this request.';" +
  "d.style.cssText='padding:12px;border-radius:8px;background:#fef2f2;color:#991b1b;font:14px system-ui';" +
  "r.appendChild(d);";

const CodeIslandInput = z.object({
  /** Free-text prompt describing the widget the user wants. */
  intent: z.string().min(1).max(4096),
  /** Optional untrusted document content to quarantine (Call A). */
  rawContent: z.string().default(""),
  /** Optional importer context forwarded to the audit row. */
  importerId: z.string().optional(),
});

const CodeIslandOutputSchema = z.object({
  /** The generated island program (plain JS). Always WEB_FALLBACK_CODE on fallback. */
  code: z.string().min(1),
  outcome: z.enum(["ok", "fallback", "escalated"]),
  /** Generator attempts consumed (Haiku→Sonnet escalation). */
  attempts: z.number().int().nonnegative(),
  /** Friendly, non-leaking reason — present only on fallback. */
  reason: z.string().optional(),
});

export type CodeIslandOutput = z.infer<typeof CodeIslandOutputSchema>;

function fallback(reason: string): CodeIslandOutput {
  return { code: WEB_FALLBACK_CODE, outcome: "fallback", attempts: 0, reason };
}

export const codeIslandGenerateProcedure = protectedProcedure
  .input(CodeIslandInput)
  .output(CodeIslandOutputSchema)
  .query(async ({ input }): Promise<CodeIslandOutput> => {
    const { url, apiKey } = getListenerConfig();

    let res: Response;
    try {
      res = await fetch(`${url}/v1/genui/code-island/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({
          intent: input.intent,
          raw_content: input.rawContent,
          importer_id: input.importerId ?? null,
        }),
      });
    } catch (networkErr) {
      logError("code_island_network_error", networkErr);
      return fallback("The generation service is temporarily unavailable.");
    }

    if (!res.ok) {
      let rawDetail: unknown = "(unreadable)";
      try {
        rawDetail = await res.json();
      } catch {
        // ignore
      }
      logError("code_island_non2xx", `status=${res.status} detail=${JSON.stringify(rawDetail)}`);
      return fallback("Could not generate a widget for this request. Please try again.");
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (parseErr) {
      logError("code_island_json_parse_error", parseErr);
      return fallback("Received an unreadable response from the generation service.");
    }

    const dataField =
      body !== null &&
      typeof body === "object" &&
      "data" in body &&
      (body as Record<string, unknown>)["data"] !== null &&
      typeof (body as Record<string, unknown>)["data"] === "object"
        ? ((body as Record<string, unknown>)["data"] as Record<string, unknown>)
        : undefined;

    const rawCode = dataField && typeof dataField["code"] === "string" ? (dataField["code"] as string) : undefined;
    if (rawCode === undefined || rawCode.length === 0) {
      logError("code_island_missing_code_field", JSON.stringify(body));
      return fallback("Received an unexpected response structure from the generation service.");
    }

    const outcome: "ok" | "fallback" | "escalated" =
      dataField &&
      (dataField["outcome"] === "ok" ||
        dataField["outcome"] === "fallback" ||
        dataField["outcome"] === "escalated")
        ? (dataField["outcome"] as "ok" | "fallback" | "escalated")
        : "ok";

    const attempts =
      dataField && typeof dataField["attempts"] === "number" ? (dataField["attempts"] as number) : 0;

    return { code: rawCode, outcome, attempts };
  });
