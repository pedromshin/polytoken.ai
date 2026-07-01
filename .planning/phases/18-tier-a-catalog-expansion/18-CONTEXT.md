# Phase 18: Tier A — Catalog Expansion - Context

**Gathered:** 2026-06-28 (autonomous — documented defaults, no interactive discuss per user "full autonomous now")
**Status:** Ready for planning
**Source:** ROADMAP.md Phase 18 (CTLG-06..09); 17-CONTEXT.md (the token/theme layer new components MUST honor); Phase-12 catalog contract (the rigor bar); Phase-17 UAT findings + backlog 999.2 (folded-in layout-primitive work).

<domain>
## Phase Boundary

The catalog gains **real domain components** so generated compositions stop reading as a stack of
generic cards and start resembling real app surfaces (profiles, feeds, nav). Each new entry is built
**depth-first to the Phase-12 catalog contract**: a fully-real component (wrap an existing `@nauta/ui`
primitive OR house-build to the same rigor), a **strict Zod prop schema**, **locked vs LLM-settable props**,
**a11y-required props marked**, a **CI-validated example that renders a real component (not a fallback)**,
and **`COMPONENT_REGISTRY` registration** with a registry-version bump. New components **honor the Phase-17
token/theme layer** (CSS-variable theming — no hardcoded colors — so they adopt the active style pack).

Also folded in (Phase-17 UAT + backlog 999.2): **layout-primitive robustness** — grid **`colSpan`** for
asymmetric layouts (main+sidebar) and a **`section`** primitive for declarative page framing — because
"compositions stop reading as generic cards" depends on real layout structure, not just more leaf components.

In scope: CTLG-06, CTLG-07, CTLG-08, CTLG-09 + the two folded layout primitives.
Out of scope (later phases): interactive form controls with validation/state (Phase 19 form engine),
real button/nav **click navigation** wiring (Phase 19), sandboxed code-island (Phase 20). New interactive-ish
components here are **presentational/declarative only** (no eval, no live state beyond the Phase-12 declared-state model).
</domain>

<decisions>
## Implementation Decisions

### Component set (CTLG-06) — depth-first, Phase-12 rigor
- **D-01:** Add these catalog entries (each a real component + strict schema + a11y + CI example + registry):
  - **`avatar`** — wraps `@nauta/ui/avatar`. Props: `src?`, `alt` (a11y-REQUIRED), `fallback` (initials), `size?` (sm/md/lg). Image with initials fallback.
  - **`input`** — wraps `@nauta/ui/input`. **Presentational only** (no state binding — that is Phase 19). Props: `label` (a11y-REQUIRED, rendered as an associated `<label>`), `placeholder?`, `type?` (text/email/password/number/search/tel/url), `disabled?`, `defaultValue?`. No `onChange`/state.
  - **`nav`** — house-built navigation bar/list. Props: `aria-label` (a11y-REQUIRED), `items` (array of `{ label, href, current? }` where `href` is relative-only, reusing the Phase-13 relative-href guard), optional `orientation?` (horizontal/vertical). Renders links; the active item is marked. **No click-wiring** (visual/semantic nav; real routing is Phase 19).
  - **`feed-item`** (a.k.a. list-item) — house-built composite row: optional leading `avatar`-style media, `title` (required), `subtitle?`/`meta?`, optional trailing slot. The component that most directly makes feeds/profiles stop reading as generic cards.
  - **`tabs`** (presentational) — house-built visual tab-strip with a declared `active` index that renders the active panel; **no click-switching** (interactivity = Phase 19). `aria-label` required. Included because ROADMAP lists it; kept strictly presentational. (Claude's discretion: if a clean presentational tabs proves low-value without interactivity, defer it and document — the other four are the priority.)
- **D-02:** **Wrap existing `@nauta/ui` primitives where they exist** (avatar, input, tabs) rather than re-implement; **house-build** only what has no primitive (nav, feed-item) — same pattern as the Phase-12 `stack`/`grid` house-built primitives + the `@nauta/ui`-backed leaves.
- **D-03:** **Depth-first, no stubs** ([[depth-first-no-stubs-preference]]): every entry is fully real, renders a real component (never a placeholder/fallback), and ships its CI-validated example. No "TODO"/partial entries.

### a11y + example CI gate (CTLG-07)
- **D-04:** Every new entry marks its accessibility props **required** in the Zod schema (`alt`, `aria-label`, `label` as applicable — matching the Phase-12 D-04 a11y-required convention) and ships a committed `example` that (a) parses against its own `propsSchema` and (b) renders a **real** component (not `UnknownComponentPlaceholder`/fallback) through the shared `SpecRenderer` — asserted by the existing manifest-example CI test (Phase-12 CTLG-04). Extend that test to cover the new entries.

### Registry + cache (CTLG-08)
- **D-05:** Register each new component in `COMPONENT_REGISTRY`; the SHA-256 `REGISTRY_VERSION` bumps automatically from the changed catalog; the existing **cache-invalidation-on-version-change** behavior (Phase-14) must continue to hold (a version bump invalidates stale cached specs). Add the new node types to `spec-schema.ts` (the wire discriminated union) AND the manifest `propsSchema` (render) — **the two MUST match** (the same drift that caused the Phase-17 button `onClick` bug: keep wire + render schemas in lockstep, verified by a parity test).
- **D-06:** Re-emit the Bedrock artifacts (`emit-bedrock-artifacts.ts`) after catalog/schema changes; the CI drift gate stays green. The compact catalog in `genui-prompt.json` now advertises the new components so the generator can compose them.

### Honor the Phase-17 token layer (CTLG-09)
- **D-07:** New components use **only** `@nauta/ui`/shadcn CSS-variable theming (`hsl(var(--*))`, `--radius`, fonts) — **no hardcoded colors** — so they automatically adopt the active style pack via `ThemedRoot`. Per-component token props (the Phase-17 TOKEN allowlist) apply where the model may style them.

### Folded-in layout primitives (Phase-17 UAT / backlog 999.2)
- **D-08:** **Grid `colSpan`** — add an optional per-child `colSpan` (1–12) layout hint so the model can express asymmetric layouts (e.g. a 3/9 sidebar+main split), not just equal columns. The renderer applies `grid-column: span N` (clamped to the grid's effective column count; keep the Phase-17 cols→child-count clamp). Schema: a per-node optional `colSpan` on grid children (wire + render in lockstep). Safe: pure layout integer, no injection surface.
- **D-09:** **`section` primitive** — a house-built titled page-section (optional `title` heading + vertical rhythm + consistent spacing) so the model frames pages declaratively into sections rather than relying only on the render-level page-shell. Complements (does not remove) the Phase-17 page-shell.

### Measuring the win (success criterion 4)
- **D-10:** Re-run the Phase-16/17 eval on profile/feed/nav corpus prompts to show the new components are **composed** (not degraded to generic cards) with a **rubric lift over the Phase-17 score** and **no a11y/contrast regression** (the Phase-17 hard gate holds). The deterministic checks are offline-unit-tested; the live `--all-packs`/corpus run vs baseline is the **deferred connected-env checkpoint** (same posture as Phase 17 — needs Bedrock creds + seeded DB).

### Claude's Discretion
- Exact prop names/enums per component; whether `feed-item` uses named slots vs positional media.
- Whether presentational `tabs` ships now or defers (D-01 note).
- `nav`/`feed-item` internal markup (semantic `<nav>`/`<ul>`/`<li>`), within the a11y + token-only constraints.
- Wave/plan split (suggest: layout primitives + schema in one wave, leaf components in parallel, eval + example-CI gate last).
</decisions>

<specifics>
## Specific Ideas
- The Phase-17 UAT proved the ceiling: generated pages look raw/generic because the catalog is card-heavy and
  layout is equal-columns-only. This phase attacks BOTH — real domain components (avatar/feed-item/nav) AND
  real layout structure (colSpan, section). A CRM/profile/feed prompt should now compose recognizable app surfaces.
- **Keep wire schema (spec-schema.ts) and render schema (manifest propsSchema) in lockstep** — the Phase-17
  button `onClick` bug was exactly this drift (wire accepted a prop the render schema rejected → every button
  errored). Add a parity test if one doesn't already exist.
- Presentational-only: no live interactivity/validation here — that is the Phase-19 declarative form engine.
  Inputs/tabs/nav render and look real; they don't yet "do" anything (documented, not a stub).
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase intent + the catalog contract
- `C:\Users\pc\Desktop\nauta.services.email-listener\.planning\ROADMAP.md` — Phase 18 section: goal + 4 success criteria + CTLG-06..09.
- `C:\Users\pc\Desktop\nauta.services.email-listener\.planning\phases\12-catalog-spec-schema-and-trusted-interpreter\12-CONTEXT.md` — the ORIGINAL catalog/manifest contract (strict Zod, a11y-required, locked vs settable, CI example) this phase must match.
- `C:\Users\pc\Desktop\nauta.services.email-listener\.planning\phases\17-tier-a-design-token-theme-layer-style-packs-assembly-rag\17-CONTEXT.md` — the token/theme layer (D-05..D-09) new components MUST honor (CTLG-09); the TOKEN allowlist.

### Catalog + schema (where components register — wire + render MUST match)
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\catalog\manifest.ts` — `NAUTA_CATALOG` entries + house-built primitives (stack/grid) + `@nauta/ui`-backed leaves. Add the new entries here (render propsSchema).
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\catalog\types.ts` — `ManifestEntry`/`ComponentRegistry` types + a11y-required marker.
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\schema\spec-schema.ts` — the wire discriminated union; add the new node schemas (MUST match manifest propsSchema — see the Phase-17 `onClick` drift lesson) + grid `colSpan`.
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\registry\component-registry.ts` + `registry-version.ts` — register new components; SHA-256 version bump + cache invalidation (Phase-14).
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\renderer\render-node.tsx` — per-node `propsSchema.safeParse` render validation; grid `colSpan` application lives in the grid component (`manifest.ts` GridComponent) + here for child layout.
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\scripts\emit-bedrock-artifacts.ts` + `packages\genui\artifacts\{spec.schema.json,genui-prompt.json}` — re-emit after changes (CI drift gate).

### CI example test + eval
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\__tests__\manifest.test.ts` — the CTLG-04 manifest-example CI test; extend to cover new entries (example parses + renders real component).
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\studio\build-catalog-example-spec.ts` + `__tests__\catalog-example-render.test.tsx` — catalog example rendering (each entry renders, not fallback).
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\email-listener\scripts\genui_eval\` — the eval harness (run_eval/rubric/style_metrics/compare_reports) for the deferred lift-vs-baseline check (D-10).

### @nauta/ui primitives to wrap
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\ui\src\avatar.tsx`, `input.tsx`, `tabs.tsx` — real primitives to wrap for avatar/input/tabs. (`nav`, `feed-item` are house-built composites.)
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase-12 catalog pattern** — `manifest.ts` shows both house-built primitives (stack/grid) and `@nauta/ui`-backed leaves (badge/button/card/separator/table). New entries follow the exact same shape (`description`, `example`, `propsSchema.strict()`, `lockedProps`, `acceptsChildren`/`slots`, `component`).
- **`@nauta/ui/avatar`, `/input`, `/tabs`** — real shadcn components to wrap (CSS-var themed → auto-adopt style packs).
- **The Phase-13 relative-href guard** (`action-schema.ts` navigate branch) — reuse for `nav` item hrefs (relative-only).
- **Phase-17 GridComponent clamp** (`manifest.ts`) — extend with `colSpan`; the clamp already handles cols→child-count.
- **The manifest-example CI test + build-catalog-example-spec** — the proven "every entry renders real, not fallback" gate.

### Established Patterns
- Wire schema (spec-schema.ts) + render schema (manifest propsSchema) MUST stay in lockstep (Phase-17 `onClick` drift lesson) — add/keep a parity test.
- Schema/catalog change → re-emit Bedrock artifacts behind the CI drift gate.
- Immutable-only, named exports, type-everything, zero-eval renderer (GR-01), a11y-required props (D-04).

### Integration Points
- New catalog entries + node schemas + registry registration + re-emitted artifacts.
- Grid `colSpan` (schema + GridComponent). New `section` primitive (house-built).
- Extended manifest-example CI test + a wire/render parity test. Deferred eval lift-vs-baseline run.
</code_context>

<deferred>
## Deferred Ideas
- **Interactive form controls** (validation, live state, conditional logic) — Phase 19 declarative form engine. Inputs here are presentational only.
- **Real click navigation** (button/nav actually routing) — Phase 19 (the `onClick`/action wiring). Nav is visual/semantic only here.
- **Interactive tabs** (click-to-switch) — Phase 19; Phase 18 tabs (if shipped) are presentational (declared active index).
- **Connected-env live eval** lift-vs-baseline run — deferred (needs Bedrock creds + seeded DB), same posture as Phase 17.
- **Sandboxed code-island** — Phase 20 (blocked on sign-off).

### Reviewed Todos (not folded)
None — no pending todos matched this phase.
</deferred>

---

*Phase: 18-tier-a-catalog-expansion*
*Context gathered: 2026-06-28 (autonomous)*
