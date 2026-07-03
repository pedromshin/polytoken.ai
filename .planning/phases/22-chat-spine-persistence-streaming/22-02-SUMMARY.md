---
phase: 22-chat-spine-persistence-streaming
plan: 02
subsystem: llm-transport
tags: [chat-provider, bedrock, openrouter, streaming, multi-provider, registry]

# Dependency graph
requires:
  - phase: 22-01 (chat data model)
    provides: chat_messages.parts typed-parts shape (FOUND-1) this transport layer's
      deltas will eventually persist into
provides:
  - ChatProvider port (chat_provider.py) — one Protocol, typed stream deltas
    (TextDelta/ToolCallDelta/ToolResultDelta/UsageDelta/StreamEnd)
  - CHAT_MODEL_REGISTRY (chat_model_registry.py) — curated model registry with
    transport/execution_locus/pricing/capability flags + content-hash version
  - BedrockChatAdapter + OpenRouterChatAdapter — two real ChatProvider
    implementations, both capturing real token usage (D-22)
  - GET /v1/chat/models — authed endpoint serving the registry
affects: [22-06 (chat orchestration agent), 22-07 (SSE endpoint), 22-picker-UI, cost-breaker]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ChatProvider Protocol + typed delta union (TextDelta/ToolCallDelta/ToolResultDelta/UsageDelta/StreamEnd) — one port, many transports (D-04..D-07)"
    - "Content-hash registry version (chat_registry_version(), mirrors packages/genui registry-version.ts, FOUND-2)"
    - "Inactivity asyncio.timeout rescheduled per stream event (genui_code_generator_adapter idiom), reused for both Bedrock and OpenRouter adapters"
    - "Adapters bound to their own concrete Dishka type (not the shared Protocol) since two structural implementations of ChatProvider coexist; the chat orchestration layer (22-06) selects by registry transport"

key-files:
  created:
    - apps/email-listener/app/domain/ports/chat_provider.py
    - apps/email-listener/app/domain/services/chat_model_registry.py
    - apps/email-listener/app/infrastructure/llm/bedrock_chat_adapter.py
    - apps/email-listener/app/infrastructure/llm/openrouter_chat_adapter.py
    - apps/email-listener/app/presentation/api/v1/chat_models.py
    - apps/email-listener/tests/test_chat_model_registry.py
    - apps/email-listener/tests/infrastructure/test_bedrock_chat_adapter.py
    - apps/email-listener/tests/infrastructure/test_openrouter_chat_adapter.py
  modified:
    - apps/email-listener/app/settings.py
    - apps/email-listener/app/container.py
    - apps/email-listener/app/main.py

key-decisions:
  - "Test placement follows the codebase's ESTABLISHED test-layout convention (flat tests/test_*.py for domain services, tests/infrastructure/test_*.py for infra adapters) instead of the plan's literal tests/unit/ path — the codebase has no tests/unit/ directory anywhere; every other domain-service test (test_key_terms.py, test_mime_parser.py, test_domain_entities.py) and every LLM adapter test (tests/infrastructure/test_genui_*.py) already follows this layout. Introducing a new parallel tests/unit/ convention for exactly three files would fragment the test suite for no benefit."
  - "Bedrock model ids in CHAT_MODEL_REGISTRY are literal strings mirroring DEFAULT_BEDROCK_MODEL_ID/DEFAULT_GENUI_MODEL_ID in settings.py, NOT imported from app.settings — domain stays free of app.settings per the existing 'domain has no external deps' import-linter contract (no existing domain module imports app.settings either). Documented in a module comment so a future settings default change prompts a manual registry sync."
  - "All 4 curated OpenRouter entries are flagged capabilities.genui=False (conservative default: genui reliability with third-party models is unverified) — only the 2 Bedrock entries are genui=True. This also scopes OpenRouterChatAdapter's message translation to text-only for Phase 22 (no tool_use/tool_result block translation needed yet; that lands with the Phase 24 round-trip if a future OpenRouter entry is ever promoted to genui=True)."
  - "GET /v1/chat/models returns {registry_version, models: [...]} as one object (ChatModelsView), not a bare list with a decoration — makes registry_version a first-class, always-present field the client can diff against a locally cached copy, following the same {catalogId, version} + separate-payload spirit as registry-version.ts."
  - "httpx.AsyncClient is provided as a Dishka APP-scope singleton with read=None (no read timeout) — OpenRouterChatAdapter's own inactivity asyncio.timeout (rescheduled per SSE line) is the real safety net, matching the Bedrock adapter's reliance on its own timeout rather than the SDK's."

requirements-completed: [STREAM-01, STREAM-03, SEAM-04]

# Metrics
duration: ~75min
completed: 2026-07-03
---

# Phase 22 Plan 02: Multi-Provider Model System Summary

**One `ChatProvider` port with typed stream deltas, a curated 7-entry model registry (2 Bedrock + 4 OpenRouter + 1 browser/WebLLM) with honest capability flags and a content-hash version, two real streaming adapters (Bedrock + OpenRouter) both capturing real token usage, and an authed `GET /v1/chat/models` endpoint.**

## Performance

- **Duration:** ~75 min
- **Completed:** 2026-07-03
- **Tasks:** 3/3 completed
- **Files created:** 8 (1 domain port, 1 domain service, 2 infra adapters, 1 presentation router, 3 test files)
- **Files modified:** 3 (settings.py, container.py, main.py)
- **New tests:** 26 (11 registry + 8 Bedrock adapter + 7 OpenRouter adapter), all passing

## Accomplishments

- **ChatProvider port** (`chat_provider.py`): a single `Protocol` with `async def stream(...)` returning an `AsyncIterator` over a typed delta union — `TextDelta`, `ToolCallDelta`, `ToolResultDelta` (reserved for the Phase 24 round-trip seam), `UsageDelta`, terminal `StreamEnd`. Designed so a future self-hosted OpenAI-compatible adapter (D-07) is a third implementation with zero port changes.
- **CHAT_MODEL_REGISTRY** (`chat_model_registry.py`): 7 curated entries — Claude Sonnet 4.6 + Haiku 4.5 (Bedrock, `genui=True`), DeepSeek V3 / Qwen 2.5 72B / GLM 4.6 / Gemma 2 27B (OpenRouter, `genui=False`), Gemma 3 4B (browser/WebLLM, `$0`, `execution_locus='browser'`). Each entry carries pricing, capability flags, and a `best_for` caption (D-06). `chat_registry_version()` is a deterministic SHA-256 content hash mirroring `packages/genui/src/registry/registry-version.ts` (FOUND-2).
- **BedrockChatAdapter**: generalizes the existing `genui_code_generator_adapter` streaming idiom (`messages.stream` + `asyncio.timeout` rescheduled per event) into the `ChatProvider` contract — yields `TextDelta`/`ToolCallDelta` in order, then exactly one `UsageDelta` from the final message's real `input_tokens`/`output_tokens` (D-22), then `StreamEnd`. `tool_choice` is never forced (D-02); `tools` is omitted entirely when empty. Any exception surfaces as `StreamEnd(stop_reason='error')` — nothing escapes the generator boundary.
- **OpenRouterChatAdapter**: streams OpenRouter's OpenAI-compatible `/chat/completions` (`stream: true`) over `httpx` (already a dependency — no new package), parsing SSE `data:` lines into the same typed deltas, reading the terminal chunk's `usage` object into one `UsageDelta` (`prompt_tokens`/`completion_tokens` → `input_tokens`/`output_tokens`, D-22). `[DONE]` terminates cleanly. `OPENROUTER_API_KEY` is read server-side only and a missing key **raises immediately** (fail-closed, D-07) rather than attempting a request that would degrade into a generic HTTP error; a genuine non-2xx OpenRouter response instead yields `StreamEnd(stop_reason='error')` with the body logged server-side only.
- **GET /v1/chat/models**: authed (`require_api_key`) endpoint serving the full registry + `registry_version` as `ApiResponse.ok(ChatModelsView(...))`. Verified end-to-end via `TestClient` — 200, 7 models, all three transports present.
- **DI wiring**: `BedrockChatAdapter` and `OpenRouterChatAdapter` are each bound to their own concrete Dishka type (both structurally satisfy `ChatProvider` but a single Protocol-keyed binding can't hold two implementations at once); a shared `httpx.AsyncClient` singleton (`read=None`) was added as the OpenRouter transport, with its own inactivity timeout doing the real stall-guarding rather than a fixed httpx read timeout.

## Task Commits

Each task was committed atomically:

1. **Task 1: ChatProvider port + typed deltas + curated model registry + GET /v1/chat/models** - `3b547ae` (feat)
2. **Task 2: BedrockChatAdapter — stream deltas + real usage capture (D-22)** - `30136b9` (feat)
3. **Task 3: OpenRouterChatAdapter — OpenAI-compatible SSE stream + usage capture + settings/DI** - `1e48f39` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `apps/email-listener/app/domain/ports/chat_provider.py` — `ChatProvider` Protocol + `TextDelta`/`ToolCallDelta`/`ToolResultDelta`/`UsageDelta`/`StreamEnd` frozen dataclasses + `ChatDelta` union
- `apps/email-listener/app/domain/services/chat_model_registry.py` — `ChatModel`/`ChatModelCapabilities` dataclasses, `CHAT_MODEL_REGISTRY` (7 entries), `chat_registry_version()`, `get_model()`, `genui_capable_ids()`
- `apps/email-listener/app/infrastructure/llm/bedrock_chat_adapter.py` — `BedrockChatAdapter` implementing `ChatProvider.stream` over `AsyncAnthropicBedrock`
- `apps/email-listener/app/infrastructure/llm/openrouter_chat_adapter.py` — `OpenRouterChatAdapter` implementing `ChatProvider.stream` over OpenRouter's OpenAI-compatible SSE endpoint via `httpx`
- `apps/email-listener/app/presentation/api/v1/chat_models.py` — `GET /v1/chat/models` router (`ChatModelsView`/`ChatModelView`/`ChatModelCapabilitiesView`)
- `apps/email-listener/app/settings.py` — `CHAT_INACTIVITY_TIMEOUT_SECONDS`, `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL` + `openrouter_api_key` property
- `apps/email-listener/app/container.py` — `httpx.AsyncClient` singleton factory + `BedrockChatAdapter`/`OpenRouterChatAdapter` Dishka factories, registered in `_build_provider()`
- `apps/email-listener/app/main.py` — registers `chat_models_router`
- `apps/email-listener/tests/test_chat_model_registry.py` — 11 tests (transport coverage, browser $0/locus, genui flag honesty, version stability/format, lookup, uniqueness)
- `apps/email-listener/tests/infrastructure/test_bedrock_chat_adapter.py` — 8 tests (ordered deltas + usage + StreamEnd, tool-call tracking, tool_choice never forced, mid-stream exception handling, missing-usage default)
- `apps/email-listener/tests/infrastructure/test_openrouter_chat_adapter.py` — 7 tests (SSE parsing + usage + StreamEnd, `[DONE]` termination, tool-call deltas, fail-closed missing key, non-2xx/401 handling, auth header + payload shape) using `httpx.MockTransport` (no new test dependency)

## Decisions Made

- **Test placement diverges from the plan's literal `tests/unit/` path.** The plan's frontmatter and `<verify>` blocks specified `tests/unit/test_chat_model_registry.py`, `tests/unit/test_bedrock_chat_adapter.py`, `tests/unit/test_openrouter_chat_adapter.py`. This codebase has no `tests/unit/` directory anywhere — the established convention (verified by reading `pyproject.toml`'s `testpaths` and every existing test file) is flat `tests/test_*.py` for domain-layer code (`test_key_terms.py`, `test_mime_parser.py`, `test_domain_entities.py`) and `tests/infrastructure/test_*.py` for infra/LLM adapters (`test_genui_quarantine_adapter.py`, `test_genui_code_generator_adapter.py`, etc.), mirroring the Clean Architecture layers. I followed the established convention instead of introducing a one-off parallel directory, and ran the plan's exact verification commands against the equivalent paths (all passed). This is a CLAUDE.md-aligned adjustment ("organize by feature/domain," consistency with existing conventions) — documented per the executor's deviation protocol.
- **Bedrock model ids are literal strings in the domain registry, not imported from `app.settings`.** Keeps the domain layer free of any `app.settings` coupling (no existing domain module imports settings; the import-linter "Domain has no external deps" contract, while not literally forbidding `app.settings`, is honored in spirit). A code comment documents the mirror relationship to `DEFAULT_BEDROCK_MODEL_ID`/`DEFAULT_GENUI_MODEL_ID` so a future settings change is a visible, deliberate two-line edit rather than a silent import.
- **All OpenRouter entries curated as `genui=False`.** GenUI reliability for third-party OpenRouter models wasn't independently verified in this plan's scope; marking them conservatively `False` keeps the picker honest (D-05) and narrows `OpenRouterChatAdapter`'s message-translation scope to text-only for now (no tool_use/tool_result block plumbing needed until a future plan promotes an entry and needs the Phase 24 round-trip).
- **`GET /v1/chat/models` response shape:** `{success, data: {registry_version, models: [...]}}` rather than a bare list. Keeps `registry_version` a top-level, always-present field for cache-busting, following the spirit of `REGISTRY_VERSION`'s separate `{catalogId, version}` export on the TS side.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - CLAUDE.md/convention alignment] Test files placed per established repo convention, not the plan's literal `tests/unit/` path**
- **Found during:** Task 1 (before writing the first test file)
- **Issue:** Plan frontmatter/`<verify>` specified `tests/unit/test_chat_model_registry.py` etc., but no `tests/unit/` directory exists anywhere in the codebase; the established, consistently-applied convention is flat `tests/test_*.py` (domain) and `tests/infrastructure/test_*.py` (infra adapters).
- **Fix:** Created `tests/test_chat_model_registry.py`, `tests/infrastructure/test_bedrock_chat_adapter.py`, `tests/infrastructure/test_openrouter_chat_adapter.py` instead, and ran every plan-specified verification command against the equivalent path.
- **Files affected:** the three new test files (see Files Created/Modified above)
- **Verification:** All plan-level `<verify>`/`<acceptance_criteria>` pytest commands re-run against the actual paths — all pass (26/26 new tests).
- **Committed in:** `3b547ae`, `30136b9`, `1e48f39` (one test file per task commit)

**2. [Rule 1 - Bug] Removed the literal string "NEXT_PUBLIC_" from a settings.py comment**
- **Found during:** Task 3, running the acceptance-criteria grep check
- **Issue:** My own explanatory comment above `OPENROUTER_API_KEY` in `settings.py` said "no NEXT_PUBLIC_ equivalent here," which made `grep -c "NEXT_PUBLIC" app/settings.py` return `1` instead of the required `0` — a self-inflicted false positive on the exact security-intent check the plan specifies (T-22-06: never client-exposed).
- **Fix:** Reworded the comment to convey the same intent ("no client-visible-prefixed env var here") without the literal trigger string.
- **Files modified:** `apps/email-listener/app/settings.py`
- **Verification:** `grep -c "NEXT_PUBLIC" app/settings.py` now returns `0`.
- **Committed in:** `1e48f39` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1/2, no architectural changes, no scope creep — one is a test-directory convention alignment, the other a one-word comment fix to satisfy the plan's own security grep check).

## Issues Encountered

None beyond the two items above. `uv run mypy app/container.py app/settings.py` (run as part of exploring Task 2's acceptance criteria) surfaces 6 **pre-existing** errors in three unrelated files (`genui_generator_adapter.py`, `genui_code_generator_adapter.py`, `supabase_ui_spec_template_repository.py`) reached transitively via `container.py`'s imports — confirmed pre-existing via `git diff` (zero changes to those files in this plan) and out of scope per the executor's Scope Boundary rule. Logged here, not fixed. `uv run mypy app/infrastructure/llm/bedrock_chat_adapter.py app/infrastructure/llm/openrouter_chat_adapter.py` (the plan's actual acceptance-criteria command) is clean.

Similarly, a full-suite `uv run pytest` run surfaces 10 pre-existing failures in `tests/test_genui_retrieval_provider.py` (`asyncio.get_event_loop()` incompatible with Python 3.13's "no current event loop in a fresh thread" behavior) — confirmed pre-existing via `git diff` (zero changes to that file or its adapter), unrelated to chat work, out of scope. Full suite otherwise: `882 passed, 9 skipped` (includes all 26 new chat tests).

## User Setup Required

- **OPENROUTER_API_KEY is unset in every environment today.** `OpenRouterChatAdapter` is DI-wired and unit-tested with mocks, but any real (non-mocked) invocation will raise `RuntimeError` immediately (fail-closed, D-07) until a real key is provisioned via the settings/secret-manager pattern — this is expected and by design for this plan's scope (no live API calls were made or attempted, per the autonomous-session offline-testable pattern already established for Bedrock adapters).
- No other external service configuration required. Bedrock transport reuses the existing ECS task IAM role (no key).

## Threat Flags

None beyond what the plan's `<threat_model>` already enumerated (T-22-06 OPENROUTER_API_KEY leak, T-22-07 unauthenticated registry scrape, T-22-08 tool-call json tampering, T-22-09 stalled-stream DoS, T-22-SC supply chain) — all implemented exactly as dispositioned:
- T-22-06: key read only via `settings.openrouter_api_key` server-side; `Authorization` header only; error bodies logged truncated (2000 chars) and never returned to the caller.
- T-22-07: `require_api_key` dependency on the `/v1/chat` router.
- T-22-08: tool-call deltas are inert text at this layer (no execution); downstream schema gate is a later phase's concern (already noted in the plan).
- T-22-09: both adapters reschedule an `asyncio.timeout` inactivity deadline per event/line.
- T-22-SC: `httpx` (already a project dependency) is the only new import; no new pip package installed.

## Next Phase Readiness

- `ChatProvider`, `CHAT_MODEL_REGISTRY`, `BedrockChatAdapter`, and `OpenRouterChatAdapter` are all DI-resolvable and ready for the chat orchestration agent (22-06) to select a provider by the picked model's registry `transport` and drive a turn.
- `GET /v1/chat/models` is live and ready for the frontend picker to consume (transport/locus/pricing/capability flags + `registry_version` for cache-busting).
- The Phase 24 tool-call/tool-result round-trip has a clean seam: `ToolResultDelta` already exists in the `ChatDelta` union, and no OpenRouter entry needs tool-block translation until a future plan promotes one to `genui=True`.
- OpenRouter is fully wired but inert without a real `OPENROUTER_API_KEY` in this environment — deploying/testing live OpenRouter calls is deferred to whenever that secret is provisioned (out of scope for this plan, consistent with the "local/sandbox only" v1.3 milestone scope).

---
*Phase: 22-chat-spine-persistence-streaming*
*Completed: 2026-07-03*

## Self-Check: PASSED

All 9 created/referenced files confirmed present on disk; all three task commits (`3b547ae`, `30136b9`, `1e48f39`) confirmed present in `git log --oneline --all`.
