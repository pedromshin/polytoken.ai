---
phase: 22-chat-spine-persistence-streaming
verified: 2026-07-04T02:10:00Z
status: human_needed
score: 17/17 machine-checkable must-haves verified
overrides_applied: 0
human_verification:
  - test: "Live end-to-end streamed conversation in a real browser (send -> stream -> persist -> reload)"
    expected: "Message streams token-by-token, generating indicator shows, persists across reload, matches 22-UI-SPEC.md visually"
    why_human: "Requires a running apps/email-listener instance with real Bedrock/OpenRouter credentials and a browser; headless env has no live LLM transport or DOM renderer"
  - test: "WebGPU browser: select the Qwen3-4B in-browser model, watch it download (~2.5GB first run), stream a reply, persist across reload"
    expected: "Progress states (Downloading -> Loading into WebGPU -> Ready), local streamed reply, canonical-shape persistence, correct model actually loads (Qwen3-4B, matching the picker's advertised name)"
    why_human: "Requires a WebGPU-capable browser and a real model download; not available in this headless verification environment"
  - test: "Non-WebGPU browser: confirm the browser-locus picker entry renders disabled with the explanatory caption"
    expected: "Row disabled + \"Your browser doesn't support WebGPU — choose another model.\" caption"
    why_human: "Requires a browser without WebGPU support to observe the negative path"
  - test: "Visual/UX conformance to 22-UI-SPEC.md (typography 2-weight system, token colors, rail 280px/0px collapse, Send<->Stop morph with no layout shift, cost meter subtlety, model picker capability-row formatting, sibling-nav chevrons, error/cost-cap card styling)"
    expected: "Rendered UI matches the UI-SPEC's literal visual/interaction contract"
    why_human: "Visual appearance and interaction feel cannot be verified via grep/static analysis; all underlying logic is unit-tested but final pixel/interaction fidelity needs a human or Playwright pass"
  - test: "Regenerate -> ‹ 1/2 › sibling navigation and inline-error Retry in a live running conversation"
    expected: "Regenerate produces a navigable second sibling; a forced provider failure shows Retry with the composer draft intact"
    why_human: "Requires a live streamed turn against a real or intentionally-failing provider; this environment cannot invoke live Bedrock/OpenRouter"
---

# Phase 22: Chat Spine + Persistence + Streaming Verification Report

**Phase Goal:** Users can have a persistent, streamed conversation with the agent — text and genui
specs render progressively, the full table-stakes chat mechanics (stop/regenerate/error-recovery/
history) work from day one, and an application-level cost circuit breaker guards every turn.

**Verified:** 2026-07-04
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (mapped to ROADMAP's 5 Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can open `/chat`, send a message, get a streamed agent response; conversations/messages persist across reload | ✓ VERIFIED (code+tests) / human_needed (live E2E) | `chat_conversations`/`chat_messages` tables live in local Postgres with RLS (confirmed via `\d chat_messages` against `supabase_db_nauta`); `RunChatTurn.run()` persists user+assistant messages (13 tests in `test_run_chat_turn.py`); SSE proxy (`route.ts`) + `useChatStream` fold events into state (12 tests); `chat.getHistory` reads back parts/status; full live browser round-trip not run in this headless env |
| 2 | User can manage conversations: list, switch, rename, delete | ✓ VERIFIED | `chatRouter` (create/list/rename/delete/getHistory) registered in `root.ts` (`chat: chatRouter`); hard delete via Drizzle delete (not status flip); `conversation-rail.tsx`/`inline-rename-field.tsx`/`delete-conversation-dialog.tsx` exist and wired; 9 DB-free tests in `conversations.test.ts` pass |
| 3 | Stop, regenerate, inline retryable error that never loses in-flight input | ✓ VERIFIED | `RunChatTurn` catches `CancelledError` -> persists `stopped` + re-raises (D-15); `regenerate()` creates a new active sibling (D-16); `InlineErrorCard` (`role="alert"` + Retry) never references composer draft state (verified by inspection — `Composer` owns draft locally); dedicated tests for abort/cancel/fail/regenerate in `test_run_chat_turn.py` |
| 4 | Composer + message rendering behave like a real chat product (multi-line, enter-to-send, disabled-while-streaming, optimistic render, markdown/code, auto-scroll/jump-to-bottom) + progressive partial-tree genui | ✓ VERIFIED (code+tests) / human_needed (visual) | `composer.tsx`: `Enter && !shiftKey` submits, `disabled={isStreaming}`; `MarkdownRenderer` sanitized (react-markdown+remark-gfm+rehype-sanitize+rehype-highlight, no `dangerouslySetInnerHTML`, no `rehype-raw` import); `GenuiPartBoundary` renders valid subtrees + skeletons for pending children, falls back to `SAFE_FALLBACK_SPEC` on final-invalid (3 tests); no `eval`/`new Function` in the render path (grep = 0) |
| 5 | Cost circuit breaker (per-turn/per-session/per-day) + event-based agent/run abstraction (SEAM-03/04) | ✓ VERIFIED | `CostCircuitBreaker.check_pre_turn` fail-closed (ledger-sum errors BLOCK, not ALLOW — T-22-14); no cap-override parameter anywhere (`grep -c override` = 0); `chat_run_events` is insert-only (no real `.update(` call — see Anti-Patterns note); `RunChatTurn` is `agent_id='chat-agent-v1'`, one run per turn; 17 breaker tests + 12 ledger tests + 13 turn-orchestration tests all pass |

**Score:** 5/5 ROADMAP success criteria machine-verified at the code/architecture level; full live-browser/live-model smoke test deferred to human verification (see below) — this is the expected pattern for a headless autonomous run per this project's established practice.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/db/migrations/0023_chat_spine.sql` | 5 tables + RLS deny-all + correct cascade semantics | ✓ VERIFIED | Applied to live `supabase_db_nauta` (localhost:54322) — confirmed via `\dt chat_*` (5 tables exist) and `pg_class.relrowsecurity = t` for all 5; re-ran `migrate:local` — idempotent ("Migrations completed in 12ms (20 tables)"); `chat_cost_ledger`/no-cascade-on-conversation uses `ON DELETE SET NULL`, others `CASCADE` (confirmed in live `\d chat_messages` output) |
| `apps/email-listener/app/domain/ports/chat_provider.py` | `ChatProvider` port + typed deltas | ✓ VERIFIED | File exists; `TextDelta`/`ToolCallDelta`/`ToolResultDelta`/`UsageDelta`/`StreamEnd` present |
| `apps/email-listener/app/domain/services/chat_model_registry.py` | Curated registry, content-hash version | ✓ VERIFIED | 7 entries (2 Bedrock, 4 OpenRouter, 1 browser/Qwen3-4B); `chat_registry_version()` present; 26 registry+adapter tests pass |
| `apps/email-listener/app/infrastructure/llm/bedrock_chat_adapter.py` / `openrouter_chat_adapter.py` | Streaming adapters with usage capture | ✓ VERIFIED | Both exist; mypy clean; usage read from final message/terminal chunk |
| `apps/email-listener/app/domain/services/cost_circuit_breaker.py` | Fail-closed breaker | ✓ VERIFIED | Read in full — fail-closed on ledger-sum exceptions (`except Exception: return True`), no override parameter, `should_abort` boundary-correct |
| `apps/email-listener/app/application/use_cases/run_chat_turn.py` | Agent/run orchestrator | ✓ VERIFIED | Persists user/assistant messages, routes via registry, gates via breaker, emits typed run events, handles regenerate/stop/fail/cost-cap |
| `apps/email-listener/app/presentation/api/v1/chat_stream.py` | SSE stream+regenerate endpoints | ✓ VERIFIED | `require_api_key` dependency present; real `asyncio.Task` cancellation on disconnect (not `.aclose()`) — correctly triggers the agent's `CancelledError` handler |
| `apps/web/src/app/chat/_components/markdown-renderer.tsx` | Sanitized markdown renderer | ✓ VERIFIED | `dangerouslySetInnerHTML` count = 0; `rehypeSanitize` present; `rehype-raw` never imported; 5 tests pass |
| `packages/api-client/src/router/chat/*.ts` | Full chat tRPC surface (conversations/history/models/cost/browser-turn) | ✓ VERIFIED | `chat: chatRouter` registered in `root.ts`; 173/173 api-client tests pass including 11 `browser-turn.test.ts` tests |
| `apps/web/src/app/chat/_components/genui-part-boundary.tsx` | Progressive partial-tree genui rendering | ✓ VERIFIED | No `eval`/`new Function`; wraps unmodified `SpecRenderer`; 3 tests (valid/partial+skeleton/fallback) pass |
| `apps/web/src/app/chat/_hooks/use-webllm-engine.ts` | WebGPU detect + local streaming | ✓ VERIFIED | `navigator.gpu` check present; dynamic `import("@mlc-ai/web-llm")` (not static); model id `Qwen3-4B-q4f16_1-MLC` matches the registry's `webllm-qwen3-4b` entry (cross-checked Python <-> TS) |
| `apps/web/src/app/chat/_components/model-picker.tsx` / `cost-meter.tsx` | cmdk picker + session cost meter | ✓ VERIFIED | Files exist, `Command` grouping present, wired into `page.tsx` toolbar |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `packages/db/src/schema/index.ts` | 5 chat-*.ts modules | barrel re-export | ✓ WIRED | `grep -c "chat-" index.ts` = 5 |
| `chat_stream.py` | `require_api_key` | router dependency | ✓ WIRED | Both `/v1/chat/stream` and `/v1/chat/regenerate` behind the dependency |
| `run_chat_turn.py` | `cost_circuit_breaker.check_pre_turn`/`should_abort` | pre-turn gate + mid-stream abort | ✓ WIRED | Confirmed in source; BLOCK yields exactly one `cost_capped` event with zero provider calls (tested) |
| `use-chat-stream.ts` | `/api/chat/stream` | fetch streaming POST | ✓ WIRED | `route.ts` reads `EMAIL_LISTENER_API_KEY` server-side only, pipes upstream body as `text/event-stream` |
| `packages/api-client/src/root.ts` | `chatRouter` | appRouter registration | ✓ WIRED | `chat: chatRouter` present |
| `apps/web/src/components/app-sidebar.tsx` | `/chat` | nav item | ✓ WIRED | `{ href: "/chat", label: "Chat", icon: MessageSquare }` present |
| `genui-part-boundary.tsx` | `SpecRootSchema.safeParse` + `SpecRenderer` + `SAFE_FALLBACK_SPEC` | web-boundary schema gate | ✓ WIRED | Unmodified renderer import confirmed; safeParse->fallback path tested |
| `use-webllm-engine.ts` | `@mlc-ai/web-llm` | dynamic import + `CreateMLCEngine`/`chat.completions.create` | ✓ WIRED | Package genuinely installed in `node_modules`; dynamic import confirmed (bundle size delta in `next build` output: +4kB/+36kB, not multi-MB) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `chat.getHistory` -> `MessageList` | `historyRows` | Drizzle `select` over `chat_messages` (real DB query, no static return) | Yes | ✓ FLOWING |
| `useChatStream` -> `MessageTurn` | `parts` | Live SSE frames folded by `applyRunEvent` (real accumulator, not a stub) | Yes | ✓ FLOWING |
| `chat.sessionCost` -> `CostMeter` | `totalCostUsd`/`breakdown` | Drizzle read over `chat_cost_ledger`, bounded 200-row fetch, sum computed from same row set | Yes | ✓ FLOWING |
| `chat.models` -> `ModelPicker` | `models` | Server-side proxy to FastAPI `GET /v1/chat/models` (fails soft to empty list on outage, not a hardcoded fixture) | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Migration 0023 applies idempotently to live local Postgres | `npm run migrate:local` (packages/db) | "Migrations completed in 12ms (20 tables)" on re-run | ✓ PASS |
| All 5 chat tables exist with RLS enabled | `psql -c "SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'chat_%'"` against `supabase_db_nauta` | all 5 rows, `relrowsecurity = t` | ✓ PASS |
| Targeted Python test suites for phase 22 | `uv run pytest tests/test_chat_model_registry.py tests/infrastructure/test_bedrock_chat_adapter.py tests/infrastructure/test_openrouter_chat_adapter.py tests/test_cost_ledger_repository.py tests/test_cost_circuit_breaker.py tests/test_chat_provider_router.py tests/application/test_run_chat_turn.py tests/application/test_emit_ui_spec_tool.py tests/presentation/test_chat_stream.py` | 83 passed | ✓ PASS |
| Full apps/email-listener suite (regression check) | `uv run pytest -q --no-cov` | 10 failures, all in `tests/test_genui_retrieval_provider.py` (confirmed pre-existing — file untouched since before phase 22 per `git diff 54ed44d`) | ✓ PASS (no phase-22 regressions) |
| apps/web vitest suite | `npx vitest run` | 3 files, 20 passed | ✓ PASS |
| packages/api-client vitest suite | `npx vitest run` | 18 files, 173 passed (incl. 11 `browser-turn.test.ts`) | ✓ PASS |
| apps/web typecheck | `npx tsc --noEmit` | clean | ✓ PASS |
| packages/api-client typecheck | `npx tsc --noEmit` | clean | ✓ PASS |
| packages/db typecheck | `npx tsc --noEmit` | clean | ✓ PASS |
| apps/web production build | `npx next build` | compiled successfully; `/chat`, `/api/chat/stream`, `/api/chat/regenerate` all registered | ✓ PASS |
| Python ruff | `uv run ruff check app/` | All checks passed | ✓ PASS |
| Python import-linter | `uv run lint-imports` | 3 contracts kept, 0 broken | ✓ PASS |
| Python mypy (core new files) | `uv run mypy` on 7 key phase-22 files | Success: no issues found | ✓ PASS |

### Probe Execution

Not applicable — this phase declares no `scripts/*/tests/probe-*.sh` probes and is not a migration/CLI-tooling phase in the probe-harness sense; database migration verification was performed directly against the live Postgres instance (see Behavioral Spot-Checks).

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| CHAT-01 | 22-01, 22-05, 22-06, 22-08 | Open /chat, send message, get response, persist across reload | ✓ SATISFIED | Schema + tRPC CRUD + SSE core all present and tested |
| CHAT-02 | 22-05 | Conversation list/switch/rename/delete | ✓ SATISFIED | `chatRouter` CRUD + rail UI |
| CHAT-03 | 22-07, 22-08, 22-11 | Stop in-flight generation | ✓ SATISFIED | Disconnect->cancel->stopped path; browser-locus `interruptGenerate()` parity |
| CHAT-04 | 22-06, 22-07, 22-09 | Regenerate without retyping | ✓ SATISFIED | `regenerate()` creates versioned sibling; `SiblingNav` ‹N/M› UI |
| CHAT-05 | 22-09 | Inline retryable error, draft never lost | ✓ SATISFIED | `InlineErrorCard` + draft/turn state decoupling verified by inspection |
| CHAT-06 | 22-08 | Composer: multi-line, enter-to-send, disabled-while-streaming, optimistic | ✓ SATISFIED | `composer.tsx` behavior confirmed via grep + tsc |
| CHAT-07 | 22-03, 22-08 | Markdown + code rendering; auto-scroll/jump-to-bottom | ✓ SATISFIED | Sanitized `MarkdownRenderer` + `JumpToBottomButton` |
| STREAM-01 | 22-02, 22-06, 22-07, 22-08, 22-10, 22-11 | SSE streaming with generating indicator | ✓ SATISFIED | FastAPI SSE + Next proxy + `GeneratingIndicator` |
| STREAM-02 | 22-07, 22-09 | Progressive partial-tree genui rendering | ✓ SATISFIED | `GenuiPartBoundary` render-what's-valid + skeletons, depth-bounded |
| STREAM-03 | 22-04, 22-10, 22-11 | App-level cost circuit breaker | ✓ SATISFIED | Fail-closed pre-turn + mid-stream abort; browser $0 metered |
| SEAM-03 | 22-01, 22-06 | Chat turns as events on a run | ✓ SATISFIED | `chat_run_events` append-only, unique (run_id, seq) |
| SEAM-04 | 22-02, 22-06 | Agent/run abstraction | ✓ SATISFIED | `RunChatTurn` / `ChatProviderRouter` / one `agent_id='chat-agent-v1'` |

No orphaned requirements — all 12 IDs declared across the 11 plans' frontmatter match REQUIREMENTS.md's Phase 22 mapping exactly (cross-checked against `.planning/REQUIREMENTS.md`'s traceability table, all marked "Complete").

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/email-listener/app/infrastructure/supabase/supabase_chat_run_repository.py` | 6-7 | Docstring contains the literal substring `.update(` (documenting that the file avoids it) | ℹ️ Info | Cosmetic only — the plan's own acceptance-criteria grep (`grep -c "\.update(" ... returns 0`) would technically return 2 due to this self-referential comment, but manual code read confirms ZERO actual `.update()` method calls exist (`append_event` inserts, `finish_run` upserts). Same class of self-inflicted grep false-positive already documented and accepted elsewhere in this phase's SUMMARYs (e.g., 22-03's "dangerouslySetInnerHTML" comment, 22-05's "SidebarProvider" comment). Not a functional gap. |

No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER markers found in any of the 11 core phase-22 production files scanned (Python domain/application/infrastructure/presentation layers, and the key TS/TSX chat components).

### Human Verification Required

### 1. Live end-to-end streamed conversation

**Test:** Run `apps/email-listener` with real Bedrock/OpenRouter credentials and `apps/web` against it; open `/chat`, send a message, watch the response stream, reload the page.
**Expected:** Text streams progressively with a visible generating indicator; after reload, the same conversation and messages are present (persisted).
**Why human:** Requires live LLM transport and a real browser DOM; this headless verification environment has neither.

### 2. WebGPU browser: in-browser model load + stream + persist

**Test:** In a WebGPU-capable browser, select the "Qwen3 4B (in-browser)" picker entry, observe the download/loading progress states, send a message, confirm it streams locally and persists across reload.
**Expected:** Progress states in order (Downloading -> Loading into WebGPU -> Ready); a locally-streamed text reply; the turn persists in the canonical shape with a $0 but token-metered cost-ledger row.
**Why human:** Requires an actual WebGPU-capable browser and a ~2.5GB model download; not possible in this environment.

### 3. Non-WebGPU browser: disabled entry path

**Test:** In a browser without WebGPU support, open the model picker.
**Expected:** The browser-locus entry renders disabled with the caption "Your browser doesn't support WebGPU — choose another model."
**Why human:** Requires a real non-WebGPU browser environment to observe the negative path.

### 4. Visual/UX conformance to 22-UI-SPEC.md

**Test:** Visually inspect the rendered `/chat` UI against 22-UI-SPEC.md's typography (2-weight system), token colors, rail collapse behavior, Send<->Stop morph (no layout shift), cost meter subtlety, model-picker capability-row formatting, and card styling for errors/cost-caps.
**Expected:** Pixel/interaction fidelity to the UI-SPEC's literal contract.
**Why human:** Visual appearance and interaction feel are not machine-verifiable via static analysis; all underlying logic is unit-tested, but final rendered fidelity needs human eyes (or a future Playwright pass).

### 5. Regenerate/error-recovery in a live conversation

**Test:** Regenerate a response to confirm the ‹1/2› sibling counter appears and navigates; force a provider failure to confirm the Retry button appears with the composer draft intact.
**Expected:** Sibling navigation works; InlineErrorCard shows with Retry; draft text is never cleared by the failure.
**Why human:** Requires a live streamed turn (or an intentionally-failing live provider call), which this environment cannot invoke.

### Gaps Summary

No blocking gaps found. Every machine-checkable truth, artifact, and key link verified against the actual codebase — not just SUMMARY.md claims. Migration 0023 was independently re-verified against the live local Supabase Postgres instance (not just trusted from the SUMMARY), all declared Python and TypeScript test suites were re-run directly by the verifier (83 targeted + full-suite regression check on the Python side, 20 + 173 on the TS side), and security-relevant greps (NEXT_PUBLIC leakage, dangerouslySetInnerHTML/rehype-raw, eval/Function, fail-closed auth) were independently confirmed clean. The phase's remaining work is exclusively the class of check this project's autonomous-session pattern always defers to a human: live LLM/WebGPU calls and visual/UX fidelity — none of which surfaced any code-level red flags during static/architectural review.

---

_Verified: 2026-07-04_
_Verifier: Claude (gsd-verifier)_
