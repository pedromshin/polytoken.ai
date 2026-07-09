---
phase: 40-confirm-action-widgets
plan: 01
subsystem: chat-widget-tools
tags: [emit-confirm-action, live-edge-read, widget-kind-migration, CONF-01, terminal-widget-tool]
dependency_graph:
  requires:
    - "app.domain.ports.knowledge_graph_repository.find_edge_by_id (v1.5, unchanged)"
    - "app.infrastructure.supabase.knowledge_graph_repository.SupabaseKnowledgeGraphRepository (v1.5, extended by 37-01)"
    - "app.application.use_cases.run_chat_turn_widgets.INTERACTIVE_WIDGET_TOOL_NAMES / derive_declared_response_schema (Phase 24)"
    - "app.application.use_cases.run_chat_turn_tool_loop.PARSE_FAILURE_TEXT (Phase 34-02, 'never silent' convention)"
    - "app.domain.ports.chat_widget_interaction_repository.ChatWidgetInteractionRepository (Phase 24-01)"
  provides:
    - "packages/db/migrations/0030_confirm_action_widget_kind.sql — chat_widget_interactions_widget_kind_check now accepts 'confirm_action'"
    - "app.infrastructure.llm.chat_tools.EMIT_CONFIRM_ACTION_TOOL_NAME / build_emit_confirm_action_tool"
    - "app.application.use_cases.run_chat_turn_confirm_action (parse_confirm_action_call, build_confirm_action_declaration, SUGGESTION_KIND_EDGE_TIER_PROMOTION, SUGGESTION_KIND_ENTITY_MERGE_CONFIRM, CONFIRM_ACTION_UNAVAILABLE_TEXT)"
    - "app.application.use_cases.run_chat_turn.RunChatTurn._finalize_confirm_action + knowledge_graph constructor param"
    - "app.domain.ports.chat_widget_interaction_repository.WidgetKind now includes 'confirm_action'"
  affects:
    - "Plan 40-02 (CONF-02): consumes SUGGESTION_KIND_ENTITY_MERGE_CONFIRM (registered but unreachable via this tool's schema), declaration['tierSnapshot'] for the staleness re-check, and the confirm/reject optionId contract for the submit-time dispatch table"
tech_stack:
  added: []
  patterns:
    - "Eager pending-state clear before live I/O: _finalize_confirm_action clears pending_tool_* on every branch BEFORE the live edge read, so the subsequent pure _finalize_pending_tool(state) call is provably a no-op for this tool — the seam that lets an async, self-bound live-read collaborate safely with the existing pure mid-stream dispatch"
    - "Generic-unavailable collapse (T-40-02): not-found / cross-importer / inactive / wrong-tier all produce the SAME CONFIRM_ACTION_UNAVAILABLE_TEXT — no oracle for probing another tenant's edge id"
    - "Schema-restricted allowlist ordering: suggestionRef.kind enum has exactly one value (knowledge_edge_tier_promotion) this phase; entity_merge_confirm is defined as a constant for Plan 40-02's dispatch table but structurally unreachable via the tool schema"
    - "Wire-format reuse: confirm_action declarations reuse the proposal_cards derive_declared_response_schema branch verbatim — {optionId: enum[confirm,reject]} IS the frozen {action: confirm|reject} contract, zero new web components"
key_files:
  created:
    - packages/db/migrations/0030_confirm_action_widget_kind.sql
    - packages/db/scripts/verify-0030-live.ts
    - apps/email-listener/app/application/use_cases/run_chat_turn_confirm_action.py
    - apps/email-listener/app/application/use_cases/__tests__/test_run_chat_turn_confirm_action_helpers.py
    - apps/email-listener/app/application/use_cases/__tests__/test_run_chat_turn_confirm_action.py
  modified:
    - packages/db/migrations/meta/_journal.json
    - apps/email-listener/app/infrastructure/llm/chat_tools.py
    - apps/email-listener/app/application/use_cases/run_chat_turn_widgets.py
    - apps/email-listener/app/domain/ports/chat_widget_interaction_repository.py
    - apps/email-listener/app/application/use_cases/run_chat_turn.py
    - apps/email-listener/app/container.py
decisions:
  - "Migration numbered 0030 (0029_knowledge_search_extracted_only.sql confirmed as head via ls at execution time, matching the critical_context's pre-verified number — no concurrency collision)"
  - "container.py reuses the SAME knowledge_repo instance Phase 37-02 already instantiates for search_knowledge_executor, rather than a second SupabaseKnowledgeGraphRepository(client=client) — one instance, two consumers, no duplicate construction"
  - "emit_confirm_action has NO exposure flag (unlike search_knowledge's SEARCH_KNOWLEDGE_TOOL_ENABLED) — always offered once wired, since terminal human-confirm widget tools are Phase-24-style by construction, not a mid-turn data-read risk the synthesis's exposure-gate rule targets"
  - "_finalize_confirm_action wraps find_edge_by_id in try/except Exception, treating a DB error identically to edge-unavailable — fail-closed, the turn never crashes on a lookup hiccup"
metrics:
  duration: "~55 min"
  completed: 2026-07-09
---

# Phase 40 Plan 01: Confirm-Action Widgets — emit_confirm_action + Live Edge Read Summary

Adds the `emit_confirm_action` terminal widget tool: the model supplies only `suggestionRef
{kind, id}` (+ an optional short rationale) — never a tier, node id, or mutation parameter. The
server re-reads the live `knowledge_node_edges` row at emission time and either builds a frozen
confirm/reject widget declaration or fails into visible text (never silent). Extends the
`chat_widget_interactions.widget_kind` CHECK constraint via migration 0030.

## What Was Built

### Task 1 — widget_kind migration (0030) + live-verify

Confirmed migration head via `ls packages/db/migrations/*.sql | sort | tail`: `0029_knowledge_
search_extracted_only.sql`, so N=0030 (matching the critical_context's pre-verified number,
no concurrent collision). `packages/db/migrations/0030_confirm_action_widget_kind.sql`:
idempotent `DROP CONSTRAINT IF EXISTS` + re-`ADD CONSTRAINT` extending
`chat_widget_interactions_widget_kind_check` to `CHECK (widget_kind IN ('proposal_cards',
'clarify_widget', 'confirm_action'))`. `packages/db/migrations/meta/_journal.json` gained the
manual entry (`idx: 30, tag: "0030_confirm_action_widget_kind", when: 1783708800000` — strictly
greater than 0029's `when`, breakpoints/version match the existing entries) — per the critical
lesson from Phase 37-01, drizzle's migrator silently skips a hand-written `.sql` file absent
from the journal. `packages/db/scripts/verify-0030-live.ts` (mirrors verify-0027-live.ts's
direct-`pg.Client` structure): queries `information_schema.check_constraints` for the
constraint's `check_clause` and asserts it contains all three widget_kind values. Applied via
`npm run db:migrate` from repo root (23 tables, 20ms, no error) and live-verified: `npm run
with-env -- tsx scripts/verify-0030-live.ts` printed `(widget_kind = ANY (ARRAY['proposal_cards'
::text, 'clarify_widget'::text, 'confirm_action'::text]))` and exited 0 (`VERIFICATION PASSED`).

### Task 2 — emit_confirm_action tool schema + pure parse/declaration-builder helpers

`chat_tools.py`: `EMIT_CONFIRM_ACTION_TOOL_NAME = "emit_confirm_action"` +
`build_emit_confirm_action_tool()` mirrors `build_emit_proposal_cards_tool`'s structure exactly
— root `type: object`, `additionalProperties: false`, `required: ["suggestionRef"]`;
`suggestionRef` is a nested object (`required: ["kind", "id"]`, `additionalProperties: false`,
`kind` restricted to a single-value enum `["knowledge_edge_tier_promotion"]`, `id` a
1-100-char string); top-level optional `rationale` (maxLength 280). Two load-time asserts
mirror the existing Bedrock-valid-schema guards, checking both `additionalProperties: false`
occurrences (root + nested).

New `run_chat_turn_confirm_action.py` (pure, no I/O, no port imports — mirrors
`run_chat_turn_widgets.py`'s contract): `EMIT_CONFIRM_ACTION_TOOL_NAME` (independently defined,
not cross-imported from infra per the import-linter contract), `SUGGESTION_KIND_EDGE_TIER_
PROMOTION`/`SUGGESTION_KIND_ENTITY_MERGE_CONFIRM` (the second registered for Plan 40-02's
dispatch table, never reachable via this tool's own schema), `CONFIRM_ACTION_UNAVAILABLE_TEXT`,
`_CONFIRM_OPTION`/`_REJECT_OPTION` (server-assigned `confirm`/`reject` ids — the wire-format
contract). `parse_confirm_action_call(raw_json) -> dict | None`: rejects malformed JSON,
non-dict shapes, a missing/non-dict `suggestionRef`, any `kind` other than
`knowledge_edge_tier_promotion` (defense-in-depth against `entity_merge_confirm` even though
the schema enum already blocks it), and a missing/empty `id`; a non-string `rationale` is
silently ignored (not a parse failure). `build_confirm_action_declaration(*, kind,
suggestion_id, edge, rationale)`: pure — takes an ALREADY-FETCHED edge dict, builds the prompt
from `relation_type`, a Confirm-option description from `confidence`/`tier` (+ rationale if
present), and returns `{prompt, options: [confirm, reject], suggestionRef, tierSnapshot}` (the
`tierSnapshot` key name preserved verbatim for Plan 40-02's staleness check).

`run_chat_turn_widgets.py`: imports `EMIT_CONFIRM_ACTION_TOOL_NAME`, appends it as the third
`INTERACTIVE_WIDGET_TOOL_NAMES` entry, and extends `derive_declared_response_schema`'s first
branch to `widget_kind in ("proposal_cards", "confirm_action")` — the existing
enum-of-option-ids body is reused verbatim, producing `{"optionId": {"enum": ["confirm",
"reject"]}}` for a confirm_action declaration.

`chat_widget_interaction_repository.py`: `WidgetKind` extended to `Literal["proposal_cards",
"clarify_widget", "confirm_action"]`.

18 new pure-helper tests (`test_run_chat_turn_confirm_action_helpers.py`): parse
success/no-rationale/malformed-json/empty-string/non-dict/missing-ref/ref-not-dict/wrong-kind
(both `entity_merge_confirm` and an arbitrary unknown kind)/missing-id/empty-id/non-string-
rationale-ignored; declaration shape with and without rationale; `INTERACTIVE_WIDGET_TOOL_NAMES`
length == 3; `derive_declared_response_schema("confirm_action", ...)` shape;
`CONFIRM_ACTION_UNAVAILABLE_TEXT` non-empty; the two suggestion-kind constants are distinct.

### Task 3 — wire the live-edge-read finalization into RunChatTurn + container

Re-read `run_chat_turn.py`/`container.py` fresh by symbol per the critical_context instruction
(rather than trusting the plan's quoted line numbers) — confirmed `_finalize_pending_tool`,
`_finalize_turn_completed`, `RunChatTurn.__init__`'s trailing params, and `_provide_run_chat_
turn`'s current shape all matched the plan's `<interfaces>` snapshot exactly (Phases 34-39
hadn't touched these seams since the plan was authored). One genuinely new discovery not in
the plan's snapshot: `_provide_run_chat_turn` ALREADY instantiates `knowledge_repo =
SupabaseKnowledgeGraphRepository(client=client)` (added by Phase 37-02 for
`search_knowledge_executor`) — reused that existing instance for `RunChatTurn`'s new
`knowledge_graph=` param instead of constructing a second one.

`RunChatTurn.__init__` gains `knowledge_graph: KnowledgeGraphRepository | None = None`
(additive default, placed after `interactive_widget_tools`, before `tool_executors`), stored as
`self._knowledge_graph`. New async method `_finalize_confirm_action(self, state, *,
importer_id)`: no-ops (`state, None`) unless `state.pending_tool_name ==
EMIT_CONFIRM_ACTION_TOOL_NAME`. Otherwise clears `pending_tool_*` EAGERLY (on every branch)
before doing anything else — this is what lets the subsequent pure `_finalize_pending_tool
(state)` call in `_finalize_turn_completed` become a provable no-op for this tool. Calls
`parse_confirm_action_call`; `None` → `PARSE_FAILURE_TEXT` text part, `self._knowledge_graph.
find_edge_by_id` never called. On a parsed call, `find_edge_by_id` is awaited inside a broad
`try/except Exception` (a lookup failure degrades to `edge = None`, never crashes the turn).
Validates `edge is not None and edge["importer_id"] == importer_id and edge["is_active"] and
edge["tier"] in ("INFERRED", "AMBIGUOUS")` — any failure → `CONFIRM_ACTION_UNAVAILABLE_TEXT`
text part (same string for all four failure modes, T-40-02). On success, builds the
`confirm_action` `interactive_widget` part via `build_confirm_action_declaration` and returns
a `tool_result` event tuple, mirroring `_finalize_pending_tool`'s own return shape.
`_finalize_turn_completed` calls `_finalize_confirm_action` FIRST (before the existing
`_finalize_pending_tool` call), emitting its event when non-None.

`container.py`: imports `build_emit_confirm_action_tool`; `_provide_run_chat_turn` adds it as
the third `interactive_widget_tools` tuple entry and passes `knowledge_graph=knowledge_repo`
into `RunChatTurn(...)`. No exposure flag (unlike `search_knowledge`) — `emit_confirm_action`
is always offered once wired, since it's a terminal human-confirm widget tool, not a mid-turn
data-read risk.

New `test_run_chat_turn_confirm_action.py` (mirrors `test_run_chat_turn_interactive_widget.py`'s
fixture set plus a new `FakeKnowledgeGraphRepository`): 10 tests covering (1) valid live edge →
confirm_action widget + matching `create_pending` call, declared_response_schema, tierSnapshot;
(2) edge not found; (3) edge cross-importer; (4) edge inactive; (5) edge wrong-tier
(EXTRACTED) — all four asserting the SAME unavailable text and zero `create_pending` calls;
(6) malformed call missing `suggestionRef`; (7) malformed call with `kind:
"entity_merge_confirm"` — both asserting `find_edge_by_id` is NEVER called; (8) regression:
`emit_proposal_cards` still finalizes correctly and `_finalize_confirm_action` never calls
`find_edge_by_id` for a non-confirm_action pending tool; (9) genui-capable model is offered all
three widget tools in order; (10) no `knowledge_graph` injected (default None) still falls back
safely to the unavailable text, never a crash.

## Verification

```
cd packages/db && npm run with-env -- tsx scripts/verify-0030-live.ts
# Constraint definition: (widget_kind = ANY (ARRAY['proposal_cards'::text, 'clarify_widget'::text, 'confirm_action'::text]))
# VERIFICATION PASSED: all assertions confirmed live.

cd apps/email-listener && uv run pytest app/application/use_cases/__tests__/test_run_chat_turn_confirm_action_helpers.py -v --no-cov
# 18 passed

cd apps/email-listener && uv run pytest app/application/use_cases/__tests__/test_run_chat_turn_confirm_action.py \
  app/application/use_cases/__tests__/test_run_chat_turn_interactive_widget.py \
  app/application/use_cases/__tests__/test_run_chat_turn_clarify_widget.py -v --no-cov
# 20 passed (10 new confirm_action + 4 interactive_widget regression + 6 clarify_widget regression)

cd apps/email-listener && uv run pytest tests/application/test_run_chat_turn.py tests/application/test_run_chat_turn_tool_loop.py \
  tests/application/test_run_chat_turn_tool_loop_bugfixes.py tests/application/test_run_chat_turn_tool_loop_e2e.py \
  tests/application/test_run_chat_turn_real_tools_wiring.py tests/test_container.py app/infrastructure/llm/__tests__/test_chat_tools.py -v --no-cov
# 64 passed (full regression sweep across every chat-turn/container/chat-tools test file)

# Combined (all files above, once, no double-counting):
cd apps/email-listener && uv run pytest app/application/use_cases/__tests__/test_run_chat_turn_confirm_action_helpers.py \
  app/application/use_cases/__tests__/test_run_chat_turn_confirm_action.py \
  app/application/use_cases/__tests__/test_run_chat_turn_interactive_widget.py \
  app/application/use_cases/__tests__/test_run_chat_turn_clarify_widget.py \
  tests/application/test_run_chat_turn.py tests/application/test_run_chat_turn_tool_loop.py \
  tests/application/test_run_chat_turn_tool_loop_bugfixes.py tests/application/test_run_chat_turn_tool_loop_e2e.py \
  tests/application/test_run_chat_turn_real_tools_wiring.py tests/test_container.py \
  app/infrastructure/llm/__tests__/test_chat_tools.py --no-cov
# 102 passed, 0 failed

cd apps/email-listener && uv run mypy app/infrastructure/llm/chat_tools.py app/application/use_cases/run_chat_turn_confirm_action.py \
  app/application/use_cases/run_chat_turn_widgets.py app/domain/ports/chat_widget_interaction_repository.py \
  app/application/use_cases/run_chat_turn.py app/container.py
# Success: no issues found in 6 source files (container.py's own transitive-import check separately
# surfaces the SAME 12 pre-existing errors in 4 unrelated infrastructure files Phase 36-02/37-02 already
# documented — zero errors in any file this plan touched/created)

cd apps/email-listener && uv run lint-imports
# Contracts: 3 kept, 0 broken

cd apps/email-listener && uv run ruff check app/infrastructure/llm/chat_tools.py app/application/use_cases/run_chat_turn_confirm_action.py \
  app/application/use_cases/run_chat_turn_widgets.py app/domain/ports/chat_widget_interaction_repository.py \
  app/application/use_cases/run_chat_turn.py app/container.py app/application/use_cases/__tests__/test_run_chat_turn_confirm_action.py \
  app/application/use_cases/__tests__/test_run_chat_turn_confirm_action_helpers.py
# All checks passed!

git diff --stat -- apps/web/
# (empty — zero web changes, this plan is Python + migration only)
```

Note: as in every prior Phase 34-37 plan, the repo's global pytest coverage gate
(`fail-under=80`) fails on any targeted subset run by design — the pass/fail counts above are
what verify this plan. Running with `-k confirm_action` and no explicit path collects 0 tests
(the repo's `testpaths = ["tests"]` pytest config only auto-discovers under `tests/`, not the
co-located `app/**/__tests__/` directories the Phase 24 precedent established) — every command
above uses explicit file paths, matching how the existing `test_run_chat_turn_interactive_
widget.py`/`test_run_chat_turn_clarify_widget.py` suites are already run.

## Deviations from Plan

**1. [Claude's Discretion, non-architectural] Reused the existing `knowledge_repo` instance
in `container.py` instead of constructing a second one.** The plan's action text said to
"build `knowledge_repo = SupabaseKnowledgeGraphRepository(client=client)`" inside
`_provide_run_chat_turn` — by the time this plan executed, Phase 37-02 had already added that
exact line for `search_knowledge_executor`. Constructing a second instance would be redundant
(same client, same stateless wrapper); reused the one already in scope. No behavioral
difference — `SupabaseKnowledgeGraphRepository` holds no per-instance state beyond the shared
`client`.

**2. [Rule 3 — auto-fix blocking issue] Removed an unused `noqa: BLE001` comment.** `ruff
check` flagged `RUF100` (unused noqa — `BLE001` is not enabled in this project's ruff config,
unlike some other Python projects' defaults). Removed the directive, kept the plain-comment
rationale for the broad `except Exception` (fail-closed on a DB hiccup). Zero behavior change.

No Rule 4 (architectural) deviations. No auth gates encountered. No interface drift beyond the
one additive discovery documented above — the plan's `<interfaces>` snapshot of
`run_chat_turn.py`/`container.py` was otherwise accurate at execution time (2026-07-09).

## Known Stubs

None. Every piece built this plan is fully wired end-to-end: the tool is offered to
genui-capable models, a completed call reaches the live edge-read finalization path, and both
the success and every failure branch are covered by tests against the real `RunChatTurn`
(not a mock of it). `SUGGESTION_KIND_ENTITY_MERGE_CONFIRM` is intentionally registered-but-
unreachable via this tool's own JSON schema — that is Plan 40-02's territory (the dispatch
table consumes the constant), not a stub in this plan's own scope.

## Threat Flags

None beyond the plan's own `<threat_model>` register (T-40-01..04, all addressed as designed —
see What Was Built's Task 2/3 sections for the concrete `additionalProperties:false`+enum
schema restriction (T-40-01), the generic-unavailable-text collapse (T-40-02), the
accepted per-turn cost-ceiling bound (T-40-03, unchanged from Phase 35), and the fail-closed
`PARSE_FAILURE_TEXT` malformed-call handling (T-40-04)).

## Self-Check: PASSED

- FOUND: packages/db/migrations/0030_confirm_action_widget_kind.sql
- FOUND: packages/db/scripts/verify-0030-live.ts
- FOUND: apps/email-listener/app/application/use_cases/run_chat_turn_confirm_action.py
- FOUND: apps/email-listener/app/application/use_cases/__tests__/test_run_chat_turn_confirm_action_helpers.py
- FOUND: apps/email-listener/app/application/use_cases/__tests__/test_run_chat_turn_confirm_action.py
- FOUND: packages/db/migrations/meta/_journal.json entry idx=30 tag=0030_confirm_action_widget_kind
- FOUND: apps/email-listener/app/infrastructure/llm/chat_tools.py (EMIT_CONFIRM_ACTION_TOOL_NAME + build_emit_confirm_action_tool)
- FOUND: apps/email-listener/app/application/use_cases/run_chat_turn_widgets.py (INTERACTIVE_WIDGET_TOOL_NAMES 3 entries)
- FOUND: apps/email-listener/app/domain/ports/chat_widget_interaction_repository.py (WidgetKind includes confirm_action)
- FOUND: apps/email-listener/app/application/use_cases/run_chat_turn.py (_finalize_confirm_action + knowledge_graph param)
- FOUND: apps/email-listener/app/container.py (build_emit_confirm_action_tool wired, knowledge_graph=knowledge_repo)
- FOUND commit 62a9c34 (Task 1 — migration 0030 + journal entry + live-verify)
- FOUND commit c2f6d6f (Task 2 — tool schema + pure helpers)
- FOUND commit 600618f (Task 3 — RunChatTurn/container wiring + tests)
