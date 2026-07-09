---
phase: 38-quarantine-adversarial-eval
verified: 2026-07-09T03:45:00Z
status: passed
score: 12/12 must-haves verified
overrides_applied: 0
---

# Phase 38: Quarantine + Adversarial Eval Verification Report

**Phase Goal:** Every wired `ToolExecutor` returns tier-filtered typed envelopes as an interface
obligation, proven against a prompt-injection fixture suite and a live-model harness wired into
the real executors — and `search_knowledge` becomes safely exposed to users.
**Verified:** 2026-07-09T03:45:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + PLAN must_haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every registered `ToolExecutor`'s non-error output is validated against a structural envelope contract at ONE boundary point, before it can enter `provider_messages` or a persisted part (SC1, 38-01 truth 1) | VERIFIED | Read `tool_envelope_gate.py` in full: 4 checks in one recursive walk (JSON-parse+top-level-dict, forbidden field names `content_text`/`body_html`/`body_text`/`raw_storage_key`, tier/label field-omission, citation route-template match). Read `run_chat_turn.py` lines 1230-1242: `validate_tool_envelope(result.content)` called exactly once inside `_run_server_tool_round`, immediately after `executor.execute()` and strictly BEFORE the `cap_tool_output`/persisted-part-build lines. `grep -rn "\.execute(name="` across `app/` confirms this is the ONLY production call site of any `ToolExecutor.execute`, so the gate cannot be bypassed by another code path |
| 2 | A tool result that violates the contract is replaced with a generic, safe, visible `is_error` text — never passed through raw (38-01 truth 2) | VERIFIED | Same wiring: on `gate.ok is False`, `result = ToolExecutionResult(tool_use_id=tool_id, content=_TOOL_ENVELOPE_INVALID_TEXT, is_error=True)`, `_TOOL_ENVELOPE_INVALID_TEXT` is a fixed string, never the raw content. Re-ran `tests/application/test_run_chat_turn_envelope_gate.py` myself: 6 passed, including `test_poisoned_envelope_replaced_with_invalid_text_and_marked_error` and `test_poisoned_envelope_safe_replacement_fed_to_next_round_not_raw` (proves the poisoned "LEAKED" marker never reaches a persisted part or round-2 provider message) |
| 3 | A turn that can enter a server-tool round carries the hardening line; a turn that cannot does not (SC4, 38-01 truth 3) | VERIFIED | Read `_system_prompt_for` (lines 163-173) and its call site (line 567-568): `tool_round_eligible = model.capabilities.max_tool_rounds > 0 and bool(self._tool_executors)` — the EXACT same condition `_build_tool_offer` uses. Re-ran the same test file: `test_tool_round_eligible_turn_system_prompt_carries_hardening_line`, `test_openrouter_model_system_prompt_unmodified_no_hardening_line`, `test_tool_round_capable_model_with_empty_executors_system_prompt_unmodified` all pass — both eligibility conditions independently proven required |
| 4 | Contract tests exist and pass over all 3 real, container-registered executors (`lookup_entity`, `search_emails`, `search_knowledge`) | VERIFIED | Re-ran `uv run pytest tests/infrastructure/tools/test_tool_envelope_contract.py -q --no-cov`: 6 passed (5 parametrized happy-path/hostile cases + 1 container-enumeration test). Read the file: constructs real `LookupEntityExecutor`/`SearchEmailsExecutor`/`SearchKnowledgeExecutor` classes directly with hand-built fake collaborators (not `MagicMock`'d Supabase) |
| 5 | `injection-fixtures.json` grown to 20-30 fixtures across exactly 7 categories (38-02 artifact) | VERIFIED | Read the file directly: 26 entries. Counted by name prefix: `delimiter-breakout` (4), `role-confusion` (4), `encoded-override` (5), `nested-tool-call-request` (4), `citation-spoofing` (4), `markdown-link-exfiltration` (4), `knowledge-inferred-crafted-search` (1) = 26, 7 categories. `eval-dimensions-assets.test.ts` bound widened to 20-30; re-ran `npm run test -w @nauta/genui -- eval-dimensions-assets --run`: 12 passed |
| 6 | The full fixture set is scored against the REAL `SearchKnowledgeExecutor` and passes the deterministic no-leak check (SC2, 38-02 truth 1) | VERIFIED | Re-ran `uv run pytest tests/evals/test_injection_adversarial_suite.py --no-cov`: 51 passed (25 non-extracted-seeded no-leak proofs + 25 extracted-seeded legitimate-surfacing proofs + 1 crafted-query proof). Read the file: constructs the real `SearchKnowledgeExecutor` class with hand-built fake `knowledge`/`embedder` collaborators, never a re-implementation |
| 7 | One fixture proves the `extracted_only` tier filter holds when the malicious text arrives as the SEARCH QUERY, not just as retrieved content (38-02 truth 2) | VERIFIED | Read `test_crafted_adversarial_search_query_reaches_repo_unmodified_and_tier_filter_holds` in `test_injection_adversarial_suite.py`: asserts `knowledge.search_nodes.assert_awaited_once_with(query_text=<exact adversarial text>, ...)` reaches the repo layer completely unmodified while a co-seeded non-EXTRACTED row's canary still never leaks — the defense is structural (tier filter), not query sanitization, exactly as 38-CONTEXT.md required |
| 8 | `retrieval-golden-set.json` contains real, DB-resolvable ids, not only synthetic placeholders (38-02 truth 3) | VERIFIED (live DB) | File has 14 entries: 7 original synthetic (ids 1-7, `entity-`/`email-seed-`/`node-seed-` prefixes, byte-identical/untouched) + 7 new real-data entries (ids 8-14). Independently wrote and ran a one-off `pg.Client` query script (mirroring `verify-0030-live.ts`'s pattern) against the local dev DB's `POSTGRES_URL_NON_POOLING`: all 2 `entity_instances` ids, all 5 `emails` ids, and the 1 `knowledge_nodes` id (confirmed `tier='EXTRACTED'`) resolved to real rows — 8/8 found. Script deleted after use, zero trace left in git status |
| 9 | A live Bedrock Haiku-tier harness runs a representative fixture set against a real model and confirms no canary leaks into visible text (SC3) | VERIFIED (re-run live, not trusted from SUMMARY) | Read `test_live_injection_harness.py` in full: genuine `pytest.mark.integration()`, a real `BedrockChatAdapter(client=get_anthropic_client())` construction wired into a real `RunChatTurn`, `us.anthropic.claude-haiku-4-5-20251001-v1:0`, credential-chain skip guard + runtime try/except `pytest.skip` fallback (never a hard failure on unavailability) — not a stub. Independently RE-RAN it myself just now (not the prior SUMMARY claim): `uv run pytest tests/evals/test_live_injection_harness.py --no-cov` → **7 passed in 11.23s**, all 7 representative fixtures (one per category) genuinely hit live Bedrock and the canary never leaked into visible text |
| 10 | `SEARCH_KNOWLEDGE_TOOL_ENABLED=True` if and only if the deterministic adversarial suite passed in the same execution run (SC5, 38-02 truth 4) | VERIFIED | `grep` confirms `app/settings.py` line 156: `SEARCH_KNOWLEDGE_TOOL_ENABLED: bool = True`, with an updated comment documenting the gated flip. Independently re-ran the deterministic suite fresh in THIS verification session (`tests/evals/` sans live-harness: 51+5+5+8 = 69 passed, 0 failed) — the flag's current `True` value is consistent with a currently-green suite, not a stale/speculative flip |
| 11 | `TestSearchKnowledgeExposureGate` is internally consistent with the flag's current `True` default (enabled-by-default + can-still-disable via flag) | VERIFIED | Re-ran `uv run pytest tests/test_container.py -k SearchKnowledgeExposureGate --no-cov`: 3 passed (`enabled_by_default` — no env override, asserts search_knowledge present; `can_still_be_disabled_via_flag` — `SEARCH_KNOWLEDGE_TOOL_ENABLED=false` still structurally omits the key, proving the kill-switch remains real post-flip; `enabled_via_flag` — explicit `true` override). Read the class: no contradiction with the `True` default |
| 12 | No regressions, no scope violations, static checks clean | VERIFIED | mypy on the 3 touched core files: `Success: no issues found in 3 source files`. `uv run lint-imports`: `Contracts: 3 kept, 0 broken`. Full regression sweep `uv run pytest --no-cov --deselect tests/test_genui_retrieval_provider.py`: **1176 passed, 9 skipped, 0 failed**. Confirmed the deselected file's failure is a genuine pre-existing, unrelated Python-3.13 test-ordering issue (`asyncio.get_event_loop()`), zero diff since `14c696c` (`git diff 14c696c..HEAD -- .../test_genui_retrieval_provider.py` = 0 lines, last touched Phase 17). Scope: `git diff --stat b9f3e10~1..736d2d9` (the phase-38 commit range) touches only `apps/email-listener/**`, `packages/genui/src/eval/**`/`packages/genui/src/__tests__/**`, `.planning/**` — confirmed no other paths. No migrations added (`packages/db/migrations` tops out at `0030_confirm_action_widget_kind.sql`, a pre-existing Phase-40 migration). No `package.json`/`pyproject.toml` diffs in the phase-38 range |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/email-listener/app/domain/services/tool_envelope_gate.py` | `validate_tool_envelope` + `EnvelopeGateOutcome` | VERIFIED | 161 lines, pure, fail-closed, 4 checks, never raises past its boundary, `_ROUTE_TEMPLATES` locally re-declared (import-linter compliant) |
| `apps/email-listener/tests/infrastructure/tools/test_tool_envelope_contract.py` | contract tests over all 3 real executors | VERIFIED | 6 tests passing, constructs real executor classes |
| `apps/email-listener/app/application/use_cases/run_chat_turn.py` | gate wiring + hardening-line seam | VERIFIED | `_TOOL_ENVELOPE_INVALID_TEXT`, `_TOOL_RESULT_HARDENING_LINE`, `_system_prompt_for`, single gate call site all confirmed by direct read |
| `packages/genui/src/eval/injection-fixtures.json` | 20-30 fixtures, 7 categories | VERIFIED | 26 entries, 7 categories counted directly |
| `apps/email-listener/tests/evals/test_injection_adversarial_suite.py` | deterministic full-suite scoring vs. real executor | VERIFIED | 51 tests passing, real `SearchKnowledgeExecutor` |
| `apps/email-listener/tests/evals/test_live_injection_harness.py` | live Bedrock Haiku harness, attempted, non-blocking | VERIFIED | 328 lines, genuine `pytest.mark.integration`, real `BedrockChatAdapter`; re-run live: 7/7 passed |
| `packages/genui/src/eval/retrieval-golden-set.json` | 12-17 entries, real DB-resolvable ids | VERIFIED (live DB) | 14 entries (7 synthetic + 7 real); all 8 real UUIDs independently confirmed resolvable against local dev DB |
| `apps/email-listener/app/settings.py` | `SEARCH_KNOWLEDGE_TOOL_ENABLED: bool = True` | VERIFIED | Confirmed via grep, consistent with a freshly-green deterministic suite |
| `apps/email-listener/tests/test_container.py` | `TestSearchKnowledgeExposureGate` updated | VERIFIED | 3 tests, internally consistent with `True` default |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `run_chat_turn.py` (`_run_server_tool_round`) | `tool_envelope_gate.py` | `validate_tool_envelope(result.content)` called once, before `provider_messages`/persisted part | WIRED | Confirmed by direct source read, lines 1236-1242; confirmed to be the ONE `ToolExecutor.execute()` call site in `app/` via grep |
| `test_injection_adversarial_suite.py` | `tool_envelope_gate.py` | the deterministic suite exercises the same gate via `validate_tool_envelope`/envelope-shaped assertions on the real executor's output | WIRED | Confirmed by reading the suite; also indirectly exercised because `SearchKnowledgeExecutor`'s own output already conforms to the envelope shape the gate checks |
| `app/settings.py` | `app/container.py` | `SEARCH_KNOWLEDGE_TOOL_ENABLED` read by the container's conditional tool-executor wiring | WIRED | `TestSearchKnowledgeExposureGate`'s 3 tests directly exercise `create_container()` reading the live settings value and conditionally including/excluding `search_knowledge` |

### Behavioral Spot-Checks / Test Runs (independently re-executed)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Envelope-gate unit tests | `uv run pytest app/domain/services/__tests__/test_tool_envelope_gate.py --no-cov` | 15 passed | PASS |
| Wiring + hardening-line tests | `uv run pytest tests/application/test_run_chat_turn_envelope_gate.py --no-cov` | 6 passed | PASS |
| Plan-38-01 full sweep | `uv run pytest app/domain/services/__tests__/test_tool_envelope_gate.py tests/application/test_run_chat_turn_envelope_gate.py tests/application/test_run_chat_turn_tool_loop_e2e.py tests/application/test_run_chat_turn.py tests/application/test_run_chat_turn_real_tools_wiring.py tests/infrastructure/tools/ --no-cov` | 82 passed, 0 failed | PASS |
| Contract tests (3 real executors) | `uv run pytest tests/infrastructure/tools/test_tool_envelope_contract.py -q --no-cov` | 6 passed | PASS |
| Full `tests/evals/` sweep (incl. live harness) | `uv run pytest tests/evals/ --no-cov` | 76 passed (51 adversarial + 5 fixtures + 7 live-harness + 5 golden-set + 8 scorers) | PASS |
| Deterministic-only `tests/evals/` (excl. live harness, the flag-flip gate scope) | sum of individual files: 51+5+5+8 | 69 passed | PASS |
| Live Bedrock Haiku harness, re-run fresh | `uv run pytest tests/evals/test_live_injection_harness.py --no-cov` | 7 passed in 11.23s | PASS |
| TS-side widened bounds | `npm run test -w @nauta/genui -- eval-dimensions-assets --run` | 12 passed | PASS |
| Exposure-gate consistency | `uv run pytest tests/test_container.py -k SearchKnowledgeExposureGate -q --no-cov` | 3 passed | PASS |
| mypy (3 touched core files) | `uv run mypy app/domain/services/tool_envelope_gate.py app/application/use_cases/run_chat_turn.py app/settings.py` | Success: no issues found in 3 source files | PASS |
| import-linter | `uv run lint-imports` | Contracts: 3 kept, 0 broken | PASS |
| Full regression sweep | `uv run pytest --no-cov --deselect tests/test_genui_retrieval_provider.py` | 1176 passed, 9 skipped, 0 failed | PASS |
| Real DB resolvability of new golden-set ids | one-off `pg.Client` script (deleted after use) | 8/8 real UUIDs found (2 entities, 5 emails, 1 EXTRACTED knowledge node) | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| QUAR-01 | 38-01 | Structural envelope gate as a TESTED interface obligation, wired once, contract-tested over all 3 real executors | SATISFIED | Truths 1-4 above |
| QUAR-02 | 38-02 | Adversarial fixture suite (7 categories) + deterministic scoring + live-model harness + real-data golden-set + gated exposure flip | SATISFIED | Truths 5-11 above |

No orphaned requirements — `REQUIREMENTS.md` maps only QUAR-01/QUAR-02 to Phase 38, both claimed by 38-01/38-02 and both marked `[x]` complete.

### Anti-Patterns Found

None. Scanned all 16 phase-38-touched files (Python + TS + JSON) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented"/"coming soon" markers — zero matches.

### Scope Discipline Check

`git diff --stat b9f3e10~1..736d2d9` (the exact phase-38 commit range, `b9f3e10` through `736d2d9`) touches exactly 22 files, all within `apps/email-listener/**`, `packages/genui/src/eval/**`/`packages/genui/src/__tests__/**`, and `.planning/**`. No `package.json`/`pyproject.toml` diffs anywhere in this range — no new dependencies. `packages/db/migrations/` tops out at `0030_confirm_action_widget_kind.sql`, a pre-existing Phase-40 migration untouched by Phase 38 — no new migrations. The one commit AFTER the phase-38 range currently at `HEAD` (`ab5b720`, "docs(41): UI design contract") only touches a `.planning/phases/41-.../41-UI-SPEC.md` planning doc for the next phase — not part of Phase 38, does not affect this verification, and falls within the allowed `.planning/**` pattern regardless.

### Human Verification Required

None. Every QUAR-01/QUAR-02 truth is a server-side/data-layer logic property (structural envelope validation, generic-replacement behavior, hardening-line eligibility gating, deterministic fixture scoring, real-DB id resolvability, exposure-flag gating) fully provable by static code inspection and automated/live test runs. The live-model harness — the one truth that could plausibly need human judgment — was independently re-run against real Bedrock in this verification session and produced a genuine, non-skipped, all-pass result (not the `human_needed` fallback), so no human check is outstanding.

### Answers to the Explicit Questions

**Did the `SEARCH_KNOWLEDGE_TOOL_ENABLED` flag flip actually happen, and was it correctly gated on a green deterministic suite (not flipped speculatively)?**
Yes. `app/settings.py` line 156 reads `SEARCH_KNOWLEDGE_TOOL_ENABLED: bool = True`, and the deterministic adversarial suite (`tests/evals/` excluding the live-harness module — the scope 38-CONTEXT.md designates as "the gate") was independently re-run fresh in this verification session and is green: 69/69 passed, 0 failures. The flip is consistent with, not merely claimed to be consistent with, a currently-passing gate.

**What was the live-model harness outcome?**
Ran and passed. Independently re-executed `tests/evals/test_live_injection_harness.py` against real AWS Bedrock (`us.anthropic.claude-haiku-4-5-20251001-v1:0`) in this verification session: 7/7 representative fixtures (one per category) genuinely resisted injection — no canary token leaked into any visible assistant text. This is the strongest possible outcome, not the `human_needed`/credentials-unavailable fallback the plan allowed for.

**Are there any gaps_found that should block calling this phase fully done?**
No. All 12 must-have truths (merged from ROADMAP SC1-SC5 and both plans' frontmatter) are VERIFIED against live code, live test runs, and a live-database query — not trusted from SUMMARY.md claims. No scope violations, no new migrations, no new dependencies, no debt markers, no stub or dead-code fallback in any critical path.

### Gaps Summary

No gaps. All 12 observable truths verified against live code, freshly re-run tests (including the live Bedrock harness and the deterministic adversarial suite, not trusted from SUMMARY.md), and an independently-executed live-database query confirming the new golden-set UUIDs are real. The structural envelope gate is confirmed to be the single, unbypassable wiring point for every `ToolExecutor.execute()` call in the codebase. The `SEARCH_KNOWLEDGE_TOOL_ENABLED` flip is confirmed correctly gated on a currently-green deterministic suite, and the exposure-gate regression tests remain internally consistent with the new default. mypy, import-linter, and the full regression sweep (1176 passed, 0 failed, excluding one pre-existing unrelated Python-3.13 test-ordering issue confirmed to have zero diff since before Phase 38) are all clean. Phase goal achieved.

---

_Verified: 2026-07-09T03:45:00Z_
_Verifier: Claude (gsd-verifier)_
