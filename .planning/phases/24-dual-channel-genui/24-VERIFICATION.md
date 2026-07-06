---
phase: 24-dual-channel-genui
verified: 2026-07-05T00:00:00Z
status: human_needed
score: 12/12 must-haves verified
overrides_applied: 0
requirements_coverage:
  DCUI-01: satisfied
  DCUI-02: satisfied
  DCUI-03: satisfied
  DCUI-04: satisfied
human_verification:
  - test: "Click through a live proposal-card widget in an actual running browser (dev server, real pointer clicks, not jsdom)"
    expected: "Card group renders, click disables the group + shows Submitting…, chosen card locks with ring+Selected badge, others dim, compact 'Selected \"{title}\"' entry appears in transcript, same state reflected in the canvas panel"
    why_human: "Visual rendering, cross-browser CSS, and real pointer-event UX cannot be fully confirmed by jsdom-based vitest mounts alone"
  - test: "Click through a live clarify-widget (form) round-trip in an actual running browser"
    expected: "Form renders via the Phase-19 engine, fill+submit locks to the 'Your response' + Submitted badge + key-value-list view, a 422 (e.g. clearing a required field via devtools before submit) re-enables the form with the inline error row"
    why_human: "Same class as above — real DOM/browser rendering and interaction, not mechanically provable from jsdom mounts"
  - test: "End-to-end round-trip against a real AWS Bedrock model: agent calls emit_proposal_cards or emit_clarify_widget, turn ends, user submits, continuation streams a real model response"
    expected: "The full stack (Next -> FastAPI -> Bedrock -> FastAPI -> Next) round-trips a genuine model-authored widget and a genuine continuation turn, not a fake/test provider"
    why_human: "No live-Bedrock test is part of this phase's automated suite (consistent with this project's existing EVAL-LIFT/ISO-RUN deferred-verification convention); the mechanism is proven end-to-end against fake/test providers and a real Supabase-backed CAS lock, but a live model call was not exercised during this verification pass"
---

# Phase 24: Dual-Channel GenUI Verification Report

**Phase Goal:** The agent and user can exchange interactive widgets in both directions — proposal
cards and clarify-widgets — with every round-trip safely re-validated, double-submit-locked,
staleness-signaled, and requiring explicit user action; genui turns and widget interactions persist
in the conversation history and canvas.

**Verified:** 2026-07-05
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `chat_widget_interactions` table exists with state machine, stored schema, staleness columns, RLS deny-all (migration 0025) | VERIFIED | `packages/db/migrations/0025_chat_widget_interactions.sql` read directly: `CREATE TABLE IF NOT EXISTS`, CHECK on `widget_kind IN ('proposal_cards','clarify_widget')`, CHECK on `state IN ('pending','submitted','superseded','stale')`, both FKs (cascade), unique index on `(message_id, part_index)`, index on `conversation_id`, RESTRICTIVE deny-all RLS for `anon`+`authenticated`. Drizzle schema (`chat-widget-interactions.ts`) mirrors it; barrel export confirmed in `schema/index.ts`; journal entry `0025_chat_widget_interactions` confirmed present after `0024`. |
| 2 | Server-side re-validation against the STORED schema, never client-supplied (D-10) | VERIFIED | `widget_result_validator.py::validate_result_against_schema` uses `jsonschema.Draft7Validator` against a `schema` param the caller must supply; `submit_widget_interaction.py`'s `prepare()` loads `interaction.declared_response_schema` (the STORED row value, fetched via `widget_interactions.get(interaction_id)`) and passes THAT into the validator — never anything from the request body. Fail-closed on empty/malformed schema, generic non-leaking `reason` string (verified in source). |
| 3 | DB-level compare-and-swap double-submit lock returns 409 on a second submit | VERIFIED | `SupabaseChatWidgetInteractionRepository.try_submit` issues `.update({...}).eq("id", interaction_id).eq("state", "pending").execute()` and returns `len(result.data) == 1` — a second call matches zero rows. `submit_widget_interaction.py` raises `WidgetSubmitRejected("conflict", ...)` when `try_submit` returns False; `chat_widget.py` maps `conflict -> 409` in `_REJECTION_STATUS`. |
| 4 | Turn-bound staleness rejected with 409 before the lock (D-12) | VERIFIED | `is_stale` queries `chat_messages` for the emitting row's `is_active` flag and any strictly-newer `turn_index` in the conversation. `submit_widget_interaction.py`'s `prepare()` calls `is_stale` BEFORE `try_submit` (fixed step order 1→2→3→4, confirmed by direct code read) and raises `WidgetSubmitRejected("stale", ...)` → mapped to 409. |
| 5 | Order of checks: ownership(404) → staleness(409) → schema(422) → CAS(409) → persist → continuation | VERIFIED | `submit_widget_interaction.py::prepare()` body reads exactly in that sequence; confirmed line-by-line (`get`→ownership check, `is_stale`, `validate_result_against_schema`, `try_submit`, `_resolve_summary` + `insert_message`, `continue_after_widget`). |
| 6 | `emit_proposal_cards` AND `emit_clarify_widget` tools exist, each ends the turn with a pending row | VERIFIED | `chat_tools.py` defines both `build_emit_proposal_cards_tool()` and `build_emit_clarify_widget_tool()`, both `type:"object"`/`additionalProperties:false`/load-time-asserted. `run_chat_turn_widgets.py::INTERACTIVE_WIDGET_TOOL_NAMES` includes both; `_finalize_pending_tool` branches on tool name to build an `interactive_widget` part (never a `genui_spec` part) for either. `_execute_turn` calls `provider.stream()` exactly ONCE per turn (no internal re-invocation loop after a tool call) — confirmed by reading the full `_execute_turn` body; the model's own `StreamEnd` naturally ends the turn. `_persist_and_finish` creates exactly one pending `chat_widget_interactions` row via `build_create_pending_kwargs` (picks the FIRST interactive_widget part — D-04). |
| 7 | `emit_clarify_widget`'s response schema is server-derived, requires non-empty `submitLabel` | VERIFIED | `_CLARIFY_WIDGET_INPUT_SCHEMA["properties"]["submitLabel"] == {"type":"string","minLength":1}`, `required:["submitLabel","fields"]`, load-time `assert`ed. `run_chat_turn_widgets.py::derive_declared_response_schema`/`_derive_clarify_response_schema` computes the schema server-side from `fields` (enum for select/radio, boolean for checkbox, number/string otherwise, `required[]`) — the model's tool input_schema has no `declared_response_schema` field at all. |
| 8 | `POST /v1/chat/widget/submit` + Next proxy + tRPC `getWidgetInteractions`; valid non-stale submit persists `interaction_result` turn + streams continuation over existing SSE (no held-open stream) | VERIFIED | `chat_widget.py` router registered in `main.py`; `prepare()` runs all rejection checks BEFORE `StreamingResponse` is constructed (confirmed: `try/except WidgetSubmitRejected` wraps only `prepare()`, not the stream). `apps/web/src/app/api/chat/widget/submit/route.ts` proxies with server-only `EMAIL_LISTENER_API_KEY`, passes 404/409/422 through with `reason` (not flattened to 502). `chat.getWidgetInteractions` registered in `packages/api-client/src/router/chat/index.ts`. Continuation reuses `continue_after_widget` → `_execute_turn` (same SSE transport, no separate held-open stream — the widget POST is a fresh request that starts a NEW stream). |
| 9 | Both widget kinds render through the UNMODIFIED SpecRenderer (last commit ecc7a46) via deterministic builders + the 23-06 ActionRegistry contract; `bare` variant present and used by canvas | VERIFIED | `git log -1 --oneline -- packages/genui/src/renderer/spec-renderer.tsx` → `ecc7a46` (unchanged); `git status --porcelain` on that file is empty. `genui-part-boundary.tsx` has `variant?: "default"\|"bare"` routed through an internal `Wrapper` at all four return paths (finalized/streaming-full-parse/streaming-partial/skeleton) — read in full, confirmed. `genui-panel-node.tsx` passes `variant="bare"` at both the `interactive_widget` (`InteractiveWidgetBoundary`) and `genui_spec` (`GenuiPartBoundary`) call sites. `buildProposalCardsSpec`/`buildClarifyWidgetSpec` emit `onClick`/`onSubmit` actions consumed via the existing `setState` ActionRegistry seam (`ButtonComponent`/`FormComponent`, both otherwise unmodified except the additive `{...onSubmit, values}` spread confirmed in `form-component.tsx` line 239). |
| 10 | Transcript AND canvas render the same widget from ONE message-part source of truth (D-08) | VERIFIED | `genui-panel-node.tsx`'s `GenuiPanelNodeBody` reads `controller?.widgets.states/submittedValues/errorMessages` and calls `controller?.widgets.onSubmitResult` — the SAME `widgets` surface `message-turn.tsx` reads for the transcript branch. Both are built once in `use-conversation-controller.ts`'s single `useMemo` over `widgetInteractions`/`historyRows`/`supersededLocally`/`inFlightWidget`. Confirmed by direct code read of both consumer files. |
| 11 | Typing supersedes a pending widget (D-02); durable across reload | VERIFIED | Client: `handleSubmit` in `use-conversation-controller.ts` optimistically adds every currently-pending interaction id to `supersededLocally` BEFORE the send starts (confirmed). Server: `supersede_pending(conversation_id)` (port + Supabase adapter, conditional `UPDATE ... WHERE conversation_id=? AND state='pending'`) is called from `RunChatTurn.run()` right after the user-message insert (confirmed in `run_chat_turn.py` around the `run()` body) — NOT called from `regenerate()`/`continue_after_widget()`, matching the plan's explicit requirement. |
| 12 | One pending interactive widget per turn (D-04) | VERIFIED | `build_create_pending_kwargs` (`run_chat_turn_widgets.py`) returns on the FIRST `interactive_widget` part found and only one such part can exist per assistant message (the turn ends at tool-call finalization, no second tool call is ever solicited in the same `_execute_turn` invocation). |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/db/src/schema/chat-widget-interactions.ts` | Drizzle table (state machine + schema + staleness cols) | VERIFIED | All columns present, uniqueIndex + index present, exported from `schema/index.ts` |
| `packages/db/migrations/0025_chat_widget_interactions.sql` | Migration w/ CHECK + RLS deny-all | VERIFIED | Read directly; both CHECK constraints, both FKs, both indexes, RESTRICTIVE RLS anon+authenticated |
| `apps/email-listener/app/domain/ports/chat_widget_interaction_repository.py` | Port + frozen entity | VERIFIED | `WidgetInteraction` frozen dataclass, `ChatWidgetInteractionRepository` Protocol (`create_pending`/`get`/`try_submit`/`is_stale`/`supersede_pending`) |
| `apps/email-listener/app/domain/services/widget_result_validator.py` | Pure re-validation service | VERIFIED | `validate_result_against_schema` + `ValidationOutcome`, zero `app.infrastructure` import (lint-imports confirms) |
| `apps/email-listener/app/infrastructure/supabase/supabase_chat_widget_interaction_repository.py` | Supabase adapter (CAS + staleness + supersede) | VERIFIED | All 5 methods implemented and directly read; CAS via double `eq()` predicate |
| `apps/email-listener/app/infrastructure/llm/chat_tools.py` | `build_emit_proposal_cards_tool` + `build_emit_clarify_widget_tool` | VERIFIED | Both present, Bedrock-valid, load-time asserted |
| `apps/email-listener/app/application/use_cases/submit_widget_interaction.py` | `SubmitWidgetInteraction` use case | VERIFIED | `prepare()`/`submit()` split, fixed ordering, `_resolve_summary` handles both widget kinds |
| `apps/email-listener/app/presentation/api/v1/chat_widget.py` | `POST /v1/chat/widget/submit` SSE endpoint | VERIFIED | Registered in `main.py`; pre-stream rejection mapping confirmed |
| `apps/web/src/app/chat/_components/genui-part-boundary.tsx` | `variant` prop, bare renders w/o GenuiCard | VERIFIED | All 4 return paths routed through `Wrapper`; spec-renderer.tsx untouched |
| `apps/web/src/app/chat/_components/build-proposal-cards-spec.ts` | declaration → SpecRoot builder | VERIFIED | Present, tested (7 tests) |
| `apps/web/src/app/chat/_components/build-clarify-widget-spec.ts` | declaration → form-node builder + submitted view | VERIFIED | Present (24-04), `buildClarifyWidgetSpec`/`buildClarifySubmittedSpec` exported |
| `apps/web/src/app/chat/_components/interactive-widget-boundary.tsx` | State chrome, generic over widgetKind | VERIFIED | `onSubmitResult` generalized signature, both proposal + clarify branches present |
| `packages/api-client/src/router/chat/widget-interactions.ts` | `chat.getWidgetInteractions` tRPC query | VERIFIED | Registered in `chat/index.ts`; uuid-validated input, row-capped |
| `apps/web/src/app/api/chat/widget/submit/route.ts` | Next SSE proxy | VERIFIED | Server-only API key, passes 404/409/422 through with reason |
| `packages/genui/src/catalog/form-component.tsx` | `handleSubmit` passes `{...onSubmit, values}` | VERIFIED | Confirmed at line 239; single-expression change, layout/schema untouched |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `SupabaseChatWidgetInteractionRepository.try_submit` | `chat_widget_interactions` | `eq("state","pending")` CAS | WIRED | Confirmed in source |
| `widget_result_validator.validate_result_against_schema` | `jsonschema` | `Draft7Validator` | WIRED | Confirmed in source |
| `run_chat_turn.py` | `chat_widget_interactions` | `create_pending` after assistant message insert | WIRED | Confirmed in `_persist_and_finish` |
| `SubmitWidgetInteraction` | `validate_result_against_schema` | pre-CAS re-validation | WIRED | Confirmed, correct order |
| `chat_widget.py` | `RunChatTurn` continuation | `StreamingResponse` over `stream_run_events` | WIRED | Confirmed, reused not reimplemented |
| `interactive-widget-boundary.tsx` | `GenuiPartBoundary` | `actions` prop, setState registry | WIRED | Confirmed |
| `use-chat-stream.ts` | `/api/chat/widget/submit` | `submitWidget()` reusing reader loop | WIRED | Confirmed via controller wiring |
| `genui-panel-node.tsx` | `interactive-widget-boundary.tsx` | `variant="bare"` | WIRED | Confirmed |
| `run_chat_turn.py` | `emit_clarify_widget` finalization | `clarify_widget` branch | WIRED | Confirmed |
| `form-component.tsx handleSubmit` | `InteractiveWidgetBoundary` actions registry | `{...onSubmit, values}` | WIRED | Confirmed |
| `run_chat_turn.run` | `supersede_pending` | after user-message insert | WIRED | Confirmed; NOT called from `regenerate()`/`continue_after_widget()` |

### Behavioral Spot-Checks / Test Execution (independently run by verifier)

| Suite | Command | Result | Status |
|-------|---------|--------|--------|
| Python — Phase 24 widget test files (7 files) | `uv run pytest <7 test files> -q --no-cov` | 49 passed | PASS |
| Python — broader chat regression | `uv run pytest tests/application/test_run_chat_turn.py app/presentation/api/v1/__tests__/ -q --no-cov` | 25 passed | PASS |
| Python — ruff | `uv run ruff check <8 phase-24 files>` | All checks passed | PASS |
| Python — lint-imports | `uv run lint-imports` | 3/3 contracts kept | PASS |
| apps/web — chat vitest suite | `npx vitest run src/app/chat` | 140/140 (17 files) passed | PASS |
| apps/web — tsc | `npx tsc --noEmit` | clean (no output) | PASS |
| apps/web — next build | `npm run build` | Compiled successfully; `/api/chat/widget/submit` registered | PASS |
| packages/genui — vitest | `npx vitest run` | 475/475 passed | PASS |
| packages/api-client — chat vitest | `npx vitest run src/router/chat` | 40/40 (6 files) passed | PASS |
| packages/api-client — tsc | `npx tsc --noEmit` | clean (no output) | PASS |
| spec-renderer.tsx integrity | `git log -1 --oneline` + `git status --porcelain` | `ecc7a46`, clean tree | PASS |

All test/build commands above were re-run independently by the verifier in this session (not taken from SUMMARY claims) and match the SUMMARY's reported counts.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|--------------|--------|----------|
| DCUI-01 | 24-02, 24-03 | Agent can emit proposal cards; clicking one sends a structured result that resumes the run | SATISFIED | `emit_proposal_cards` tool, `SubmitWidgetInteraction`, `POST /v1/chat/widget/submit`, `buildProposalCardsSpec`/`InteractiveWidgetBoundary`, dual-surface D-08 wiring — all confirmed in code + 140/140 web tests + 49 Python widget tests |
| DCUI-02 | 24-04 | Agent can emit clarify-widgets; submit returns structured result to the agent | SATISFIED | `emit_clarify_widget` tool (required `submitLabel` minLength 1), server-derived schema, `FormComponent` values-through-registry, `buildClarifyWidgetSpec`/`buildClarifySubmittedSpec`, clarify branch of `_resolve_summary` |
| DCUI-03 | 24-01, 24-02 | Every round-trip server-side re-validated, double-submit-locked, staleness-signaled, explicit-action-only | SATISFIED | Fixed check order in `submit_widget_interaction.py` (ownership→stale→schema→CAS), `try_submit` CAS, `is_stale`/`supersede_pending`, no auto-fire (only real DOM click fires `onSubmitResult`) |
| DCUI-04 | 24-01, 24-03, 24-04 | GenUI turns + widget interactions persist in history and canvas | SATISFIED | `chat_widget_interactions` table, `interactive_widget`/`interaction_result` message parts, canvas materializes `interactive_widget` parts as genui-panel nodes via the same `genuiPanelNodeId` scheme, one shared `controller.widgets` surface for both surfaces |

No orphaned requirements — REQUIREMENTS.md maps only DCUI-01..04 to Phase 24, and all four are claimed across the four plans' `requirements:` frontmatter.

### Anti-Patterns Found

None. Scanned all 19 phase-24 key source files (Python + TypeScript) for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER|placeholder|coming soon|not yet implemented`; every `placeholder` match is a legitimate HTML form-field `placeholder` attribute/prop (build-clarify-widget-spec.ts, chat_tools.py's field schema, form-component.tsx's native `<input placeholder=...>`), not a stub marker. No empty implementations, no hardcoded-empty stub data flows found in the phase's artifacts.

### Human Verification Required

1. **Live browser click-through — proposal cards**
   **Test:** In a running dev server, have the agent emit a proposal-card group and click through the full flow (select → Submitting… → locked Selected state → compact transcript entry), then check the same conversation's canvas panel shows the identical locked state.
   **Expected:** Matches the UI-SPEC's visual/copy contract exactly, both surfaces update from the same click.
   **Why human:** jsdom-based vitest mounts (140/140 green, using the real `SpecRenderer` and real DOM click events) prove the mechanism works, but true cross-browser visual rendering and pointer-event UX have not been checked in an actual browser.

2. **Live browser click-through — clarify-widgets**
   **Test:** Have the agent emit a clarify-widget, fill and submit the form, and force a 422 (e.g. tamper with a required field) to confirm the retry path.
   **Expected:** Form renders via the unmodified Phase-19 engine, submit locks to the "Your response"/Submitted/key-value-list view, only the 422 case re-enables the form.
   **Why human:** Same class of gap as #1 — the round-trip logic and display-state derivation are proven in vitest (14 new clarify tests + reused proposal machinery), but a real-browser pass has not been run.

3. **Live end-to-end round-trip against real AWS Bedrock**
   **Test:** Drive an actual conversation where a real Bedrock-hosted model decides to call `emit_proposal_cards` or `emit_clarify_widget`, then submit and confirm the continuation turn streams a genuine model response (not a fake/test provider).
   **Expected:** The full stack round-trips correctly with a live model in the loop — tool-call streaming, turn-ending semantics (D-01/D-04), and the continuation's context correctly includes the synthesized `interaction_result` turn.
   **Why human:** All Python tests in this phase use a fake `ChatProvider`; no live-Bedrock run was part of this phase's automated verification (consistent with this project's pre-existing EVAL-LIFT/ISO-RUN deferred-verification convention noted in REQUIREMENTS.md's "Carried v1.2 deferrals").

### Gaps Summary

No gaps found. All 12 derived observable truths (roadmap Success Criteria DCUI-01..04, decomposed against 24-CONTEXT.md's D-01..D-16 decisions) are verified directly against the codebase — migration/schema/RLS confirmed by reading the SQL and Drizzle definitions, the CAS lock and staleness/supersede logic confirmed by reading the Python source (not merely trusting the SUMMARY's prose), the fixed rejection-ordering confirmed line-by-line in `submit_widget_interaction.py`, both emit tools confirmed present and Bedrock-valid, the `bare` variant and dual-surface D-08 wiring confirmed by reading `genui-part-boundary.tsx`/`genui-panel-node.tsx`/`message-turn.tsx`/`use-conversation-controller.ts` directly, and `spec-renderer.tsx` confirmed untouched via `git log`. All automated test suites (Python: 49+25 targeted; web: 140 chat + 475 genui + 40 api-client) were independently re-run by the verifier in this session and are green, matching the SUMMARY claims. `next build` succeeds with the new route registered. No anti-pattern markers (TODO/FIXME/XXX/stub) found in any phase-24 file.

Status is `human_needed` rather than `passed` solely because three items require a live browser and a live-Bedrock model in the loop — neither is exercisable by an automated grep/test-run verifier, and this project's established convention (per the verification instructions and REQUIREMENTS.md's EVAL-LIFT/ISO-RUN deferred items) is to route such checks to human verification once the underlying mechanism is proven end-to-end in unmocked/fake-provider tests, which it is here.

---

*Verified: 2026-07-05*
*Verifier: Claude (gsd-verifier)*
