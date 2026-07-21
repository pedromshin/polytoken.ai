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
// DesktopNodeDataSchema — a jailed remote-desktop panel shell (Cloud Desktop
// epoch, VISION E5 / RFC §4)
// ---------------------------------------------------------------------------

/**
 * REF-ONLY, and HARDER than the sibling panels: node.data carries an OPAQUE
 * session id + display-only chrome, and NEVER a gateway URL or a stream token.
 * Those are minted server-side per session at `desktop.attach` time (RFC §4.3:
 * short-lived, audience-scoped, delivered in the URL fragment, never persisted)
 * — a layout row is not a credential store. The sessionId is opaque per INV-11:
 * it is the anchor `desktop.attach`/`desktop.hibernate`/`desktop.destroy` key
 * on, but it is NEVER parsed for authorization — a DB ownership assert is
 * (RFC §4.3 step 4). status/region/shape are DISPLAY TEXT only, feeding the
 * node's cost/status chrome (RFC §5.3); the control plane is the sole authority
 * on the real machine's state, so a tampered row can mislead the chrome but can
 * never change a VM.
 */
export const DesktopNodeDataSchema = z
  .object({
    /** Opaque session id — the lifecycle-capability anchor. Optional: a node
     * can exist before its session is provisioned. Never parsed for authz. */
    sessionId: z.string().min(1).max(255).optional(),
    /** Lifecycle state for the node's status/cost chrome (RFC §5.3). Display
     * only — the control plane owns the real machine's state. */
    status: z
      .enum(["provisioning", "running", "hibernated", "destroyed"])
      .optional(),
    label: z.string().max(120).optional(),
    /** Display-only provider region (e.g. "eu-central") — chrome, never authz. */
    region: z.string().max(64).optional(),
    /** Display-only instance-shape tag (e.g. "CPX41") — chrome, never authz. */
    shape: z.string().max(64).optional(),
  })
  .strict();

export type DesktopNodeData = z.infer<typeof DesktopNodeDataSchema>;

// ---------------------------------------------------------------------------
// GEOMETRY/LABELS LIVE IN THE VOCABULARY NOW — the staging maps this module
// carried while `canvas-vocabulary.ts` was fenced (PANEL_NODE_KIND_GEOMETRY /
// PANEL_NODE_KIND_LABEL) were PROMOTED at integration: the three kinds are
// registered in `CANVAS_NODE_KIND_GEOMETRY` / `CANVAS_NODE_KIND_LABEL` and the
// components read those maps directly. The staged left-rule/frame claims
// survived verbatim; each kind additionally wears the RIGHT SEAM RULE
// (`border-r-2 border-r-ink`, "a live daemon-backed surface") because the
// staged literals collided with their static siblings (directory ==
// email-thread, browser == source, editor == document) and kind must stay
// structurally DISTINCT (canvas-vocabulary.test.ts's legibility gate, law 3).
// One fact, one map — the deliberate, temporary second map is gone.
// ---------------------------------------------------------------------------
