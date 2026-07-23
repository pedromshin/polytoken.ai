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
// SpreadsheetNodeDataSchema — spreadsheet node.data (spreadsheet ref + optional
// label only, FEATURE-CATALOG CV-03) — mirrors DocumentNodeDataSchema's exact
// provenance-ref-only discipline: node.data carries ONLY a spreadsheetId ref,
// never the fetched table (columns/rows rehydrate via api.spreadsheets.byId,
// gated through ownership.ts). `.strict()` — no stored columns/rows may ride
// along in node.data.
// ---------------------------------------------------------------------------

export const SpreadsheetNodeDataSchema = z
  .object({
    spreadsheetId: z.string().uuid(),
    label: z.string().max(120).optional(),
  })
  .strict();

export type SpreadsheetNodeData = z.infer<typeof SpreadsheetNodeDataSchema>;

// ---------------------------------------------------------------------------
// FileNodeDataSchema — file node.data (FEATURE-CATALOG DR-03: a vault file as a
// first-class canvas node). Ref-only like every sibling: node.data carries ONLY
// the vault object's tenant-RELATIVE location (folder path segments + basename)
// and an optional label — NEVER the blob, never a signed URL. The file
// rehydrates (name/size/download) through the ownership-gated files router,
// resolved against `ctx.user.id` at read time, so the ref never carries a
// userId and can never address another tenant's object.
//
// THE PATH IS THE THREAT SURFACE (mirrors SourceNodeDataSchema's url gate):
// node.data arrives from chat_canvas_layouts, a user-writable row, and the
// restore path re-validates only the generic CanvasSnapshotSchema — NOT this
// per-type schema. A ".."/"." segment or an embedded separator, if a downstream
// reader built a storage key naively, would walk out of the user's prefix.
// `isSafeVaultSegment` gates EVERY segment to the same rules the vault-keys
// chokepoint enforces (packages/api-client's VaultSegmentSchema: no empty, no
// dot-segments, no separators, no control chars, <=255), so a tampered row can
// never smuggle a traversal into node.data. The eventual read STILL re-parses
// through `vaultKey(ctx.user.id, …)` — this is defense in depth, not the only
// guard.
// ---------------------------------------------------------------------------

/** Control characters: C0 (NUL..US) and DEL — mirrors vault-keys' CONTROL_CHAR_RE. */
const VAULT_CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

/** A single vault path/name segment is safe iff it survives the vault-keys
 * chokepoint's rules (VaultSegmentSchema). Re-declared here (not imported) so
 * this stays the ONE Zod boundary and its capabilities-package MIRROR can be
 * field-for-field identical without either importing the files router. */
function isSafeVaultSegment(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 255 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !VAULT_CONTROL_CHAR_RE.test(value)
  );
}

export const FileNodeDataSchema = z
  .object({
    /** The vault folder path as validated segments; empty array = vault root. */
    path: z
      .array(
        z.string().refine(isSafeVaultSegment, {
          message: "path segment must be a safe vault name (no traversal/separators)",
        }),
      )
      .max(32),
    /** The file basename — the same safe-segment rules as a path component. */
    name: z.string().refine(isSafeVaultSegment, {
      message: "name must be a safe vault name (no traversal/separators)",
    }),
    label: z.string().max(120).optional(),
  })
  .strict();

export type FileNodeData = z.infer<typeof FileNodeDataSchema>;

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

// ---------------------------------------------------------------------------
// CirclePackNodeDataSchema — circle-pack node.data (FEATURE-CATALOG TM-03 + TM-04).
//
// The node renders the shared `CirclePack` primitive (TM-01) over a SCOPE, and
// like every sibling it carries ONLY a ref, never fetched content: the mailbox
// landscape rehydrates from `emails.circlePackLandscape`, the drive landscape
// from `files.folderSizeRollup`, at render time. Three scopes — the whole
// mailbox (optionally narrowed to one owned importer), a single entity, or the
// DRIVE (optionally rooted at a folder path) — so the agent can drop "show me
// what's eating my inbox" OR "…my drive" (AI-01) as a placed node. `.strict()`
// — no aggregated tree may ride along in node.data (it is derived, owned-scoped
// server-side, and can change).
//
// THE DRIVE FOLDER PATH IS THE THREAT SURFACE (mirrors FileNodeDataSchema): a
// scope==="drive" node may carry `folderPath`, and node.data arrives from
// chat_canvas_layouts (a user-writable row) whose restore re-validates only the
// generic snapshot schema. Every segment is gated to the vault-keys chokepoint's
// safe-segment rules (`isSafeVaultSegment`), so a tampered row can never smuggle
// a "../other-tenant" traversal — and the eventual `folderSizeRollup` re-parses
// through `vaultKey(ctx.user.id, …)` regardless (defense in depth).
// ---------------------------------------------------------------------------

export const CirclePackNodeDataSchema = z
  .object({
    scope: z.enum(["mailbox", "entity", "drive"]),
    /** Required in spirit when scope==="entity"; kept optional at the schema
     * boundary so a tampered row degrades to the mailbox view rather than
     * failing restore (the render path treats a missing entityId as mailbox). */
    entityId: z.string().uuid().optional(),
    /** Optional narrowing to one importer; validated against ownership by the
     * query, never trusted from node.data. */
    importerId: z.string().uuid().optional(),
    /** scope==="drive" only: the tenant-relative vault folder the landscape is
     * rooted at (empty/absent ⇒ whole vault). Every segment is a safe vault name
     * (no traversal/separators) — the query still re-parses through vaultKey. */
    folderPath: z
      .array(
        z.string().refine(isSafeVaultSegment, {
          message: "folderPath segment must be a safe vault name (no traversal/separators)",
        }),
      )
      .max(32)
      .optional(),
    label: z.string().max(120).optional(),
  })
  .strict();

export type CirclePackNodeData = z.infer<typeof CirclePackNodeDataSchema>;

// ---------------------------------------------------------------------------
// Panel node.data schemas (directory / browser / editor) — authored in
// `panel-node-schemas.ts` while this module was fenced (v2.0 canvas-panels
// slice; see that file's header for the per-type ref-only/threat reasoning).
// Re-exported HERE at integration so this module stays the ONE Zod boundary
// for canvas node.data: `node-type-registry.ts` imports every dataSchema from
// this module and nowhere else.
// ---------------------------------------------------------------------------

export {
  BrowserNodeDataSchema,
  DesktopNodeDataSchema,
  DirectoryEntrySchema,
  DirectoryNodeDataSchema,
  EditorNodeDataSchema,
} from "./panel-node-schemas";
export type {
  BrowserNodeData,
  DesktopNodeData,
  DirectoryEntry,
  DirectoryNodeData,
  EditorNodeData,
} from "./panel-node-schemas";
