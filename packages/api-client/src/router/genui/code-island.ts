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

// ---------------------------------------------------------------------------
// Typed-inputs manifest (Phase 76 / 76-02a — the summon-loop passthrough).
//
// When the "Build a tool from these" flow wires ≥2 data nodes into a new
// code-island, it describes each wired source's SHAPE — its targetKey (the
// `window.__ISLAND_DATA__.{targetKey}` the island reads), a human label, the
// source node type, and the top-level field names/types — so the generator can
// write code against the known structure. This carries SHAPE ONLY, never the
// user's row VALUES: the values flow to the running island at runtime through
// the sandbox data channel (BTAP-01), NEVER into the model prompt. Bounded so a
// caller can't smuggle an unbounded blob into the generator.
//
// Additive + back-compat: omitted today by every existing caller, and the
// FastAPI generator ignores the field until 76-02b consumes it, so shipping
// this half needs no listener redeploy.
// ---------------------------------------------------------------------------

const FORBIDDEN_MANIFEST_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** One field of a wired source's published projection — a name + coarse type. */
const CodeIslandInputField = z
  .object({
    name: z.string().min(1).max(120),
    type: z.string().max(40).optional(),
  })
  .strict();

/** One wired source's shape descriptor, keyed by its targetKey in the manifest. */
const CodeIslandInputManifestEntry = z
  .object({
    label: z.string().max(200).optional(),
    nodeType: z.string().max(80).optional(),
    fields: z.array(CodeIslandInputField).max(50).optional(),
    rowCount: z.number().int().nonnegative().optional(),
  })
  .strict();

/** targetKey → shape descriptor. Capped count + prototype-pollution-guarded
 * keys (the targetKey is echoed back to the generator and becomes a property
 * name in the injected data global downstream). */
const CodeIslandInputsManifest = z
  .record(z.string().min(1).max(120), CodeIslandInputManifestEntry)
  .refine((obj) => Object.keys(obj).length <= 32, {
    message: "at most 32 typed inputs",
  })
  .refine((obj) => Object.keys(obj).every((k) => !FORBIDDEN_MANIFEST_KEYS.has(k)), {
    message: "input key must not be __proto__/constructor/prototype",
  });

const CodeIslandInput = z.object({
  /** Free-text prompt describing the widget the user wants. */
  intent: z.string().min(1).max(4096),
  /** Optional untrusted document content to quarantine (Call A). */
  rawContent: z.string().default(""),
  /** Optional importer context forwarded to the audit row. */
  importerId: z.string().optional(),
  /** Optional typed-inputs SHAPE manifest (76-02a) — describes the wired data
   * sources so the generator writes against the known structure. Shape only,
   * never values. Omitted for a plain single-widget generate. */
  inputs: CodeIslandInputsManifest.optional(),
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
          // 76-02a: forward the typed-inputs manifest (shape only). Additive —
          // the FastAPI model ignores it until 76-02b, so this is safe to ship
          // ahead of the listener. `null` when the caller wired no inputs.
          inputs: input.inputs ?? null,
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
