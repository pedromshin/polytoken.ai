---
phase: 40-confirm-action-widgets
plan: 02
subsystem: chat-widget-tools
tags: [confirm-action-submit, edge-tier-staleness, dispatch-table, CONF-02, promote-edge-provenance]
dependency_graph:
  requires:
    - "app.application.use_cases.run_chat_turn_confirm_action.SUGGESTION_KIND_EDGE_TIER_PROMOTION/SUGGESTION_KIND_ENTITY_MERGE_CONFIRM (Plan 40-01)"
    - "app.application.use_cases.promote_edge.PromoteEdgeUseCase (v1.5, Phase 30-02)"
    - "app.domain.ports.knowledge_graph_repository.KnowledgeGraphRepository.find_edge_by_id (v1.5, unchanged)"
    - "app.application.use_cases.submit_widget_interaction.SubmitWidgetInteraction (Phase 24-02, ordering spine)"
  provides:
    - "app.application.use_cases.confirm_action_dispatch (ConfirmActionHandler Protocol, KnowledgeEdgeTierPromotionHandler, UnsupportedConfirmActionHandler)"
    - "PromoteEdgeUseCase.execute(mechanism=, extra=) — additive chat-confirm provenance"
    - "SubmitWidgetInteraction's confirm_action edge-tier staleness re-check + post-CAS dispatch (knowledge_graph/confirm_action_dispatch constructor params)"
    - "compact-interaction-entry.tsx's confirm_action -> ProposalSummary routing"
  affects:
    - "Phase 41 (Knowledge-Preview Canvas Node): none directly — this closes v1.6's CONF track"
    - "any future chat-confirm widget kind: the 2-entry dispatch table is the extension point (register a new ConfirmActionHandler)"
tech_stack:
  added: []
  patterns:
    - "Fail-closed live re-read before mutation: the confirm_action staleness check wraps find_edge_by_id in try/except Exception, collapsing a DB hiccup into the SAME 'stale' rejection as an actual tier mismatch — never leaks a raw exception, mirrors _finalize_confirm_action's (Plan 40-01) identical fail-closed convention on the emission side"
    - "Best-effort post-CAS dispatch: the confirm/reject use-case call happens strictly AFTER try_submit succeeds, wrapped in a bare except Exception that only logs — the interaction row's own CAS state is the durable outcome; a dispatch failure never re-raises past a submitted turn"
    - "Explicit finite dispatch table keyed server-side: dict.get(kind) where kind comes from the STORED declaration (server-authored at Plan 40-01 emission time), never from client-supplied submit data — an unregistered kind resolves to None/no-op, never a raw KeyError or dynamic lookup (T-40-06)"
    - "Additive provenance kwargs: PromoteEdgeUseCase.execute(mechanism=, extra=) preserves byte-identical default behavior for every existing caller — the same idiom RunChatTurn/ToolExecutor collaborators use for additive constructor params"
key_files:
  created:
    - apps/email-listener/app/application/use_cases/confirm_action_dispatch.py
    - apps/email-listener/app/application/use_cases/__tests__/test_confirm_action_dispatch.py
  modified:
    - apps/email-listener/app/application/use_cases/promote_edge.py
    - apps/email-listener/tests/test_promote_edge.py
    - apps/email-listener/app/application/use_cases/submit_widget_interaction.py
    - apps/email-listener/app/application/use_cases/__tests__/test_submit_widget_interaction.py
    - apps/email-listener/app/container.py
    - apps/web/src/app/chat/_components/compact-interaction-entry.tsx
    - apps/web/src/app/chat/_components/__tests__/compact-interaction-entry.test.tsx
decisions:
  - "SubmitWidgetInteraction.__init__ gained knowledge_graph as a REQUIRED keyword-only param (no default), while confirm_action_dispatch defaults to an empty mapping — knowledge_graph is a genuine, always-available production collaborator (container.py always wires it), so a missing default cannot silently produce a broken confirm_action path; only 2 call sites exist (container.py, the test file), both updated by this plan"
  - "Imported SUGGESTION_KIND_EDGE_TIER_PROMOTION from Plan 40-01's run_chat_turn_confirm_action.py rather than redefining the string locally — the plan's interfaces section explicitly said 'import from here, do not redefine'; import-linter confirms app.application -> app.application is unrestricted (only app.application -> app.infrastructure is forbidden)"
  - "container.py's _provide_submit_widget_interaction instantiates its OWN SupabaseKnowledgeGraphRepository(client=client) rather than reusing _provide_run_chat_turn's local knowledge_repo variable — confirmed via grep that no shared DI singleton for KnowledgeGraphRepository exists anywhere in this codebase; every one of the 3 factories that needs one (_provide_confirm_region_use_case, _provide_promote_edge_use_case, _provide_run_chat_turn) already instantiates its own, so this plan's factory mirrors that established pattern exactly rather than deviating from it"
  - "_reject_if_confirm_action_edge_stale/_dispatch_confirm_action extracted as private methods on SubmitWidgetInteraction rather than inlined in prepare() — Claude's Discretion per the plan; source ordering (staleness strictly before try_submit, dispatch strictly after) is preserved and verified by a dedicated ordering test, matching the plan's 'source ordering, not just test-proven' acceptance criterion"
metrics:
  duration: "~50 min"
  completed: 2026-07-09
---

# Phase 40 Plan 02: Confirm-Action Widgets — Edge-Tier Staleness Re-Check + Dispatch Table Summary

Closes CONF-02: submitting a `confirm_action` widget now re-checks the referenced
`knowledge_node_edges` row's LIVE tier against the declaration's frozen `tierSnapshot`
BEFORE any interaction-row mutation, rejecting with `WidgetSubmitRejected(reason="stale")`
if the edge was promoted or deactivated out-of-band (another chat, the `/knowledge` canvas,
a plain REST promote). Confirm dispatches through the v1.5 `promote_edge` path recording
`chat_confirm_action` provenance distinct from `human_promote`; reject never mutates the
edge at all — the interaction row's own submitted value is the durable audit record.

## What Was Built

### Task 1 — PromoteEdgeUseCase provenance extension + confirm_action_dispatch handlers

`promote_edge.py`: `PromoteEdgeUseCase.execute` gained two keyword-only params,
`mechanism: str = "human_promote"` and `extra: dict[str, object] | None = None`. The
`promotion` dict construction became `{"promoted_at": ..., "from_tier": ..., "mechanism":
mechanism, **(extra or {})}` — every existing caller that omits both gets the EXACT same
dict as before (proven by a new test asserting `set(promotion.keys()) == {"promoted_at",
"from_tier", "mechanism"}`). A chat confirm dispatch passes `mechanism="chat_confirm_action"`
+ `extra={"widget_interaction_id": ...}`, producing a promotion record distinguishable from
a plain REST `human_promote`.

New `confirm_action_dispatch.py` (application layer, zero infrastructure import):
`ConfirmActionHandler` Protocol (`execute(*, action, suggestion_id, importer_id,
widget_interaction_id) -> dict`); `KnowledgeEdgeTierPromotionHandler` wraps
`PromoteEdgeUseCase` — `reject` returns `{"status": "rejected"}` immediately and never
touches `self._promote_edge` at all (audit-on-the-row convention: the interaction row's own
`submitted_value`, already CAS-persisted before this handler ever runs, IS the durable
rejection record); `confirm` calls `promote_edge.execute(mechanism="chat_confirm_action",
extra={"widget_interaction_id": ...})`, catching `EdgeNotFound`/`EdgeNotPromotable` and
returning `{"status": "promote_failed"}` — NEVER re-raises (this runs after the interaction
row's own CAS already succeeded; the turn must complete cleanly). `UnsupportedConfirmActionHandler`
is the registered-but-unsupported stub for `entity_merge_confirm` (40-CONTEXT.md's confirmed
pair-keyed blocker — `component_entity_candidate_links` is addressed by `(entity_instance_id,
target_id)`, not a single id, so `curate_entity_merge.ConfirmMergeUseCase` cannot be wrapped
without inventing a surrogate key, explicitly out of scope this phase) — it never raises,
always returns `{"status": "unsupported", "reason": ...}`.

16 tests (10 existing `test_promote_edge.py` unmodified + 2 new mechanism/extra cases + 6
new dispatch-handler tests covering confirm-success, confirm-catches-EdgeNotPromotable,
confirm-catches-EdgeNotFound, reject-never-calls-promote_edge, and both unsupported-handler
action variants).

### Task 2 — CONF-02 staleness re-check + dispatch wiring in SubmitWidgetInteraction + container

`submit_widget_interaction.py`: `SubmitWidgetInteraction.__init__` gained
`knowledge_graph: KnowledgeGraphRepository` (required) and
`confirm_action_dispatch: Mapping[str, ConfirmActionHandler] = MappingProxyType({})`
(defaulted). `prepare()`'s ordering: immediately after the existing turn-staleness check (step
2) and BEFORE schema re-validation (step 3), a new confirm_action-scoped edge-tier staleness
re-check runs (`_reject_if_confirm_action_edge_stale`) — no-op for every other `widget_kind`,
and a no-op for a confirm_action whose `suggestionRef.kind` isn't
`knowledge_edge_tier_promotion` (defensive skip for an unregistered kind). When the kind
matches, it awaits `find_edge_by_id` wrapped in `try/except Exception` (a DB hiccup collapses
to the same outcome as a real mismatch — fail-closed), then raises
`WidgetSubmitRejected("stale", ...)` when the edge is missing, inactive, or its live `tier`
no longer equals the declaration's `tierSnapshot`. The already-fetched edge dict is threaded
through (not re-fetched) to the post-CAS dispatch step. Immediately after `try_submit`
succeeds (the CAS lock, step 4), `_dispatch_confirm_action` resolves the confirm/reject use
case from the STORED declaration's `suggestionRef.kind` via `self._confirm_action_dispatch.get(kind)`
— an unregistered kind or a kind with no wired handler is a silent no-op — and awaits
`handler.execute(action=..., suggestion_id=..., importer_id=<from the already-fetched edge>,
widget_interaction_id=interaction.id)` inside a bare `try/except Exception` that only logs;
`importer_id` is derived from the loaded edge row, never a new caller-supplied param on
`prepare()` itself (`prepare()`'s public signature — `conversation_id`/`interaction_id`/
`result`/`model_id` — stays byte-identical). `_resolve_summary`'s `proposal_cards` branch
condition became `interaction.widget_kind in ("proposal_cards", "confirm_action")` — the
body (option-id-to-title lookup) is reused verbatim.

`container.py`: `_provide_submit_widget_interaction` gained `client: Client` and
`promote_edge_use_case: PromoteEdgeUseCase` (the latter already DI-registered, reused via
injection). Instantiates its own `SupabaseKnowledgeGraphRepository(client=client)` (mirrors
the established pattern in `_provide_confirm_region_use_case`/`_provide_promote_edge_use_case`/
`_provide_run_chat_turn` — no shared DI singleton for `KnowledgeGraphRepository` exists
anywhere in this codebase, confirmed by grep) and builds the explicit 2-entry
`confirm_action_dispatch` dict keyed by `SUGGESTION_KIND_EDGE_TIER_PROMOTION`/
`SUGGESTION_KIND_ENTITY_MERGE_CONFIRM` (imported from Plan 40-01's
`run_chat_turn_confirm_action.py`, not redefined).

New `FakeKnowledgeGraphRepository`/`FakeConfirmActionHandler` test doubles + `_make_use_case`
extended with optional `knowledge_graph`/`confirm_action_dispatch` params (sensible defaults
— every existing proposal_cards/clarify_widget test keeps working with zero edits, verified:
all 10 pre-existing tests pass unmodified). 7 new tests:

- **THE MUST-TEST** (`test_confirm_action_stale_when_edge_tier_promoted_out_of_band`): a
  pending confirm_action interaction with `tierSnapshot == "INFERRED"`; the fake
  `KnowledgeGraphRepository.find_edge_by_id` returns an edge with `tier == "EXTRACTED"`
  (simulating v1.5's REST promote_edge path having already fired out-of-band). Submitting
  `{"optionId": "confirm"}` raises `WidgetSubmitRejected(reason="stale")`. Asserts
  `try_submit` was NEVER called (zero interaction-row mutation) AND the dispatch handler's
  `execute` was NEVER called (zero edge double-mutation) AND zero messages inserted AND zero
  continuation events.
- `test_confirm_action_stale_when_edge_deactivated_out_of_band` — same shape, `is_active=False`.
- `test_confirm_action_stale_when_edge_lookup_raises` — a DB error during the live read is
  fail-closed to `stale`, never leaked.
- `test_confirm_action_non_stale_confirm_dispatches_and_yields_continuation` — matching tier,
  `try_submit` called once, dispatch `execute(action="confirm", suggestion_id="edge-1",
  importer_id="imp-1", widget_interaction_id="int-confirm-1")` called exactly once, summary
  `{"chosenTitle": "Confirm"}`, continuation events yielded.
- `test_confirm_action_non_stale_reject_dispatches_and_never_mutates_edge` — dispatch
  `execute(action="reject", ...)` called once, summary `{"chosenTitle": "Reject"}`.
- `test_confirm_action_unregistered_suggestion_kind_never_crashes` — an unknown
  `suggestionRef.kind` skips the staleness re-check (`find_edge_by_id` never called) and the
  dispatch lookup resolves to a safe no-op — submit still succeeds, zero exceptions.
- `test_confirm_action_ordering_edge_staleness_check_before_cas_lock` — source-ordering
  proof mirroring the pre-existing `test_ordering_is_stale_check_before_cas_lock`.

17/17 green (10 unmodified regression + 7 new). mypy clean on both touched files (the
transitive whole-tree run surfaces the SAME 12 pre-existing errors in 4 unrelated
infrastructure files Phase 36-02/37-02/40-01 already documented — zero new errors). ruff
clean. `lint-imports`: 3 kept, 0 broken. `test_container.py` (14/14) confirms the DI graph
resolves the new required `knowledge_graph`/`confirm_action_dispatch` params correctly;
`test_chat_widget.py` (10/10) endpoint regression green.

### Task 3 — compact transcript summary renders confirm_action via ProposalSummary

`compact-interaction-entry.tsx`: the widgetKind check became
`widgetKind === "proposal_cards" || widgetKind === "confirm_action"` — `ProposalSummary`,
`ClarifySummary`, `BUBBLE_CLASS` all untouched. Module docstring updated to document
confirm_action's reuse of the identically-shaped `{chosenTitle}` summary. New vitest case
asserts a `confirm_action` summary renders `Selected "Confirm"` via `ProposalSummary` (not
the clarify key-value-list `<dl>` path). `interactive-widget-boundary.tsx` — confirmed by
`git diff --stat` — has ZERO diff: `isClarify = part.widgetKind === "clarify_widget"`
already routes confirm_action into the (unmodified) proposal-card live-rendering branch.

## Verification

```
cd apps/email-listener && uv run pytest tests/test_promote_edge.py \
  app/application/use_cases/__tests__/test_confirm_action_dispatch.py \
  app/application/use_cases/__tests__/test_submit_widget_interaction.py -v --no-cov
# 33 passed

cd apps/email-listener && uv run pytest tests/application/ app/application/use_cases/__tests__/ \
  tests/test_container.py app/presentation/api/v1/__tests__/test_chat_widget.py \
  tests/test_promote_edge.py --no-cov
# 307 passed, 0 failed (full regression sweep — chat-turn/container/widget-submit surface)

cd apps/email-listener && uv run mypy app/application/use_cases/submit_widget_interaction.py app/container.py
# 0 errors in either touched file (12 pre-existing errors in 4 unrelated infrastructure
# files, unchanged from Phase 36-02/37-02/40-01's documented baseline)

cd apps/email-listener && uv run ruff check app/application/use_cases/promote_edge.py \
  app/application/use_cases/confirm_action_dispatch.py app/application/use_cases/submit_widget_interaction.py \
  app/container.py app/application/use_cases/__tests__/test_confirm_action_dispatch.py \
  app/application/use_cases/__tests__/test_submit_widget_interaction.py tests/test_promote_edge.py
# All checks passed!

cd apps/email-listener && uv run lint-imports
# Contracts: 3 kept, 0 broken

cd apps/web && npx vitest run src/app/chat/_components/__tests__/compact-interaction-entry.test.tsx
# 4 passed

cd apps/web && npm run typecheck
# tsc --noEmit -- clean

git diff --stat -- apps/web/src/app/chat/_components/interactive-widget-boundary.tsx
# (empty — zero diff, confirmed)
```

## Deviations from Plan

None architectural (no Rule 4 triggers). Two minor, both documented above under `decisions`:

**1. [Claude's Discretion] Extracted the staleness check + dispatch call into private
methods** (`_reject_if_confirm_action_edge_stale`/`_dispatch_confirm_action`) rather than
inlining directly in `prepare()`. The plan's action text described the logic inline; keeping
`prepare()` itself readable while still satisfying "source ordering, not just test-proven"
(the staleness check is called strictly before `try_submit`; the dispatch call strictly
after) was judged the better implementation shape. No behavioral difference — verified by
the dedicated ordering test.

**2. [Claude's Discretion] Imported `SUGGESTION_KIND_EDGE_TIER_PROMOTION` from Plan 40-01's
`run_chat_turn_confirm_action.py`** rather than defining a local module-level string
constant, per the plan's interfaces section explicit instruction ("import from here, do not
redefine"). Confirmed via `pyproject.toml`'s `[tool.importlinter]` contracts that
`app.application -> app.application` imports are unrestricted (only `app.application ->
app.infrastructure/app.presentation` is forbidden) — `lint-imports` confirms 3 kept, 0
broken after the import.

No auth gates encountered. No interface drift beyond what 40-01-SUMMARY.md already
documented (the `knowledge_graph` DI-instantiation pattern this plan mirrors was itself the
one deviation 40-01 recorded).

## Known Stubs

None. `entity_merge_confirm`'s `UnsupportedConfirmActionHandler` is an intentional,
documented stub (40-CONTEXT.md's confirmed pair-keyed blocker) — not reachable via the
`emit_confirm_action` tool's own JSON schema (Plan 40-01 restricts `suggestionRef.kind` to a
single enum value), registered ONLY so the dispatch table has its full 2 entries and a
lookup by kind never raises a raw KeyError. This is Plan 40-02's own scope decision, not a
deferred stub — the surrogate-key question for entity-merge-via-chat is out of scope for
v1.6 per 40-CONTEXT.md's deferred-ideas list.

## Threat Flags

None beyond the plan's own `<threat_model>` register (T-40-05..08, all addressed as
designed): T-40-05 (out-of-band edge mutation racing a pending confirm-action) — mitigated
by the new staleness re-check, proven by the MUST-test; T-40-06 (use-case resolution from a
`kind` string) — mitigated by the explicit finite server-built dispatch table, `kind` sourced
only from the STORED declaration; T-40-07 (residual staleness-check-to-CAS race) — accepted,
`promote_edge`'s own independent CAS is the second guard, a race loser is caught and logged
by `KnowledgeEdgeTierPromotionHandler`, never crashes the turn; T-40-08 (no per-user
attribution) — accepted, matches REQUIREMENTS.md's documented single-shared-API-key
out-of-scope decision.

## Self-Check: PASSED

- FOUND: apps/email-listener/app/application/use_cases/confirm_action_dispatch.py
- FOUND: apps/email-listener/app/application/use_cases/__tests__/test_confirm_action_dispatch.py
- FOUND: apps/email-listener/app/application/use_cases/promote_edge.py (mechanism/extra kwargs)
- FOUND: apps/email-listener/tests/test_promote_edge.py (2 new kwarg-cases + 10 unmodified)
- FOUND: apps/email-listener/app/application/use_cases/submit_widget_interaction.py (confirm_action staleness + dispatch)
- FOUND: apps/email-listener/app/application/use_cases/__tests__/test_submit_widget_interaction.py (7 new + 10 unmodified)
- FOUND: apps/email-listener/app/container.py (_provide_submit_widget_interaction wiring)
- FOUND: apps/web/src/app/chat/_components/compact-interaction-entry.tsx (confirm_action routing)
- FOUND: apps/web/src/app/chat/_components/__tests__/compact-interaction-entry.test.tsx (new confirm_action case)
- FOUND commit 160c453 (Task 1 — promote_edge provenance + confirm_action_dispatch handlers)
- FOUND commit c96f47a (Task 2 — CONF-02 staleness re-check + dispatch wiring)
- FOUND commit 827a265 (Task 3 — compact transcript summary web fix)
- CONFIRMED: apps/web/src/app/chat/_components/interactive-widget-boundary.tsx has ZERO diff
