# Suggested-Feature Catalog — polytoken (2026-07-22)

> Companion to `.planning/research/2026-07-22-META-AUDIT.md` (gap map) and
> `.planning/research/polytoken-vision/VISION.md`. Every suggestion below is grounded in code that
> exists today; repo paths are cited inline. This is a CATALOG, not a roadmap — sequencing lives in
> META-AUDIT §4 and ROADMAP.md; §12 here only summarizes the dependency lattice.
>
> **Connective thread:** AI-driven integration. The registry pattern already appears three times —
> canvas `NODE_TYPE_REGISTRY` (`apps/web/src/app/chat/_canvas/node-type-registry.ts`), genui
> `COMPONENT_REGISTRY` (`packages/genui/src/registry/component-registry.ts`), and the capability
> spine (`packages/capabilities/src/capability.ts`, "one capability, declared once, read by four
> consumers": LLM tool, genui block, daemon executable, canvas node). Almost every feature below is
> a *populate* of one of these registries plus wiring, not a new architecture. That is the thesis
> of this catalog: the AI reads the same declarations the UI renders, so each new surface
> (treemap, spreadsheet, home, drive) becomes simultaneously a human view AND an agent tool.

## Legend

- **Tier 1** — high value / small-to-medium effort; mostly wiring existing assets. Days-to-a-week each.
- **Tier 2** — high value / medium-to-large effort; new surface or new schema, but on existing seams.
- **Tier 3** — strategic / large effort or externally gated (providers, billing, multi-user).
- **V/E** — Value High/Med/Low, Effort Small/Med/Large.
- **⟲ UNWIRED** — reuses an existing-but-unwired asset (code already in-repo, imported by nothing or gated off).
- **Deps:** feature IDs this depends on. IDs: `AI-*` integration spine, `CV-*` canvas, `CI-*` canvas
  interactivity, `TM-*` treemap, `CH-*` chat, `DR-*` drive, `HM-*` home, `EN-*` entities, `ST-*`
  settings, `KN-*` knowledge, `DX-*` distributed inference / remote desktop.

**Assumptions (explicit):**
1. Single-user remains the deployment model through Tier 2 (META-AUDIT: "Multiuser… Greenfield"); no feature below silently requires sharing/RBAC.
2. Phases 68–72 (capability spine, research citations, documents, genui×registry binding, evals) get wired/verified first — several Tier-1 items assume the capability manifest is live (`packages/api-client/src/router/capabilities/builtin-manifest.ts` exists; META-AUDIT calls 68–72 "built-but-unwired").
3. "Circular treemap" is interpreted as zoomable circle packing (containment hierarchy), per the vision wishlist row "Circular treemap (emails or drive) on canvas — Greenfield".
4. Design law applies to everything visual (`docs/design/taste-references.md`, `.planning/phases/58-visual-identity-sketch-pick-human-gate/58-IDENTITY.md`); no feature here re-litigates identity.

---

## 1. AI-Driven Integration Spine (`AI-*`) — the connective thread

These are the cross-cutting features that make chat + canvas + drive + knowledge + capabilities +
inference + desktops feel like ONE system. Everything in later sections either feeds or consumes
these.

### AI-01 — Agent-driven canvas mutation ("the AI can place nodes") — Tier 1, V:H E:M
The canvas has 9 registered node types with Zod data schemas
(`node-type-registry.ts`: chat, genui-panel, knowledge-preview, email-thread, document, source,
directory, browser, editor, desktop) and server-side persistence
(`packages/db/src/schema/chat-canvas-layouts.ts`, `packages/api-client/src/router/chat/canvas.ts`
+ `canvas-schema.ts`). Today only the *user* adds nodes (popovers/pickers). Expose a
`canvas.addNode` / `canvas.connect` / `canvas.removeNode` capability triple via
`defineCapability()` so mid-turn tool loops can materialize what they talk about: research turn →
`source` nodes appear; "open that thread" → `email-thread` node; document generated →
`document` node. The Zod `dataSchema` per node type is already the validation boundary, and
`resolveNodeType` never throws on unknown types — agent output is fail-safe by construction.
**Deps:** none (foundation for CV-02, HM-01, TM-03).
**Why first:** it converts every existing surface into agent-composable material with zero new UI.

### AI-02 — Capability→genui→canvas auto-binding audit + "every capability gets a face" — Tier 1, V:H E:M ⟲ UNWIRED
Phase 71 (genui×registry binding) is built-but-unwired (META-AUDIT §1). Finish the wiring so each
capability in the builtin manifest renders as (a) an LLM tool, (b) a `/capabilities` card
(`apps/web/src/app/capabilities/_components/capabilities-surface.tsx` exists), (c) a genui block,
(d) a canvas node — the INV-1 contract stated verbatim in `packages/capabilities/src/capability.ts`.
Add a CI check: any capability lacking one of the four projections fails the build. **Deps:** none.

### AI-03 — Ingest-time entity resolution + knowledge-edge proposal — Tier 1, V:H E:M
META-AUDIT §3: entity resolution (`resolve_entity_candidates.py`, BlendedRAG RRF) and knowledge
edges are *user-triggered*, not part of inbound ingest, while the vision says "AI establishes
relationships automatically." Wire `resolve → propose edges (tier: suggested)` into
`ingest_inbound_email.py` after persist, respecting the existing tier ladder so nothing lands as
canon without promotion. Pairs with the email-analysis hardening item (ST-04) because ~60
`except Exception` swallow sites currently hide exactly this class of pipeline step.
**Deps:** ST-04 (error surfacing) strongly recommended first.

### AI-04 — Universal "Send to chat / Send to canvas" affordance — Tier 1, V:H E:S
Every object surface (email thread, entity detail `apps/web/src/app/entities/[id]`, knowledge node
detail pane `apps/web/src/app/knowledge/_components/node-detail-pane.tsx`, file row
`apps/web/src/app/files/_components/vault-row.tsx`, document, capability card) gets one shared
action: attach this object as context to a conversation and/or drop it as a node on that
conversation's canvas. The chat side already has context edges
(`packages/db/src/schema/chat-context-edges.ts`, `router/chat/context-edges.ts`) and thread-link
(`router/chat/thread-link.ts`); this is UI plumbing over existing rails. **Deps:** AI-01 for the
canvas half; DR-03 for file context.

### AI-05 — Cross-surface semantic search / command-K omnibox — Tier 2, V:H E:M
`entity_instances` already carries `halfvec` embeddings (`packages/db/src/schema/_halfvec.ts`,
`entity-instances.ts`), emails have extraction + embedding adapters, knowledge nodes exist. One
omnibox that searches emails, entities, knowledge, files, documents, conversations and returns
typed results (each row deep-links AND offers AI-04's "send to chat/canvas"). This is also the
natural host for a *command palette* (see CI-02) — same component, two modes (search vs. verbs).
**Deps:** AI-04; DR-05 (file text extraction) to include file contents.

### AI-06 — Agent memory over the knowledge graph in every chat turn — Tier 2, V:H E:M
Chat already streams with tools and sources (`apps/web/src/app/api/chat/stream`, source ledger +
promote routes). Add a retrieval step that pulls tier-canon knowledge edges + entity profiles
relevant to the conversation cluster into the system context, with citations back to
`/knowledge` nodes rendered via the existing research-trace component
(`apps/web/src/app/chat/_components/research-trace.tsx`). Suggest-only writes back (new edges
proposed at "suggested" tier), preserving the promotion gate. **Deps:** AI-03.

---

## 2. Canvas (`CV-*`)

### CV-01 — Node-type completeness: file/vault node + entity node + spreadsheet node — Tier 1→2, V:H E:M
The registry lacks nodes for three first-class objects that already have backends:
- **file node** (vault object; files router `packages/api-client/src/router/files/index.ts` has
  list/requestDownload) — preview + open + attach-to-chat;
- **entity node** (`entity_instances` + entities router `router/entities/`) — avatar, type, alias
  count, open `/entities/[id]`;
- **spreadsheet node** — see CV-03. Registering is mechanical: Zod schema in
  `node-data-schemas.ts`, entry in `NODE_TYPE_REGISTRY`, component in `_canvas/`. **Deps:** none;
  spreadsheet node depends CV-03.

### CV-02 — Live data-bound panels everywhere — Tier 2, V:H E:M
`use-data-bindings.ts` (324 lines) + `data-edge.tsx` + `edge-payload-schema.ts` already move data
across edges between nodes. Extend bindings so genui panels can subscribe to *queries* (e.g. "all
emails from entity X this week") instead of only message-part provenance — making dashboards that
stay current. This is the substrate HM-01 (home) stands on. **Deps:** AI-02.

### CV-03 — Wire the spreadsheet grid: tables as canvas panels + agent-suggested tables — Tier 2, V:H E:M ⟲ UNWIRED
`packages/ui/src/spreadsheet-grid/` is a complete Excel-like grid — cell editors, renderers,
clipboard, `column-header-menu.tsx`, `row-context-menu.tsx`, `conditional-formatting-dialog.tsx`,
`add-column-dialog.tsx`, validation — imported by NO surface (META-AUDIT: "Built but 100%
unwired"). Wiring plan: (1) persistence schema (`spreadsheets` + `spreadsheet_cells` or JSONB doc
in a new `packages/db/src/schema/spreadsheets.ts` — greenfield, the only new schema here); (2)
`spreadsheet` canvas node; (3) a `table.create`/`table.update` capability so the agent can propose
tables from email extractions ("here are the 14 invoices as a table"); (4) genui `table` catalog
entry (already exists in `packages/genui/src/catalog/manifest.ts`, type `table`) upgrade path from
static table → live grid. **Deps:** CV-01 pattern, AI-01 for agent-created tables.

### CV-04 — Canvas templates / packs — Tier 2, V:M E:M
`controls/pack-switcher.tsx` and `ui_spec_templates` (`packages/db/src/schema/ui-spec-templates.ts`,
template-flywheel research) already exist. Add save/load of *canvas layouts* as named templates
("research board", "email triage board", "entity dossier") — a serialization of
`chat_canvas_layouts` minus instance ids. The agent can instantiate a template as its first
canvas act ("set up a research board for this"). **Deps:** AI-01.

### CV-05 — Cross-conversation canvas references — Tier 3, V:M E:M
Let a node reference an object owned by another conversation's canvas (read-only ghost node with
"open origin"). Prereq for eventual sharing; keep single-user for now. **Deps:** CV-01, HM-01.

---

## 3. Canvas Interactivity (`CI-*`) — dedicated section

Current state (verified in `chat-canvas.tsx`): keyboard handling exists only on the container —
arrow-key panning (50px step), `+`/`=`/`-` zoom, `0` fit-view, `Escape` deselect; React Flow stock
Backspace-deletion is referenced in comments; multi-select exists ONLY for source nodes via the
bespoke `canon-selection.tsx` click-to-toggle accumulation (source nodes opt OUT of stock
selection). Only 2 files in the app handle contextmenu/keydown (META-AUDIT). Node adding goes
through `add-email-thread-popover.tsx`, `add-knowledge-preview-popover.tsx`, and
`edge-creation-picker.tsx`. There is a dismissible `canvas-keyboard-hint.tsx`. React Flow supports
all of the below natively ([context menu example](https://reactflow.dev/examples/interaction/context-menu),
[`multiSelectionKeyCode` / `selectionKeyCode` / `deleteKeyCode` props](https://reactflow.dev/api-reference/react-flow)).

### CI-01 — Right-click context menus (pane, node, edge, selection) — Tier 1, V:H E:M
Four menus via `onPaneContextMenu` / `onNodeContextMenu` / `onEdgeContextMenu` /
`onSelectionContextMenu`:
- **Pane:** "Add node ▸ (one entry per NODE_TYPE_REGISTRY id — generated from the registry, not
  hand-listed)", "Paste", "Fit view", "Save as template" (CV-04).
- **Node:** type-specific verbs sourced from the same declarations the panel toolbar uses
  (`panel-actions-toolbar.tsx`, `panel-action-bridge.ts`, `controls/…` — regenerate, retheme,
  edit-params, version-history) + generic "Duplicate / Remove / Connect to… / Send to chat"
  (AI-04). Risky verbs (e.g. desktop.destroy) inherit the confirm-modal law from
  `reversibility: "irreversible"` in the capability metadata — menus read data, not code (INV-4).
- **Edge:** "Edit label", "Reverse", "Delete", "Open payload" (edge payloads already schema'd in
  `edge-payload-schema.ts`).
- **Selection:** bulk verbs (CI-05).
Reuse the vendored shadcn context-menu from `packages/ui` per the polytoken-design-system skill
(vendor-and-adapt). **Deps:** none. **This is the single highest-leverage interactivity item.**

### CI-02 — Keyboard command map + palette — Tier 1, V:H E:S→M
Extend `handleKeyDown` (chat-canvas.tsx:618) into a declared command map (one table, rendered
three ways: handler, hint card, palette):

| Key | Action | Status |
|---|---|---|
| Arrows | pan 50px | exists |
| `+`/`=`/`-`, `0` | zoom, fit | exists |
| `Escape` | deselect | exists |
| `Delete`/`Backspace` | delete selection (with undo toast) | stock RF; make explicit via `deleteKeyCode` |
| `Cmd/Ctrl+A` | select all nodes | new |
| `Cmd/Ctrl+D` | duplicate selection | new |
| `Cmd/Ctrl+C/V/X` | copy/paste/cut nodes (serialize via node `dataSchema`) | new |
| `Cmd/Ctrl+Z` / `Shift+Z` | undo/redo (see CI-06) | new |
| `Tab` / `Shift+Tab` | cycle node focus (a11y — canvas already `role="application"`) | new |
| `Enter` on focused node | open primary action | new |
| `N` then type-letter, or `Cmd/Ctrl+K` | add-node / command palette (shares AI-05 omnibox) | new |
| `1–9` | jump to saved viewport bookmarks | new |
| `Shift+drag` | rubber-band selection (`selectionKeyCode`) | new |
| `Cmd/Ctrl+click` | additive toggle (`multiSelectionKeyCode`) | new |

Update `canvas-keyboard-hint.tsx` copy from the same table. **Deps:** CI-05 for selection verbs,
CI-06 for undo.

### CI-03 — Drag interactions: drop-to-create, drag-out, snap refinements — Tier 1→2, V:H E:M
- **Drop-to-create:** drag an email row from the inbox three-pane
  (`apps/web/src/app/_components/inbox-three-pane` usage in root `page.tsx`), a file row from
  `/files` (`vault-drop-layer.tsx` already implements drop-target mechanics for uploads — reuse
  its pattern in reverse), an entity card from `/entities`, or an OS file onto the canvas → the
  matching node (or DR-01 upload + file node) appears at drop point. HTML5 DnD with a typed
  `application/x-polytoken-ref` payload validated by the node `dataSchema`.
- **Drag-out:** drag a node onto the chat node's composer → attach as context (AI-04).
- **Connect-by-drag:** `onConnect`/`onConnectEnd` already exist; add drop-on-empty-pane =
  open `edge-creation-picker.tsx` pre-filtered to compatible targets.
**Deps:** AI-04, DR-01.

### CI-04 — Add/remove-node flows unified — Tier 1, V:M E:S
Today adding is per-type popovers. Unify into one "Add node" entry point (pane context menu +
palette + an empty-state CTA in `canvas-empty-state.tsx`) that enumerates `NODE_TYPE_REGISTRY`
and delegates to per-type pickers. Removal: every node card already renders the remove `×`
(D-48-07 touch-target note in canvas-keyboard-hint.tsx); route ALL removal paths (×, Delete key,
context menu) through one `removeNodes(ids)` that (a) schedules persistence save, (b) pushes an
undo entry (CI-06), (c) announces via the existing `aria-live` region. **Deps:** CI-01, CI-06.

### CI-05 — General multi-select + bulk actions — Tier 1, V:H E:M
Generalize beyond `canon-selection.tsx`'s source-only accumulation: shift-drag rubber band +
ctrl/cmd-click additive selection for ALL node types (React Flow props, see
[discussion #3890](https://github.com/xyflow/xyflow/discussions/3890)), with a floating selection
toolbar (the `canon-toolbar.tsx` pattern, generalized): align/distribute, group-move, bulk delete,
bulk connect-to-one-target, "summarize these N nodes in chat" (agent verb — the flagship
AI-integration moment: select 5 emails + 2 sources + a document → one synthesis turn).
Keep source-canon accumulation semantics as a *mode* of the general mechanism, not a parallel
system. **Deps:** CI-01; AI-01 for the agent verb.

### CI-06 — Undo/redo for canvas mutations — Tier 1, V:H E:M
Required for CI-02/04/05 to be safe. Command-pattern stack over the canvas store
(`canvas-store.ts` + `use-canvas-persistence.ts` already centralize mutations + debounced saves —
the seam is there). Scope: add/remove/move/connect/label; NOT chat content. **Deps:** none;
blocks CI-04/05 polish.

### CI-07 — Viewport bookmarks + minimap upgrades — Tier 2, V:L E:S
Named viewport bookmarks persisted in the layout row (viewport already persists via
`handleMoveEnd` → `chat_canvas_layouts`); `1–9` jump keys (CI-02). **Deps:** CI-02.

---

## 4. Circular Treemap (`TM-*`) — emails AND drive

Vision row: "Circular treemap (emails or drive) on canvas — **Greenfield** — zero treemap/
circle-pack code anywhere" (META-AUDIT §3). Recommendation: zoomable **circle packing**
(d3-hierarchy `d3.pack()`), which "uses containment to represent hierarchy" and reads better than
rectangular treemaps for browse-and-zoom, at the cost of some area distortion
([d3-hierarchy pack docs](https://d3js.org/d3-hierarchy/pack),
[Bostock's zoomable circle packing](https://observablehq.com/@d3/zoomable-circle-packing)).
d3-hierarchy is layout-only math — render the circles as React/SVG inside existing surfaces; no
DOM takeover, plays fine inside an xyflow node or a standalone pane.

### TM-01 — Shared `CirclePack` primitive in `packages/ui` — Tier 2, V:H E:M
One component: `hierarchy → packed circles`, click-to-zoom (animated focus transitions per the
Observable pattern), hover card, leaf renderer slot, keyboard navigation (arrow = sibling,
Enter = zoom in, Esc = zoom out), theme-aware per design law. Both TM-02 and TM-04 consume it —
build once. **Deps:** none.

### TM-02 — Email circle pack view — Tier 2, V:H E:M
A fourth inbox view (the three-pane exists at root `page.tsx` → `InboxThreePane`): hierarchy =
entity (sender_profiles/entity_instances) → thread → email, leaf size = message count or bytes,
leaf tint = recency or unread. This is the "see your email as a landscape" moment; clicking a leaf
deep-links `/emails/[id]`; entity circles get AI-04's send-to-chat. Data comes from existing
`emails.listThreads` + entities routers — likely one new aggregate query for counts-by-entity.
**Deps:** TM-01; AI-03 improves grouping quality (resolved entities, not raw addresses).

### TM-03 — Treemap as a canvas node — Tier 2, V:M E:S (after TM-01/02)
Register `circle-pack` in `NODE_TYPE_REGISTRY` with a scope param (entity id / folder id / whole
mailbox / whole vault). The agent can then *place* a treemap in answer to "show me what's eating
my drive" (AI-01). **Deps:** TM-01, AI-01, CV-01 pattern.

### TM-04 — Drive circle pack — Tier 2, V:M E:M
Hierarchy = vault folders → files, leaf size = bytes. Requires per-folder size aggregates the
files router doesn't compute today (it lists a bounded page); add a size-rollup query (and it
becomes the substrate for DR-04 quotas — same aggregate). Zoom into a folder circle ⇒ same state
as `/files` navigation, so the two views share one store. **Deps:** TM-01, DR-04's aggregates
(build together).

---

## 5. Chat (`CH-*`)

### CH-01 — Composer attachments (files-in-chat) — Tier 1, V:H E:M
META-AUDIT: "composer has no attach affordance." Add attach-from-vault + attach-by-upload to
`apps/web/src/app/chat/_components/composer.tsx`, reusing the vault upload path
(`files/index.ts` `requestUpload`) and the existing `attachments` schema/API
(`packages/db/src/schema/attachments.ts`, `apps/web/src/app/api/attachments/[id]`). Attached
files become chat context (and optionally a canvas file node, CV-01). **Deps:** DR-05 for the AI
actually *reading* file content.

### CH-02 — Conversation-as-agent-session upgrades — Tier 1, V:M E:S ⟲ UNWIRED
`apps/web/src/app/sessions/` exists as a surface, WebLLM local inference works
(`use-webllm-engine.ts`, `webllm-loading.tsx`), cost metering is live (`cost-meter.tsx`,
`chat-cost-ledger.ts`, `cost-cap-blocked-card.tsx`). Quick wins: per-conversation default model +
cost cap; "continue in background" (server-run turn that lands results as canvas nodes);
cluster summaries surfaced in the rail (`cluster-summary.ts` router exists,
`thread-cluster-indicator.tsx` exists). **Deps:** none.

### CH-03 — Scheduled/recurring agent runs ("routines") — Tier 2, V:H E:M
A daily triage turn: "summarize new email, propose entity merges, update the home board."
Needs a job runner (the daemon `apps/daemon` or a cron in the listener) + a `runs` trigger table;
results arrive as ordinary chat turns + canvas mutations (AI-01), so no new render path.
**Deps:** AI-01, AI-03; HM-01 is the natural output surface.

### CH-04 — Voice input + dictation on composer — Tier 3, V:L E:M
Browser SpeechRecognition or local Whisper via daemon. Only after Tier-1/2 chat items. **Deps:** CH-01.

---

## 6. Drive / Files (`DR-*`)

Vault exists (`apps/web/src/app/files/`, router with list/createFolder/requestUpload/
requestDownload/remove — verified; **no rename/move procedures**), with drag-drop upload
(`vault-drop-layer.tsx`, `upload-tray.tsx`). META-AUDIT: versioning/backups/quota/files-in-chat
all greenfield.

### DR-01 — Rename + move + multi-select bulk ops — Tier 1, V:H E:S
The missing table-stakes verbs. Two new router procedures + row context menu (reuse the
spreadsheet-grid's `row-context-menu.tsx` interaction pattern or shadcn context-menu), plus
shift-click range select in `vault-listing.tsx`. **Deps:** none.

### DR-02 — File versioning + trash — Tier 2, V:H E:M
`file_versions` table keyed on vault object; `remove` becomes soft-delete to trash with retention;
"restore version" in row menu. Storage adapter seam already isolated
(`router/files/storage-adapter.ts`) so version blobs are a key-suffix scheme, not a new store.
**Deps:** DR-01.

### DR-03 — Files as first-class chat/canvas citizens — Tier 1, V:H E:M
= CH-01 + CV-01 file node + AI-04 on vault rows. Listed here because it's the drive-side
integration moment: right-click a file → "Ask about this file" opens a conversation with the file
attached and a file node on canvas. **Deps:** CH-01, CV-01, AI-04.

### DR-04 — Quotas + usage surface — Tier 2, V:M E:S→M
Per-user byte rollups (shared with TM-04's aggregates), a usage meter in `/files` header and in
Settings (ST-01), soft-block at quota via `requestUpload`. **Deps:** none; co-build with TM-04.

### DR-05 — Content extraction + embedding for vault files — Tier 2, V:H E:M
Extract text (PDF/docx/txt) on upload via the listener's existing extraction/embedding adapters
(the email pipeline already has `extractions.ts` schema + embedding adapter), store halfvec, feed
AI-05 search and CH-01 "AI reads the attachment." **Deps:** none technically; unlocks AI-05/CH-01 depth.

### DR-06 — Daemon-synced folders ↔ vault backup — Tier 3, V:M E:L
The `directory` canvas node already previews daemon-watched folders via `fs.list`; extend to
scheduled one-way backup into the vault (daemon `fs.read` → `requestUpload`). This is the
"backups" wishlist row, and the first capability chain crossing daemon→cloud storage. **Deps:**
DR-02 (versioning is what makes backup non-destructive), daemon liveness.

---

## 7. Home (`HM-*`)

### HM-01 — Agentic genui home: chat canvas as the home surface — Tier 2, V:H E:M ⟲ UNWIRED
META-AUDIT verbatim: "Exists as /chat canvas, not home… home page is the inbox." The panel system
(xyflow + `chat_canvas_layouts` persistence + snap/stash/resize + `panel-actions-toolbar`) is the
asset; the feature is a *pinned, conversation-independent* canvas at `/` — a layout row with a
`home` scope instead of a conversation id (one column/discriminator on `chat-canvas-layouts.ts`,
not a new system). Default board: inbox summary panel (data-bound, CV-02), today's entities,
recent documents, vault usage (DR-04), cost meter. The agent curates it: CH-03 routines rearrange
and repopulate panels; the user can always pin/lock panels (persistence already diffs
positions). The inbox three-pane remains one click away (or becomes a maximized panel).
**Deps:** CV-02, AI-01; CH-03 for the "agentic" half. **This is the flagship Tier-2 feature.**

### HM-02 — Morning brief panel — Tier 2, V:M E:S
A genui panel on the home board rendered from a scheduled synthesis turn (CH-03): new-email
digest by entity, proposed merges awaiting review (EN-02), documents generated overnight.
**Deps:** HM-01, CH-03.

### HM-03 — Home treemap widget — Tier 2, V:M E:S
TM-02/TM-04 embedded as home panels via TM-03's node. **Deps:** TM-03, HM-01.

---

## 8. Entities (`EN-*`)

Gallery/mosaic/table views exist (`entities-gallery.tsx`, `entities-mosaic.tsx`,
`entities-table.tsx`), detail + mutations routers exist, `merged_into`/aliases/halfvec on schema.

### EN-01 — Entity table → spreadsheet-grid upgrade — Tier 1, V:M E:S ⟲ UNWIRED
Swap `entities-table.tsx` internals for `packages/ui/src/spreadsheet-grid` in read-mostly mode
(sorting, column menu, conditional formatting for "needs review" states). The lowest-risk first
wiring of the grid — no persistence schema needed (cells are entity fields; edits go through the
existing entities mutations router). **Deps:** none. **Do this before CV-03 to shake the grid down.**

### EN-02 — Merge-review queue (AI-proposed, human-gated) — Tier 1, V:H E:M
`resolve_entity_candidates.py` produces candidates; give them a review surface: side-by-side
compare, merge (writes `merged_into`), reject (negative example). Once AI-03 runs at ingest, this
queue is the human gate that keeps auto-resolution trustworthy. **Deps:** AI-03.

### EN-03 — Entity dossier: canvas-backed detail page — Tier 2, V:M E:M
`/entities/[id]` becomes a scoped canvas (same HM-01 mechanism, `entity:{id}` scope): threads,
knowledge subgraph (`knowledge-preview-node` exists), documents, a mini treemap of that entity's
mail (TM-03 scoped). **Deps:** HM-01 scoping work, TM-03.

### EN-04 — Correction feedback loop surfaced — Tier 1, V:M E:S
`entity_type_corrections` + reprocess exist but reprocess is bug-suspect (META-AUDIT §3: fragile
SES-id derivation, only supersedes pending regions). Ship the fix + a visible "reprocessed N
emails with your correction" toast/history, so corrections feel consequential. **Deps:** ST-04
hardening batch.

---

## 9. Settings (`ST-*`)

Settings today is exactly ONE page: `apps/web/src/app/settings/forwarding/page.tsx`. Everything
else below is a new pane in a settings shell (Phase 62's redesign is pixel-gated on Pedro — build
panes to slot into it).

### ST-01 — Settings shell + panes: account, models & cost, storage, capabilities — Tier 1, V:H E:M
- **Models & cost:** default model, per-conversation caps (data already in `chat-cost-ledger` +
  models registry `router/chat/models.ts` with transport/execution_locus axes), WebLLM model
  management (⟲ the browser engine exists).
- **Storage:** DR-04 usage + trash/retention controls.
- **Capabilities & permissions:** the ONE permission model's home — per-capability
  allow/ask/deny, driven by `risk`/`reversibility` metadata (INV-4: "risk is DATA"); renders from
  the builtin manifest, same declarations as `/capabilities`. **Deps:** DR-04 for storage pane;
  AI-02 for capability pane fidelity.

### ST-02 — BYOK provider keys — Tier 2, V:M E:M
OpenRouter/Bedrock key entry per user; prereq for DX-02 credit stories and for anyone-but-Pedro
use. Encrypt at rest; never expose to browser. **Deps:** ST-01 shell.

### ST-03 — Daemon & desktop management pane — Tier 2, V:M E:S
Paired daemons, watched-folder scopes, desktop sessions list with live cost
(`desktop_sessions.hourly_rate_cents` exists) and hibernate/destroy verbs (confirm-modal via
reversibility metadata). **Deps:** ST-01; DX-03 for live desktops.

### ST-04 — Email pipeline health surface — Tier 1, V:H E:M
The META-AUDIT bug section as a *feature*: stop swallowing (`ingest_inbound_email.py:160-313`
`propose_regions_failed` et al., silent LLM-adapter degradation at
`entity_type_classifier_adapter.py:218`, `segmentation_adapter.py:179`), persist per-stage
status, and render a "N emails received / M fully analyzed / K failed at stage X — Retry"
panel. Without this, every AI-integration feature above inherits invisible failure. **Deps:**
none. **Highest-priority non-UI item in the catalog.**

---

## 10. Knowledge (`KN-*`) — brief, as connective tissue

Graph surface is mature (tier filter, expand, merge, legend, detail pane). Two integration items:
- **KN-01 — Promotion inbox** (Tier 1, V:M E:S): one queue of suggested edges/sources awaiting
  promotion (promote endpoints exist: `api/knowledge/edges/[edgeId]/promote`,
  `api/chat/sources/[ledgerId]/promote`); today promotion is scattered per-surface. Feeds HM-02.
- **KN-02 — Knowledge-scoped chat** (Tier 2, V:M E:S): "chat with this subgraph" from the node
  detail pane = AI-04 + AI-06 scoped retrieval.

---

## 11. Distributed Inference & Remote Desktop (`DX-*`)

Both have design docs and deliberate seams; neither should be improvised beyond them
(`.planning/research/e7-inference/ARCHITECTURE.md`, `.planning/research/cloud-desktop/RFC.md`).

### DX-01 — `inference.run` capability + daemon-local locus — Tier 2, V:M E:M ⟲ UNWIRED (seam)
E7 doc §0: the model registry already declares `execution_locus: "server" | "browser" |
"remote-peer"` ("remote-peer reserved, unused today") and the capability substrate is the job
envelope — an `InferenceProvider` port exactly like `desktop.ts`'s `DesktopProvider`. First
increment: `daemon-local` locus (user's own machine via the daemon), $0-cost convention already
in place (D-08). This makes "run this summarization on my desktop GPU" a model-picker choice, not
a mode. **Deps:** AI-02; daemon liveness. Model-picker UI already supports transport axes.

### DX-02 — Peer pooling + credits — Tier 3, V:M E:L (venture-gated)
E7 is "parked at its gate as a venture decision" (VISION header). When opened: pooled locus =
another provider binding; credits/BYOK (ST-02) become the accounting layer. Prior art for
consumer-device pooling exists but is explicitly experimental in 2026 — exo (local clusters,
[TechRadar](https://www.techradar.com/computing/bittorrent-for-llm-exo-software-is-a-distributed-llm-solution-that-can-run-even-on-old-smartphones-and-computers),
[comparison](https://sharedllm.org/blog/sharedllm-vs-petals-vs-exo.html)) and Petals
(public BitTorrent-style serving). **Deps:** DX-01, ST-02, multi-user groundwork. Do not schedule
before the gate.

### DX-03 — Live desktop node (provider binding + stream iframe) — Tier 2→3, V:M E:L
Everything up to the provider is built fail-closed: `desktop_sessions` table (hourly rate, idle
reaper), 4 capabilities with irreversibility metadata (`packages/capabilities/src/desktop.ts`),
desktop router + provider port (`router/desktop/provider.ts`), canvas `desktop` node shell
("no iframe mounted yet"). The feature = bind Hetzner per RFC §2.2, mint stream tokens, mount the
jailed iframe, live cost ticker on the node chrome (rate is already on the row). **Deps:** AI-02
(permission model reads reversibility), ST-03 pane; billing appetite. **The RFC, not this
catalog, governs scope.**

### DX-04 — Desktop as agent tool — Tier 3, V:M E:M
Once DX-03 is live: agent can spawn/attach within permission gates, e.g. "open this .blend file
on a desktop and screenshot it into the canvas." Pure capability composition. **Deps:** DX-03, AI-01.

---

## 12. Dependency lattice + suggested order (summary)

**Unwired-asset shortlist (build nothing new, wire what exists):** spreadsheet-grid (EN-01 →
CV-03), chat canvas as home (HM-01), capability manifest → four projections (AI-02), WebLLM
model management (ST-01), sessions surface (CH-02), desktop node/provider seam (DX-03),
`remote-peer` locus (DX-01).

**Foundational order (each unlocks the most downstream items):**
1. **ST-04** email-pipeline health (everything AI-driven inherits its reliability)
2. **AI-02** capability wiring closeout (= v1.11 close, Assumption 2)
3. **AI-01** agent canvas mutation + **CI-01/CI-02/CI-05/CI-06** interactivity block (one phase)
4. **AI-03 + EN-02** ingest-time resolution with human gate
5. **CH-01/DR-01/DR-03/AI-04** files-and-context wiring block
6. **EN-01 → CV-03** spreadsheet wiring (small proof, then panels)
7. **TM-01 → TM-02 → TM-04/TM-03** treemap track (parallel-friendly, UI-heavy)
8. **CV-02 → HM-01 → CH-03/HM-02** agentic home track (the flagship)
9. **ST-01/ST-02/ST-03** settings build-out alongside 5–8
10. **DX-01** when daemon work resumes; **DX-03** on billing appetite; **DX-02** stays gated

**External sources:** [d3-hierarchy pack](https://d3js.org/d3-hierarchy/pack) ·
[Zoomable circle packing (Bostock/Observable)](https://observablehq.com/@d3/zoomable-circle-packing) ·
[React Flow context-menu example](https://reactflow.dev/examples/interaction/context-menu) ·
[React Flow component API (selection/delete/multi-select key codes)](https://reactflow.dev/api-reference/react-flow) ·
[xyflow multi-selection discussion #3890](https://github.com/xyflow/xyflow/discussions/3890) ·
[exo distributed inference (TechRadar)](https://www.techradar.com/computing/bittorrent-for-llm-exo-software-is-a-distributed-llm-solution-that-can-run-even-on-old-smartphones-and-computers) ·
[SharedLLM vs Petals vs Exo (2026 landscape)](https://sharedllm.org/blog/sharedllm-vs-petals-vs-exo.html)
