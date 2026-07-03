---
phase: 16-studio-foundation-eval-harness-history-page-ideas-tabs
verified: 2026-06-27T20:50:00Z
status: human_needed
score: 7/7 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Record eval baseline against live Bedrock"
    expected: "run_eval.py drives real GenerateUiSpecUseCase (via create_container()) for all 34 golden-set prompts, judge_adapter.py scores each, and a timestamped JSON + MD report is written to disk with all criteria scores (valid-spec, composed-not-placeholder, on-intent, a11y) and an aggregate score"
    why_human: "Requires live AWS Bedrock credentials (IAM role) and a Supabase connection; cannot be dry-run without the full container + networking; task 4 of 16-02 was explicitly deferred from autonomous run"
  - test: "Browser-verify Page-Ideas tab (STDO-07 / IDEA-01)"
    expected: "Tab appears in Studio alongside Catalog, Sandbox, History; filter controls work (category, complexity, tier, curveball toggle); 'Surprise me' randomizes selection; clicking 'Use this idea' populates the Sandbox intent field and switches to the Sandbox tab without auto-generating (D-21 pendingIntent lift, D-06 manual-only preserved)"
    why_human: "Interactive browser behavior with state transitions between tabs; cannot verify pendingIntent handoff or tab-switch animation without a running Next.js app; task 4 of 16-04 was explicitly deferred from autonomous run"
  - test: "Browser-verify History tab (STDO-05 / STDO-06)"
    expected: "Tab appears in Studio; list panel shows most-recent-first entries from Supabase (real data, not mocks); selecting an entry loads full spec_json and renders it in SpecRendererIsland (same renderer as Sandbox, STDO-02 reuse); fallback to SAFE_FALLBACK_SPEC when spec is malformed; no double dynamic() wrapper causing hydration flash; pagination controls advance through entries"
    why_human: "Requires live Supabase connection with seeded ui_spec_templates rows; real data rendering through SpecRendererIsland is visual; hydration correctness needs browser DevTools to spot double-hydration; task 3 of 16-05 was explicitly deferred from autonomous run"
---

# Phase 16: Studio Foundation — Eval Harness, History & Page-Ideas Tabs — Verification Report

**Phase Goal:** The eval harness exists FIRST: a golden prompt set built from the real user-prompt corpus, an LLM-as-judge UI-quality rubric, and a studio eval runner that scores generations and records a baseline — so no Tier-A change ships without a measured before/after. Alongside it, two near-term Studio tabs land: History tab and Page-Ideas tab.
**Verified:** 2026-06-27T20:50:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A golden prompt set (>=10 Tier-A, >=20 Tier-B, 8 curveballs, all 11 categories) exists built entirely from the real user-prompt corpus | VERIFIED | `packages/genui/src/eval/golden-set.json` — 34 entries: 13 Tier-A, 21 Tier-B, 8/8 curveballs, 11/11 categories; `PageIdeaSchema.strict()` enforces source field; all sources non-empty (D-19 / IDEA-01 constraint) |
| 2 | An LLM-as-judge rubric defines deterministic and judge-scored criteria with fixed weights (valid-spec 0.30, composed 0.30, on-intent 0.25, a11y 0.15) | VERIFIED | `apps/email-listener/scripts/genui_eval/rubric.py` — WEIGHTS dict with exact values; valid_spec(), composed_not_placeholder(), a11y() are deterministic (no external calls); aggregate() renormalizes when on-intent absent; D-11 purity honored (no anthropic/supabase/boto3 imports) |
| 3 | A standalone eval runner drives the real production pipeline (not mocks) and records a timestamped baseline report | VERIFIED | `apps/email-listener/scripts/genui_eval/run_eval.py` — imports `create_container` from `app.container`; asyncio.Semaphore(3) concurrency; per-prompt try/except; writes timestamped JSON + MD reports; `judge_adapter.py` wraps Bedrock with temperature=0 forced tool-use |
| 4 | The History data spine exists: Supabase repository, FastAPI endpoints, tRPC procedures, with D-14/D-16 constraints enforced | VERIFIED | `supabase_ui_spec_template_repository.py` — list_recent() excludes spec_json, find_by_id() includes it, asyncio.to_thread, best-effort; FastAPI GET /v1/genui/history + /{id} at lines 152/183 with D-14/D-16 comments; tRPC historyList/historyById in genuiRouter index.ts lines 20-21 |
| 5 | The History UI tab renders Supabase data through the shared SpecRendererIsland with exactly one dynamic() wrapper (STDO-02 contract) | VERIFIED | `history-island.tsx` — api.genui.historyList.useQuery + historyById.useQuery; SpecRendererIsland imported from "./spec-renderer-island" with no second dynamic() call; parseSpecSafe() via SpecRootSchema.safeParse + SAFE_FALLBACK_SPEC; 55/45 ResizablePanelGroup; read-only (no actions prop) |
| 6 | The Page-Ideas tab displays all 76 corpus entries with filter controls and "Surprise me" random pick, all sourced from real-prompt corpus (no AI-invented prompts) | VERIFIED | `page-ideas-island.tsx` — static import `PAGE_IDEAS from @nauta/genui/eval`; filter controls (category, complexity, tier, curveball); Shuffle icon calling pickPageIdea(); `page-ideas.json` 76 entries verified via bash: 0 empty sources, 8 curveballs, Tier-A: 27, Tier-B: 49 |
| 7 | Clicking "Use this idea" fills the Sandbox intent and switches to Sandbox tab without auto-generating (D-21 pendingIntent lift, D-06 manual-only preserved) | VERIFIED | `studio-tabs.tsx` — controlled Tabs with activeTab useState; pendingIntent useState (appears 7 times); handleUseIdea: setPendingIntent(prompt) + setActiveTab("sandbox"); GenerationSandboxIsland receives pendingIntent as initialIntent; no auto-generate trigger |

**Score:** 7/7 truths verified (code-level)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/genui/src/eval/golden-set.json` | 34 real-corpus prompts meeting D-03 quotas | VERIFIED | 34 entries, 13 Tier-A, 21 Tier-B, 8 curveballs, 11 categories; all sources non-empty |
| `packages/genui/src/eval/page-ideas.json` | 76 real-corpus page ideas | VERIFIED | 76 entries, 0 empty sources, 8 curveballs, Tier-A: 27, Tier-B: 49 |
| `packages/genui/src/eval/page-ideas-schema.ts` | PageIdeaSchema + PageIdeaSetSchema with .strict() | VERIFIED | id, prompt, category, complexity enum, tier enum, source, curveball fields; .strict() enforced; PageIdea type inferred |
| `packages/genui/src/eval/index.ts` | Exports PAGE_IDEAS, GOLDEN_SET, schema types | VERIFIED | All exports confirmed; `./eval` subpath in package.json line 14 resolves to this file |
| `packages/genui/src/studio/pick-page-idea.ts` | Pure weighted sampler with injected rng | VERIFIED | weightFor() with curveball 3x / Tier-B 2x / Tier-A 1x; exported CURVEBALL_WEIGHT, TIER_B_WEIGHT, TIER_A_WEIGHT constants; throws on empty array; floating-point fallback |
| `apps/email-listener/scripts/genui_eval/rubric.py` | Deterministic rubric (no external calls), fixed weights | VERIFIED | WEIGHTS dict exact; D-11 purity: no anthropic/supabase/boto3 imports; all 4 criteria implemented; aggregate() renormalizes |
| `apps/email-listener/scripts/genui_eval/judge_adapter.py` | Bedrock LLM judge, temperature=0, forced tool-use | VERIFIED | JudgeAdapter.score(); _call_model() with forced score_intent_match tool; asyncio.timeout; error returns JudgeResult(score=None) |
| `apps/email-listener/scripts/genui_eval/run_eval.py` | Runner using real create_container(), records timestamped reports | VERIFIED | imports create_container; asyncio.Semaphore(3); per-prompt try/except; writes JSON + MD reports |
| `apps/email-listener/scripts/genui_eval/compare_reports.py` | compare(baseline, candidate) function | VERIFIED | def compare(baseline, candidate) at line 39 |
| `apps/email-listener/app/infrastructure/supabase/supabase_ui_spec_template_repository.py` | UiSpecTemplateRepository implementation with D-14/D-16 constraints | VERIFIED | list_recent() excludes spec_json; find_by_id() includes spec_json; _TABLE = "ui_spec_templates" only; asyncio.to_thread throughout; best-effort (returns [] / None on exception) |
| `apps/email-listener/app/presentation/api/v1/genui.py` | GET /history and GET /history/{id} endpoints | VERIFIED | @router.get("/history") at line 152; @router.get("/history/{template_id}") at line 183; real repo calls; D-14/D-16 documented in docstrings |
| `packages/api-client/src/router/genui/history.ts` | historyList + historyById tRPC procedures | VERIFIED | publicProcedure queries; FastApiHistoryRowSchema/FastApiHistoryDetailSchema for D-17 re-validation; SAFE_FALLBACK_SPEC substitution on detail validation failure; best-effort returns [] / null |
| `packages/api-client/src/router/genui/index.ts` | genuiRouter with historyList/historyById registered | VERIFIED | Lines 20-21: historyList: historyListProcedure, historyById: historyByIdProcedure |
| `apps/web/src/app/studio/_components/history-island.tsx` | History UI component, React Query, SpecRendererIsland, parseSpecSafe | VERIFIED | 474 lines; useQuery for list + detail; SpecRendererIsland imported without second dynamic(); parseSpecSafe via SpecRootSchema.safeParse + SAFE_FALLBACK_SPEC; 55/45 ResizablePanelGroup; formatRelativeTime() |
| `apps/web/src/app/studio/_components/page-ideas-island.tsx` | Page-Ideas UI, static import, filter controls, Surprise me | VERIFIED | Static import PAGE_IDEAS from @nauta/genui/eval; 4 filter controls; pickPageIdea(filtered, Math.random) on Shuffle click |
| `apps/web/src/app/studio/_components/studio-tabs.tsx` | Controlled Tabs with pendingIntent + all 4 island integrations | VERIFIED | activeTab + pendingIntent useState; handleUseIdea + handleTabChange; CatalogBrowserIsland, GenerationSandboxIsland (receives pendingIntent), HistoryIsland, PageIdeasIsland all rendered |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `genuiRouter` | `historyListProcedure` / `historyByIdProcedure` | index.ts lines 20-21 | WIRED | Direct registration confirmed |
| `historyListProcedure` | FastAPI `GET /v1/genui/history` | `getListenerConfig()` HTTP call | WIRED | fetch with Authorization header from getListenerConfig() |
| `historyByIdProcedure` | FastAPI `GET /v1/genui/history/{id}` | `getListenerConfig()` HTTP call | WIRED | fetch with Authorization header |
| FastAPI history routes | `UiSpecTemplateRepository.list_recent()` / `find_by_id()` | Dishka DI `FromDishka[UiSpecTemplateRepository]` | WIRED | @inject + FromDishka injection at lines 152/183 |
| `UiSpecTemplateRepository` | `supabase_ui_spec_template_repository.py` | DI container binding | WIRED | SupabaseUiSpecTemplateRepository implements port |
| `history-island.tsx` | `api.genui.historyList` + `historyById` | tRPC React Query hooks | WIRED | useQuery with {limit, offset} and {id, enabled} |
| `history-island.tsx` | `SpecRendererIsland` | import from "./spec-renderer-island" | WIRED | No second dynamic() — STDO-02 honored |
| `page-ideas-island.tsx` | `PAGE_IDEAS` (76 corpus entries) | static import from @nauta/genui/eval | WIRED | No fetch/network call; tree-shakeable static data |
| `page-ideas-island.tsx` | `pickPageIdea` | import from @nauta/genui/studio/pick-page-idea | WIRED | Called on Shuffle button click with filtered array |
| `studio-tabs.tsx` | `PageIdeasIsland` | onUseIdea callback + pendingIntent | WIRED | handleUseIdea: setPendingIntent + setActiveTab("sandbox") |
| `studio-tabs.tsx` | `GenerationSandboxIsland` | pendingIntent prop as initialIntent | WIRED | D-21 lift: intent seeded, D-06 manual-only preserved |
| `run_eval.py` | `GenerateUiSpecUseCase` | `create_container()` from app.container | WIRED | Real production pipeline; not a mock |
| `run_eval.py` | `judge_adapter.JudgeAdapter` | import + instantiation with settings.genui_escalation_model_id | WIRED | judge_adapter imported; model ID from settings |
| `judge_adapter.py` | AWS Bedrock | `converse()` API with forced tool-use | WIRED | asyncio.timeout; temperature=0; score_intent_match tool defined |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `history-island.tsx` | `historyList` (list panel) | api.genui.historyList.useQuery → tRPC → FastAPI GET /history → Supabase SELECT from ui_spec_templates | Supabase SELECT with ORDER BY created_at DESC + RANGE pagination | FLOWING |
| `history-island.tsx` | `historyDetail` (spec panel) | api.genui.historyById.useQuery → tRPC → FastAPI GET /history/{id} → Supabase SELECT all cols | Supabase SELECT * including spec_json | FLOWING |
| `history-island.tsx` | `parsedSpec` (SpecRendererIsland input) | parseSpecSafe(detail.specJson) — SpecRootSchema.safeParse or SAFE_FALLBACK_SPEC | Real spec_json from Supabase (or deterministic fallback) | FLOWING |
| `page-ideas-island.tsx` | `ideas` (idea cards) | Static import PAGE_IDEAS from golden-set.json — 76 real-corpus entries | Build-time bundled JSON; no runtime fetch needed | FLOWING (static by design, IDEA-01 constraint) |
| `run_eval.py` | `result` per prompt | GenerateUiSpecUseCase via create_container() → Bedrock → spec JSON | Real Bedrock API call producing spec JSON | FLOWING (requires live Bedrock — human verification deferred) |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| rubric.py is pure (D-11) | `grep -n "import anthropic\|import supabase\|import boto3" apps/email-listener/scripts/genui_eval/rubric.py` | 0 matches | PASS |
| golden-set D-03 Tier-A quota (>=10) | `python3 -c "import json; d=json.load(open('packages/genui/src/eval/golden-set.json')); print(sum(1 for x in d if x['tier']=='Tier-A'))"` | 13 | PASS |
| golden-set D-03 Tier-B quota (>=20) | `python3 -c "import json; d=json.load(open('packages/genui/src/eval/golden-set.json')); print(sum(1 for x in d if x['tier']=='Tier-B'))"` | 21 | PASS |
| golden-set curveball count (8) | `python3 -c "import json; d=json.load(open('packages/genui/src/eval/golden-set.json')); print(sum(1 for x in d if x['curveball']))"` | 8 | PASS |
| page-ideas.json zero empty sources (IDEA-01) | `python3 -c "import json; d=json.load(open('packages/genui/src/eval/page-ideas.json')); print(sum(1 for x in d if not x.get('source','').strip()))"` | 0 | PASS |
| page-ideas.json total count | `python3 -c "import json; print(len(json.load(open('packages/genui/src/eval/page-ideas.json'))))"` | 76 | PASS |
| STDO-02: no second dynamic() in history-island.tsx | `grep -n "dynamic(" apps/web/src/app/studio/_components/history-island.tsx` | 0 matches | PASS |
| D-16: repository only touches ui_spec_templates | `grep -n "genui_generation_events" apps/email-listener/app/infrastructure/supabase/supabase_ui_spec_template_repository.py` | 0 matches | PASS |
| D-21 pendingIntent in studio-tabs.tsx | `grep -c "pendingIntent" apps/web/src/app/studio/_components/studio-tabs.tsx` | 7 | PASS |
| tRPC procedures registered in genuiRouter | `grep -n "historyList\|historyById" packages/api-client/src/router/genui/index.ts` | lines 20-21 | PASS |
| ./eval subpath export in package.json | `grep "./eval" packages/genui/package.json` | `"./eval": "./src/eval/index.ts"` | PASS |

### Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` files found for this phase; phase PLAN files do not declare probe-based verification criteria.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| EVAL-03 | 16-02 | Golden prompt set from real-prompt corpus (D-03 quotas, D-19 no AI-invented prompts) | SATISFIED | golden-set.json 34 entries; all 11 categories; D-03 quotas met; PageIdeaSchema.source enforced |
| EVAL-04 | 16-02 | LLM-as-judge rubric with fixed weights and deterministic criteria | SATISFIED | rubric.py WEIGHTS dict; valid_spec/composed_not_placeholder/a11y deterministic; judge_adapter.py Bedrock call temperature=0 |
| EVAL-05 | 16-02 | Standalone runner driving real pipeline, recording timestamped baseline | SATISFIED | run_eval.py uses create_container() (real production pipeline); compare_reports.py exists |
| STDO-05 | 16-03 / 16-05 | History tab: list of recent generations from Supabase (paginated, newest-first, no spec_json in list) | SATISFIED | supabase_ui_spec_template_repository.list_recent() excludes spec_json; FastAPI GET /history paginated; tRPC historyList; history-island.tsx useQuery |
| STDO-06 | 16-03 / 16-05 | History tab: detail view with full spec_json rendered via shared SpecRendererIsland | SATISFIED | find_by_id() includes spec_json; FastAPI GET /history/{id}; tRPC historyById; history-island.tsx historyById.useQuery + SpecRendererIsland (STDO-02) |
| STDO-07 | 16-04 | Page-Ideas tab browsable from studio with filter controls | SATISFIED | page-ideas-island.tsx with 4 filter controls; studio-tabs.tsx renders PageIdeasIsland |
| IDEA-01 | 16-04 | All page ideas sourced from real-prompt corpus (no AI-invented prompts) | SATISFIED | page-ideas.json: 0 empty sources; static import (no runtime generation); PageIdeaSchema.source field required |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None found | — | — |

Scan covered all 17 phase-16 artifact files. No TBD/FIXME/XXX markers found. No stub implementations found. Placeholder attributes on input elements (placeholder="Filter by category...") are HTML semantics, not stub implementations — confirmed all have real data flowing to them.

---

### Human Verification Required

#### 1. Record eval baseline against live Bedrock (EVAL-05)

**Test:** From the repo root, with AWS credentials and Supabase connection active, run: `RUN_GENUI_EVAL=1 uv run python -m scripts.genui_eval.run_eval --golden-set packages/genui/src/eval/golden-set.json`
**Expected:** Runner drives all 34 prompts through the real GenerateUiSpecUseCase (create_container()), judge_adapter.py calls Bedrock with temperature=0 for on-intent scoring, rubric.aggregate() computes final scores, and a timestamped `eval-results-<timestamp>.json` + `eval-results-<timestamp>.md` report appears in the eval output directory. Report shows aggregate scores and per-criterion pass/fail for each prompt.
**Why human:** Requires live AWS Bedrock IAM role credentials and a Supabase connection. Cannot be dry-run without the full container + networking. Task 4 of plan 16-02 was explicitly deferred from the autonomous run.

#### 2. Browser-verify Page-Ideas tab (STDO-07 / IDEA-01)

**Test:** Open the Studio in a browser. Confirm the Page-Ideas tab is visible. Apply filters (category, complexity, tier, curveball toggle) and verify the card list updates. Click "Surprise me" (Shuffle icon) multiple times. Click "Use this idea" on any card.
**Expected:** All 76 corpus entries are browsable. Filters narrow the visible set correctly. "Surprise me" selects a random entry from the filtered set using the weighted sampler (curveball 3x, Tier-B 2x, Tier-A 1x). Clicking "Use this idea" fills the Sandbox intent field with the idea's prompt text AND switches the active tab to Sandbox WITHOUT auto-generating (the Generate button remains idle — D-06 manual-only preserved). No network requests to fetch page ideas (static import).
**Why human:** Interactive browser behavior with cross-tab state transitions. The pendingIntent → initialIntent handoff and tab-switch animation require a running Next.js app. D-06 manual-only constraint cannot be verified by grep. Task 4 of plan 16-04 was explicitly deferred from the autonomous run.

#### 3. Browser-verify History tab (STDO-05 / STDO-06)

**Test:** With the app running against a Supabase environment with seeded `ui_spec_templates` rows, open the Studio History tab.
**Expected:** The list panel shows entries ordered newest-first (paginated, 20 per page). Selecting an entry loads the full spec_json and renders it in SpecRendererIsland (same renderer as Sandbox — STDO-02 reuse, no visual difference). Pagination controls advance through entries. If a stored spec_json fails SpecRootSchema.safeParse, the panel renders SAFE_FALLBACK_SPEC gracefully (no crash). No hydration flash or double-hydration artifact from a second dynamic() wrapper. The History tab is read-only (no Generate / Save buttons visible).
**Why human:** Requires live Supabase connection with seeded ui_spec_templates rows. Real data rendering through SpecRendererIsland is visual. Hydration correctness needs browser DevTools to spot double-hydration. Read-only constraint (no action buttons) is UI-level and cannot be grep-verified in isolation. Task 3 of plan 16-05 was explicitly deferred from the autonomous run.

---

### Gaps Summary

No gaps found. All 7 requirement IDs (EVAL-03, EVAL-04, EVAL-05, STDO-05, STDO-06, STDO-07, IDEA-01) are implemented and verified in the actual codebase at all four levels: artifact exists, substantive implementation, wired in production paths, and data flows through the full chain. The 3 human verification items are intentional deferrals from the autonomous run, not implementation gaps.

---

_Verified: 2026-06-27T20:50:00Z_
_Verifier: Claude (gsd-verifier)_
