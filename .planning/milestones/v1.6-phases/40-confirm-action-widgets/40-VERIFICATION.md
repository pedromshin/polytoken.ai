---
phase: 40-confirm-action-widgets
verified: 2026-07-09T02:15:00Z
status: passed
score: 11/11 must-haves verified
overrides_applied: 0
---

# Phase 40: Confirm-Action Widgets Verification Report

**Phase Goal:** Agent can end a turn with a confirm-action widget that lets a human promote or
reject a knowledge suggestion without the LLM ever supplying raw mutation params — retrofitting
v1.5's promotion confirm onto the existing Phase-24 CAS + staleness spine, plus a new edge-tier
staleness re-check.
**Verified:** 2026-07-09T02:15:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + PLAN must_haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `emit_confirm_action` schema restricts the model to `suggestionRef {kind, id}` + optional `rationale` — never tier/node-id/mutation params | VERIFIED | Read `chat_tools.py` lines 250-296: root `additionalProperties: False`, nested `suggestionRef.additionalProperties: False`, `suggestionRef.kind` enum is exactly `["knowledge_edge_tier_promotion"]`, two load-time asserts enforce both `additionalProperties:false` sites |
| 2 | Server derives the frozen `{action: confirm\|reject}` schema by re-reading the LIVE `knowledge_node_edges` row at emission — never from LLM-supplied fields | VERIFIED | Read `run_chat_turn.py` `_finalize_confirm_action` (lines 718-780): `await self._knowledge_graph.find_edge_by_id(parsed["id"])` is the only source of the edge data used to build the declaration; the model-supplied `id` is the only untrusted input, tier/confidence/relation_type all come from the live-fetched row |
| 3 | Missing/inactive/cross-importer/wrong-tier edge -> visible "suggestion no longer available" text, never a broken widget | VERIFIED | Re-read `_finalize_confirm_action`'s `edge_valid` check (importer_id match + is_active + tier in INFERRED/AMBIGUOUS) — any failure appends `CONFIRM_ACTION_UNAVAILABLE_TEXT`; ran `test_edge_not_found_finalizes_unavailable_text_and_never_creates_pending_row`, `test_edge_cross_importer_finalizes_unavailable_text`, `test_edge_inactive_finalizes_unavailable_text`, `test_edge_wrong_tier_finalizes_unavailable_text` myself — all 4 pass |
| 4 | Malformed/truncated tool call -> visible `PARSE_FAILURE_TEXT`, never silently dropped | VERIFIED | `parse_confirm_action_call` returns `None` on any structural failure; `_finalize_confirm_action` appends `PARSE_FAILURE_TEXT` and `find_edge_by_id` is asserted NEVER called (`find_edge_by_id_calls == []`) in `test_malformed_call_missing_suggestion_ref_finalizes_parse_failure_text` and `test_malformed_call_wrong_kind_finalizes_parse_failure_text` — both re-run, pass |
| 5 | `widget_kind` CHECK constraint accepts `confirm_action`, migration numbered after every merged v1.6 migration | VERIFIED (live DB) | Independently re-ran `cd packages/db && npm run with-env -- tsx scripts/verify-0030-live.ts` — exit code 0, printed `(widget_kind = ANY (ARRAY['proposal_cards'::text, 'clarify_widget'::text, 'confirm_action'::text]))`. `0030_confirm_action_widget_kind.sql` exists; `_journal.json` entry idx=30 (sequential after idx=29), tag `0030_confirm_action_widget_kind` matches filename exactly |
| 6 | Submitting a confirm-action re-checks the LIVE edge tier against the `tierSnapshot` and rejects 409 stale if promoted/deactivated out-of-band, BEFORE any interaction-row mutation | VERIFIED | Read `submit_widget_interaction.py` source: `_reject_if_confirm_action_edge_stale` called at line 146, strictly BEFORE `try_submit` at line 152 — confirmed by source ordering, not just test |
| 7 | THE MUST-TEST: emit confirm-action -> promote SAME edge out-of-band -> submit -> 409 stale, NO double mutation (try_submit never called AND dispatch handler's execute never called) | VERIFIED | Read `test_confirm_action_stale_when_edge_tier_promoted_out_of_band` in full: asserts `exc_info.value.reason == "stale"` AND `not widget_interactions.try_submit_calls` AND `not dispatch_handler.execute_calls` AND `not messages.inserted` AND `not runner.calls`. The `FakeChatWidgetInteractionRepository`/`FakeConfirmActionHandler` doubles genuinely track call lists (not always-true stubs) — verified by reading their implementations. Re-ran the test file myself: 17/17 passed including this test and its `is_active=False` sibling |
| 8 | 2-entry dispatch table keyed by kind, `dict.get`/equivalent (never raw KeyError), `entity_merge_confirm` registered-but-unsupported, never crashes | VERIFIED | `confirm_action_dispatch.py`: `self._confirm_action_dispatch.get(kind)` (submit_widget_interaction.py line 270) returns `None` for an unregistered kind rather than raising; `container.py` builds the exact 2-entry dict `{SUGGESTION_KIND_EDGE_TIER_PROMOTION: KnowledgeEdgeTierPromotionHandler(...), SUGGESTION_KIND_ENTITY_MERGE_CONFIRM: UnsupportedConfirmActionHandler()}`; `UnsupportedConfirmActionHandler.execute` has no `raise` statement, always returns `{"status": "unsupported", ...}` |
| 9 | Reject never mutates the edge row | VERIFIED | `KnowledgeEdgeTierPromotionHandler.execute`: `if action == "reject": return {"status": "rejected"}` immediately — no reference to `self._promote_edge` on that branch at all |
| 10 | Confirm records `mechanism="chat_confirm_action"` + `widget_interaction_id` provenance, distinct from plain REST `human_promote` | VERIFIED | `promote_edge.py`: `promotion = {"promoted_at": ..., "from_tier": ..., "mechanism": mechanism, **(extra or {})}`, default `mechanism="human_promote"`; `KnowledgeEdgeTierPromotionHandler` calls it with `mechanism="chat_confirm_action", extra={"widget_interaction_id": ...}`. Test `test_execute_with_mechanism_and_extra_records_chat_confirm_provenance` + regression test asserting `set(promotion.keys()) == {"promoted_at", "from_tier", "mechanism"}` when omitted — both re-run, pass |
| 11 | `SubmitWidgetInteraction.prepare()`'s public signature UNCHANGED (conversation_id, interaction_id, result, model_id only) | VERIFIED | Read `prepare()`'s signature directly (lines 124-131): exactly `conversation_id`, `interaction_id`, `result`, `model_id` — byte-identical to the pre-40-02 interface documented in the plan |

**Score:** 11/11 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/db/migrations/0030_confirm_action_widget_kind.sql` | widget_kind CHECK extended with confirm_action | VERIFIED | Exists, idempotent DROP+ADD, contains `confirm_action`; live-verified against local Postgres |
| `packages/db/migrations/meta/_journal.json` | idx=30 entry, tag matches filename | VERIFIED | Confirmed idx=30, tag `0030_confirm_action_widget_kind`, `when` strictly greater than idx=29's |
| `apps/email-listener/app/application/use_cases/run_chat_turn_confirm_action.py` | pure parse/declaration helpers | VERIFIED | `parse_confirm_action_call`, `build_confirm_action_declaration` both exist, pure (no I/O), unit-tested (18 helper tests) |
| `apps/email-listener/app/infrastructure/llm/chat_tools.py` | `build_emit_confirm_action_tool()` | VERIFIED | Exists, schema-restricted as documented above |
| `apps/email-listener/app/application/use_cases/run_chat_turn.py` | `_finalize_confirm_action` async live-edge-read | VERIFIED | Exists, wired into `_finalize_turn_completed`, fail-closed on DB errors |
| `apps/email-listener/app/application/use_cases/confirm_action_dispatch.py` | ConfirmActionHandler Protocol + 2 handlers | VERIFIED | `KnowledgeEdgeTierPromotionHandler` + `UnsupportedConfirmActionHandler`, both tested |
| `apps/email-listener/app/application/use_cases/submit_widget_interaction.py` | CONF-02 staleness re-check + dispatch, prepare() unchanged | VERIFIED | Confirmed source ordering + unchanged signature |
| `apps/email-listener/app/application/use_cases/promote_edge.py` | additive mechanism/extra params | VERIFIED | Backward-compatible defaults confirmed by regression test |
| `apps/web/src/app/chat/_components/compact-interaction-entry.tsx` | confirm_action routes to ProposalSummary | VERIFIED | One-line widgetKind check extended; 4/4 vitest tests pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `run_chat_turn.py` | `knowledge_graph_repository.py` | `find_edge_by_id` inside `_finalize_confirm_action` | WIRED | Confirmed call site + try/except fail-closed wrapper |
| `container.py` | `run_chat_turn.py` | `build_emit_confirm_action_tool()` as 3rd `interactive_widget_tools` entry + `knowledge_graph=knowledge_repo` | WIRED | Confirmed in `_provide_run_chat_turn`, lines 716-734 |
| `submit_widget_interaction.py` | `knowledge_graph_repository.py` | `find_edge_by_id` inside `_reject_if_confirm_action_edge_stale` | WIRED | Confirmed call site, runs before `try_submit` |
| `confirm_action_dispatch.py` | `promote_edge.py` | `KnowledgeEdgeTierPromotionHandler` wraps `PromoteEdgeUseCase.execute(mechanism=..., extra=...)` | WIRED | Confirmed |
| `container.py` | `submit_widget_interaction.py` | `_provide_submit_widget_interaction` wires `knowledge_graph` + 2-entry `confirm_action_dispatch` dict | WIRED | Confirmed, lines 756-794 |

### Data-Flow Trace (Level 4)

Not applicable in the strict UI-rendering sense (this phase's server-side logic feeds an
already-vetted, unmodified widget renderer). Traced the one relevant server-to-client hop:
`declaration.options`/`prompt`/`tierSnapshot` are built from a live-fetched `edge` dict
(`find_edge_by_id`), never from hardcoded/static values — confirmed by reading
`build_confirm_action_declaration`'s body (relation_type/confidence/tier all read off the fetched
`edge` argument).

### Behavioral Spot-Checks / Test Runs (independently re-executed)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Migration 0030 live-verify | `cd packages/db && npm run with-env -- tsx scripts/verify-0030-live.ts` | exit 0, constraint contains all 3 values | PASS |
| confirm_action helper + wiring tests | `uv run pytest tests/test_promote_edge.py app/application/use_cases/__tests__/test_confirm_action_dispatch.py app/application/use_cases/__tests__/test_run_chat_turn_confirm_action_helpers.py app/application/use_cases/__tests__/test_run_chat_turn_confirm_action.py -v --no-cov` | 44 passed | PASS |
| submit_widget_interaction (incl. THE MUST-TEST) | `uv run pytest app/application/use_cases/__tests__/test_submit_widget_interaction.py -v --no-cov` | 17 passed | PASS |
| Full regression sweep | `uv run pytest tests/application/ app/application/use_cases/__tests__/ tests/test_container.py app/presentation/api/v1/__tests__/test_chat_widget.py tests/test_promote_edge.py --no-cov` | 307 passed, 0 failed | PASS |
| container + chat_widget endpoint tests | `uv run pytest tests/test_container.py app/presentation/api/v1/__tests__/test_chat_widget.py -v --no-cov` | 24 passed (14+10) | PASS |
| mypy (9 phase-40 touched files) | `uv run mypy <9 files>` | 0 errors in touched files; 12 pre-existing errors confined to 4 unrelated infra files (documented baseline) | PASS |
| ruff (phase-40 touched files) | `uv run ruff check <9 files>` | All checks passed | PASS |
| lint-imports | `uv run lint-imports` | Contracts: 3 kept, 0 broken | PASS |
| web vitest (compact-interaction-entry) | `npx vitest run src/app/chat/_components/__tests__/compact-interaction-entry.test.tsx` | 4 passed | PASS |
| web typecheck | `npm run typecheck` | clean, no output | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CONF-01 | 40-01 | emit_confirm_action tool, schema-restricted, live-read finalization, widget_kind migration | SATISFIED | Truths 1-5 above |
| CONF-02 | 40-02 | edge-tier staleness re-check + 2-entry dispatch + compact-summary web fix | SATISFIED | Truths 6-11 above |

No orphaned requirements — REQUIREMENTS.md maps only CONF-01/CONF-02 to Phase 40, both claimed by
the plans and both marked `[x]` complete.

### Anti-Patterns Found

None. Scanned all 11 phase-40-touched source files (Python + the one web file + the migration)
for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented"/"coming soon" markers —
zero matches except three legitimate, unrelated uses of the literal word "placeholder" (a form
field's `placeholder` schema property, and a code comment referencing a *different*, already-
resolved Phase-34 placeholder pattern by name) — none are stubs in this phase's own scope.

### Scope Discipline Check

Enumerated each of the 8 phase-40 commits' file lists individually (the commit range diff was
polluted by interleaved phase 35-39 commits due to non-linear autonomous-run history, so a raw
`git diff --stat` over a commit range was not reliable — verified per-commit instead):
`b56cebc`, `ec952f0`, `62a9c34`, `c2f6d6f`, `600618f`, `ff243a6`, `160c453`, `c96f47a`, `827a265`,
`8dda981`. Every file touched falls within `apps/email-listener/**`, `packages/db/**`, the single
web file `apps/web/src/app/chat/_components/compact-interaction-entry.tsx` (+ its test), or
`.planning/**`. `apps/web/src/app/chat/_components/interactive-widget-boundary.tsx` is not touched
by any phase-40 commit — confirmed zero diff.

### Human Verification Required

None. Every CONF-01/CONF-02 truth is a server-side logic property (schema restriction, live-read
gating, staleness re-check ordering, dispatch-table safety, provenance recording) fully provable
by static code inspection and automated tests. The one web change reuses the already-vetted
(Phase 24) proposal-card rendering machinery verbatim — confirmed zero diff on
`interactive-widget-boundary.tsx` — and is covered by a passing automated vitest assertion on the
rendered text ("Selected \"Confirm\""), not a visual/real-time/external-service behavior requiring
human judgment.

### Gaps Summary

No gaps. All 11 observable truths verified against live code and a live-Postgres-verified
migration (independently re-run, not trusted from SUMMARY.md). The MUST-test proving CONF-02's
headline safety property (409 stale, zero double-mutation) was read in full and confirmed to
assert all three required conditions (rejection reason, zero interaction-row mutation, zero
dispatch-handler invocation) using test doubles that genuinely track call lists. Source ordering
(staleness check before CAS, dispatch after CAS) was confirmed by reading the actual source, not
inferred from a passing test. All 11 phase-40 commits stay within
`apps/email-listener/**`/`packages/db/**`/one web file/`.planning/**` scope. mypy, ruff, and
lint-imports all clean on every phase-40-touched file. Phase goal achieved.

---

_Verified: 2026-07-09T02:15:00Z_
_Verifier: Claude (gsd-verifier)_
