/**
 * canvas.ts — the three canvas-mutation capabilities (FEATURE-CATALOG AI-01), declared ONCE as
 * `defineCapability()` descriptors so LLM tool loops, genui, the /capabilities panel, and the
 * canvas itself all read the SAME declaration (INV-1). This is what lets a mid-turn tool loop
 * materialize what it talks about: a research turn drops `source` nodes, "open that thread"
 * drops an `email-thread` node, a generated document drops a `document` node.
 *
 * ## Why this lives in OSS substrate, and how it stays pure
 *
 * The package rule (capability.ts header): NO tenant logic, NO env coupling, NO Supabase. These
 * descriptors carry ZERO persistence code — the layout-row machinery is a `CanvasMutationStore`
 * PORT injected through the executor's context (`TCtx = CanvasExecCtx`), exactly as desktop.ts
 * injects its `DesktopProvider`. The control plane (packages/api-client's
 * `router/chat/canvas-mutations.ts`) binds a Drizzle-backed store that persists through the SAME
 * `chat_canvas_layouts` upsert path the UI's saveCanvasLayout uses — additive, never clobbering
 * the user's layout. Until a store is bound, {@link failClosedCanvasMutationStore} is the default
 * and every verb refuses (INV-5: unbound fails closed).
 *
 * ## The node-type allowlist is a MIRROR (builtin-manifest honesty discipline)
 *
 * `CANVAS_NODE_DATA_SCHEMAS` hand-mirrors the per-type Zod `dataSchema`s from the canvas's
 * declaring source — `apps/web/src/app/chat/_canvas/node-type-registry.ts` (+
 * `node-data-schemas.ts` / `panel-node-schemas.ts`). This package cannot import an app (the
 * dependency arrow runs apps → packages), so — like
 * `packages/api-client/src/router/capabilities/builtin-manifest.ts` — the mirror is hand-copied
 * from the declaring source, never invented, and a drift test in apps/web
 * (`__tests__/canvas-capability-mirror.test.ts`) pins id-set equality and per-type fixture parity
 * so a change at the source trips CI here.
 *
 * FAIL-SAFE BY CONSTRUCTION (the AI-01 contract): an unknown node type is rejected at THIS input
 * schema, so an agent can never write a type the canvas doesn't recognize — and even if a legacy
 * row carries one, the web render path's `resolveNodeType` NEVER throws (it degrades to
 * `UnknownNodeTypePlaceholder`). Nothing here weakens that contract; the schema gate just keeps
 * agent output from ever needing it.
 *
 * ## risk + reversibility are DATA (INV-4)
 *
 * No verb implements its own confirm flow. All three are `risk: "write"` layout-row mutations and
 * all three are reversible: addNode/connect declare no reversibility key (absent ⇒ reversible,
 * the sibling convention); `canvas.removeNode` declares `reversibility: "reversible"` EXPLICITLY
 * and returns the removed node + its detached edges in its output, so a tool loop can undo a
 * removal by re-adding exactly what it took away (reversible-with-undo, stated as data + output
 * shape, never as a bespoke confirm dialog).
 */
import { z } from "zod";

import { defineCapability, type Capability } from "./capability.js";

// ---------------------------------------------------------------------------
// Local guards — mirrored from the canvas boundary conventions
// (api-client's canvas-schema.ts / apps/web's node-data-schemas.ts). Re-declared
// here because substrate sits BELOW api-client in the dependency graph.
// ---------------------------------------------------------------------------

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** True if `value` (or any nested object/array) carries a prototype-pollution key. */
function hasForbiddenKeyDeep(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasForbiddenKeyDeep(item));
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (hasForbiddenKeyDeep((value as Record<string, unknown>)[key])) return true;
  }
  return false;
}

/** True if any dotted-path segment of `path` is a forbidden key (T-23-01 restated). */
function hasForbiddenPathSegment(path: string): boolean {
  return path.split(".").some((segment) => FORBIDDEN_KEYS.has(segment));
}

/** Accepts only an absolute http(s) URL (mirrors node-data-schemas.ts's isHttpUrl). */
function isHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" || parsed.protocol === "http:";
}

// ---------------------------------------------------------------------------
// CANVAS_NODE_DATA_SCHEMAS — the per-type node.data allowlist, MIRRORED from
// apps/web/src/app/chat/_canvas/node-type-registry.ts (see module header for
// the mirror/honesty rationale). Every object ends in `.strict()` — no extra
// keys tolerated at any node.data boundary (D-22 convention).
// ---------------------------------------------------------------------------

const provenanceSchema = z
  .object({
    messageId: z.string().uuid(),
    partIndex: z.number().int().min(0),
    runId: z.string().uuid().nullable(),
  })
  .strict();

const directoryEntrySchema = z
  .object({
    name: z.string().min(1).max(255),
    kind: z.enum(["dir", "file"]),
    depth: z.number().int().min(0).max(6),
  })
  .strict();

export const CANVAS_NODE_DATA_SCHEMAS: Readonly<Record<string, z.ZodTypeAny>> = Object.freeze({
  chat: z.object({ conversationId: z.string().uuid() }).strict(),
  "genui-panel": z
    .object({ provenance: provenanceSchema, turnIndex: z.number().int().min(0) })
    .strict()
    .refine((data) => !("spec" in data) && !("root" in data), {
      message:
        "genui-panel node.data must not contain spec/root keys (D-05) — specs rehydrate from " +
        "chat_messages by provenance, never duplicated in node.data",
    }),
  "knowledge-preview": z
    .object({ focusNodeId: z.string().uuid(), label: z.string().max(80).optional() })
    .strict(),
  "email-thread": z
    .object({ threadId: z.string().uuid(), label: z.string().max(120).optional() })
    .strict(),
  document: z
    .object({ documentId: z.string().uuid(), label: z.string().max(120).optional() })
    .strict(),
  source: z
    .object({
      sourceLedgerId: z.string().uuid(),
      url: z.string().max(2048).refine(isHttpUrl, { message: "url must be an absolute http(s) URL" }),
      title: z.string().min(1).max(300),
      excerpt: z.string().max(500).optional(),
      tier: z.enum(["confirmed", "suggested"]).optional(),
    })
    .strict(),
  directory: z
    .object({
      path: z.string().min(1).max(4096),
      label: z.string().max(120).optional(),
      entries: z.array(directoryEntrySchema).max(50).optional(),
    })
    .strict(),
  browser: z
    .object({
      url: z
        .string()
        .max(2048)
        .refine(isHttpUrl, { message: "url must be an absolute http(s) URL" })
        .optional(),
      label: z.string().max(120).optional(),
    })
    .strict(),
  editor: z
    .object({
      filePath: z.string().min(1).max(4096),
      label: z.string().max(120).optional(),
      language: z.string().max(40).optional(),
    })
    .strict(),
  desktop: z
    .object({
      sessionId: z.string().min(1).max(255).optional(),
      status: z.enum(["provisioning", "running", "hibernated", "destroyed"]).optional(),
      label: z.string().max(120).optional(),
      region: z.string().max(64).optional(),
      shape: z.string().max(64).optional(),
    })
    .strict(),
  // FEATURE-CATALOG CV-03 — spreadsheet node: ref-only, like document/email-thread. node.data
  // carries ONLY a spreadsheetId ref; the columns/rows rehydrate via `spreadsheets.byId`
  // (ownership-gated), never duplicated into the layout row.
  spreadsheet: z
    .object({
      spreadsheetId: z.string().uuid(),
      label: z.string().max(120).optional(),
    })
    .strict(),
});

/** The allowlisted node type ids — MUST stay id-set-equal with apps/web's NODE_TYPE_REGISTRY
 * (pinned by the apps/web drift test). Sorted for stable describes/errors. */
export const CANVAS_NODE_TYPE_IDS: readonly string[] = Object.freeze(
  Object.keys(CANVAS_NODE_DATA_SCHEMAS).sort(),
);

// ---------------------------------------------------------------------------
// Input schemas — the LLM-tool-facing validation boundary (INV-1: `input` IS
// the tool definition's parameter schema).
// ---------------------------------------------------------------------------

// .finite(): Infinity/-NaN survive z.number() but JSON.stringify them to null
// in jsonb, permanently failing snapshot validation on every later load — the
// row would be refused forever and the UI could then save an empty canvas over
// the user's layout (skeptic finding, 2026-07-23).
const positionSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();

export const canvasAddNodeInputSchema = z
  .object({
    conversationId: z.string().uuid(),
    /** MUST be one of CANVAS_NODE_TYPE_IDS — unknown types are rejected here so an agent can
     * never persist a type the canvas doesn't recognize (fail-safe by construction). */
    nodeType: z.string().min(1),
    /** Validated against the node type's own dataSchema in the superRefine below. */
    data: z.record(z.string(), z.unknown()),
    /** Optional — when absent the store computes a non-overlapping placement. */
    position: positionSchema.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (hasForbiddenKeyDeep(input.data)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data"],
        message: "data must not contain __proto__/constructor/prototype keys at any depth",
      });
      return;
    }
    const dataSchema = CANVAS_NODE_DATA_SCHEMAS[input.nodeType];
    if (dataSchema === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodeType"],
        message:
          `unknown node type "${input.nodeType}" — allowed types: ` +
          CANVAS_NODE_TYPE_IDS.join(", "),
      });
      return;
    }
    const parsed = dataSchema.safeParse(input.data);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["data", ...issue.path],
          message: issue.message,
        });
      }
    }
  });
export type CanvasAddNodeInput = z.infer<typeof canvasAddNodeInputSchema>;

/** The defaults the executor applies when a connect call omits the data-edge plumbing — keeps
 * the tool surface simple: a plain "connect these two" is a valid call. (Declared as constants
 * rather than zod `.default()`s because the frozen `Capability.input` type is `ZodType<TInput>`
 * — one type for in AND out — and `.default()` forks the two.) */
export const CANVAS_CONNECT_DEFAULT_SOURCE_PATH = "data";
export const CANVAS_CONNECT_DEFAULT_TARGET_KEY = "input";

export const canvasConnectInputSchema = z
  .object({
    conversationId: z.string().uuid(),
    sourceNodeId: z.string().min(1).max(255),
    targetNodeId: z.string().min(1).max(255),
    /** Dotted path into the source node's published values (data-edge plumbing). Optional —
     * the executor applies {@link CANVAS_CONNECT_DEFAULT_SOURCE_PATH}. */
    sourcePath: z
      .string()
      .min(1)
      .max(255)
      .refine((s) => !hasForbiddenPathSegment(s), {
        message: "sourcePath must not contain a __proto__/constructor/prototype path segment",
      })
      .optional(),
    targetKey: z
      .string()
      .min(1)
      .max(255)
      .refine((s) => !hasForbiddenPathSegment(s), {
        message: "targetKey must not contain a __proto__/constructor/prototype path segment",
      })
      .optional(),
  })
  .strict()
  // Self-loops are never meaningful for data edges and the canvas renders
  // them degenerately (skeptic finding, 2026-07-23).
  .refine((data) => data.sourceNodeId !== data.targetNodeId, {
    message: "sourceNodeId and targetNodeId must differ (self-loops are not allowed)",
  });
export type CanvasConnectInput = z.infer<typeof canvasConnectInputSchema>;

export const canvasRemoveNodeInputSchema = z
  .object({
    conversationId: z.string().uuid(),
    nodeId: z.string().min(1).max(255),
  })
  .strict();
export type CanvasRemoveNodeInput = z.infer<typeof canvasRemoveNodeInputSchema>;

// ---------------------------------------------------------------------------
// Output schemas — snapshots mirror api-client's canvasNodeSchema/canvasEdgeSchema
// shapes so the removeNode output is directly re-addable (the undo payload).
// ---------------------------------------------------------------------------

export const canvasNodeSnapshotSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    position: positionSchema,
    width: z.number().finite().positive().optional(),
    height: z.number().finite().positive().optional(),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();
export type CanvasNodeSnapshot = z.infer<typeof canvasNodeSnapshotSchema>;

export const canvasEdgeSnapshotSchema = z
  .object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    data: z.object({ sourcePath: z.string(), targetKey: z.string() }).strict(),
  })
  .strict();
export type CanvasEdgeSnapshot = z.infer<typeof canvasEdgeSnapshotSchema>;

const addNodeOutputSchema = z
  .object({
    nodeId: z.string().min(1),
    nodeType: z.string().min(1),
    /** false ⇒ a node with this canonical identity already existed; the call was an idempotent
     * no-op and `nodeId` names the existing node. */
    created: z.boolean(),
  })
  .strict();
export type CanvasAddNodeOutput = z.infer<typeof addNodeOutputSchema>;

const connectOutputSchema = z
  .object({
    edgeId: z.string().min(1),
    /** false ⇒ an identical edge already existed; idempotent no-op. */
    created: z.boolean(),
  })
  .strict();
export type CanvasConnectOutput = z.infer<typeof connectOutputSchema>;

const removeNodeOutputSchema = z
  .object({
    /** false ⇒ no such node — an idempotent no-op, never an error (fail-safe: a tool loop
     * retrying a removal must not blow up the turn). */
    removed: z.boolean(),
    /** The removed node exactly as it was persisted — the undo payload (re-add it verbatim). */
    node: canvasNodeSnapshotSchema.nullable(),
    /** Every edge that referenced the removed node, detached alongside it — the rest of the
     * undo payload. */
    detachedEdges: z.array(canvasEdgeSnapshotSchema),
  })
  .strict();
export type CanvasRemoveNodeOutput = z.infer<typeof removeNodeOutputSchema>;

// ---------------------------------------------------------------------------
// The store PORT — the one seam substrate exposes for real persistence. The
// control plane binds a Drizzle-backed implementation over chat_canvas_layouts
// (the SAME upsert machinery saveCanvasLayout uses); substrate holds no DB.
// ---------------------------------------------------------------------------

export interface CanvasMutationStore {
  addNode(input: CanvasAddNodeInput): Promise<CanvasAddNodeOutput>;
  connect(input: CanvasConnectInput): Promise<CanvasConnectOutput>;
  removeNode(input: CanvasRemoveNodeInput): Promise<CanvasRemoveNodeOutput>;
}

/** What the executor receives — the injected store (and nothing tenant-shaped; the binding
 * closes over the DB handle and the ownership-checked conversation). */
export type CanvasExecCtx = { readonly store: CanvasMutationStore };

/** The scope a permission decision is made against — the verb + the conversation it mutates. */
export type CanvasScope = { readonly action: string; readonly conversationId: string };

/** The fails-closed default: no store bound ⇒ every verb refuses (INV-5). */
export const failClosedCanvasMutationStore: CanvasMutationStore = Object.freeze({
  addNode: () =>
    Promise.reject(new Error("[canvas] no layout store configured — canvas mutation is unavailable")),
  connect: () =>
    Promise.reject(new Error("[canvas] no layout store configured — canvas mutation is unavailable")),
  removeNode: () =>
    Promise.reject(new Error("[canvas] no layout store configured — canvas mutation is unavailable")),
});

// ── canvas.addNode ───────────────────────────────────────────────────────────────────────────────
export const canvasAddNodeCapability = defineCapability<
  CanvasAddNodeInput,
  CanvasAddNodeOutput,
  CanvasExecCtx,
  CanvasScope
>({
  id: "canvas.addNode",
  input: canvasAddNodeInputSchema,
  output: addNodeOutputSchema,
  risk: "write",
  cost: "free",
  describe:
    "Add a node to this conversation's canvas so what you talk about becomes visible material: " +
    "an email-thread, document, source, knowledge-preview, chat, genui-panel, directory, " +
    "browser, editor, or desktop node. Additive — never moves or removes anything the user " +
    "placed. Idempotent per referenced object: adding the same thread/document/source twice " +
    "returns the existing node.",
  source: "builtin",
  trust: "first-party",
  scope: (input) => ({ action: "canvas.addNode", conversationId: input.conversationId }),
  execute: (input, ctx) => ctx.store.addNode(input),
});

// ── canvas.connect ───────────────────────────────────────────────────────────────────────────────
export const canvasConnectCapability = defineCapability<
  CanvasConnectInput,
  CanvasConnectOutput,
  CanvasExecCtx,
  CanvasScope
>({
  id: "canvas.connect",
  input: canvasConnectInputSchema,
  output: connectOutputSchema,
  risk: "write",
  cost: "free",
  describe:
    "Draw a data edge between two existing nodes on this conversation's canvas (source node's " +
    "sourcePath feeds the target node's targetKey). Additive and idempotent — an identical edge " +
    "is never duplicated; existing edges and node positions are untouched.",
  source: "builtin",
  trust: "first-party",
  scope: (input) => ({ action: "canvas.connect", conversationId: input.conversationId }),
  execute: (input, ctx) => ctx.store.connect(input),
});

// ── canvas.removeNode ────────────────────────────────────────────────────────────────────────────
export const canvasRemoveNodeCapability = defineCapability<
  CanvasRemoveNodeInput,
  CanvasRemoveNodeOutput,
  CanvasExecCtx,
  CanvasScope
>({
  id: "canvas.removeNode",
  input: canvasRemoveNodeInputSchema,
  output: removeNodeOutputSchema,
  risk: "write",
  // EXPLICITLY reversible (INV-4 data, not a bespoke confirm flow): removal detaches a node from
  // the LAYOUT only — the underlying object (thread, document, source row…) is untouched, and the
  // output returns the removed node + detached edges verbatim so a tool loop can undo by
  // re-adding exactly what it took away.
  reversibility: "reversible",
  cost: "free",
  describe:
    "Remove a node (and its edges) from this conversation's canvas layout. The underlying object " +
    "is never deleted — only its canvas placement — and the removed node and detached edges are " +
    "returned so the removal can be undone by adding them back.",
  source: "builtin",
  trust: "first-party",
  scope: (input) => ({ action: "canvas.removeNode", conversationId: input.conversationId }),
  execute: (input, ctx) => ctx.store.removeNode(input),
});

/**
 * The three canvas-mutation capabilities as one array — the control plane folds this into its
 * registry (INV-1: one declaration, many consumers). Ordered by the natural tool-loop verbs:
 * add, connect, remove.
 */
export const CANVAS_CAPABILITIES: readonly Capability<
  never,
  never,
  CanvasExecCtx,
  CanvasScope
>[] = Object.freeze([
  canvasAddNodeCapability,
  canvasConnectCapability,
  canvasRemoveNodeCapability,
] as unknown as readonly Capability<never, never, CanvasExecCtx, CanvasScope>[]);
