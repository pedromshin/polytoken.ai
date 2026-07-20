/**
 * panel-node-schemas.ts — Zod boundary for the v2.0 PANEL node.data payloads
 * (directory / browser / editor), a STANDALONE sibling of `node-data-schemas.ts`.
 *
 * WHY A SEPARATE MODULE: the v2.0 canvas-panels slice ships beside a fenced
 * registry — `node-data-schemas.ts` / `node-type-registry.ts` /
 * `canvas-vocabulary.ts` / `node-types.ts` are owned by another wave RIGHT NOW.
 * These schemas follow that file's exact conventions (every object ends in
 * `.strict()`, refs over content, threat comments inline) so the orchestrator's
 * registration step is an IMPORT, not a rewrite:
 *
 *   NODE_TYPE_REGISTRY gains three entries whose `dataSchema` fields point HERE.
 *
 * THE REF-ONLY DISCIPLINE, applied per node (mirrors node-data-schemas.ts):
 *
 * - directory: node.data carries the watched PATH (the anchor the daemon's
 *   fs.list capability keys on) plus a BOUNDED immutable tree-preview snapshot
 *   (`entries`) — the SourceNode deviation restated: there is no per-row web
 *   read procedure for a daemon-watched folder today, so a tiny display payload
 *   rides along rather than N nodes costing N fetches. The LIVE tree arrives
 *   through the daemon seam (`fs.list`), never through this row.
 *
 * - browser: node.data carries ONLY the url the panel's url bar shows. NO
 *   screenshot bytes ever land in node.data — frames stream from the daemon's
 *   `browser.screenshot` capability at view time and are ephemeral by design
 *   (a layout row must never become a screenshot archive).
 *
 * - editor: node.data carries ONLY the filePath ref. NEVER the file content —
 *   content rehydrates through the daemon's `fs.read` and writes back through
 *   `fs.write` (seam), exactly as DocumentNode refuses to persist its spec.
 *
 * THREAT SURFACE (T-61-04 restated for panels): node.data arrives from
 * `chat_canvas_layouts`, a user-writable row, and the restore path re-validates
 * only the generic snapshot schema — NOT these per-type schemas. So:
 *   - `url` gates to absolute http(s) at write time here, AND browser-node.tsx
 *     re-guards at render time (`safeBrowserUrl`, defense in depth). A tampered
 *     javascript:/data:/file: url can never mount in the DOM — and note the
 *     browser panel NEVER mounts the url as an href/iframe src at all: the only
 *     live view is a daemon-produced screenshot image (jailed by construction).
 *   - `path`/`filePath` are DISPLAY TEXT only on the web side. They are never
 *     joined, opened, or fetched by the web app; the daemon's broker
 *     (canonicalizePath + roots) is the sole authority on whether a path is
 *     reachable. Max lengths mirror the daemon's own 4096 caps.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared url gate — same rule as node-data-schemas.ts's isHttpUrl and the
// daemon's navigateInput refine ("file:// would be a filesystem read wearing a
// browser costume"). Re-declared here rather than imported because the sibling
// module does not export it and is FENCED this wave; the panel-nodes test
// asserts the two behaviours agree on the canonical hostile inputs.
// ---------------------------------------------------------------------------

/** Accepts only an absolute http(s) URL. */
export function isHttpPanelUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" || parsed.protocol === "http:";
}

// ---------------------------------------------------------------------------
// DirectoryNodeDataSchema — a watched folder as a canvas node
// ---------------------------------------------------------------------------

/**
 * One row of the bounded tree preview. Flat-with-depth rather than recursive:
 * a recursive Zod schema on a user-writable row invites stack-depth abuse, and
 * the preview renders as indented rows anyway. Depth is capped at 6 and the
 * list at 50 rows — a PREVIEW, not the filesystem.
 */
export const DirectoryEntrySchema = z
  .object({
    name: z.string().min(1).max(255),
    kind: z.enum(["dir", "file"]),
    depth: z.number().int().min(0).max(6),
  })
  .strict();

export type DirectoryEntry = z.infer<typeof DirectoryEntrySchema>;

export const DirectoryNodeDataSchema = z
  .object({
    /** The watched folder's path — the anchor `fs.list`/attach-chat key on.
     * Display text on the web side; the daemon broker owns reachability. */
    path: z.string().min(1).max(4096),
    label: z.string().max(120).optional(),
    /** Bounded immutable preview snapshot (see module header). */
    entries: z.array(DirectoryEntrySchema).max(50).optional(),
  })
  .strict();

export type DirectoryNodeData = z.infer<typeof DirectoryNodeDataSchema>;

// ---------------------------------------------------------------------------
// BrowserNodeDataSchema — a live browser panel shell
// ---------------------------------------------------------------------------

export const BrowserNodeDataSchema = z
  .object({
    /** What the url bar shows. Optional: a panel can exist before first
     * navigate. Write-gated to http(s); render re-guards (defense in depth). */
    url: z
      .string()
      .max(2048)
      .refine(isHttpPanelUrl, { message: "url must be an absolute http(s) URL" })
      .optional(),
    label: z.string().max(120).optional(),
  })
  .strict();

export type BrowserNodeData = z.infer<typeof BrowserNodeDataSchema>;

// ---------------------------------------------------------------------------
// EditorNodeDataSchema — a jailed editor shell anchored on a file path
// ---------------------------------------------------------------------------

export const EditorNodeDataSchema = z
  .object({
    /** The file this editor is about — ref only, NEVER content (see header). */
    filePath: z.string().min(1).max(4096),
    label: z.string().max(120).optional(),
    /** Display hint only ("ts", "py", …) — never executed, never an import. */
    language: z.string().max(40).optional(),
  })
  .strict();

export type EditorNodeData = z.infer<typeof EditorNodeDataSchema>;

// ---------------------------------------------------------------------------
// PANEL_NODE_KIND_GEOMETRY — STAGING for the fenced vocabulary.
//
// `canvas-vocabulary.ts` is owned by another wave, so the three kinds' shape
// claims are stated HERE and the components read this map. The orchestrator
// copies these EXACT literals into CANVAS_NODE_KIND_GEOMETRY (seams list) and
// may then delete this map and re-point the components — or keep it and let
// canvas-vocabulary.test.ts assert agreement. Two maps of one fact is the
// known failure mode; this one is deliberate, temporary, and test-pinned.
//
// The claims, on the axis canvas-vocabulary.ts states (weight = how much of
// the user's OWN material; DOTTED = a view/guess; DOUBLE = a bound artifact):
//
//   directory (2, solid)   the user's OWN files, raw and present in full —
//                          the same claim email-thread makes about real mail.
//                          The preview is bounded but the node IS the folder.
//   browser   (1, dotted)  a live viewport: polytoken's rendering with no
//                          words of its own (1) that is a VIEW, not an
//                          artifact (dotted) — the same claim `source` makes.
//   editor    (2, double)  an artifact BEING authored: the draft is the
//                          user's own material (2) composed toward a bound
//                          standalone piece (double) — document's claim, in
//                          progress.
//
// DOTTED/DOUBLE, never DASHED: tier owns solid-vs-dashed (law 3).
// ---------------------------------------------------------------------------

export const PANEL_NODE_KIND_GEOMETRY = {
  directory: "border-l-2 border-l-ink",
  browser: "border-l border-l-ink border-dotted",
  editor: "border-l-2 border-l-ink border-double",
} as const;

export type PanelNodeKind = keyof typeof PANEL_NODE_KIND_GEOMETRY;

/**
 * PANEL_NODE_KIND_LABEL — polytoken's word for each kind (sans, never behind
 * pmark/chip — these are chrome words, law 2). Staged for
 * CANVAS_NODE_KIND_LABEL exactly as the geometry map above.
 */
export const PANEL_NODE_KIND_LABEL: Record<PanelNodeKind, string> = {
  directory: "Folder",
  browser: "Browser",
  editor: "Editor",
};
