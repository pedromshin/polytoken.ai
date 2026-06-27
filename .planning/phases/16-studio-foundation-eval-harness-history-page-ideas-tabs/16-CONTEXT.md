# Phase 16: Studio Foundation — Eval Harness + History & Page-Ideas Tabs - Context

**Gathered:** 2026-06-27
**Status:** Ready for planning
**Source:** ROADMAP.md Phase 16; GENUI-VNEXT-RESEARCH.md §5 (eval-driven process) + §2 (HYBRID); REAL-PROMPT-CORPUS.md (76 prompts); existing generate pipeline + studio surface (Phases 13-15).

<domain>
## Phase Boundary

Three deliverables, eval harness FIRST (eval-driven development), all **LOCAL + `/studio` sandbox only**
(no deploy, no product convergence):

1. **Eval harness (EVAL-03/04/05)** — a committed **golden prompt set** curated from the REAL prompt corpus
   (provenance preserved), a **Python eval runner** in `apps/email-listener` that drives the existing
   `GenerateUiSpecUseCase` over that set, and a **hybrid rubric** (deterministic checks + a single
   LLM-as-judge Bedrock call) that emits a per-prompt + aggregate **0.0–1.0 score with pass/fail per
   criterion** and writes a **baseline report**. This is the regression gate every later phase must not
   regress against.

2. **History tab (STDO-05/06)** — FastAPI read endpoints over `ui_spec_templates` → new `genui` tRPC
   procedures (`historyList` / `historyById`) → a **History tab** in `studio-tabs.tsx`: a paginated,
   newest-first list of past generations; clicking one opens a detail view that re-renders the stored spec
   via the SHARED `SpecRendererIsland` in the same **55/45 render/JSON split**. Read-only, best-effort.

3. **Page-Ideas tab (STDO-07/IDEA-01)** — the REAL corpus converted to a **committed structured asset**, a
   **Page-Ideas tab** that browses/filters by category/complexity/tier + a **"Surprise me"** that
   random-samples (weighted toward curveballs/Tier-B). Clicking an idea fills the Sandbox intent and
   switches to the Sandbox tab. These are REAL curated prompts with provenance — **never AI-invented**.

In scope: EVAL-03, EVAL-04, EVAL-05, STDO-05, STDO-06, STDO-07, IDEA-01.
Out of scope (later phases, explicitly): Tier-A token/theme layer + style packs + assembly RAG (Phase 17),
catalog expansion (Phase 18), declarative form engine (Phase 19), sandboxed code-island + adversarial /
a11y-axe fixtures EVAL-01/02 (Phase 20, blocked on sign-off). This phase ADDS the eval gate; it does not
change the generation engine, the renderer, the catalog, or the safety model.
</domain>

<decisions>
## Implementation Decisions

### Golden set asset (EVAL-03)
- **D-01:** The golden set is a **committed structured asset derived from REAL-PROMPT-CORPUS.md** —
  **no AI-invented prompts** (hard rule). It is a curated subset of the 76 real prompts, **~36 entries**,
  spanning both tiers (A static / B interactive), all three complexity bands (simple/medium/complex), every
  category, and **including the full curveball subset** (#57 soundscape mixer, #54 whiteboard, #66 Bloomberg
  terminal, #69 drawing game, #61 3D configurator, #30 Notion clone, #28 Billy bill-splitter, #22 blog-brief
  generator).
- **D-02:** Asset location + format: **`packages/genui/src/eval/golden-set.json`** (committed JSON, single
  source of truth, importable by both the TS studio layer and read by the Python runner via a relative path).
  Each entry shape: `{ id: number, prompt: string, category: string, complexity: "simple"|"medium"|"complex",
  tier: "A"|"B", source: string, curveball: boolean }`. `id` is the corpus row number (provenance anchor);
  `source` keeps the corpus's verbatim/source-URL provenance string. A **committed Zod schema**
  (`golden-set-schema.ts`) validates the file shape; a CI/unit test asserts the file parses + that every
  `id` exists in the corpus and counts hit the tier/complexity/curveball coverage targets (D-01).
- **D-03:** Curation method is **mechanical + transparent**, recorded in a short header comment / sibling
  `golden-set.README` note: select to hit coverage quotas (≥10 Tier-A, ≥20 Tier-B, all 8 curveballs, ≥1 per
  category, balanced across complexity). No paraphrasing of prompt text — copy verbatim from the corpus.

### Eval runner (EVAL-03/05)
- **D-04:** The runner is a **standalone Python script** at
  **`apps/email-listener/scripts/genui_eval/run_eval.py`** (new `scripts/genui_eval/` package). It drives
  the EXISTING `GenerateUiSpecUseCase` — the same production pipeline (cache → quarantine → generate →
  persist → audit), not a reimplementation — so the eval measures the real engine (GENUI-VNEXT §5 composite
  discipline). Generation is Bedrock/Python, so the runner MUST live Python-side (matches LLM-transport =
  Bedrock).
- **D-05:** Invocation: **`uv run python -m scripts.genui_eval.run_eval`** with flags
  `--out <path>` (default `apps/email-listener/scripts/genui_eval/reports/`), `--limit N` (smoke subset),
  `--no-judge` (run deterministic checks only, skip the LLM-as-judge Bedrock call — fast/free local mode),
  and `--label <name>` (report tag, e.g. `baseline`). It is **NOT part of the pytest suite** (it makes real
  Bedrock calls and would break the `--cov-fail-under=80` gate). A thin **`pytest -m integration` smoke
  test** (skipped by default unless `RUN_GENUI_EVAL=1`) imports the runner + rubric modules and runs the
  deterministic rubric against a fixed in-memory spec — so the harness code itself is unit-covered without
  network.
- **D-06:** Runner construction reuses the **container DI**: build the real `GenerateUiSpecUseCase` via
  `create_container()` (`apps/email-listener/app/container.py`) so the runner uses the same wired adapters
  (quarantine, generator, audit, templates). The runner sets `registry_version` from the committed
  artifact (read `packages/genui/artifacts/` / the `spec.schema.json` sibling registry-version value) so
  scores are keyed to the engine version under test (comparability lever, D-12).
- **D-07:** Each golden prompt runs **intent-only** (`raw_content=""`, intent-only generation mode the
  pipeline already supports) so the eval isolates intent→UI quality. The runner runs prompts **sequentially
  with a small concurrency cap (≤3)** and a per-prompt try/except so one failure never aborts the run; a
  failed generation scores 0 on every criterion and is recorded with the error.

### Rubric — hybrid: deterministic + LLM-as-judge (EVAL-04)
- **D-08:** The rubric scores **four criteria**, each emitting a **0.0–1.0 sub-score AND a boolean
  pass/fail**, per GENUI-VNEXT §5 (LLM-as-judge with a fixed rubric):
  1. **valid-spec** (deterministic) — the returned spec **parses the SpecRoot JSON schema** AND
     `outcome != "fallback"` AND it is not byte-equal to `SAFE_FALLBACK_SPEC`. Validate with the SAME
     `jsonschema.Draft7Validator(load_spec_schema())` + `MAX_SPEC_NODES`/`MAX_SPEC_DEPTH` bounds the
     generator uses (`genui_generator_adapter`), so the eval's notion of "valid" is identical to production.
  2. **composed-not-placeholder** (deterministic) — **node-count / variety / depth thresholds** AND
     **no placeholder/meta text**. Reuse the production no-placeholder signal: the generator's system prompt
     already forbids meta-commentary ("this is a placeholder", "consider breaking this into components",
     "to build this, design each component separately"). The rubric scans the spec's text-bearing props for
     that exact phrase-set (the no-placeholder signal) and requires composition thresholds
     (default: ≥6 nodes, ≥3 distinct node types, depth ≥2, ≥1 layout container with real children).
  3. **on-intent** (LLM-as-judge) — a **single structured Bedrock call** with a **fixed rubric prompt**:
     given (prompt text, the emitted spec JSON), return `{score: 0..1, pass: bool, rationale: str}` judging
     whether the rendered UI would satisfy the user's intent. Forced tool-use / structured output, low
     max_tokens, `temperature=0`, one call per prompt — never multi-turn (cost-bounded, deterministic-ish).
  4. **a11y** (deterministic) — **required a11y props present**: walk the spec and confirm every node whose
     catalog entry marks an a11y-required prop (label/alt/caption per Phase-12 D-04) actually carries it.
     Because valid-spec already enforces schema (which makes a11y props required), this criterion is a
     focused re-report at the node level so a11y regressions surface as their own number.
- **D-09:** **Judge model = the genui escalation model** (`settings.genui_escalation_model_id`, the
  Sonnet-tier model) — a stronger model judges than the Haiku generator, per GENUI-VNEXT (LLM-as-judge most
  human-aligned with a capable judge). The judge call is its OWN adapter
  (`scripts/genui_eval/judge_adapter.py`) using the shared `AsyncAnthropicBedrock` client; it is **separate
  from the generation path** and never feeds the generator. `--no-judge` skips it and the on-intent criterion
  is reported as `null` (excluded from the aggregate).
- **D-10:** **Aggregate score** per prompt = a **fixed-weight mean** of the available sub-scores
  (weights: valid-spec 0.30, composed-not-placeholder 0.30, on-intent 0.25, a11y 0.15 — committed as
  constants in `rubric.py`). The **run aggregate** = mean of per-prompt aggregates + a **pass-rate per
  criterion** (fraction passing) + breakdowns by tier / complexity / curveball-vs-not. Weights and
  thresholds are committed constants so two runs are comparable (D-12).
- **D-11:** The rubric's deterministic core (valid-spec, composed-not-placeholder, a11y, weighting,
  aggregation) lives in a **pure, dependency-light module** `scripts/genui_eval/rubric.py` (no Bedrock, no
  Supabase) so it is fully unit-testable (D-05 smoke) and reused identically across runs.

### Baseline + regression gate (EVAL-05)
- **D-12:** A run writes a **timestamped JSON report** + a **human-readable markdown summary** to
  `scripts/genui_eval/reports/` (e.g. `2026-06-27-baseline.json` / `.md`). The report records: engine
  `registry_version`, judge model id, the rubric weights/thresholds used, per-prompt rows, and all
  aggregates. The **first run with `--label baseline` is committed as the recorded baseline**; later phases
  re-run and diff against it. **Comparability is structural** — same golden set ids + same committed
  weights/thresholds + recorded registry_version make any two reports directly comparable; a tiny
  `compare_reports.py` helper prints lift/regression per criterion between two report files.
- **D-13:** This phase **records the baseline; it does not enforce a hard CI fail-threshold** (the engine is
  pre-Tier-A and will score modestly). The gate is the recorded number + the compare helper; Phase 17+ uses
  "no regression vs baseline" as its bar. The report is the artifact phases 17-20 must beat.

### History tab — read endpoints (STDO-05)
- **D-14:** New **FastAPI read endpoints** under the existing `genui` router prefix
  (`apps/email-listener/app/presentation/api/v1/genui.py`), behind the same `require_api_key`:
  - `GET /v1/genui/history` — list `ui_spec_templates`, **newest-first** (`created_at desc`),
    **paginated** (`limit` default 20 / max 100, `offset`), optional **`importer_id` scope filter**.
    Returns rows of `{ id, intent_text, created_at, registry_version, use_count, validation_status }` —
    **NOT** `spec_json` (list stays light).
  - `GET /v1/genui/history/{id}` — returns one row INCLUDING `spec_json` for the detail view.
- **D-15:** History reads go through a **new read method on the existing `UiSpecTemplateRepository` port**
  (`list_recent(limit, offset, importer_id)` + `find_by_id(id)`) implemented on
  `SupabaseUiSpecTemplateRepository` with the same **best-effort** contract (errors → empty list / None,
  logged server-side) and `asyncio.to_thread` offload (WR-06 convention). Reads are **read-only** — no new
  writes, no RLS change (FastAPI connects service-role, bypassing the deny-all RLS already on the table).
- **D-16:** **History surfaces validated `ui_spec_templates` ONLY — NOT `genui_generation_events`.** Reason:
  `ui_spec_templates` holds the renderable `spec_json` + plaintext `intent_text` (the events table stores
  only `intent_hash`, no spec, so its rows cannot be re-rendered or shown with readable intent). Cache-hit /
  fallback observability already exists live in the Sandbox's `GenerationStateChrome`; re-deriving it from
  the audit table is deferred (see `<deferred>`). The `validation_status` column is surfaced as a small badge
  for forward-compat (all rows are `validated` in v1.1).

### History tab — tRPC + UI (STDO-06)
- **D-17:** Two new procedures on the genui tRPC sub-router (`packages/api-client/src/router/genui/`):
  `historyList` (input `{ limit?, offset?, importerId? }`) and `historyById` (input `{ id: string }`).
  Both follow the **exact proxy + re-validate pattern of `generate.ts`**: server-side `getListenerConfig()`
  for URL+key, `fetch` the FastAPI endpoint, read the `ApiResponse` envelope (`body.data`), and **re-validate
  with Zod at the web boundary**. `historyList` validates a `z.array(HistoryRowSchema)`; `historyById`
  **re-runs `SpecRootSchema.safeParse` on the stored `spec_json`** and on failure returns the row with
  `spec: SAFE_FALLBACK_SPEC` (a stored spec that no longer parses under the current schema degrades
  gracefully — never crashes the detail view). New files `history.ts` (+ test) registered in `index.ts`
  alongside `generate`.
- **D-18:** A **"History" tab** is added to `studio-tabs.tsx` (third trigger after Catalog, Sandbox). Its
  content is a new **`history-island.tsx`** ("use client", `api.genui.historyList.useQuery`):
  - **Master list:** newest-first rows showing intent_text (truncated), relative `created_at`, a
    `registry_version` short badge, `use_count`, and the `validation_status` badge; a "Load more" /
    offset pager (D-14 pagination). Empty + loading + error states.
  - **Detail view:** clicking a row fires `api.genui.historyById.useQuery({ id })`; the result re-renders
    the stored spec via the **SHARED `SpecRendererIsland`** in the **same 55/45 `ResizablePanelGroup`
    render/JSON split** lifted from `generation-sandbox-island.tsx` (D-09 of Phase 15). Read-only: no
    Generate button, no editing; actions passed as the empty/no-op registry (detail is for inspection).

### Page-Ideas tab — asset + UI (STDO-07, IDEA-01)
- **D-19:** The FULL 76-prompt corpus is converted to a **committed structured asset**
  **`packages/genui/src/eval/page-ideas.json`** with entry shape
  `{ id, prompt, category, complexity, tier, source, curveball }` (same shape as the golden set, D-02 — the
  golden set is a curated SUBSET, so they share a schema and the page-ideas file is the superset of all 76).
  **CRITICAL: these are the REAL curated corpus prompts with provenance — NOT AI-generated.** A
  unit/CI test asserts the file has 76 entries and every prompt is non-empty. Diversity/"high temperature"
  comes from **sampling the real corpus**, never from inventing prompts (user constraint).
- **D-20:** A **"Page Ideas" tab** added to `studio-tabs.tsx` (fourth trigger). Content is a new
  **`page-ideas-island.tsx`** ("use client", direct import of `page-ideas.json` — static data, no network):
  - **Browse/filter grid:** cards showing prompt text + category / complexity / tier / curveball chips, with
    **filter controls** by category, complexity, tier, and a curveball-only toggle. Client-side filtering
    over the in-memory array.
  - **"Surprise me" button:** random-samples one idea with **weighting toward curveballs/Tier-B** —
    committed weights in a pure helper `pick-page-idea.ts` (curveball weight 3×, Tier-B 2×, Tier-A 1×;
    composed multiplicatively, normalized). The helper is **pure + unit-tested** (seedable RNG injected for
    determinism in tests).
- **D-21:** **Clicking an idea (card or "Surprise me" result) fills the Sandbox intent and switches to the
  Sandbox tab.** Because `Tabs` active state + the Sandbox intent live in separate islands, **lift the
  active-tab value AND a `pendingIntent` string into `StudioTabs`** (controlled `Tabs value`/`onValueChange`
  + `useState`). Page-Ideas calls an `onUseIdea(prompt)` callback → sets `pendingIntent` + sets active tab to
  `"sandbox"`; `GenerationSandboxIsland` accepts an optional `initialIntent` / `pendingIntent` prop and
  seeds its `intent` state from it (does NOT auto-generate — the user still clicks Generate, D-06 manual-only
  contract preserved). This is the minimal lift; no global store needed.

### Claude's Discretion
- Exact golden-set count within the ~30-40 envelope (~36 endorsed) and the precise ids chosen, provided the
  D-01/D-03 coverage quotas are met.
- Exact composition thresholds in the composed-not-placeholder check (the ≥6 nodes / ≥3 types / depth ≥2
  defaults are endorsed starting points; tune against the first baseline run).
- Exact judge-prompt wording for the on-intent criterion (must be a fixed, committed string; structured
  output, temperature 0, single call).
- Report file naming + the markdown summary layout; whether `compare_reports.py` is a separate file or a
  `--compare` flag on the runner.
- Page-Ideas card layout/styling and filter-control widget choices (reuse `@nauta/ui` primitives).
- Whether the History pager is "Load more" vs prev/next page buttons.
- Internal module split within `scripts/genui_eval/` (runner / rubric / judge_adapter / report / compare).
</decisions>

<specifics>
## Specific Ideas

- The eval runner is the **regression gate** the whole v1.2 milestone hangs on (GENUI-VNEXT §6: "Nothing
  else ships without a baseline score"). Build it FIRST and record the baseline before any other phase 16
  work is graded — though within phase 16 the History/Page-Ideas tabs are independent and can be built in
  parallel.
- The "no-placeholder signal" is not new — it is the **exact meta-commentary phrase-set already encoded in
  the generator's system prompt** (`genui_generator_adapter._SYSTEM_PROMPT_TEXT`). The rubric reuses that
  same phrase-set so "composed-not-placeholder" measures precisely the failure the prompt tries to prevent.
- The golden set and page-ideas asset SHARE one entry schema; the golden set is a curated subset of the
  page-ideas superset. Keep them as two committed JSON files under `packages/genui/src/eval/` with one Zod
  schema so provenance + shape stay consistent and the CI tests are simple.
- History detail and the Sandbox both use the SAME `SpecRendererIsland` + the SAME 55/45 split — this is the
  Phase-15 reuse contract (STDO-02: the production renderer, never a stub) continued. Do NOT fork a second
  renderer or a second panel layout.
- The page-ideas "Surprise me" weighting is the ONLY place "diversity" is engineered, and it is engineered
  by **sampling the real corpus**, never by an LLM inventing ideas — the user's hard constraint.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase intent + process (primary)
- `C:\Users\pc\Desktop\nauta.services.email-listener\.planning\ROADMAP.md` — Phase 16 section: goal, the 5
  success criteria, requirements EVAL-03/04/05 + STDO-05/06/07 + IDEA-01.
- `C:\Users\pc\Desktop\nauta.services.email-listener\.planning\research\GENUI-VNEXT-RESEARCH.md` — §5
  (eval-driven development, LLM-as-judge fixed rubric, UI-Bench method, composite architecture) is the
  decided eval method; §2 the HYBRID architecture context; §6 the phase order ("eval harness first").
- `C:\Users\pc\Desktop\nauta.services.email-listener\.planning\research\REAL-PROMPT-CORPUS.md` — the 76 REAL
  prompts with provenance/tier/complexity/category + the curveball subset. The ONLY source of prompts for
  BOTH the golden set and the page-ideas asset (no AI-invented prompts).

### Format template
- `C:\Users\pc\Desktop\nauta.services.email-listener\.planning\phases\12-catalog-spec-schema-and-trusted-interpreter\12-CONTEXT.md`
  — the CONTEXT format this document matches exactly.

### Generation pipeline the runner drives (Python)
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\email-listener\app\application\use_cases\generate_ui_spec.py`
  — `GenerateUiSpecUseCase.execute(intent, raw_content, registry_version, importer_id, catalog_id)`; the
  exact entrypoint the eval runner calls; intent-only mode (`raw_content=""`); `GenerateUiSpecResult`
  (`spec`, `cache_hit`, `outcome`).
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\email-listener\app\infrastructure\llm\genui_generator_adapter.py`
  — `SAFE_FALLBACK_SPEC`, `MAX_SPEC_NODES`/`MAX_SPEC_DEPTH`, `_validate_spec` (Draft7 + bounds), `_count_nodes`,
  and the placeholder/meta phrase-set in `_SYSTEM_PROMPT_TEXT` (the no-placeholder signal the rubric reuses).
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\email-listener\app\infrastructure\llm\genui_artifacts.py`
  — `load_spec_schema()` (the runner's valid-spec check uses the SAME schema), `GENUI_ARTIFACTS_DIR`.
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\email-listener\app\container.py` — `create_container()`
  + `_provide_generate_ui_spec_use_case`; how the runner gets a fully-wired use case + shared Bedrock client.
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\email-listener\app\settings.py` — `genui_model_id`,
  `genui_escalation_model_id` (the judge model, D-09), timeouts, `GENUI_ARTIFACTS_DIR`.

### History tab — data + endpoints + repository
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\db\src\schema\ui-spec-templates.ts` — the table
  the History tab reads (intent_text, created_at, registry_version, use_count, validation_status, spec_json).
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\email-listener\app\infrastructure\supabase\supabase_ui_spec_template_repository.py`
  — the repo to extend with `list_recent` + `find_by_id` (best-effort + `asyncio.to_thread` convention).
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\email-listener\app\presentation\api\v1\genui.py` —
  the FastAPI genui router to add the two read endpoints to (require_api_key, ApiResponse envelope).
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\db\src\schema\genui-generation-events.ts` —
  the audit table NOT surfaced by History (D-16: intent_hash only, no spec_json).

### tRPC + studio surface (web)
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\api-client\src\router\genui\generate.ts` — the
  proxy + Zod-re-validate pattern `historyList`/`historyById` copy.
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\api-client\src\router\genui\index.ts` — the
  sub-router to register the new procedures in.
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\web\src\app\studio\_components\studio-tabs.tsx` —
  where History + Page-Ideas triggers slot in; lift active-tab + pendingIntent here (D-21).
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\web\src\app\studio\_components\spec-renderer-island.tsx`
  — the SHARED renderer island reused by the History detail view.
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\web\src\app\studio\_components\generation-sandbox-island.tsx`
  — the 55/45 split to reuse + accepts `initialIntent`/`pendingIntent` (D-21).
- `C:\Users\pc\Desktop\nauta.services.email-listener\apps\web\src\app\studio\_components\catalog-browser-island.tsx`
  — the existing direct-static-import island pattern Page-Ideas mirrors (no network for static data).

### Schema (web boundary re-validation)
- `C:\Users\pc\Desktop\nauta.services.email-listener\packages\genui\src\schema\index.ts` — `SpecRootSchema`,
  `SAFE_FALLBACK_SPEC` (historyById re-validates stored spec; D-17).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`GenerateUiSpecUseCase`** — the production pipeline; the runner drives it unchanged. Intent-only mode
  (`raw_content=""`) is already supported and is exactly what the eval needs.
- **`SAFE_FALLBACK_SPEC` + `_validate_spec` + bounds + `_count_nodes`** (genui_generator_adapter) — the
  rubric reuses these so "valid"/"composed" match production semantics exactly.
- **`SpecRendererIsland` + the 55/45 `ResizablePanelGroup` split** (Phase 15) — reused verbatim by the
  History detail view; STDO-02 "same production renderer, no stub" continued.
- **`generate.ts` proxy + Zod-re-validate pattern** — `historyList`/`historyById` follow it line-for-line
  (getListenerConfig, ApiResponse envelope `body.data`, web-boundary safeParse).
- **`SupabaseUiSpecTemplateRepository`** best-effort + `asyncio.to_thread` convention — extended with the two
  read methods.
- **`catalog-browser-island.tsx`** — the precedent for a studio tab that imports static committed data
  directly (Page-Ideas mirrors it; no network for `page-ideas.json`).
- **`create_container()`** — gives the runner a fully-wired use case + shared `AsyncAnthropicBedrock` client
  (judge adapter reuses the same client).

### Established Patterns
- Studio tabs = client `Tabs` shell + per-tab "use client" island; `dynamic(ssr:false)` for the renderer.
- tRPC genui procedures proxy FastAPI with server-side `EMAIL_LISTENER_API_KEY` and ALWAYS re-validate
  untrusted output at the web boundary (never trust FastAPI/model output blindly).
- Best-effort read/write repos (errors swallowed + logged), `asyncio.to_thread` for the sync supabase client.
- Python clean-architecture import-linter contracts: the eval runner lives under `scripts/` (outside `app/`),
  so it MAY import `app.container` / infrastructure directly — it is a tool, not part of the layered app.

### Integration Points
- **New `apps/email-listener/scripts/genui_eval/`** package: `run_eval.py`, `rubric.py` (pure),
  `judge_adapter.py`, `report.py`, `compare_reports.py`, `reports/`.
- **New committed assets** `packages/genui/src/eval/golden-set.json`, `page-ideas.json`, `golden-set-schema.ts`
  + an `eval/index.ts` export + CI/unit coverage tests.
- **Extended** `UiSpecTemplateRepository` port + Supabase adapter (`list_recent`, `find_by_id`); **extended**
  FastAPI `genui.py` (2 read endpoints); **extended** genui tRPC sub-router (`history.ts`).
- **New web islands** `history-island.tsx`, `page-ideas-island.tsx`, pure helper `pick-page-idea.ts`;
  **extended** `studio-tabs.tsx` (2 triggers + lifted active-tab + pendingIntent) and
  `generation-sandbox-island.tsx` (optional `initialIntent` prop).
</code_context>

<deferred>
## Deferred Ideas

- **EVAL-01 (adversarial / prompt-injection regression fixtures) + EVAL-02 (axe-core automated a11y on
  rendered output)** — Phase 20 (code-island), where they gate the jailed-eval safety change. This phase's
  a11y criterion is the schema-level required-prop check (D-08.4), not runtime axe.
- **Pairwise / TrueSkill ranking** (UI-Bench's full method, GENUI-VNEXT §5) — this phase ships the simpler
  absolute 0-1 + pass/fail rubric; pairwise ranking is a later refinement if absolute scores prove noisy.
- **Hard CI fail-threshold on the eval** — deferred (D-13): this phase records the baseline; Phase 17+ adopts
  "no regression vs baseline" as the bar.
- **Surfacing `genui_generation_events` in History** (cache-hit / fallback / token analytics over the audit
  table) — deferred (D-16): events store `intent_hash` only (no spec, no readable intent), so they cannot be
  re-rendered; live state already shown in the Sandbox chrome.
- **History write/edit/delete, re-run-from-history, promotion** — out of scope; History is read-only,
  best-effort. Promotion/flywheel is v1.2 FLY (later).
- **Tier-A token/theme layer, style packs, assembly RAG, catalog expansion, form engine, code-island** —
  Phases 17-20; this phase only builds the gate they are measured against.

### Reviewed Todos (not folded)
None reviewed for this phase.
</deferred>

---

*Phase: 16-studio-foundation-eval-harness-history-page-ideas-tabs*
*Context gathered: 2026-06-27*
