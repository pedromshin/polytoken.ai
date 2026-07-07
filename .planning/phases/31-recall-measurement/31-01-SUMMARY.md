---
phase: 31-recall-measurement
plan: 01
subsystem: autofill
tags: [autofill, few-shot, prompt-injection-defense, entity-resolution, recall]
dependency-graph:
  requires:
    - EntityInstanceRepository.find_selected_instance_for_component (Phase 29-03)
    - EntityInstanceRepository.find_unselected_candidate_instances_for_component (Phase 30-01)
    - AutofillUseCase / AutofillProtocol / AnthropicAutofiller (04-08 few-shot retrieval spine)
  provides:
    - AnthropicAutofiller few-shot example rendering (<example> blocks in the user turn)
    - AnthropicAutofiller entity_context rendering (<known_entity_context> block, aliases + identifiers)
    - AutofillProtocol.autofill entity_context kwarg
    - AutofillUseCase._resolve_entity_context (best-effort resolved-entity read)
  affects:
    - apps/email-listener/app/container.py (_provide_autofill_use_case now wires EntityInstanceRepository)
tech-stack:
  added: []
  patterns:
    - "Untrusted region-equivalent content (examples, aliases, identifiers) rendered ONLY in the user
       turn inside dedicated XML-style delimiters (<example>, <known_entity_context>) — system prompt
       stays schema+KB only (D-14 structural defense extended, not modified)"
    - "Best-effort entity read (try/except log-and-swallow) mirrors the confirm_region.py synthesis-hook
       convention: an entity_instances read failure never breaks the primary flow"
    - "Defensive size cap (_MAX_RENDERED_ALIASES=20) on injected untrusted content, mirroring the
       cost-guard posture used elsewhere in the codebase (T-31-03)"
key-files:
  created:
    - apps/email-listener/tests/test_autofill_adapter_examples.py
    - apps/email-listener/tests/test_autofill_entity_context.py
  modified:
    - apps/email-listener/app/infrastructure/llm/autofill_adapter.py
    - apps/email-listener/app/domain/ports/autofill_protocol.py
    - apps/email-listener/app/application/use_cases/autofill.py
    - apps/email-listener/app/container.py
    - apps/email-listener/tests/test_autofill_use_case.py
decisions:
  - "Delimiter choice: <example> per retrieved example (content + extracted_fields) and one aggregate
     <known_entity_context> block wrapping <aliases>/<identifiers> sub-blocks — mirrors the existing
     <document_content> delimiter discipline already proven safe against injection in this adapter."
  - "Alias cap = 20 (module constant _MAX_RENDERED_ALIASES), applied via a plain slice — deliberately
     simple over a token-budget-aware truncation, since demo-volume entity instances rarely approach it."
  - "Entity resolution order: selected link first (find_selected_instance_for_component), then the
     first unselected candidate (find_unselected_candidate_instances_for_component) as a weaker-signal
     fallback — matches the phase CONTEXT's explicit source-of-truth ordering."
  - "routing_reason stays driven exclusively by `examples` (few_shot_autofill vs cold_start_autofill) —
     entity_context injection is deliberately NOT wired into routing_reason, per the plan's explicit
     'do NOT change the routing_reason derivation' instruction."
metrics:
  duration_minutes: 35
  completed: 2026-07-07
---

# Phase 31 Plan 01: Recall & Measurement — Cheap Recall Win (RECALL-01) Summary

Closed the verified few-shot rendering gap (`AnthropicAutofiller` accepted `examples` but never rendered
them into the Bedrock messages) and added the resolved entity's `aliases[]`/`identifiers` as a delimited
"known entity context" block in the same user turn — a direct `entity_instances` read via the existing
suggest-only link paths, zero BFS/graph traversal, zero new migrations.

## What Was Built

**Task 1 — Few-shot + entity-context rendering in the adapter.** Added two pure user-turn content
builders to `autofill_adapter.py`: `_render_examples_block` (wraps each example's `content_text` +
`extracted_fields` in an `<example>` block, aggregated inside `<few_shot_examples>`) and
`_render_entity_context_block` (wraps aliases + identifiers in `<aliases>`/`<identifiers>` sub-blocks
inside `<known_entity_context>`, capped at `_MAX_RENDERED_ALIASES=20`). `_generate` appends both blocks
to `user_content` only when non-empty — the cold-start form (`examples=()`, `entity_context=None`) stays
byte-identical to the pre-change single-message form (regression-guarded by an exact-string test).
`AutofillProtocol.autofill` gained the `entity_context: dict[str, object] | None = None` kwarg with an
updated docstring describing the untrusted-content/user-turn-only contract. 12 tests in
`test_autofill_adapter_examples.py` (new) + `test_autofill_adapter.py` (unchanged, still green) cover:
example content in the user message, example content absent from `system`, entity-context content in
the user message, entity-context content absent from `system`, alias-cap enforcement, and two cold-start
regression guards (byte-identical unchanged form; an empty-but-present `entity_context` dict omits the
block entirely).

**Task 2 — Best-effort resolved-entity read wired into the use case.** `AutofillUseCase` gained an
optional `entity_instances: EntityInstanceRepository | None` constructor param and a new
`_resolve_entity_context` private method: reads `find_selected_instance_for_component(component_id)`
first, falls back to the first result of `find_unselected_candidate_instances_for_component(component_id)`
when no selected link exists, and returns `{"aliases": [...], "identifiers": {...}}` (or `None`) — all
inside a try/except that logs a warning and returns `None` on any failure (mirrors the
`confirm_region.py` synthesis-hook best-effort posture). `execute` calls this after `importer_id` is
derived (so the read is implicitly scoped to the component's own tenant — no importer_id is ever passed
across a tenant boundary) and forwards the result as `entity_context=` to `self._autofiller.autofill(...)`.
`routing_reason` derivation is untouched (still driven solely by `examples`). Logs
`autofill_entity_context_injected` with `entity_instance_id`/alias+identifier counts (the Plan 31-02
instrumentation hook this phase's second half will consume). `container.py::_provide_autofill_use_case`
now takes `entity_instances: EntityInstanceRepository` and passes it through (the binding already existed
in the container for other use cases). 6 new tests in `test_autofill_entity_context.py` cover: selected-
link injection, candidate-fallback injection, no-resolution → `entity_context=None` with unaffected
`routing_reason`, entity-repo-raises best-effort isolation (execute still completes,
`autofiller.autofill` still called), no-port-injected omission, and a tenant-scoping documentation test.

**Refactor (in-scope, required for the ruff `PLR0915` too-many-statements gate):** extracted the
resolved-entity read into `_resolve_entity_context` rather than inlining it in `execute` — `execute` was
already near the 50-statement ruff ceiling before this plan; inlining the new ~20-line block would have
exceeded it. This is a pure extraction (no behavior change) required to keep the existing quality gate
green, not a plan deviation.

## Deviations from Plan

**1. [Rule 1/3 — pre-existing test signature drift] Updated `FakeAutofiller.autofill` in
`test_autofill_use_case.py`.** Not in the plan's `files_modified` list, but adding the `entity_context`
kwarg to `AutofillProtocol.autofill` broke 4 pre-existing tests in `test_autofill_use_case.py` (their
`FakeAutofiller.autofill` signature didn't accept the new kwarg → `TypeError`). Fixed by adding the same
`entity_context: dict[str, object] | None = None` param to the fake, mirroring the real protocol
extension. All 7 tests in that file pass afterward; no test assertions were weakened.

**2. [Rule 3 — blocking lint gate] Extracted `_resolve_entity_context` as a private method.** `ruff`'s
`PLR0915` (too-many-statements, ceiling 50) fired when the entity-context read was inlined directly into
`execute` (52 statements). Extracted into a dedicated method — pure refactor, same behavior, all tests
still pass.

No architectural changes; no Rule 4 checkpoints triggered.

## Commits

- `f54fade` — feat(31-01): render few-shot examples + known-entity-context in autofill prompt (Task 1)
- `816ee5f` — feat(31-01): inject resolved entity aliases/identifiers into autofill (RECALL-01) (Task 2)

## Verification

- `pytest tests/test_autofill_adapter_examples.py tests/test_autofill_entity_context.py
  tests/test_autofill_adapter.py tests/test_autofill_use_case.py` — 25/25 pass.
- Full email-listener test suite (`pytest tests/`, excluding the known pre-existing
  `test_genui_retrieval_provider.py` flake) — all green, zero regressions.
- `ruff check` clean on all edited files; `mypy` clean on `autofill_adapter.py`,
  `autofill_protocol.py`, `autofill.py`, `container.py` (container.py's 12 pre-existing transitive
  mypy errors in unrelated files — e.g. `genui_generator_adapter.py`,
  `supabase_ui_spec_template_repository.py` — are the same pre-existing, already-logged class first
  documented in 25-02-SUMMARY.md; none are in files this plan touched).
- `lint-imports` clean (3/3 contracts kept — the use case still imports domain-only).
- `grep -n "entity_context=" apps/email-listener/app/application/use_cases/autofill.py` → 1 hit
  (the kwarg passed to `self._autofiller.autofill`).
- `grep -n "knowledge_node_edges"` on both edited application/infrastructure files → 0 hits (no
  graph-edge/BFS reference introduced).

## TDD Gate Compliance

Both tasks were TDD-flagged (`tdd="true"`). Implementation and its test suite were authored together in
this session (not a strict separately-committed RED→GREEN sequence — each task's test file was verified
failing against the pre-change adapter/use-case logic during development, then committed together with
the passing implementation in a single commit per task, consistent with this plan's tight
implementation↔test coupling). Final state: all new + pre-existing tests green; no REFACTOR-only commit
was needed beyond the in-task `_resolve_entity_context` extraction described above.

## Self-Check: PASSED

- FOUND: apps/email-listener/app/infrastructure/llm/autofill_adapter.py (entity_context + examples rendering)
- FOUND: apps/email-listener/app/domain/ports/autofill_protocol.py (entity_context kwarg)
- FOUND: apps/email-listener/app/application/use_cases/autofill.py (_resolve_entity_context)
- FOUND: apps/email-listener/app/container.py (_provide_autofill_use_case entity_instances wiring)
- FOUND: apps/email-listener/tests/test_autofill_adapter_examples.py
- FOUND: apps/email-listener/tests/test_autofill_entity_context.py
- FOUND: commit f54fade
- FOUND: commit 816ee5f
- Verified: 25/25 targeted tests pass; full suite green; ruff/mypy/lint-imports clean on touched files.
