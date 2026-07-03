# Phase 17: Tier A — Design-Token/Theme Layer + Style Packs + Assembly RAG - Context

**Gathered:** 2026-06-28
**Status:** Ready for planning
**Source:** ROADMAP.md Phase 17 (STYLE-01..04, RAG-01..02); GENUI-VNEXT-RESEARCH.md §3 (Tier-A "registry" method) + §2 (HYBRID) + §5 (eval-driven); REQUIREMENTS.md (RAG-01/02 = lightweight precursor, FLY deferred); Phase-16 eval harness (the measurement instrument this phase extends). Areas 1–3 captured interactively; Area 4 (eval) resolved with documented research-grounded defaults under autonomous mode (user switched to `/gsd:autonomous` mid-discussion — never block, pick defaults + document).

<domain>
## Phase Boundary

Ground generation in an explicit, machine-readable design system + **W3C-DTCG design tokens** that
**vary per generation ("style packs")**, plus **assembly RAG** (retrieve relevant components/exemplars and
inject before generation — v0's "registry" method), so output stops always reading as default shadcn. The
win is **measured**: a demonstrable lift on the Phase-16 golden set vs the recorded baseline, with **no a11y
regression**. **LOCAL + `/studio` sandbox only** (no deploy, no product convergence).

In scope: STYLE-01, STYLE-02, STYLE-03, STYLE-04, RAG-01, RAG-02.
Out of scope (later phases, explicitly): catalog expansion / new domain components (Phase 18), declarative
form engine (Phase 19), sandboxed code-island + adversarial/axe fixtures EVAL-01/02 (Phase 20, blocked on
sign-off), and the full **FLY flywheel** (template embeddings / promotion / parameterization — RAG here is
the *lightweight precursor*, seamed for FLY but not building it).
</domain>

<decisions>
## Implementation Decisions

### Style packs — the library (STYLE-01, STYLE-02)
- **D-01:** **~5–6 distinct style packs** in the starter library — enough range to prove same-intent
  variation and cover the corpus's vibes without diluting curation.
- **D-02:** Packs are **distinct brand personalities** (not variations on one baseline) — e.g. Linear-clean,
  warm editorial, brutalist, corporate-SaaS, playful-rounded. The exact named set + palettes are Claude's
  discretion within "genuinely distinct personalities" — maximally escaping the generic shadcn look the user
  flagged. The **current Nauta teal theme** (`--primary: 164 39% 22%`, `--radius: 0.5rem` in
  `apps/web/src/app/globals.css`) is retained as the **default/baseline pack** so eval lift is measured
  against a real "current look" anchor.
- **D-03:** Packs are **hand-authored W3C-DTCG token JSON** (color / type / spacing / radius / shadow),
  **no AI-invented values** — real, curated token sets in the stable DTCG 2025.10 shape. (Honors the
  no-fabrication rule carried across the milestone.)
- **D-04:** `/studio` selection = **explicit dropdown + an Auto/Surprise mode** — the user can pin a pack for
  demo control, and Auto/Surprise applies a (rotating/sampled) pack so the **same intent visibly differs
  across packs on demand** (success criterion 2). Selection is a studio control, not model-chosen.

### Stylization depth — how custom (STYLE-01, STYLE-03)
- **D-05:** Depth = **color re-theme + structural personality + per-component token props** (the maximal
  tier). Each pack overrides color CSS vars AND sets **radius, spacing/density, and shadow** personality
  (all expressible as the CSS variables `@nauta/ui` already reads — `hsl(var(--*))`, `--radius`, etc.),
  **and** the model may set token-driven style props on individual nodes. This goes well past a flat re-skin
  — the explicit answer to "overdone generic shadcn."
- **D-06:** **The model MAY set per-node style props, but ONLY from the active pack's allowlisted token
  aliases — never raw hex / free-form values** (STYLE-03: specificity beats description; the AutonomyAI
  "constrain to a token registry" pattern, research §3). This adds a **fourth allowlist — a TOKEN
  allowlist — enforced at the Zod/spec-schema level**, mirroring the existing component / procedure / action
  allowlists. A spec referencing a token alias not in the active pack fails validation before render.
- **D-07:** **Packs swap font families** — curated self-hosted/Google **display+body pairings** mapped to
  pack tokens (one of the strongest "custom brand" signals). Small, fixed, self-hosted set (no per-request
  remote font fetch).
- **D-08:** **The chosen pack is recorded as provenance + a cache dimension:** a **`style_pack_id` in the
  spec envelope** AND **included in the Phase-14 exact-cache key** (`cache_key.py`), so the same intent under
  two packs are **distinct cache entries** and History/eval can show which pack produced a given output.
  Mirrors how `registry_version` already keys the cache.
- **D-09 (hard constraint):** Because the model now picks per-component colors, **a11y/contrast MUST NOT
  regress.** Add a **deterministic WCAG-AA contrast check** on resolved token pairs (text vs surface) to the
  eval's a11y criterion; token-driven styling that fails contrast is a regression and blocks the lift claim.
  Packs themselves are authored to pass AA.

### Assembly RAG — what + how (RAG-01, RAG-02)
- **D-10:** Retrieval lives behind a **source-agnostic `RetrievalProvider` port** (mirrors Phase-11's
  inferred edge-provider seam). Ship the **fullest local implementation feasible now** — retrieve relevant
  **catalog components/blocks** + **hand-authored curated exemplar specs** + **available `ui_spec_templates`
  rows** — while making the interface **already capable of receiving the deferred complex structure**
  (embedding/RRF semantic retrieval + promotion = FLY). The provider returns a **ranked, scored result
  list**, so the semantic adapter drops in **with no caller/injection changes** when FLY lands. (User
  directive: "most full implementation we can do now, but document and make it already capable of receiving
  the more complex structure that was deferred.")
- **D-11:** Method **now** = **deterministic / lexical retrieval** (category / tag / keyword + lightweight
  structural similarity) over catalog + exemplars + available templates, top-k, ranked. **No Bedrock
  embeddings now** (that is FLY, deferred) — but the port + ranked-result contract + injection format are
  the embedding path's drop-in seam. Top-k and scoring details are Claude's discretion (tune against the
  first eval re-run).
- **D-12:** Exemplars = **hand-authored real spec exemplars**, committed assets, organized per style
  direction / category (e.g. dashboard, profile, pricing). **Never AI-fabricated.**
- **D-13:** **Injection point:** the retrieved registry subset + exemplars + **active pack token table** go
  in the **DYNAMIC per-request prompt portion**; the **static rules+catalog block keeps `cache_control`
  ephemeral** (COST-01 / Phase-13 D-21 preserved). The static prefix stays cache-stable; per-request carries
  intent + data-shape + retrieved subset + active-pack tokens. (Extends `genui_generator_adapter._SYSTEM_PROMPT_TEXT`
  / `_format_catalog_reference()` — the existing catalog-injection seam.)
- **D-14:** **RAG-02 proof (retrieval is not inert):** **log the retrieved ids** per generation (on the
  generation result + audit event), and add an **eval assertion that the emitted spec references a meaningful
  fraction of the retrieved components/structure** — a measured, regression-tracked guarantee.

### Measuring the win — eval extension (STYLE-04) — *resolved with documented defaults (autonomous)*
- **D-15:** **Style-distinctiveness is an ADDITIVE, separately-reported signal — NOT folded into the
  Phase-16 4-criterion weighted aggregate** (valid-spec/composed/on-intent/a11y, weights 0.30/0.30/0.25/0.15).
  This preserves the recorded baseline's **structural comparability** (Phase-16 D-12) — the existing four
  numbers stay diff-able run-to-run; style metrics are reported alongside.
- **D-16:** **Distinctiveness is measured deterministically:** run the same golden intent under ≥2 packs and
  score divergence in **emitted token aliases / active-pack vars / structure** (a pairwise distinctiveness
  score). Cheap, deterministic, and directly proves success criterion 2 ("two generations visibly differ").
- **D-17:** Add an **LLM-as-judge "custom-not-generic / on-brand" sub-criterion** (single structured Bedrock
  call, `temperature=0`, judge = `genui_escalation_model_id`, same adapter discipline as the Phase-16 judge),
  reported alongside on-intent. Captures the qualitative "does this read as a custom-branded UI, not default
  shadcn?".
- **D-18:** **Pass bar (STYLE-04)** = **(a)** no regression on the existing four criteria — **a11y is a HARD
  no-regression incl. the new D-09 contrast check** — **+ (b)** a measurable **lift on
  composed-not-placeholder and/or on-intent** **+ (c)** a positive style-distinctiveness signal. Gated via the
  Phase-16 `compare_reports.py` lift/regression diff ("no regression vs baseline", Phase-16 D-13) — **not** a
  brittle absolute threshold.
- **D-19:** The eval runner gains a **`--style-pack <id>` / `--all-packs` mode** to run the golden set (or a
  sampled subset) under each pack and emit **per-pack + distinctiveness aggregates**, reusing the Phase-16
  runner / rubric / judge_adapter / report / compare modules (no fork).

### Claude's Discretion
- Exact pack names + palettes + the typeface pairings (within "genuinely distinct personalities", AA-passing).
- Top-k retrieval count, the lexical/structural scoring formula, exemplar set size per category.
- The distinctiveness score formula + its reporting threshold (tune against the first re-run).
- Module/file layout for the token-theme layer + retrieval provider (within `packages/genui` + the Python
  generation service), and how the themed wrapper is mounted in the renderer.
- Whether Auto/Surprise rotation is round-robin vs weighted-random.
</decisions>

<specifics>
## Specific Ideas

- The user's stated grievance is **"just slapping some overdone shadcn components"** — so the bar for this
  phase is **visible, brand-distinct output**, not a subtle re-tint. D-05 (per-component token props) +
  D-07 (font swaps) + D-02 (distinct personalities) are deliberately the *most custom* options on offer.
- **Constrain, don't free-form** (research §3, repeated): the model picks from **token aliases**, never raw
  values (D-06). This is the safety+quality lever — it's why a token allowlist is mandatory, not optional.
- RAG is the **lightweight precursor to FLY, built behind a seam** (D-10) — the user explicitly wants the
  fullest-now implementation that can *receive* the deferred embedding/promotion structure with no rework.
  This is the same "ship simple today, seam the hard part" discipline as Phase-11's empty `knowledge_node_edges`
  edge-provider seam.
- The eval harness is the **gate the whole v1.2 milestone hangs on** — this phase EXTENDS it (additive
  signals, per-pack runs) and must not break baseline comparability (D-15). "Nothing ships without a measured
  before/after."
- The current Nauta teal theme is the **default pack / baseline anchor** (D-02) — lift is measured against a
  real current look, not a strawman.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase intent + decided method (primary)
- `C:\Users\pc\Desktop\nauta.services.email-listener\.planning\ROADMAP.md` — Phase 17 section: goal, the 4
  success criteria, requirements STYLE-01..04 + RAG-01/02; plus the v1.2 milestone framing.
- `C:\Users\pc\Desktop\nauta.services.email-listener\.planning\research\GENUI-VNEXT-RESEARCH.md` — **§3**
  (Tier-A "escape generic shadcn" = machine-readable design system + DTCG tokens + style packs, v0's
  "registry" method, "constrain to token aliases"); **§4** (assembly RAG = retrieve exemplars + dynamic
  prompt, v0 composite); **§5** (eval-driven, LLM-as-judge fixed rubric). Sources: vercel.com design-systems,
  w3.org design-tokens (2025.10), autonomyai.io, mindstudio (claude-design).
- `C:\Users\pc\Desktop\nauta.services.email-listener\.planning\REQUIREMENTS.md` §STYLE (lines ~136-139),
  §RAG (lines ~143-144), and the **FLY-deferral note** (~lines 173-175: "RAG-01/02 is the lightweight,
  local precursor to the full FLY flywheel; embeddings/promotion deferred").

### The measurement instrument this phase extends (Phase-16 eval harness)
- `C:\Users\pc\Desktop\nauta.services.email-listener\.planning\phases\16-studio-foundation-eval-harness-history-page-ideas-tabs\16-CONTEXT.md`
  — eval-harness decisions D-04..D-13 (runner, hybrid rubric, 4 criteria + weights, baseline, comparability).
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\email-listener\scripts\genui_eval\run_eval.py` —
  the runner to extend with `--style-pack`/`--all-packs` (D-19). Siblings: `rubric.py` (pure; add the
  contrast check D-09 + distinctiveness D-16 here), `judge_adapter.py` (add the custom-not-generic judge
  D-17), `report.py`, `compare_reports.py` (the lift/regression gate, D-18), `reports/` (recorded baseline).
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\eval\golden-set.json` (the set the
  lift is measured on) + `page-ideas.json` + `page-ideas-schema.ts`.

### Generation pipeline — the token + RAG injection seam (Python / Bedrock)
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\email-listener\app\infrastructure\llm\genui_generator_adapter.py`
  — `_SYSTEM_PROMPT_TEXT` (line ~91), `_format_catalog_reference()` (line ~121), the combined
  `cache_control: ephemeral` system block (line ~167). **D-13 injection** extends this: static block stays
  cached; retrieved subset + active-pack tokens go in the per-request portion.
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\email-listener\app\application\use_cases\generate_ui_spec.py`
  — `GenerateUiSpecUseCase.execute(...)`; where retrieval (the new `RetrievalProvider`, D-10) + pack
  selection slot in before generation, and where `style_pack_id` + retrieved ids flow onto the result (D-08/D-14).
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\email-listener\app\application\use_cases\cache_key.py`
  — the Phase-14 exact-cache key module; **add `style_pack_id` to the key** (D-08).
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\email-listener\app\infrastructure\llm\genui_artifacts.py`
  — `load_spec_schema()`, `GENUI_ARTIFACTS_DIR` (token allowlist + envelope changes re-emit artifacts).
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\email-listener\app\container.py` — wire the new
  `RetrievalProvider` + pack registry into the use case.
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\email-listener\app\settings.py` — `genui_model_id`,
  `genui_escalation_model_id` (judge), `GENUI_ARTIFACTS_DIR`.

### Spec schema, allowlists, envelope, registry (TS — where tokens + pack id live)
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\schema\spec-schema.ts` — the `v:1`
  envelope (add `style_pack_id`, D-08) + per-node props (the per-component token-prop slot, D-05).
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\schema\allowlists.ts` — the existing
  component/procedure/action allowlists; **add the TOKEN allowlist** (D-06).
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\schema\index.ts` — `SpecRootSchema`,
  `SAFE_FALLBACK_SPEC` (re-validated at the web boundary; must accept the new envelope field).
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\catalog\manifest.ts` +
  `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\catalog\types.ts` — the catalog the
  registry/RAG retrieves over (D-10/D-11).
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\registry\registry-version.ts` — the
  versioned cache/registry key (pack id composes with it for cache invalidation).
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\scripts\emit-bedrock-artifacts.ts` +
  `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\generation\artifact-builder.ts` —
  re-emit `artifacts/spec.schema.json` + `artifacts/genui-prompt.json` after schema/allowlist changes (CI drift gate).

### Renderer — token consumption (TS)
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\renderer\spec-renderer.tsx` +
  `render-node.tsx` — mount the **themed CSS-variable wrapper** (apply the active pack's `--primary/--background/--radius/...`
  + font vars) around the spec tree so `@nauta/ui` consumes tokens automatically; apply per-node token props.
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\web\src\app\globals.css` — the `:root` token block
  (lines ~14-39) packs override (the var set + current default values; the Nauta teal baseline pack).
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\ui\package.json` — `next-themes`; `@nauta/ui`
  components read `hsl(var(--*))` (shadcn theming — the consumption mechanism).

### Studio surface (web) — pack selector + provenance display
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\web\src\app\studio\_components\generation-sandbox-island.tsx`
  — add the **style-pack dropdown + Auto/Surprise** control (D-04); pass `style_pack_id` into the generate call.
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\api-client\src\router\genui\generate.ts` — the
  tRPC generate proxy; thread `style_pack_id` through (Zod-validated at the web boundary).
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\web\src\app\studio\_components\spec-renderer-island.tsx`
  — the shared renderer island; ensure the themed wrapper applies in studio + History detail.

### Cache table (pack id joins the key)
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\db\src\schema\ui-spec-templates.ts` — the
  exact-cache table; `cache_key` now incorporates `style_pack_id` (D-08); `spec_json` carries the envelope field.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`@nauta/ui` shadcn CSS-variable theming** (`hsl(var(--primary))`, `--radius`, `--ring`, `next-themes`) —
  packs are CSS-var override sets; **no component changes** needed for the re-theme + personality layer (D-05).
- **The `cache_control` static system block + per-request split** (`genui_generator_adapter`) — the exact
  injection seam: static catalog/rules stay cached, retrieved subset + pack tokens go per-request (D-13).
- **Phase-14 `cache_key.py`** — extend with `style_pack_id` (D-08); deterministic key already includes
  registry version.
- **Phase-16 eval harness** (`scripts/genui_eval/*`, `golden-set.json`, `compare_reports.py`) — extended,
  not forked: new criteria are additive, `--all-packs` reuses the runner (D-15..19).
- **The three-allowlist guardrail** (`schema/allowlists.ts`) — the token allowlist is a fourth, same pattern (D-06).
- **Phase-11 inferred edge-provider seam** — the architectural precedent for the `RetrievalProvider` port
  that ships simple now + receives the deferred FLY structure later (D-10).

### Established Patterns
- Generation is **Bedrock/Python**; the web `genui` tRPC router proxies + re-validates with Zod at the
  boundary (never trust model/FastAPI output). New fields (`style_pack_id`) thread through both.
- Spec/allowlist changes **re-emit Bedrock artifacts** via `emit-bedrock-artifacts.ts` behind a CI drift gate.
- Studio tabs = client `Tabs` shell + per-tab `"use client"` island; the production `SpecRenderer` is shared
  (no stub renderers).
- Best-effort repos + `asyncio.to_thread` for the sync Supabase client.

### Integration Points
- **New** in `packages/genui`: a `theme/` (DTCG pack assets + loader + token allowlist), per-node token-prop
  schema, envelope `style_pack_id`, themed renderer wrapper, curated exemplar assets.
- **New** in the Python service: a `RetrievalProvider` port + a deterministic/lexical adapter (catalog +
  exemplars + templates), pack selection, wired in `container.py` + `generate_ui_spec.py`; `cache_key.py`
  + audit/result carry `style_pack_id` + retrieved ids.
- **Extended** eval: `rubric.py` (contrast + distinctiveness), `judge_adapter.py` (custom-not-generic),
  `run_eval.py` (`--all-packs`), a re-recorded comparison report.
- **Extended** web: sandbox pack selector + Auto/Surprise; `generate.ts` passes `style_pack_id`.
</code_context>

<deferred>
## Deferred Ideas

- **FLY flywheel** — semantic template retrieval via embeddings (Titan V1 1536 + pgvector + RRF k=60),
  promotion of "good" generations, and template parameterization. This phase builds the `RetrievalProvider`
  **seam** that receives it (D-10/D-11) but does NOT implement embeddings/promotion (REQUIREMENTS FLY note).
- **Catalog expansion** (avatar, list/feed-item, nav, tabs, input primitives) — Phase 18; new components will
  honor this phase's token/theme layer (CTLG-09).
- **Declarative form engine** — Phase 19. **Sandboxed code-island** + adversarial/axe-core fixtures
  (EVAL-01/02) — Phase 20 (blocked on user sign-off).
- **Pairwise / TrueSkill UI-quality ranking** (UI-Bench full method) — still deferred; this phase keeps the
  absolute 0–1 + pass/fail rubric, adding distinctiveness as an additive signal (D-15).
- **Model-chosen pack selection from intent** — considered for D-04; deferred in favor of an explicit
  dropdown + Auto/Surprise (studio-controlled), so demos are deterministic and the lift is attributable.
- **Per-request remote font loading** — packs use a small fixed self-hosted font set (D-07), not arbitrary
  runtime font fetches.

### Reviewed Todos (not folded)
None — no pending todos matched this phase.
</deferred>

---

*Phase: 17-tier-a-design-token-theme-layer-style-packs-assembly-rag*
*Context gathered: 2026-06-28*
