/**
 * node-data-schemas.ts — Zod boundary for canvas node.data payloads
 * (CANVAS-03, D-05, FOUND-2).
 *
 * Mirrors 23-01-PLAN.md's CANONICAL SNAPSHOT SHAPE (packages/api-client's
 * chat/canvas.ts `nodeDataSchema`) in lockstep: node.data carries ONLY
 * provenance/identity refs, NEVER genui spec content. `GenuiPanelNodeDataSchema`
 * additionally `.refine()`s against a top-level `spec`/`root` key — the same
 * shallow guard 23-01 applies to its generic `z.record` node.data — even
 * though `.strict()` alone already rejects an unrecognized `spec` key; the
 * explicit refine keeps the two schemas' intent verbatim-identical and gives
 * a clearer failure message than a generic "unrecognized key" error.
 *
 * Every object ends in `.strict()` (no extra keys tolerated at any node.data
 * boundary — matches packages/genui's Bedrock additionalProperties:false
 * convention, D-22).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// ProvenanceSchema — messageId/partIndex/runId ref (FOUND-5)
// ---------------------------------------------------------------------------

export const ProvenanceSchema = z
  .object({
    messageId: z.string().uuid(),
    partIndex: z.number().int().min(0),
    runId: z.string().uuid().nullable(),
  })
  .strict();

export type Provenance = z.infer<typeof ProvenanceSchema>;

// ---------------------------------------------------------------------------
// GenuiPanelNodeDataSchema — genui-panel node.data (provenance ref only, D-05)
// ---------------------------------------------------------------------------

export const GenuiPanelNodeDataSchema = z
  .object({
    provenance: ProvenanceSchema,
    turnIndex: z.number().int().min(0),
  })
  .strict()
  .refine(
    (data) => !("spec" in data) && !("root" in data),
    {
      message:
        "genui-panel node.data must not contain spec/root keys (D-05) — specs " +
        "rehydrate from chat_messages by provenance, never duplicated in node.data",
    },
  );

export type GenuiPanelNodeData = z.infer<typeof GenuiPanelNodeDataSchema>;

// ---------------------------------------------------------------------------
// ChatNodeDataSchema — chat node.data (conversation ref only)
// ---------------------------------------------------------------------------

export const ChatNodeDataSchema = z
  .object({
    conversationId: z.string().uuid(),
  })
  .strict();

export type ChatNodeData = z.infer<typeof ChatNodeDataSchema>;

// ---------------------------------------------------------------------------
// KnowledgePreviewNodeDataSchema — knowledge-preview node.data (focus node
// ref + optional label only, PREV-01)
// ---------------------------------------------------------------------------

export const KnowledgePreviewNodeDataSchema = z
  .object({
    focusNodeId: z.string().uuid(),
    label: z.string().max(80).optional(),
  })
  .strict();

export type KnowledgePreviewNodeData = z.infer<typeof KnowledgePreviewNodeDataSchema>;

// ---------------------------------------------------------------------------
// EmailThreadNodeDataSchema — email-thread node.data (thread ref + optional
// label only, CLUS-01) — mirrors KnowledgePreviewNodeDataSchema's exact
// provenance-ref-only discipline: node.data carries ONLY a threadId ref,
// never fetched content (subject/participants/summary rehydrate via
// emails.threadCard, 54-01).
// ---------------------------------------------------------------------------

export const EmailThreadNodeDataSchema = z
  .object({
    threadId: z.string().uuid(),
    label: z.string().max(120).optional(),
  })
  .strict();

export type EmailThreadNodeData = z.infer<typeof EmailThreadNodeDataSchema>;

// ---------------------------------------------------------------------------
// DocumentNodeDataSchema — document node.data (document ref + optional label
// only, Phase 70 DOCS-02) — mirrors EmailThreadNodeDataSchema's exact
// provenance-ref-only discipline: node.data carries ONLY a documentId ref,
// never the fetched document content (title/spec rehydrate via
// api.documents.byId, gated through ownership.ts). `.strict()` — no stored
// spec/blocks may ride along in node.data.
// ---------------------------------------------------------------------------

export const DocumentNodeDataSchema = z
  .object({
    documentId: z.string().uuid(),
    label: z.string().max(120).optional(),
  })
  .strict();

export type DocumentNodeData = z.infer<typeof DocumentNodeDataSchema>;

// ---------------------------------------------------------------------------
// SourceNodeDataSchema — source node.data (RCNV-02/RSRCH-03: auto-collected
// research sources as canvas nodes, zero capture ceremony).
//
// THE DELIBERATE DEVIATION from the sibling ref-only discipline, stated so
// nobody "fixes" it into a broken fetch: EmailThreadNode/DocumentNode carry a
// ref and rehydrate via tRPC because their content is authoritative elsewhere
// and can CHANGE. A chat_source_ledger row is the opposite shape — an
// INSERT-only capture (url/title/snippet written once, deduped on
// (conversation, tool_use_id, result_index), never edited), and it has NO
// per-row web read procedure today. So node.data carries the tiny immutable
// display payload itself: the node renders synchronously with zero fetch,
// which is what "sources appear WITHOUT the user asking" needs — N sources
// must not cost N queries for static data. `sourceLedgerId` remains the
// provenance anchor (context-edges' sourceRef type "source_ledger" and the
// Phase 63 promotion gate both key on it).
//
// THE URL IS THE THREAT SURFACE (T-61-04 restated): node.data arrives from
// chat_canvas_layouts, a user-writable row, and the restore path re-validates
// only the generic CanvasSnapshotSchema — NOT this per-type schema. The
// refine below gates writes to http(s) only, and source-node.tsx's
// `safeSourceHref` re-guards at render time (defense in depth) so a tampered
// row can never mount a javascript:/data: href.
//
// `tier` mirrors the suggest-only stance (tier.ts's tierOf): "suggested" =
// auto-collected, nobody confirmed; "confirmed" = promoted into the knowledge
// graph (ledger row's knowledgeNodeId set). OPTIONAL, and a consumer resolves
// an absent/unknown value to "suggested", NEVER "confirmed" — an auto-captured
// source must not silently claim a confirmation the user never gave.
// ---------------------------------------------------------------------------

/** Accepts only an absolute http(s) URL — the one write-side gate against a
 * javascript:/data:/file: href riding a persisted layout row into an <a>. */
function isHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" || parsed.protocol === "http:";
}

export const SourceNodeDataSchema = z
  .object({
    sourceLedgerId: z.string().uuid(),
    url: z
      .string()
      .max(2048)
      .refine(isHttpUrl, { message: "url must be an absolute http(s) URL" }),
    title: z.string().min(1).max(300),
    // The ledger's `snippet`, renamed to what it is on screen. The wiring seam
    // truncates to this cap when it maps a row into node.data.
    excerpt: z.string().max(500).optional(),
    tier: z.enum(["confirmed", "suggested"]).optional(),
  })
  .strict();

export type SourceNodeData = z.infer<typeof SourceNodeDataSchema>;
