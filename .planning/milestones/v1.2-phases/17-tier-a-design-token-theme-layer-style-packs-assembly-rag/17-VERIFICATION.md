---
phase: 17-tier-a-design-token-theme-layer-style-packs-assembly-rag
verified: 2026-06-28T03:00:00Z
status: human_needed
score: 13/13 code-verifiable must-haves verified
overrides_applied: 0
human_verification:
  - test: "Open /studio, select two different style packs (e.g. nauta-teal and brutalist), generate the same intent twice, and compare the rendered output visually."
    expected: "The two renders differ visibly in color, typography, and/or radius — not just text content changes. The panel's pack-provenance badge should show the pack name used."
    why_human: "CSS variable cascade and visual rendering cannot be verified by grep. ThemedRoot wiring is confirmed but pixel-level differentiation requires a browser."
  - test: "In /studio, select Auto / Surprise from the pack dropdown and click Generate multiple times."
    expected: "The provenance badge shows different pack ids across generations (distribution is random across the 6 packs)."
    why_human: "Math.random() distribution is not verifiable statically. Modulo guard is confirmed in code but uniform spread requires runtime observation."
  - test: "Run the full --all-packs eval against a live Bedrock endpoint with the Phase-16 golden set as baseline."
    expected: "style-distinctiveness score is above 0.0 (packs produce measurably different outputs); overall score shows lift vs Phase-16 baseline; no a11y HARD contrast failures."
    why_human: "Requires AWS Bedrock credentials + the recorded Phase-16 baseline. The eval machinery (style_metrics.py, run_eval.py --all-packs, rubric.py a11y HARD gate) is shipped and offline-unit-tested, but the live connected-env run is a human+ops checkpoint."
---

# Phase 17: Tier-A Design Token / Theme Layer / Style Packs / Assembly RAG Verification Report

**Phase Goal:** Generation is grounded in an explicit, machine-readable design system + W3C-DTCG design tokens that vary per generation ('style packs'), plus retrieved exemplars injected before generation (v0's 'registry' method) — so output stops always reading as default shadcn and varies by brand/style. The win is MEASURED: a demonstrable lift on the Phase-16 golden-set baseline, with no a11y regression.

**Verified:** 2026-06-28T03:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | >=5 distinct DTCG style packs exist with nauta-teal as default baseline | VERIFIED | `packages/genui/src/theme/packs.ts`: 6 packs (nauta-teal, linear-clean, warm-editorial, brutalist, corporate-saas, playful-rounded); DEFAULT_PACK_ID="nauta-teal"; all values are HSL channel-triplets (no raw hex) |
| 2 | Fourth TOKEN allowlist enforces only known aliases at the Zod boundary (no raw hex, calc, var) | VERIFIED | `packages/genui/src/schema/token-props-schema.ts`: TokenPropsSchema = z.object({alias: z.string().optional()…}).strict(); TokenAliasSchema = z.enum(TOKEN_ALIASES); rejects raw hex because "#rrggbb" is not a member of the enum |
| 3 | style_pack_id field exists in the spec envelope (SpecRootSchema) | VERIFIED | `packages/genui/src/schema/spec-schema.ts` line 352: `style_pack_id: StylePackIdSchema.optional()` |
| 4 | style_pack_id is the 5th dimension of the cache key | VERIFIED | `apps/email-listener/app/application/use_cases/cache_key.py`: compute_cache_key() accepts `style_pack_id: str | None`; pack_descriptor sentinel "__no_pack__"; included in SHA-256 formula |
| 5 | RetrievalProvider domain port is defined as a @runtime_checkable Protocol | VERIFIED | `apps/email-listener/app/domain/ports/retrieval_provider.py`: Protocol class with RetrievedItem + RetrievalResult frozen dataclasses; async retrieve(*, intent, top_k, style_pack_id) signature |
| 6 | LexicalRetrievalProvider implements the port deterministically (no Bedrock) | VERIFIED | `apps/email-listener/app/infrastructure/llm/genui_retrieval_provider.py`: 3-arm scoring (catalog + exemplars + templates), Jaccard overlap, static Protocol assertion at module load: `_: RetrievalProvider = LexicalRetrievalProvider()` |
| 7 | >=5 hand-authored exemplars exist as real SpecRoot dicts (one per category) | VERIFIED | `apps/email-listener/app/infrastructure/llm/exemplars/__init__.py`: EXEMPLAR_ASSETS tuple of 5 complete SpecRoot dicts (dashboard-saas, profile-contact, pricing-tiers, feed-email-inbox, landing-product) |
| 8 | Retrieval (RAG) runs BEFORE generation; result injected into DYNAMIC user turn only (COST-01) | VERIFIED | `apps/email-listener/app/application/use_cases/generate_ui_spec.py` Step 1 (lines 169–189): `await self._retrieval_provider.retrieve(…)` runs before quarantine/generate; `apps/email-listener/app/infrastructure/llm/genui_generator_adapter.py`: pack token table + exemplars injected into `initial_user_content` only; `_build_system_blocks()` never touched |
| 9 | CR-01: style_pack_id is propagated on cache-hit (not dropped) | VERIFIED | `generate_ui_spec.py` line 164: cache-hit returns `GenerateUiSpecResult(spec=cached.spec_json, cache_hit=True, outcome="ok", style_pack_id=style_pack_id)` |
| 10 | Core-4 weights are unchanged (D-15: 0.30/0.30/0.25/0.15) | VERIFIED | `apps/email-listener/scripts/genui_eval/rubric.py`: WEIGHTS = {"valid-spec": 0.30, "composed": 0.30, "on-intent": 0.25, "a11y": 0.15} |
| 11 | Style-distinctiveness is ADDITIVE (separate from weighted aggregate, not folded in) | VERIFIED | `run_eval.py`: aggregate_all_packs() computes cross_pack_mean_distinctiveness separately from per-pack mean_overall; distinctiveness never enters rubric.aggregate() |
| 12 | A11y HARD contrast gate (D-09): any WCAG-AA failure returns score=0.0 immediately | VERIFIED | `rubric.py` lines 244–248: if pack_token_values provided, WCAG-AA pairs checked first; any failure returns CriterionResult(name="a11y", score=0.0, passed=False) before required-props check; IN-01 threshold 0.04045 confirmed in style_metrics.py |
| 13 | ThemedRoot CSS-var wrapper wired into spec-renderer (single alias→CSS-var boundary) | VERIFIED | `packages/genui/src/renderer/spec-renderer.tsx` line 22: `import { ThemedRoot } from "../theme/themed-wrapper"` line 168: `<ThemedRoot packId={spec.style_pack_id}>…</ThemedRoot>` wraps rendered content |

**Score:** 13/13 code-verifiable truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/genui/src/theme/packs.ts` | 6 DTCG style packs, HSL only | VERIFIED | 6 packs, all HSL channel-triplets, Object.freeze + `satisfies` |
| `packages/genui/src/theme/tokens.ts` | TOKEN_ALIASES tuple (21 entries), StylePackId union | VERIFIED | 21-entry const tuple, 6-member union |
| `packages/genui/src/theme/themed-wrapper.tsx` | ThemedRoot CSS-var boundary component | VERIFIED | Substantive; derives cssVarStyle from pack.resolvedVars only (no dangerouslySetInnerHTML) |
| `packages/genui/src/schema/token-props-schema.ts` | Allowlist 4: Zod TokenPropsSchema + TokenAliasSchema | VERIFIED | .strict() + z.enum(TOKEN_ALIASES); StylePackIdSchema exported |
| `packages/genui/src/schema/allowlists.ts` | Unified re-export of all 4 allowlists | VERIFIED | Exports TokenAliasSchema, TokenPropsSchema, StylePackIdSchema, TOKEN_ALIAS_VALUES |
| `packages/genui/src/schema/spec-schema.ts` | style_pack_id: StylePackIdSchema.optional() in SpecRootSchema | VERIFIED | Line 352 confirmed |
| `packages/genui/src/renderer/spec-renderer.tsx` | ThemedRoot wired around rendered content | VERIFIED | Import line 22 + usage line 168 confirmed |
| `apps/email-listener/app/application/use_cases/cache_key.py` | style_pack_id as 5th SHA-256 dimension | VERIFIED | compute_cache_key() signature + pack_descriptor + SHA-256 formula |
| `apps/email-listener/app/application/use_cases/generate_ui_spec.py` | RAG before generate; CR-01 cache-hit pack propagation | VERIFIED | Step 1 retrieval lines 169–189; cache-hit return line 164 |
| `apps/email-listener/app/domain/ports/retrieval_provider.py` | @runtime_checkable Protocol; RetrievedItem + RetrievalResult | VERIFIED | Infra-free; frozen dataclasses; async retrieve() signature |
| `apps/email-listener/app/infrastructure/llm/genui_retrieval_provider.py` | LexicalRetrievalProvider with 3-arm scoring | VERIFIED | Catalog + exemplar + template arms; static Protocol assertion |
| `apps/email-listener/app/infrastructure/llm/exemplars/__init__.py` | 5 hand-authored SpecRoot dicts (one per category) | VERIFIED | dashboard, profile, pricing, feed, landing — all complete specs |
| `apps/email-listener/app/infrastructure/llm/genui_exemplars.py` | load_exemplars() with lru_cache; WR-04 deepcopy | VERIFIED | lru_cache(maxsize=1); copy.deepcopy per exemplar; count assertion |
| `apps/email-listener/app/infrastructure/llm/genui_style_packs.py` | Python pack registry mirroring TS; is_known_pack_id() | VERIFIED | 6 IDs as immutable tuple; frozenset for O(1) lookup; stdlib-only |
| `apps/email-listener/app/infrastructure/llm/genui_spec_utils.py` | WR-02 public module: count_nodes, validate_spec | VERIFIED | Both functions exported; jsonschema Draft7Validator; MAX_SPEC_NODES/DEPTH |
| `apps/email-listener/app/infrastructure/llm/genui_generator_adapter.py` | COST-01: static block cached; dynamic user-turn for pack+RAG | VERIFIED | _build_system_blocks() never touched; _build_pack_token_section() + _build_exemplars_section() into initial_user_content |
| `apps/email-listener/scripts/genui_eval/style_metrics.py` | WCAG contrast (IN-01 threshold 0.04045); distinctiveness; retrieval overlap | VERIFIED | wcag_contrast_ratio(); passes_aa(); distinctiveness_score() Jaccard; assert_retrieval_influence() |
| `apps/email-listener/scripts/genui_eval/rubric.py` | WEIGHTS unchanged D-15; D-09 HARD a11y gate | VERIFIED | WEIGHTS dict confirmed; HARD contrast gate lines 244–248 |
| `apps/email-listener/scripts/genui_eval/run_eval.py` | WR-03: --style-pack/--all-packs mutually exclusive; aggregate_all_packs() | VERIFIED | mutually_exclusive_group confirmed; aggregate_all_packs() separate from rubric.aggregate |
| `apps/web/src/app/studio/_components/generation-sandbox-island.tsx` | Pack dropdown + Auto/Surprise + IN-04 modulo guard | VERIFIED | pickSurprisePack() line 105: `% STYLE_PACK_IDS.length`; all 6 packs + AUTO_SENTINEL in dropdown |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| spec-renderer.tsx | themed-wrapper.tsx | import + JSX wrap | WIRED | Line 22 import; line 168 `<ThemedRoot packId={spec.style_pack_id}>` |
| spec-schema.ts | token-props-schema.ts | import StylePackIdSchema | WIRED | Line 352 `style_pack_id: StylePackIdSchema.optional()` |
| generation-sandbox-island.tsx | generate.ts tRPC | `stylePackId: queryPackId` in useQuery params | WIRED | Line 188: `{ intent, stylePackId: queryPackId }` |
| generate_ui_spec.py | retrieval_provider.py | `self._retrieval_provider.retrieve(…)` | WIRED | Step 1 lines 169–189 before generation |
| genui_generator_adapter.py | genui_style_packs.py | pack token section builder | WIRED | `_build_pack_token_section()` uses style_pack_id |
| rubric.py | genui_spec_utils.py | `from app.infrastructure.llm.genui_spec_utils import count_nodes, validate_spec` | WIRED | WR-02 fix confirmed |
| rubric.py | style_metrics.py | `from scripts.genui_eval.style_metrics import passes_aa, resolve_node_contrast_pairs` | WIRED | D-09 a11y HARD gate |
| run_eval.py | style_metrics.py | `distinctiveness_score()` + `retrieval_overlap_ratio()` | WIRED | aggregate_all_packs() calls style_metrics functions |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| ThemedRoot | cssVarStyle (CSS vars dict) | pack.resolvedVars from getStylePack(packId) | Yes — derived from committed packs.ts token values | FLOWING |
| spec-renderer.tsx | spec.style_pack_id (prop) | Passed from parent; set by FastAPI → tRPC chain | Yes — wired through generate endpoint | FLOWING |
| generation-sandbox-island.tsx | queryPackId (state) | User selection from dropdown; pickSurprisePack() for AUTO | Yes — real user input, not hardcoded | FLOWING |
| generate_ui_spec.py | retrieved_items (RetrievalResult) | LexicalRetrievalProvider.retrieve() scoring all 3 arms | Yes — real scoring over catalog + 5 exemplars | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TS test files exist for packs + allowlist | `ls packages/genui/src/theme/__tests__/` | packs.test.ts, token-allowlist.test.ts found | PASS |
| Python test files exist for retrieval + exemplars + style metrics | find tests/ | test_genui_retrieval_provider.py, test_genui_exemplars.py, test_genui_eval_style.py, test_cache_key.py, test_generate_ui_spec.py all found | PASS |
| LexicalRetrievalProvider static Protocol assertion | `_: RetrievalProvider = LexicalRetrievalProvider()` at module bottom | Present line 333 | PASS |
| No TBD/FIXME/XXX in Phase-17 key files | grep across theme/, schema/, llm/, genui_eval/ | 0 matches | PASS |
| COST-01 — pack/RAG injection never in _build_system_blocks() | grep genui_generator_adapter.py | All pack/retrieval injection lines reference initial_user_content / DYNAMIC user turn comments only | PASS |

---

### Probe Execution

Step 7c: SKIPPED — no probe-*.sh files declared for Phase 17. Eval probes require live Bedrock credentials (documented as human_verification item #3).

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| STYLE-01 | 17-01-PLAN.md | Generator conditioned on machine-readable W3C-DTCG token set | SATISFIED | tokens.ts TOKEN_ALIASES + packs.ts; TokenPropsSchema Zod boundary; spec-renderer ThemedRoot |
| STYLE-02 | 17-01-PLAN.md | Library of distinct style packs; engine can select one; two generations of same intent visibly differ | CODE SATISFIED, VISUAL DEFERRED | 6 packs shipped + studio dropdown wired; visual differentiation requires human check |
| STYLE-03 | 17-01-PLAN.md | Token specificity enforced (aliases not prose) | SATISFIED | TokenAliasSchema z.enum rejects anything not in TOKEN_ALIASES; all pack values are HSL channel-triplets |
| STYLE-04 | 17-05-PLAN.md | Measurable lift on golden-set baseline; no a11y regression | CODE SATISFIED, MEASUREMENT DEFERRED | eval machinery shipped + offline tested; live Bedrock run deferred (human_verification item #3) |
| RAG-01 | 17-04-PLAN.md | Exemplars/components retrieved + injected before generation | SATISFIED | generate_ui_spec.py Step 1 retrieval before generate; injection into initial_user_content |
| RAG-02 | 17-04-PLAN.md | Emitted spec references retrieved structure (retrieval demonstrably influences generation) | SATISFIED CODE-SIDE | retrieval_overlap_ratio() + assert_retrieval_influence() implemented; retrieved_ids in GenerationEvent audit log |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| genui_generator_adapter.py | 104–105, 159 | "placeholder" string | Info | In system-prompt instruction text telling the model NOT to emit placeholders — not a code smell |

No TBD, FIXME, or XXX markers found in any Phase-17 modified file.

---

### Human Verification Required

#### 1. Visual Pack Differentiation in /studio

**Test:** Open /studio in a browser. Generate the same intent (e.g. "dashboard with KPI cards and a data table") twice — once with pack "nauta-teal" and once with pack "brutalist".

**Expected:** The two renders differ visibly in color (teal/muted vs high-contrast dark), border-radius (rounded vs sharp), and/or typography. The pack-provenance badge in the studio panel shows the correct pack name for each result.

**Why human:** CSS variable cascade and visual rendering cannot be verified programmatically. ThemedRoot wiring from spec-renderer.tsx is code-confirmed but pixel-level differentiation requires a browser render.

#### 2. Auto/Surprise Pack Distribution

**Test:** In /studio, select "Auto / Surprise" from the pack dropdown and click Generate 5–6 times (with varied intents).

**Expected:** The provenance badge shows at least 2 different pack ids across the runs, confirming pickSurprisePack() is not stuck on a single value.

**Why human:** Math.random() distribution cannot be verified statically. The modulo guard (IN-04 fix) is confirmed in code; actual runtime behavior needs observation.

#### 3. Connected-Env Live --all-packs Eval (STYLE-04 Measurement)

**Test:** From the apps/email-listener directory with valid AWS credentials and the Phase-16 baseline stored, run: `uv run python scripts/genui_eval/run_eval.py --golden-set scripts/genui_eval/golden_set.json --all-packs --compare-baseline <phase16-baseline.json>`

**Expected:** (a) No WCAG-AA contrast failures (a11y HARD gate passes for all packs). (b) cross_pack_mean_distinctiveness > 0.0 (packs are measurably distinct). (c) Overall score >= Phase-16 baseline (lift confirmed).

**Why human:** Requires live AWS Bedrock credentials, real LLM calls, and the recorded Phase-16 baseline file. The eval machinery is fully shipped and offline-unit-tested. This is a connected-environment ops checkpoint, not a code defect.

---

### Gaps Summary

No code-level gaps found. All 13 code-verifiable must-haves are VERIFIED. The two deferred checkpoints (visual pack differentiation, live eval lift measurement) require human/ops verification as documented above — their code foundations are complete and correct.

---

_Verified: 2026-06-28T03:00:00Z_
_Verifier: Claude (gsd-verifier)_
