---
phase: 13-generation-layer-and-guardrails
verified: 2026-06-27T07:05:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification: false
---

# Phase 13: Generation Layer and Guardrails — Verification Report

**Phase Goal:** A tRPC procedure accepts an intent and returns a validated, safety-checked spec via Bedrock Haiku 4.5 — with dual-LLM quarantine ensuring raw untrusted content never reaches the generator, three allowlists enforcing the component/procedure/action surface, a bounded repair loop on invalid output, and cost controls active from the first call.
**Verified:** 2026-06-27T07:05:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Intent → Bedrock Haiku 4.5 forced-tool-use (emit_ui_spec); invalid output → repair loop max 3 feeding error back; persistent failure → SAFE_FALLBACK_SPEC, never raw model output | VERIFIED | `genui_generator_adapter.py` lines 254–319: `_repair_loop` with `for attempt in range(3)`, error fed back via messages append, `return SAFE_FALLBACK_SPEC` on exhaustion. Tool choice: `{"type": "tool", "name": "emit_ui_spec"}` forced. 19 use-case + endpoint tests pass. |
| SC2 | Untrusted content passes a separate quarantine call with enum-constrained extraction before any data reaches the generator; generator never sees raw prose | VERIFIED | `genui_quarantine_adapter.py`: Call A places raw content ONLY in user turn inside `<document_content>` delimiters (line 191–194). System prompt is static, trusted-only. `generate_ui_spec.py` passes only `QuarantineExtraction` (entity_type, intent_summary, confidence) to Call B — no raw prose crosses the boundary (lines 105–121). 10 quarantine + 15 generator adapter tests all pass offline. |
| SC3 | A spec referencing an unregistered component type / non-allowlisted tRPC procedure / non-relative action href fails validation and is rejected before the renderer | VERIFIED | Three allowlists at Zod schema level: (1) `spec-schema.ts` discriminated union on component types; (2) `data-binding-schema.ts` uses `AllowedProcedureSchema` (z.enum of 9 procedures, no wildcards); (3) `action-schema.ts` navigate branch requires href starting with "/" + refine rejecting `//` and schemes; mutate branch uses `z.never()`. `generate.ts` runs `SpecRootSchema.safeParse()` at web boundary → SAFE_FALLBACK_SPEC on failure. 40 schema allowlist tests pass. |
| SC4 | Every Bedrock call carries max_tokens + a timeout; every generation event is audit-logged (intent hashed, model, tokens, outcome); spec depth/node count bounded by schema | VERIFIED | Quarantine adapter: `max_tokens=1024`, `asyncio.timeout(15.0)` (line 199). Generator adapter: `max_tokens=3000`, `asyncio.timeout(15.0)` on every attempt (line 263). `MAX_SPEC_NODES=200`, `MAX_SPEC_DEPTH=8` enforced in `_validate_spec()`. Audit: `GenerationAuditRepository.record(GenerationEvent)` called in `generate_ui_spec.py` with SHA-256 intent hash, model_id, token counts, outcome; best-effort (swallow on failure). Migration 0021 creates `genui_generation_events` table with 14 columns + CHECK constraint. |
| SC5 | System prompt cached via cache_control/cachePoint; binding/action layer has both query and mutation paths defined (queries wired, mutation defined-but-empty seam) | VERIFIED | `genui_generator_adapter.py` `_build_system_blocks()` line 110: `"cache_control": {"type": "ephemeral"}` on system prompt block (D-21). `ALLOWED_MUTATIONS = [] as const` in `action-schema.ts` line 40; `AllowedMutationSchema = z.never()` line 57 (SEAM-02). `buildActionRegistry()` in `action-handlers.ts` registers navigate/setState/query-refresh handlers; mutate key intentionally absent. `generate.ts` is a `.query()` procedure; no mutation path in tRPC genui router (queries-only wired per v1.1 scope). |

**Score:** 5/5 truths verified

### Notable Deviation: GEN-04 Non-Streaming

REQUIREMENTS.md lists GEN-04 ("Generation streams partial specs for progressive preview") as unchecked. Phase 13 intentionally delivers non-streaming per CONTEXT.md documented judgment call (D-Discretion). The ROADMAP SC4 — which is the binding contract — does not mention streaming; it specifies max_tokens, timeout, audit log, and bounds. All four are satisfied. GEN-04 streaming is tracked as a deferred requirement and surfaces in Phase 15's studio goal. This is not a gap for Phase 13 ROADMAP verification.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/genui/src/schema/action-schema.ts` | ActionSchema + ALLOWED_MUTATIONS=[] + z.never() | VERIFIED | 155 lines, full discriminated union, SEAM-02 seam wired |
| `packages/genui/src/schema/data-binding-schema.ts` | DataBindingSchema + UUID rejection | VERIFIED | AllowedProcedureSchema imported, UUID_PATTERN refine present |
| `packages/genui/src/schema/safe-fallback-spec.ts` | SpecRoot constant, single alert node, no bindings | VERIFIED | Object.freeze, type:"alert", no data/state/bindings |
| `packages/genui/src/generation/allowed-procedures.ts` | ALLOWED_PROCEDURES enum, 9 query-only procedures | VERIFIED | z.enum([…9 procedures…]) export |
| `packages/genui/artifacts/spec.schema.json` | Bedrock-compatible JSON Schema, additionalProperties:false, no external $ref | VERIFIED | Inline definitions, procedure enum present, additionalProperties:false on nested objects |
| `packages/genui/artifacts/genui-prompt.json` | Compact catalog for Python system prompt | VERIFIED | File exists |
| `apps/email-listener/app/infrastructure/llm/genui_quarantine_adapter.py` | Call A: enum-constrained extraction, raw content in user-turn only | VERIFIED | 239 lines, forced tool_choice, asyncio.timeout, clamped entity_type |
| `apps/email-listener/app/infrastructure/llm/genui_generator_adapter.py` | Call B: emit_ui_spec forced tool-use, repair loop, cache_control, escalation | VERIFIED | 335 lines, _repair_loop max 3, Sonnet escalation attempt 2, cache_control ephemeral, SAFE_FALLBACK_SPEC constant |
| `apps/email-listener/app/application/use_cases/generate_ui_spec.py` | Orchestrates quarantine→generate→audit, SHA-256 intent hash | VERIFIED | 179 lines, hashlib.sha256, best-effort audit with try/except |
| `apps/email-listener/app/presentation/api/v1/genui.py` | POST /v1/genui/generate behind X-API-Key | VERIFIED | `dependencies=[Depends(require_api_key)]` on router |
| `packages/api-client/src/router/genui/generate.ts` | tRPC query proxy, SpecRootSchema.safeParse at web boundary | VERIFIED | safeParse on line 130, SAFE_FALLBACK_SPEC on failure, getListenerConfig() |
| `packages/genui/src/renderer/action-handlers.ts` | buildActionRegistry: navigate/setState/query-refresh wired, mutate absent | VERIFIED | 151 lines, isSafeRelativeHref D-15 re-check, mutate comment documents intentional absence |
| `packages/db/migrations/0021_genui_generation_events.sql` | 14-column audit table, outcome CHECK constraint | VERIFIED | 14 columns including intent_hash, model_id, tokens, outcome, spec_validation_passed; CHECK constraint on outcome |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `genui.py` (endpoint) | `generate_ui_spec.py` (use case) | `FromDishka[GenerateUiSpecUseCase]` | WIRED | Dishka DI injection, use_case.execute() called line 94 |
| `generate_ui_spec.py` | `genui_quarantine_adapter.py` | `self._quarantine.extract()` | WIRED | QuarantineExtraction returned, raw prose contained |
| `generate_ui_spec.py` | `genui_generator_adapter.py` | `self._generator.generate()` | WIRED | Only extraction (structured) passed, never raw_content |
| `generate_ui_spec.py` | `GenerationAuditRepository` | `self._audit.record()` | WIRED | Best-effort in try/except, GenerationEvent constructed with all D-19 fields |
| `generate.ts` (tRPC) | FastAPI `/v1/genui/generate` | `fetch()` with X-API-Key | WIRED | getListenerConfig() called at request time, X-API-Key header set |
| `generate.ts` | `SpecRootSchema.safeParse` | Direct call line 130 | WIRED | Failure returns SAFE_FALLBACK_SPEC, success returns parsed.data |
| `data-binding-schema.ts` | `allowed-procedures.ts` | `AllowedProcedureSchema` import | WIRED | z.enum enforces at parse time |
| `action-handlers.ts` | `isSafeRelativeHref` | D-15 runtime re-check | WIRED | Called in navigate handler before router.push |

### Data-Flow Trace (Level 4)

Not applicable — this phase delivers a backend pipeline (Python service + tRPC proxy), not a data-rendering component. The "data" is the spec dict that flows from Bedrock → Python validation → FastAPI response → tRPC safeParse → caller. This flow is fully traced in the Key Link section above and verified through 5 test files.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 19 use case + endpoint Python tests pass | `uv run pytest tests/application/test_generate_ui_spec.py tests/presentation/test_genui_endpoint.py -v` | 19 passed, 0 failed | PASS |
| 40 quarantine + generator + audit Python tests pass | `uv run pytest tests/ -k "quarantine or generator or audit" -v` | 40 passed, 560 deselected | PASS |
| 153 genui TypeScript tests pass | `npm run test -w @nauta/genui` | 153 passed, 6 test files | PASS |
| 109 api-client TypeScript tests pass | `npm run test -w @nauta/api-client` | 109 passed, 12 test files | PASS |

### Probe Execution

No probe scripts discovered (no `scripts/*/tests/probe-*.sh` for this phase). Behavioral spot-checks above provide equivalent runtime verification.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| GEN-01 | 13-03-PLAN | Bedrock Haiku 4.5 forced tool-use for spec generation | SATISFIED | `genui_generator_adapter.py`: tool_choice forced to `emit_ui_spec`, model_id from settings (Haiku 4.5) |
| GEN-02 | 13-03-PLAN | Bounded repair loop (≤3) feeding validation error back | SATISFIED | `_repair_loop` in adapter, 3-attempt loop with error message appended to messages |
| GEN-03 | 13-01-PLAN, 13-04-PLAN | Safe fallback spec on persistent failure | SATISFIED | SAFE_FALLBACK_SPEC returned after 3 failures; Zod re-validation at web boundary → SAFE_FALLBACK |
| GEN-04 | 13-04-PLAN | Progressive streaming (delivered as non-streaming per documented judgment call) | PARTIAL | Non-streaming intentional per CONTEXT D-Discretion; ROADMAP SC4 does not require streaming; deferred to Phase 15 studio |
| GEN-05 | 13-02-PLAN | Audit log with intent, model, tokens, outcome | SATISFIED | `genui_generation_events` table + GenerationAuditRepository + best-effort record() call |
| GEN-06 | 13-03-PLAN | Sonnet 4.6 escalation on final repair attempt | SATISFIED | `attempt == 2` → `self._escalation_model_id` in `_repair_loop` |
| SAFE-01 | 13-03-PLAN | Quarantine model: raw prose never reaches generator | SATISFIED | Separate Call A adapter; only QuarantineExtraction crosses to Call B |
| SAFE-02 | 13-01-PLAN | Component allowlist at Zod schema level | SATISFIED | SpecRootSchema discriminated union on component type strings |
| SAFE-03 | 13-01-PLAN | Data binding procedure allowlist | SATISFIED | `AllowedProcedureSchema` (z.enum, 9 procedures); UUID rejection refine |
| SAFE-04 | 13-01-PLAN | Action allowlist: relative-href navigate, z.never() mutate | SATISFIED | NavigateActionSchema: startsWith("/") + noAbsoluteScheme refine |
| SAFE-05 | 13-03-PLAN | Explicit max_tokens + timeout on every Bedrock call | SATISFIED | Both adapters: max_tokens param + `asyncio.timeout()` context manager |
| SAFE-06 | 13-01-PLAN | Spec tree depth + node count bounded | SATISFIED | `MAX_SPEC_NODES=200`, `MAX_SPEC_DEPTH=8` in `_validate_spec()` + schema-level bounds |
| COST-01 | 13-01-PLAN, 13-03-PLAN | System prompt cached via Bedrock cache_control | SATISFIED | `_build_system_blocks()` returns `[{"type":"text","text":…,"cache_control":{"type":"ephemeral"}}]` |
| SEAM-02 | 13-01-PLAN, 13-04-PLAN | Mutation seam defined-but-empty | SATISFIED | `ALLOWED_MUTATIONS=[] as const`, `z.never()`, mutate absent from ActionRegistry |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `genui_generator_adapter.py` | 155 | Pre-existing mypy: `Returning Any from function declared to return "str \| None"` | INFO | Deferred to next phase per SUMMARY; does not affect runtime behavior (return paths are correct) |
| `genui_generator_adapter.py` | 284 | Pre-existing mypy: `Incompatible types in assignment` | INFO | Deferred to next phase per SUMMARY; does not affect runtime behavior |

No `TBD`, `FIXME`, or `XXX` debt markers found in phase-modified files. No unresolved placeholder implementations. `console.error()` in `generate.ts` is server-side error logging (acceptable per CLAUDE.md guidelines — user sees only friendly message).

### Human Verification Required

None. This phase is entirely backend (Python service + tRPC proxy). All acceptance criteria are machine-verifiable and verified above. No visual, real-time, or external service behavior requires human observation.

---

## Gaps Summary

No gaps found. All 5 ROADMAP success criteria are materially true in the shipped code. All 14 requirement IDs are accounted for (GEN-04 non-streaming is an intentional, documented deviation per CONTEXT D-Discretion; ROADMAP SC4 does not include streaming). All test suites pass (19 Python use-case/endpoint, 40 Python adapter/audit, 153 genui TypeScript, 109 api-client TypeScript). Migration 0021 is locally applied; staging/prod deploy is a deployment-time concern outside the code-verification boundary.

---

_Verified: 2026-06-27T07:05:00Z_
_Verifier: Claude (gsd-verifier)_
