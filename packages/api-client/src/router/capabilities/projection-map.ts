/**
 * projection-map.ts — the DECLARED four-face projection of every builtin capability
 * (AI-02 closeout of INV-1: "one capability, declared once, read by four consumers").
 *
 * ## What this module is
 *
 * `packages/capabilities/src/capability.ts` states the contract: each capability projects as
 *   (a) an LLM tool        — `describe` + `input` consumed by a tool loop,
 *   (b) a /capabilities card — the allowlist panel row (`capabilities-surface.tsx`),
 *   (c) a genui block      — the binding layer (`@polytoken/genui/binding`) or a catalog component,
 *   (d) a canvas node      — a `NODE_TYPE_REGISTRY` node type that surfaces it.
 *
 * This module is that contract AS DATA: for every id in `BUILTIN_CAPABILITY_MANIFEST`, the four
 * faces are declared explicitly — including the faces that deliberately do NOT exist yet, which
 * are `{ status: "exception", reason }` entries rather than silence. The enforcement suite
 * (`__tests__/projection-map.test.ts`) iterates the manifest and asserts every DECLARED face
 * actually resolves; a future capability that ships without a declaration here fails that suite.
 * Intentional gaps are auditable data, not special cases inside the test.
 *
 * ## Honesty discipline (same as builtin-manifest.ts)
 *
 * Nothing here is invented:
 *   - tool `status: "live"`     — the id is in the Python chat registry's `tool_defs()` today
 *                                 (`apps/email-listener/app/application/capabilities/registry.py`).
 *   - tool `status: "declared"` — a real `defineCapability(...)` descriptor (describe + Zod input,
 *                                 i.e. a valid tool definition) exists at `declaringSource`; the
 *                                 chat-loop bridge to it is the deliberate seam builtin-manifest.ts
 *                                 documents ("live daemon manifest fetch").
 *   - genui `via: "binding"`    — the capability is reachable from a spec through
 *                                 `CapabilityBindingSchema` → `bindCapability` (REG-04). Resolution
 *                                 happens against the EXECUTING surface's registry instance; on any
 *                                 other surface the binder fails closed (INV-5) — that is the
 *                                 design, not a gap. `via: "component"` (none today) names a
 *                                 dedicated genui catalog entry and is asserted to exist.
 *   - canvas `nodeType`         — the node type's OWN registry description names the capability
 *                                 family (e.g. the browser node: "keyed on the daemon's browser.*
 *                                 capabilities"). See CANVAS_NODE_TYPE_IDS below for the mirror
 *                                 discipline.
 */
import type { BuiltinManifestEntry } from "./builtin-manifest";

// ---------------------------------------------------------------------------
// Canvas node-type mirror
// ---------------------------------------------------------------------------

/**
 * The canvas node-type allowlist — a hand-mirrored copy of the keys of
 * `apps/web/src/app/chat/_canvas/node-type-registry.ts` (NODE_TYPE_REGISTRY).
 *
 * WHY A MIRROR: this package must never import `apps/web` (the dependency points the other way),
 * exactly as builtin-manifest.ts must never import `apps/daemon`. The drift alarm is real, not
 * hope: `apps/web/src/app/capabilities/__tests__/projection-canvas-sync.test.ts` imports BOTH this
 * array and the live NODE_TYPE_REGISTRY and fails on any divergence in either direction.
 */
export const CANVAS_NODE_TYPE_IDS = Object.freeze([
  "chat",
  "genui-panel",
  "knowledge-preview",
  "email-thread",
  "document",
  "source",
  "directory",
  "browser",
  "editor",
  "desktop",
  "circle-pack",
  "spreadsheet",
] as const);

export type CanvasNodeTypeId = (typeof CANVAS_NODE_TYPE_IDS)[number];

// ---------------------------------------------------------------------------
// Face vocabulary
// ---------------------------------------------------------------------------

/**
 * A face that deliberately does not exist yet. The reason is load-bearing: the enforcement suite
 * requires a real explanation (minimum length), and the projection matrix doc renders it verbatim.
 * An exception here is a ROADMAP fact, not an excuse — closing it means replacing this object
 * with a wired face, which the suite then starts asserting.
 */
export type ProjectionException = {
  readonly status: "exception";
  readonly reason: string;
};

/** Face (a): the LLM tool projection. */
export type ToolProjection =
  | {
      /** "live" = in a tool loop today; "declared" = valid descriptor at source, bridge is the seam. */
      readonly status: "live" | "declared";
      /** The repo path of the `defineCapability`/`define_capability` declaration. */
      readonly declaringSource: string;
    }
  | ProjectionException;

/** Face (b): the /capabilities allowlist card. */
export type CardProjection = { readonly status: "wired" } | ProjectionException;

/** Face (c): the genui block projection. */
export type GenuiProjection =
  | { readonly status: "wired"; readonly via: "binding" }
  | {
      readonly status: "wired";
      readonly via: "component";
      /** Must be a key of @polytoken/genui's COMPONENT_REGISTRY — asserted by the suite. */
      readonly componentType: string;
    }
  | ProjectionException;

/** Face (d): the canvas node projection. */
export type CanvasProjection =
  | { readonly status: "wired"; readonly nodeType: CanvasNodeTypeId }
  | ProjectionException;

/** The full four-face declaration for one capability id. */
export type CapabilityProjectionDeclaration = {
  readonly id: BuiltinManifestEntry["id"];
  readonly tool: ToolProjection;
  readonly card: CardProjection;
  readonly genui: GenuiProjection;
  readonly canvas: CanvasProjection;
};

// ---------------------------------------------------------------------------
// Shared face constants (every repetition below is the SAME fact, stated once)
// ---------------------------------------------------------------------------

/** Every manifest entry renders as an allowlist row — capabilities-surface.tsx maps them all. */
const CARD_WIRED: CardProjection = Object.freeze({ status: "wired" });

/** The generic genui face: CapabilityBindingSchema → bindCapability (REG-04, fails closed off-surface). */
const GENUI_VIA_BINDING: GenuiProjection = Object.freeze({ status: "wired", via: "binding" });

const DAEMON_CORE = "apps/daemon/src/tools/capabilities.ts";
const DAEMON_BROWSER = "apps/daemon/src/tools/browser.ts";
const DAEMON_DIR = "apps/daemon/src/tools/dir.ts";
const CONTROL_PLANE_DESKTOP = "packages/capabilities/src/desktop.ts";
const CONTROL_PLANE_CANVAS = "packages/capabilities/src/canvas.ts";
const CONTROL_PLANE_TABLE = "packages/capabilities/src/table.ts";
const CHAT_REGISTRY = "apps/email-listener/app/application/capabilities/registry.py";

const declaredTool = (declaringSource: string): ToolProjection =>
  Object.freeze({ status: "declared", declaringSource });

const liveTool = (declaringSource: string): ToolProjection =>
  Object.freeze({ status: "live", declaringSource });

const canvasNode = (nodeType: CanvasNodeTypeId): CanvasProjection =>
  Object.freeze({ status: "wired", nodeType });

const exception = (reason: string): ProjectionException =>
  Object.freeze({ status: "exception", reason });

// ---------------------------------------------------------------------------
// THE PROJECTION MAP
// ---------------------------------------------------------------------------

/**
 * One declaration per builtin capability. Ordering mirrors BUILTIN_CAPABILITY_MANIFEST for
 * side-by-side review. The suite asserts the id sets are identical in both directions.
 */
export const CAPABILITY_PROJECTIONS: readonly CapabilityProjectionDeclaration[] = Object.freeze([
  // ── daemon builtins ───────────────────────────────────────────────────────────────────────────
  {
    id: "fs.read",
    tool: declaredTool(DAEMON_CORE),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    // Editor node: "load/save travel through the daemon's fs.read/fs.write capabilities".
    canvas: canvasNode("editor"),
  },
  {
    id: "fs.write",
    tool: declaredTool(DAEMON_CORE),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    canvas: canvasNode("editor"),
  },
  {
    id: "fs.list",
    tool: declaredTool(DAEMON_CORE),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    // Directory node: "the live tree arrives via the daemon's fs.list capability".
    canvas: canvasNode("directory"),
  },
  {
    id: "terminal.exec",
    tool: declaredTool(DAEMON_CORE),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    canvas: exception(
      "No terminal canvas node exists. The daemon's interactive session verbs (session.*) are " +
        "router handlers, not registry descriptors (see builtin-manifest.ts DELIBERATE OMISSION); " +
        "a terminal node is a genuinely new surface that lands when session verbs become real " +
        "descriptors — not pure wiring.",
    ),
  },
  {
    id: "git",
    tool: declaredTool(DAEMON_CORE),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    canvas: exception(
      "No repository/git canvas node exists. The nearest surface (directory node) renders a " +
        "file tree, not git state — a dedicated repo node is a new component (CV-* territory), " +
        "not pure wiring over an existing registry.",
    ),
  },

  // ── daemon browser session ────────────────────────────────────────────────────────────────────
  // Browser node: "keyed on the daemon's browser.* capabilities" — all six project to it.
  {
    id: "browser.open",
    tool: declaredTool(DAEMON_BROWSER),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    canvas: canvasNode("browser"),
  },
  {
    id: "browser.navigate",
    tool: declaredTool(DAEMON_BROWSER),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    canvas: canvasNode("browser"),
  },
  {
    id: "browser.screenshot",
    tool: declaredTool(DAEMON_BROWSER),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    canvas: canvasNode("browser"),
  },
  {
    id: "browser.click",
    tool: declaredTool(DAEMON_BROWSER),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    canvas: canvasNode("browser"),
  },
  {
    id: "browser.type",
    tool: declaredTool(DAEMON_BROWSER),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    canvas: canvasNode("browser"),
  },
  {
    id: "browser.close",
    tool: declaredTool(DAEMON_BROWSER),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    canvas: canvasNode("browser"),
  },

  // ── daemon directory tree ─────────────────────────────────────────────────────────────────────
  {
    id: "dir.list_tree",
    tool: declaredTool(DAEMON_DIR),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    canvas: canvasNode("directory"),
  },
  {
    id: "dir.sync_manifest",
    tool: declaredTool(DAEMON_DIR),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    // The directory node IS the watched-folder surface this manifest seam feeds.
    canvas: canvasNode("directory"),
  },

  // ── control-plane Cloud Desktop ───────────────────────────────────────────────────────────────
  // Desktop node: "keyed on the desktop.* control-plane capabilities (spawn/attach/hibernate/
  // destroy)". These four are the in-process-resolvable descriptors (DESKTOP_CAPABILITIES), so
  // the suite additionally asserts their describe/risk/cost/reversibility against the REAL
  // registry objects, not just this mirror.
  {
    id: "desktop.spawn",
    tool: declaredTool(CONTROL_PLANE_DESKTOP),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    canvas: canvasNode("desktop"),
  },
  {
    id: "desktop.destroy",
    tool: declaredTool(CONTROL_PLANE_DESKTOP),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    canvas: canvasNode("desktop"),
  },
  {
    id: "desktop.hibernate",
    tool: declaredTool(CONTROL_PLANE_DESKTOP),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    canvas: canvasNode("desktop"),
  },
  {
    id: "desktop.attach",
    tool: declaredTool(CONTROL_PLANE_DESKTOP),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    canvas: canvasNode("desktop"),
  },

  // ── chat tools (live in registry.tool_defs() today) ──────────────────────────────────────────
  {
    id: "lookup_entity",
    tool: liveTool(CHAT_REGISTRY),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    canvas: exception(
      "No entity canvas node exists — entity detail lives at /entities/[id], off-canvas. An " +
        "entity node is a genuinely new surface (FEATURE-CATALOG EN-*/AI-04 'send to canvas'), " +
        "not pure wiring over the existing node registry.",
    ),
  },
  {
    id: "search_emails",
    tool: liveTool(CHAT_REGISTRY),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    // Email-thread node: "renders a real thread's subject/participants/summary" — the canvas
    // face of an email search hit.
    canvas: canvasNode("email-thread"),
  },
  {
    id: "search_knowledge",
    tool: liveTool(CHAT_REGISTRY),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    // Knowledge-preview node: "a bounded, non-interactive knowledge-graph subgraph".
    canvas: canvasNode("knowledge-preview"),
  },
  {
    id: "web_search",
    tool: liveTool(CHAT_REGISTRY),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    // Source node: "an auto-collected research source ... from a chat_source_ledger capture" —
    // the canvas face of web research output (RCNV-02/RSRCH-03).
    canvas: canvasNode("source"),
  },
  {
    id: "deep_research",
    tool: liveTool(CHAT_REGISTRY),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    canvas: canvasNode("source"),
  },
  // AI-01 canvas-mutation triple (control-plane; landed with the same batch as
  // this gate — entries added at merge time, exactly the friction the gate is
  // designed to create for new capabilities).
  {
    id: "canvas.addNode",
    tool: declaredTool(CONTROL_PLANE_CANVAS),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    canvas: canvasNode("genui-panel"),
  },
  {
    id: "canvas.connect",
    tool: declaredTool(CONTROL_PLANE_CANVAS),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    canvas: canvasNode("genui-panel"),
  },
  {
    id: "canvas.removeNode",
    tool: declaredTool(CONTROL_PLANE_CANVAS),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    canvas: canvasNode("genui-panel"),
  },
  // CV-03 table capabilities (control-plane; landed with the spreadsheet-grid wiring). Their
  // canvas face is the `spreadsheet` node — an agent-proposed table becomes a spreadsheet panel.
  {
    id: "table.create",
    tool: declaredTool(CONTROL_PLANE_TABLE),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    canvas: canvasNode("spreadsheet"),
  },
  {
    id: "table.update",
    tool: declaredTool(CONTROL_PLANE_TABLE),
    card: CARD_WIRED,
    genui: GENUI_VIA_BINDING,
    canvas: canvasNode("spreadsheet"),
  },
]);

/** id → declaration lookup (built once at module load; duplicate ids throw, mirroring INV-2). */
const PROJECTIONS_BY_ID: ReadonlyMap<string, CapabilityProjectionDeclaration> = (() => {
  const byId = new Map<string, CapabilityProjectionDeclaration>();
  for (const declaration of CAPABILITY_PROJECTIONS) {
    if (byId.has(declaration.id)) {
      throw new Error(`[projection-map] duplicate projection declaration for "${declaration.id}"`);
    }
    byId.set(declaration.id, declaration);
  }
  return byId;
})();

/** Resolve a capability id's projection declaration; undefined means AI-02's gate will fail. */
export const getCapabilityProjection = (
  id: string,
): CapabilityProjectionDeclaration | undefined => PROJECTIONS_BY_ID.get(id);
