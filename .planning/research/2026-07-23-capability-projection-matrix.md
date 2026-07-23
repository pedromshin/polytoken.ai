# Capability → Four-Projection Matrix (AI-02 closeout) — 2026-07-23

> FEATURE-CATALOG §AI-02: every capability in the builtin manifest
> (`packages/api-client/src/router/capabilities/builtin-manifest.ts`, 22 entries) must project as
> **(a) an LLM tool, (b) a `/capabilities` card, (c) a genui block, (d) a canvas node** — the INV-1
> contract stated verbatim in `packages/capabilities/src/capability.ts`.
>
> This audit is now ENFORCED DATA, not prose: the machine-readable twin of this table lives in
> `packages/api-client/src/router/capabilities/projection-map.ts` (`CAPABILITY_PROJECTIONS`), and
> two suites gate it:
> - `packages/api-client/src/router/capabilities/__tests__/projection-map.test.ts` — manifest ↔
>   declaration bijection, every declared face resolves, exceptions must carry real reasons, the
>   exception set itself is pinned. A future capability shipped without a declaration fails here.
> - `apps/web/src/app/capabilities/__tests__/projection-canvas-sync.test.ts` — the canvas-node
>   mirror (`CANVAS_NODE_TYPE_IDS`) vs the live `NODE_TYPE_REGISTRY`, both directions.

## Face legend

| Face | "wired/live" means | "declared" means | source of truth |
|---|---|---|---|
| **tool** | id is in the Python chat registry's `tool_defs()` and callable by the model this turn | a real `defineCapability` descriptor (describe + Zod input = a valid tool definition) exists at the cited source; the chat-loop bridge to it is the documented seam ("live daemon manifest fetch", builtin-manifest.ts header) | `registry.py` / `apps/daemon/src/tools/*` / `packages/capabilities/src/desktop.ts` |
| **card** | renders as an allowlist row with a working allow switch | — | `apps/web/src/app/capabilities/_components/capabilities-surface.tsx` |
| **genui** | reachable from a spec via `CapabilityBindingSchema` → `bindCapability` (REG-04); resolves against the executing surface's registry, fails closed elsewhere (INV-5). `component` would name a dedicated catalog entry (none needed today) | — | `packages/genui/src/binding/*` |
| **canvas** | a registered node type whose own description names this capability family | — | `apps/web/src/app/chat/_canvas/node-type-registry.ts` |

## The matrix (22 capabilities)

| capability | origin | (a) LLM tool | (b) card | (c) genui | (d) canvas |
|---|---|---|---|---|---|
| `fs.read` | daemon | declared (`tools/capabilities.ts`) | wired | binding | `editor` (load path) |
| `fs.write` | daemon | declared (`tools/capabilities.ts`) | wired | binding | `editor` (save path) |
| `fs.list` | daemon | declared (`tools/capabilities.ts`) | wired | binding | `directory` (named in node description) |
| `terminal.exec` | daemon | declared (`tools/capabilities.ts`) | wired | binding | **EXCEPTION** — no terminal node; session.* verbs aren't registry descriptors yet |
| `git` | daemon | declared (`tools/capabilities.ts`) | wired | binding | **EXCEPTION** — no repo/git node; directory node doesn't render git state |
| `browser.open` | daemon | declared (`tools/browser.ts`) | wired | binding | `browser` |
| `browser.navigate` | daemon | declared (`tools/browser.ts`) | wired | binding | `browser` |
| `browser.screenshot` | daemon | declared (`tools/browser.ts`) | wired | binding | `browser` |
| `browser.click` | daemon | declared (`tools/browser.ts`) | wired | binding | `browser` |
| `browser.type` | daemon | declared (`tools/browser.ts`) | wired | binding | `browser` |
| `browser.close` | daemon | declared (`tools/browser.ts`) | wired | binding | `browser` |
| `dir.list_tree` | daemon | declared (`tools/dir.ts`) | wired | binding | `directory` |
| `dir.sync_manifest` | daemon | declared (`tools/dir.ts`) | wired | binding | `directory` (the watched-folder seam it feeds) |
| `desktop.spawn` | control-plane | declared (`desktop.ts`, **in-process verified**) | wired (+ new irreversible chip) | binding | `desktop` |
| `desktop.destroy` | control-plane | declared (`desktop.ts`, **in-process verified**) | wired (+ new irreversible chip) | binding | `desktop` |
| `desktop.hibernate` | control-plane | declared (`desktop.ts`, **in-process verified**) | wired | binding | `desktop` |
| `desktop.attach` | control-plane | declared (`desktop.ts`, **in-process verified**) | wired | binding | `desktop` |
| `lookup_entity` | chat | **live** (`registry.py`) | wired | binding | **EXCEPTION** — no entity canvas node (entity detail is `/entities/[id]`; an entity node is EN-*/AI-04 territory) |
| `search_emails` | chat | **live** (`registry.py`) | wired | binding | `email-thread` |
| `search_knowledge` | chat | **live** (`registry.py`) | wired | binding | `knowledge-preview` |
| `web_search` | chat | **live** (`registry.py`) | wired | binding | `source` (chat_source_ledger capture → source node, RCNV-02) |
| `deep_research` | chat | **live** (`registry.py`) | wired | binding | `source` |

**Totals:** 22 capabilities × 4 faces = 88 cells. 85 wired/declared, **3 explicit exceptions** —
all on the canvas face (`terminal.exec`, `git`, `lookup_entity`), each a genuinely new node
COMPONENT (not pure wiring), recorded as `{ status: "exception", reason }` data the suite pins.

## Gaps found by this audit, and what closed them

1. **No projection contract existed at all** — INV-1 was a comment, not a check. Closed:
   `projection-map.ts` (declarations as data) + the two gating suites above. A capability added to
   the manifest without a declaration, a declared genui `componentType` missing from
   `COMPONENT_REGISTRY`, or a declared canvas `nodeType` missing from the canvas allowlist now
   fails vitest.
2. **Card face swallowed `reversibility` (§5.2)** — `desktop.spawn`/`desktop.destroy` declare
   `reversibility: "irreversible"` (the confirm-modal axis) but the `/capabilities` card never
   stated it. Closed: pure wiring of the declared field — an ink-only "cannot be undone" badge
   (trust-badge grammar, solid border, no hue) in `capabilities-surface.tsx` +
   `IRREVERSIBLE_LABEL` in `capability-vocabulary.ts`.
3. **Desktop mirror had no in-process drift check** — the four `desktop.*` manifest rows are the
   only mirrored entries whose declaring descriptors ARE importable here (`DESKTOP_CAPABILITIES`),
   yet nothing compared them. Closed: the suite asserts describe/risk/cost/reversibility equality
   and that `input`/`output` are real Zod schemas (a valid tool definition).
4. **Canvas registry had no cross-package alarm** — nothing would notice a node type rename
   breaking the capability spine's canvas face. Closed: `CANVAS_NODE_TYPE_IDS` mirror + the
   apps/web sync test (both directions).

## Deliberate non-goals (kept honest)

- **No fake canvas nodes** for the 3 exceptions — a stub node type in `NODE_TYPE_REGISTRY` with no
  component would violate the registry's own contract (every entry carries a real data schema and
  renders). The exception-as-data design means closing one is: build the node (CV-* work), flip the
  declaration to `{ status: "wired", nodeType }`, update the pinned exception list — the suite
  forces all three moves together.
- **No pretend chat-loop bridge** for daemon/control-plane tools — "declared" states exactly what
  exists (a valid descriptor at source) and where the seam is; upgrading to "live" is the
  live-manifest/daemon-bridge work builtin-manifest.ts already specifies.
- `NODE_TYPE_REGISTRY` and `packages/capabilities/src/canvas.ts` / `router/chat/canvas*` were not
  touched (owned by the AI-01 sibling branch); this branch only READS the node registry from a test.
