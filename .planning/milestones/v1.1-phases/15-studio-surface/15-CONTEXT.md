# Phase 15: Studio Surface - Context

**Gathered:** 2026-06-27
**Status:** Ready for planning
**Source:** Autonomous synthesis from roadmap + requirements + the shipped Phases 12-14 code (overnight run — user to review flagged decisions)

<domain>
## Phase Boundary

Build the **full `/studio` developer surface** that makes the shipped v1.1 spine (Phases 12-14:
Catalog → Spec → Registry → Renderer → Generation → Cache) **observable end-to-end in one place** —
with **no new generation, cache, or renderer logic**. The studio is the milestone's **demo surface**
(SUMMARY: "studio is the demo surface"): a developer opens `/studio`, **browses the live component
catalog** (every whitelisted `@nauta/ui` component with its prop schema, slot rules, and a rendered
example), **enters a natural-language intent** in a generation sandbox, sees the **generated UI
rendered live** in a preview pane backed by the **same production `SpecRenderer` + `COMPONENT_REGISTRY`
+ `NAUTA_CATALOG`** (never a stub), inspects the **underlying spec JSON beside the render** (extending
the Phase 12 D-19 render/JSON split), and **visibly distinguishes the four generation states** —
in-progress, validation-failure + fallback, cache-hit (zero LLM cost), and cold generation.

This phase extends the EXISTING `/studio/preview` surface (Phase 12 / 12-UI-SPEC): it reuses that
surface's design system verbatim — the frosted app shell, the `ResizablePanelGroup` render/JSON
split, the existing shadcn tokens, the `dynamic(ssr:false)` client-island pattern, the header-chip
convention — and introduces **no new design system**. It consumes the Phase 13 `genui.generate` tRPC
procedure and the Phase 14 `cache_hit` signal; the **only backend/contract change** it requires is a
**thin additive pass-through** of the cache-hit and outcome signals through the FastAPI view → use-case
result → tRPC output so the client can render the four states honestly (D-05/D-06).

**In scope (mapped reqs):** STDO-01, STDO-02, STDO-03, STDO-04.

The 4 binding ROADMAP success criteria (Phase 15 section):
  1. A developer navigating to `/studio` sees a browseable catalog of all whitelisted `@nauta/ui`
     components, each with its prop schema, slot rules, and rendered example.
  2. Entering an intent in the studio's generation sandbox produces a live rendered UI preview backed by
     the same `packages/genui` `SpecRenderer` and `COMPONENT_REGISTRY` used in production — not a separate
     or stub renderer.
  3. The spec JSON that produced the rendered output is visible alongside the preview for inspection, so a
     developer can confirm the interpreter is rendering what the model emitted.
  4. The studio surface visibly distinguishes four generation states: in-progress streaming,
     validation-failure + fallback, cache-hit (zero LLM cost), and cold generation — so a developer can
     observe the full engine behavior without external tooling.

**Out of scope (later phases / v1.2 — explicit scope fence):**
- **NO new generation / cache / renderer logic.** Generation (Bedrock, dual-LLM quarantine, repair,
  allowlists) is Phase 13; the exact cache + template store is Phase 14; the trusted interpreter +
  registry + catalog is Phase 12. Phase 15 **consumes** all of them unchanged. The single permitted
  backend touch is the additive `outcome` + `cache_hit` signal pass-through (D-05/D-06), not new logic.
- **NO true token-streaming backend.** Phase 13 generation is **non-streaming by decision** (GEN-04
  judgment call: a single buffered, validated spec is returned — `13-CONTEXT.md` Discretion, `generate.ts`
  GEN-04 note). The studio's "in-progress" state is an honest **"Generating…" indicator**, NOT a token
  stream (D-02). True token-streaming is a **v1.2** enhancement (deferred).
- **NO semantic retrieval / template promotion / template browser** — v1.2 FLY (Phase 14 deferred).
- **NO mutation actions.** The Phase 13 `mutate` action branch + `ALLOWED_MUTATIONS` stay an **empty seam**
  (SEAM-02); the studio wires no mutate handler. The sandbox preview is observe-only beyond
  query/setState/navigate, which already work via the shipped `ActionRegistry`.
- **NO Nauta-flavored product wiring** (email/entity review surfaces) — v1.1 is standalone-in-`/studio`
  by decision; the sandbox accepts a free-text intent + optional raw-content textarea, nothing wired to
  real product surfaces.
</domain>

<decisions>
## Implementation Decisions

### Surface structure & routing (STDO-01, STDO-02, STDO-03, STDO-04) — KEY DECISION

- **D-01: `/studio` becomes the studio landing route with two sections in one surface: a Catalog Browser
  and a Generation Sandbox, switched by shadcn `Tabs`.** The existing `/studio/preview` route is **kept
  as-is** (the Phase 12 hardcoded showcase + JSON split — it still proves the interpreter on a static
  spec and is the documented design north-star), and a third "Showcase" affordance in `/studio` links to
  it (or embeds the same `SHOWCASE_SPEC` render). `/studio` (root) is a NEW server-component page mirroring
  `studio/preview/page.tsx`'s shell (server page → client island, header chips, `SidebarInset`). The two
  sandbox/catalog client islands live under `apps/web/src/app/studio/_components/`. Tabs (not separate
  routes) keep catalog + sandbox in "one surface" per the Phase 15 goal sentence. [JUDGMENT CALL — review:
  tabs-in-one-route over sub-routes (`/studio/catalog`, `/studio/sandbox`); chosen because success
  criterion + goal both say "in one surface" and tabs preserve a single mental space. Sub-routes are a
  trivial later refactor if preferred.] Serves STDO-01 + STDO-02 + STDO-04.

- **D-02: The studio's "in-progress" state is an honest animated "Generating…" indicator, explicitly NOT
  labeled "streaming".** Because Phase 13 generation is non-streaming (one buffered validated spec —
  `13-CONTEXT.md` GEN-04 judgment call, `generate.ts` GEN-04 note), there is no token stream to show. The
  state is driven by the tRPC mutation's pending/`isLoading` flag and renders a spinner + "Generating…"
  copy in the preview pane. The UI copy and a code comment **document that true token-streaming is a v1.2
  enhancement** (the ROADMAP success criterion's word "streaming" is satisfied by an in-flight indicator,
  with the honest caveat surfaced in the state label tooltip). [JUDGMENT CALL — review: labeling the state
  "Generating…" rather than "Streaming" is a deliberate honesty choice that mildly diverges from the
  ROADMAP's literal wording; the alternative (faking a stream) is rejected as dishonest and out of scope.]
  Serves STDO-04 (state a).

### The four generation states + the signal-surfacing contract (STDO-04 / success criterion 4) — KEY DECISION

- **D-03: The studio renders exactly four mutually-distinct generation states from two machine-readable
  signals (`outcome` + `cacheHit`):**
  - **(a) in-progress** — request in flight: tRPC mutation `isPending` true → spinner + "Generating…"
    in the preview pane (D-02). Honest non-stream indicator.
  - **(b) validation-failure + fallback** — the returned spec IS the `SAFE_FALLBACK_SPEC`: `outcome ===
    "fallback"`. Rendered distinctly: a **destructive-toned banner** ("Validation failed — showing a safe
    fallback") above the rendered fallback spec, plus the `reason` string from the tRPC output. The
    developer SEES that this is a fallback, not a normal render. Uses the existing `--destructive` token
    surface (12-UI-SPEC §4), no new color.
  - **(c) cache-hit** — `cacheHit === true`: a **secondary/teal "Cache hit · 0 LLM cost"** chip on the
    result header. Distinct from cold. Zero-LLM-cost messaging is the Phase 14 differentiator (D-03 there).
  - **(d) cold** — `cacheHit === false && outcome !== "fallback"`: a **muted "Cold generation"** chip;
    when `outcome === "escalated"` the chip reads **"Cold · escalated to Sonnet"** so the developer can
    observe the Haiku→Sonnet escalation (GEN-06) as a sub-state of cold. (escalated is a flavor of cold,
    not a fifth top-level state — the four states are honored; escalation is surfaced as extra fidelity.)
  Serves STDO-04 + success criterion 4 (all four states visibly distinguished).

- **D-04: The four-state signals are derived in ONE pure client helper** (`deriveGenerationState(input)
  -> { kind: "in_progress" | "fallback" | "cache_hit" | "cold"; escalated: boolean; reason?: string }`)
  taking `{ isPending, outcome, cacheHit, reason }`, kept in `studio/_components/` and unit-tested, so the
  state mapping is deterministic and testable (no inline ternaries scattered through JSX). Immutable
  return object (CLAUDE.md). Serves STDO-04.

- **D-05: The signals MUST reach the client — lock the tRPC contract extension (three thin additive
  layers, NO new logic):** the shipped path drops both signals before the client. Phase 15 threads them
  through:
  1. **FastAPI view (`genui.py` `GenerateUiSpecView`)** today returns `{ spec, cache_hit }` but NOT
     `outcome`. **Add `outcome: Literal["ok","fallback","escalated"]`** to `GenerateUiSpecView`, populated
     from the use-case result. The use case ALREADY computes `outcome` via `_determine_outcome(...)` — it
     is currently only used for the audit row, not returned. (additive field; ApiResponse envelope shape
     unchanged.)
  2. **Use-case result (`GenerateUiSpecResult` in `generate_ui_spec.py`)** today exposes `{ spec,
     cache_hit }`. **Add `outcome: Literal["ok","fallback","escalated"]`** to the frozen dataclass.
     On the **cache-hit** return (the early short-circuit), `outcome = "ok"` (a cached spec is by
     construction a previously-validated, non-fallback spec — D-11 of Phase 14 forbids caching fallbacks),
     `cache_hit = True`. On the cold path, set `outcome` to the already-computed `_determine_outcome(...)`
     value. (No new computation — just return the value already derived.)
  3. **tRPC procedure (`generate.ts`)** today returns a `z.discriminatedUnion("outcome", [ok, fallback])`
     and **ignores `body.data.cache_hit`** and the envelope `outcome`. Extend its `GenerateOutputSchema`
     to **`{ outcome: "ok" | "fallback" | "escalated", spec, cacheHit: boolean, reason?: string }`**:
     read `data.cache_hit` and `data.outcome` from the envelope; carry them onto the output. The
     **web-boundary `SpecRootSchema.safeParse` re-validation stays authoritative** — if the FastAPI spec
     fails web re-validation, the procedure overrides to `{ outcome: "fallback", cacheHit: false, spec:
     SAFE_FALLBACK_SPEC, reason }` exactly as today (a web-side validation failure is itself the
     validation-failure-state, D-03b). When FastAPI returns `outcome: "escalated"` and the spec passes
     re-validation, surface `outcome: "escalated"` (cold sub-state, D-03d).
  Serves STDO-04 + success criterion 4. This is the ONLY backend/contract change in Phase 15 — additive,
  no new logic, no new Bedrock/cache code.

- **D-06: The tRPC procedure stays a `query` per the shipped code, but the studio calls it as a one-shot
  request driven by an explicit "Generate" button** (React Query `useQuery` with `enabled:false` +
  `refetch`, or `useMutation`-style trigger). [JUDGMENT CALL — review: `generate.ts` is currently a
  `.query()`. A generation that performs Bedrock calls + DB writes is semantically a mutation, but the
  shipped procedure is a query and Phase 15 must not rewrite Phase 13 logic. Recommend keeping it a
  **query triggered manually** (no auto-run on mount; `enabled:false`, fire on button click) so no Phase
  13/14 code changes; converting to a tRPC mutation is a clean follow-up but out of this phase's
  no-new-logic fence. The four-state UI works identically either way via `isFetching`/`isPending`.]
  Serves STDO-02 + STDO-04.

### STDO-02 — production-renderer reuse, NO stub (success criterion 2) — KEY DECISION

- **D-07: The sandbox preview mounts the EXACT same `dynamic(ssr:false)` `SpecRenderer` client island
  from `@nauta/genui/renderer` that `/studio/preview` already uses — the production renderer, never a
  separate or stub path.** Reuse `SpecRendererIsland` (`studio/preview/_components/spec-renderer-island.tsx`)
  verbatim, or lift it to a shared `studio/_components/spec-renderer-island.tsx` imported by both
  `/studio` and `/studio/preview`. It already (a) dynamically imports `mod.SpecRenderer`, (b) lets
  `SpecRenderer` default `registry = COMPONENT_REGISTRY` rather than passing the registry as a prop
  (avoiding the Zod-object serialization problem across the server/client boundary — the island's own
  doc-comment), and (c) accepts `spec` + optional `data`. The sandbox feeds it the **validated spec
  returned by `genui.generate`** (already `SpecRootSchema`-shaped). No second renderer, no `eval`, no
  fork. Serves STDO-02 + success criterion 2.

- **D-08: The sandbox passes live `actions` into `SpecRenderer` via `buildActionRegistry()`** (the shipped
  `@nauta/genui/renderer` export wired in Phase 13: query/setState/navigate handlers; mutate left
  unregistered — SEAM-02). This makes the preview a faithful production render (buttons that navigate /
  set state behave as they would in product). The studio supplies the same `RouterLike`/`TrpcUtilsLike`
  deps the renderer expects. The empty `mutate` seam stays empty (no mutate handler) per scope fence.
  Serves STDO-02 (faithful, not stub).

### STDO-03 — spec JSON beside the render (success criterion 3)

- **D-09: The sandbox reuses the Phase 12 D-19 render/JSON split verbatim:** a horizontal
  `ResizablePanelGroup` (`@nauta/ui/resizable`) — left pane = the `SpecRendererIsland` output, right pane
  = a read-only `<pre>{JSON.stringify(spec, null, 2)}</pre>` inside a `ScrollArea` (`@nauta/ui/scroll-area`),
  `bg-muted`, `font-mono text-xs`, with the "Spec JSON" pane label — identical structure, classes, and
  `defaultSize={55}/{45}` split to `studio/preview/page.tsx`. The displayed JSON is the **exact spec the
  renderer received** (same object), so the developer confirms the interpreter renders what the model
  emitted. When the spec is the fallback, the JSON pane shows the `SAFE_FALLBACK_SPEC` (and the
  fallback banner, D-03b, makes that explicit). Serves STDO-03 + success criterion 3.

### STDO-01 — catalog browser + the serialization decision (success criterion 1) — KEY DECISION

- **D-10: The Catalog Browser enumerates `NAUTA_CATALOG` by importing it DIRECTLY into a client island
  (`studio/_components/catalog-browser-island.tsx`, `"use client"`), NOT by passing catalog data as props
  from a server component.** Zod schema objects (`propsSchema`) and React `component` references in each
  `ManifestEntry` are **not serializable across the Next server→client boundary** (the same constraint
  the Phase 12 D-island documented for `COMPONENT_REGISTRY` — see `spec-renderer-island.tsx` doc-comment).
  Importing `NAUTA_CATALOG` directly in a client module sidesteps serialization entirely — the catalog is
  a client-side module like `SpecRenderer`. The browser iterates `Object.values(NAUTA_CATALOG)` (the
  shipped frozen registry, `@nauta/genui/catalog`). [JUDGMENT CALL — review: direct client import over a
  server-built serialized descriptor; chosen because (1) it is the established Phase 12 pattern, (2) it
  avoids inventing a parallel serialized catalog descriptor that could drift from the real registry,
  (3) the catalog is small (~10 entries, no secrets). A serialized server descriptor would be needed only
  if the catalog grew large or had to be server-filtered — a documented v1.2 seam.] Serves STDO-01 +
  success criterion 1 (one source of truth: the real registry).

- **D-11: Each catalog entry renders four readable facets from its `ManifestEntry` (success criterion 1):**
  1. **type + description** — `entry.type` (mono chip) + `entry.description`.
  2. **prop schema, rendered readably** — derive a human-readable prop list from `entry.propsSchema` using
     Zod v3 introspection (`schema._def.shape()` / `.shape` on the `ZodObject`), emitting per-prop
     `{ name, typeLabel, required, locked }` rows. Required is `!isOptional`; `typeLabel` from the Zod def
     kind (`ZodString`→"string", `ZodEnum`→the union of values, `ZodBoolean`→"boolean", `ZodArray`→"array",
     `ZodLiteral`→the literal); `locked` is membership in `entry.lockedProps`. A small pure
     `describePropsSchema(schema, lockedProps)` helper (unit-tested) owns this introspection. a11y-required
     props show a "required" marker (they are non-optional by D-04 of Phase 12). [JUDGMENT CALL — review:
     introspecting the live Zod schema for a readable prop table over shipping a hand-written prop doc per
     entry; chosen so the browser can never drift from the real schema. The emitted JSON-Schema artifact
     (`spec.schema.json`, Phase 13 D-03) is an alternative source but is per-spec-node, not per-entry, and
     lives for the Python side — live Zod introspection is the tighter fit for a per-entry table.]
  3. **slot rules** — `entry.slots` (named slots e.g. `["header","footer"]`) + `entry.acceptsChildren`
     (positional children yes/no), shown as chips ("slots: header, footer · children: yes").
  4. **rendered example, live** — render `entry.example` through the **same `SpecRenderer`** by wrapping it
     in a minimal single-node `SpecRoot` (`{ v:1, root: { type: entry.type, props: entry.example, ... } }`)
     and feeding the existing `SpecRendererIsland` (D-07). This proves the example renders via the
     production interpreter (reuse, not a bespoke preview) and satisfies "rendered example" literally.
     Layout/container entries (`stack`/`grid`/`card`) render their example shell; that is acceptable
     (the example object is the CI-verified one, CTLG-04). Serves STDO-01 + success criterion 1.

- **D-12: The catalog browser layout = a scrollable list/grid of per-entry cards** (`@nauta/ui/card`),
  each card holding the four facets (D-11) with the live example in the card body and the prop/slot
  metadata below it. Reuses existing tokens (12-UI-SPEC §3/§4) — no new design system. A left filter rail
  is NOT required (10 entries); a simple in-page text filter over `type`/`description` is optional polish
  (Claude's discretion). Serves STDO-01.

### Reuse of the Phase 12 design system (no new design system) — anchored

- **D-13: Phase 15 introduces NO new design system, tokens, fonts, or color roles — it reuses the Phase 12
  / 12-UI-SPEC contract verbatim:** the frosted app shell + `SidebarInset` (`layout.tsx`), the `h-12`
  header with right-aligned `ml-auto` chips, the `ResizablePanelGroup` 55/45 render-JSON split, the
  `ScrollArea` + `font-mono text-xs` JSON pane, `bg-muted` secondary surface, the single teal `--primary`
  accent (active nav + cache-hit chip), `--destructive` reserved for the fallback banner only, the
  `dynamic(ssr:false)` island pattern, and the existing typography scale (3 sizes / 2 weights). The
  spinner uses the existing loading conventions. This is a binding constraint, not a preference — the
  studio must look and behave like an extension of `/studio/preview`. A Phase 15 UI-SPEC (run
  `/gsd:ui-phase`) will formalize the new sandbox/catalog layout within these locked tokens. Serves
  STDO-01..04 (consistency) + success-criteria coherence.

### Sidebar nav (carried from Phase 12, minimal update)

- **D-14: The "Studio" sidebar nav item points at `/studio` (the new landing) instead of `/studio/preview`.**
  `app-sidebar.tsx` currently has `{ href: "/studio/preview", label: "Studio", icon: FlaskConical }`.
  Change `href` to `/studio`; the existing `isActiveRoute` logic already treats `/studio/preview` as
  active-under-`/studio` (the `pathname.startsWith(\`${href}/\`)` branch), so both the landing and the
  preview subpage light the nav. Single-line change, no new nav entry, `FlaskConical` icon kept. Serves
  STDO-01 (discoverability).

### Renderer trust boundary (carried from Phases 12-13, reaffirmed)

- **D-15: No `eval` / `Function` / `dangerouslySetInnerHTML` anywhere on the studio→render path** (GR-01,
  SPEC-02, Phase 12 D-13, Phase 13 D-24). The studio adds a UI surface only; the spec is data rendered by
  the existing `COMPONENT_REGISTRY` lookup in `SpecRenderer`. The generated spec is re-validated at the
  web boundary (`SpecRootSchema.safeParse`, shipped in `generate.ts`) before it reaches the island, and
  the catalog example specs are the CI-verified `entry.example` objects. A grep gate over the new studio
  files (no `eval`/`Function`/`dangerouslySetInnerHTML`) is a binding acceptance criterion. Serves
  STDO-02 (faithful, safe reuse).

### Claude's Discretion

- Exact `/studio` tab order and labels ("Catalog" / "Sandbox" / link-or-embed of "Showcase"), and whether
  the existing `SHOWCASE_SPEC` is embedded in a third tab or only linked at `/studio/preview` (D-01).
- Whether `SpecRendererIsland` is imported from `studio/preview/_components/` or lifted to a shared
  `studio/_components/` module (D-07) — pick the cleaner import graph; lifting is recommended so both
  routes share one island.
- The exact `describePropsSchema` introspection rules for less-common Zod kinds (`ZodLiteral`, nested
  `ZodObject` in `items`/`columns`, `ZodRecord`) within D-11's "readable per-prop row" intent — pick a
  deterministic, well-tested mapping; the hard requirement is it reads from the live schema and never
  drifts.
- Whether the catalog browser shows a one-line in-page text filter (D-12) — optional polish at 10 entries.
- The exact "Generating…" spinner component + copy and the precise chip wording for cache-hit / cold /
  escalated states (D-02/D-03) — within the honesty + token constraints.
- Whether `genui.generate` is invoked via `useQuery({enabled:false})`+`refetch` or a thin
  `useMutation`-style wrapper (D-06) — both satisfy the four-state UI; keep the procedure a `query`.
- The optional raw-content textarea in the sandbox (the procedure accepts `rawContent`, default `""`) —
  whether to expose it for intent-only vs document-bound generation; recommended as a collapsible
  "Advanced" field so the default demo is intent-only.
- Whether the result header shows generation metadata (attempts/latency) if exposed — only if it requires
  no new backend field beyond D-05 (it does require new fields, so default OFF this phase).
</decisions>

<specifics>
## Specific Ideas

- **The studio is the milestone's demo surface** (`SUMMARY.md` STDO scope, "studio is the demo surface"):
  the whole point is to make the otherwise-invisible spine (catalog → generation → cache → render)
  observable to a developer without external tooling. Every decision optimizes for "a developer can SEE
  the engine behave."
- **Extend, don't rebuild `/studio/preview`** (Phase 12 D-19/D-20, 12-UI-SPEC): the render/JSON split,
  the client island, the header chips, the tokens — all already shipped and are the literal north-star.
  Phase 15 wraps a catalog browser + an intent sandbox around that proven core.
- **Honesty about non-streaming** (Phase 13 GEN-04 judgment call, `generate.ts` GEN-04 note): the backend
  returns one buffered validated spec. The studio shows an in-flight "Generating…" indicator and
  documents that token-streaming is v1.2 — it does NOT fake a stream (D-02). The safety model
  (validate-before-render, SAFETY-PITFALLS §4a) actively argues against rendering partial specs anyway.
- **The signal-flow gap is real and must be closed** (D-05): the FastAPI `GenerateUiSpecView` already
  carries `cache_hit` but NOT `outcome`; the use case computes `outcome` (`_determine_outcome`) only for
  the audit row; the tRPC `generate.ts` ignores `data.cache_hit` and re-derives a 2-value outcome from
  web re-validation alone. Without the additive pass-through, the studio cannot distinguish cache-hit from
  cold, nor escalated from ok. The fix is three additive fields, no new logic.
- **Cache-hit = zero LLM cost** (Phase 14 D-03): the cache-hit chip's "0 LLM cost" copy is the Phase 14
  differentiator made visible — the whole reason the exact cache exists.
- **Same renderer, same registry, same catalog — never a stub** (STDO-02, Phase 12 specifics "the renderer
  and registry built here are the SAME ones Phases 13-15 use in production"): the sandbox and the catalog
  example previews both go through `@nauta/genui/renderer`'s `SpecRenderer` + default `COMPONENT_REGISTRY`.
- **Serialization boundary is load-bearing** (Phase 12 island doc-comment): Zod schemas + React component
  refs in `NAUTA_CATALOG`/`COMPONENT_REGISTRY` cannot cross server→client; both the catalog browser and
  the renderer island import their data directly as client modules (D-07/D-10).
- **Action handlers already exist** (Phase 13 `buildActionRegistry`, `@nauta/genui/renderer`): the sandbox
  preview wires the shipped query/setState/navigate handlers; the empty `mutate` seam stays empty (D-08).
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & scope (binding)
- `C:\Users\pc\Desktop\nauta.services.email-listener\.planning\REQUIREMENTS.md` — STDO-01, STDO-02, STDO-03,
  STDO-04 (exact text of the 4 mapped reqs); the GEN-04 streaming gap (deferred) + the v1.2 FLY/EVAL/CODE
  deferrals.
- `C:\Users\pc\Desktop\nauta.services.email-listener\.planning\ROADMAP.md` (Phase 15 section) — the goal
  sentence + the 4 binding success criteria this phase must make TRUE.
- `C:\Users\pc\Desktop\nauta.services.email-listener\.planning\research\SUMMARY.md` — STDO scope, "studio is
  the demo surface" intent.

### The existing /studio surface this phase EXTENDS (MUST read)
- `C:\Users\pc\Desktop\nauta.services.email-listener\.planning\phases\12-catalog-spec-schema-and-trusted-interpreter\12-CONTEXT.md`
  — D-19 (render+JSON split this phase extends), D-20 (the `dynamic(ssr:false)` island), the
  ActionRegistry seam, the catalog/registry/renderer reuse principle (STDO-02 honored early).
- `C:\Users\pc\Desktop\nauta.services.email-listener\.planning\phases\12-catalog-spec-schema-and-trusted-interpreter\12-UI-SPEC.md`
  — **the design system this phase reuses verbatim** (D-13): tokens, spacing, typography, the 55/45
  ResizablePanelGroup layout, the JSON pane, the header chips, NodeErrorFallback color, the "Studio" nav
  item. §14 explicitly lists the Phase 15 deferrals (intent field, generate button, generation-state
  indicators, catalog browser) — those are exactly this phase's scope.
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\web\src\app\studio\preview\page.tsx` — the
  server-component shell + render/JSON split to mirror for `/studio`.
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\web\src\app\studio\preview\_components\spec-renderer-island.tsx`
  — the `dynamic(ssr:false)` `SpecRenderer` island to reuse/lift (D-07); its doc-comment is the
  serialization-boundary rationale for D-10.
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\web\src\components\app-sidebar.tsx` — the "Studio"
  nav item to repoint at `/studio` (D-14).
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\web\src\app\layout.tsx` — the frosted shell +
  `SidebarInset` + providers the new page renders inside.
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\web\src\app\knowledge\` — the three-zone island
  sibling (filter-rail / canvas / detail-pane, states, toolbar) — a layout precedent for the catalog
  browser + state chrome (reference only; do not import).

### packages/genui — the renderer / registry / catalog this phase reuses (NEVER stub — STDO-02)
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\renderer\spec-renderer.tsx` —
  `SpecRenderer` (default `registry = COMPONENT_REGISTRY`, optional `data`/`actions`), `ActionRegistryContext`.
  The production renderer the sandbox + catalog examples mount (D-07).
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\renderer\index.ts` — exports
  `SpecRenderer`, `buildActionRegistry` (D-08), `RouterLike`/`TrpcUtilsLike` deps.
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\registry\component-registry.ts` +
  `\registry\index.ts` — `COMPONENT_REGISTRY`, `REGISTERED_TYPES`, `REGISTRY_VERSION` (header chip, server-only
  `crypto` — render it server-side per `studio/preview/page.tsx` comment).
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\catalog\manifest.ts` +
  `\catalog\index.ts` — `NAUTA_CATALOG` (the 10 `ManifestEntry`s the browser enumerates, D-10/D-11),
  `toCompactCatalog`, `CompactEntry`.
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\catalog\types.ts` — `ManifestEntry`
  shape (`type`/`description`/`example`/`propsSchema`/`lockedProps`/`slots`/`acceptsChildren`/`component`) —
  the fields the catalog browser reads (D-11).
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\schema\index.ts` — `SpecRootSchema`,
  `SpecRoot`, `SAFE_FALLBACK_SPEC` (the fallback the studio detects + labels, D-03b).
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\demo\index.ts` — `SHOWCASE_SPEC`
  (the static showcase the third tab / `/studio/preview` keeps rendering, D-01).

### The genui.generate tRPC procedure + the signal-surfacing contract (D-05)
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\api-client\src\router\genui\generate.ts` —
  the procedure the sandbox calls; its `GenerateOutputSchema` (currently `ok`/`fallback`, no `cacheHit`)
  is the contract to extend (D-05.3). Keeps the authoritative web-boundary `SpecRootSchema.safeParse`.
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\api-client\src\router\genui\index.ts` — the
  `genuiRouter` (`generate` procedure) the studio consumes.
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\email-listener\app\presentation\api\v1\genui.py` —
  `GenerateUiSpecView { spec, cache_hit }` — **add `outcome`** (D-05.1).
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\email-listener\app\application\use_cases\generate_ui_spec.py`
  — `GenerateUiSpecResult { spec, cache_hit }` + `_determine_outcome(...)` (already computed) — **add
  `outcome`** to the result + return it on both the cache-hit and cold paths (D-05.2).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`/studio/preview` surface (Phase 12, shipped):** `studio/preview/page.tsx` (server shell + 55/45
  render/JSON `ResizablePanelGroup` + header chips) and `spec-renderer-island.tsx` (the `dynamic(ssr:false)`
  `SpecRenderer` island, registry imported directly to dodge Zod serialization). Phase 15 wraps the
  catalog browser + intent sandbox around these — the JSON-beside-render (STDO-03) and the production
  renderer (STDO-02) are already built; Phase 15 reuses them.
- **`SpecRenderer` + `COMPONENT_REGISTRY` + `NAUTA_CATALOG` (`@nauta/genui`, shipped):** the production
  trusted interpreter (default `registry = COMPONENT_REGISTRY`, `data`, `actions`), the 10-entry frozen
  catalog (`Object.values(NAUTA_CATALOG)` for the browser), and `buildActionRegistry` (query/setState/
  navigate; empty mutate seam). The studio mounts these unchanged (STDO-01/STDO-02).
- **`genui.generate` tRPC procedure (Phase 13, shipped):** proxies to `POST /v1/genui/generate`, buffers
  the response (non-streaming, GEN-04), re-validates with `SpecRootSchema.safeParse`, returns
  `{ outcome: ok|fallback, spec, reason? }`. The sandbox calls this; D-05 adds `cacheHit` + `escalated`.
- **Phase 14 `cache_hit` signal (shipped):** `GenerateUiSpecResult.cache_hit` (use case) →
  `GenerateUiSpecView.cache_hit` (FastAPI) — already crosses to the web envelope; the tRPC layer just
  doesn't read it yet (D-05.3). `outcome` is computed (`_determine_outcome`) but not yet returned (D-05.1/2).
- **App shell + sidebar (shipped):** `layout.tsx` frosted shell + `SidebarInset`; `app-sidebar.tsx`
  "Studio" nav item (repoint to `/studio`, D-14). `/knowledge` three-zone island is a layout precedent.

### Established Patterns
- **Client-island for anything touching `@nauta/genui` runtime** (`dynamic(ssr:false)`, Phase 11/12):
  declared state + class error boundary + Zod/React-component registry objects can't SSR-serialize, so the
  renderer and the catalog both live behind client islands importing their data directly (D-07/D-10).
- **Server page renders `REGISTRY_VERSION` chip** (it uses Node `crypto`, must not enter the browser
  bundle — `studio/preview/page.tsx` T-12-15): keep the version chip server-side in the new `/studio` page.
- **`safeParse` at the web boundary is authoritative** (`generate.ts` D-08): the studio trusts the
  re-validated spec; a web-side validation failure IS the fallback state (D-03b/D-05.3).
- **Additive, no-new-logic backend touches only** (scope fence): the `outcome` pass-through reuses the
  already-computed `_determine_outcome` value; no new Bedrock/cache/validation code (D-05).
- **Immutable / readonly house style, named exports, no `console.log` in components, Zod at boundaries**
  (CLAUDE.md) — the new state-derivation + schema-introspection helpers are pure + unit-tested (D-04/D-11).

### Integration Points
- **New route:** `apps/web/src/app/studio/page.tsx` (server shell, mirrors `studio/preview/page.tsx`) +
  `apps/web/src/app/studio/_components/` (catalog-browser island, generation-sandbox island, the shared
  spec-renderer island lifted from `preview/_components/`, the `deriveGenerationState` + `describePropsSchema`
  helpers).
- **tRPC contract extension (the ONLY backend change):** extend `GenerateOutputSchema` in
  `packages/api-client/src/router/genui/generate.ts` (`+cacheHit`, `+escalated`, read `data.cache_hit`/
  `data.outcome`); add `outcome` to `GenerateUiSpecView` (`genui.py`) and `GenerateUiSpecResult`
  (`generate_ui_spec.py`). Additive fields only — no logic change.
- **Sidebar:** repoint the "Studio" `href` to `/studio` in `app-sidebar.tsx` (D-14).
- **Renderer/catalog reuse:** import `SpecRenderer` (via the island), `NAUTA_CATALOG`, `buildActionRegistry`,
  `SAFE_FALLBACK_SPEC`, `SHOWCASE_SPEC` from `@nauta/genui/*` — no new genui code.
- **UI-SPEC:** run `/gsd:ui-phase` for Phase 15 to formalize the sandbox + catalog layout within the
  locked Phase 12 tokens (D-13) before/alongside planning.
</code_context>

<deferred>
## Deferred Ideas

- **True token-streaming generation** (the literal "streaming" state) — **v1.2.** Phase 13 generation is
  non-streaming (one buffered validated spec, GEN-04 judgment call); the studio shows an honest
  "Generating…" in-flight indicator (D-02) and documents streaming as a v1.2 enhancement. Live SSE/partial
  specs through the FastAPI proxy + a streaming-aware safety model are the v1.2 work.
- **Semantic template retrieval + template browser / promotion** — **v1.2 FLY-01/02** (Phase 14 deferred):
  no embedding column, no `match_templates_*` RPCs, no `status='promoted'`, no studio template-library
  browser. The studio shows generation results live, not a stored-template gallery.
- **Mutation actions in the sandbox** — the Phase 13 `mutate` branch + `ALLOWED_MUTATIONS` stay an **empty
  seam** (SEAM-02); the studio wires no mutate handler. Live mutations are v1.2 convergence.
- **Converting `genui.generate` to a tRPC mutation** — kept a manually-triggered `query` this phase
  (D-06) to avoid touching Phase 13 logic; a clean mutation refactor is a follow-up, not in the
  no-new-logic fence.
- **Generation metadata in the result UI** (attempts / latency / token counts) — would require new
  pass-through fields beyond the four-state `outcome`+`cacheHit` (D-05); default OFF this phase. The audit
  table already records these server-side (Phase 13 D-19) for offline inspection.
- **Server-built serialized catalog descriptor / server-side catalog filtering** — the direct client
  import (D-10) is sufficient at 10 entries; a serialized descriptor is the v1.2 seam if the catalog grows
  large or needs per-tenant server filtering (SEAM-03 per-catalog-id).
- **Nauta-flavored product wiring** (email/entity review surfaces consuming the engine) — v1.1 is
  standalone-in-`/studio`; product convergence is post-v1.1.
- **axe-core a11y CI on generated UI, eval/regression harness, code-emit experiment** — v1.2 EVAL/CODE.
- **Mobile / responsive studio layout** — developer-only surface; no mobile breakpoints (12-UI-SPEC §6
  precedent carried forward).

### Reviewed Todos (not folded)
None — no pending phase-15 todos found. (`.planning/.pending-auth-captures.jsonl` is an unrelated runtime
auth-capture artifact, not a phase-15 todo.)
</deferred>

---

*Phase: 15-studio-surface*
*Context gathered: 2026-06-27 (autonomous overnight synthesis — user to review flagged decisions)*
