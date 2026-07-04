---
phase: 22-chat-spine-persistence-streaming
plan: 11
subsystem: chat-browser-webllm-locus
tags: [webllm, webgpu, in-browser-inference, drizzle, trpc, chat, cost-ledger]

# Dependency graph
requires:
  - phase: 22-01 (chat data model)
    provides: chat_messages/chat_runs/chat_run_events/chat_cost_ledger canonical
      schema this plan's browser turn writes into verbatim
  - phase: 22-08 (streamed chat core)
    provides: useChatStream + ConversationView's growing-parts/state-machine
      contract the browser-locus path mirrors, MessageList/MessageTurn
      rendering shared by both loci
  - phase: 22-10 (model picker + cost meter)
    provides: ModelPicker/ModelPickerEntry with the typed onSelectBrowserModel
      seam this plan fills, chat.models registry proxy, chat.sessionCost
      (now also reflects browser-turn $0 rows)
provides:
  - "useWebllmEngine — WebGPU detection, lazy dynamic-import @mlc-ai/web-llm
    engine (module-level singleton), initProgressCallback mapped to the
    UI-SPEC loading copy, generateStream() OpenAI-style local streaming with
    real token-usage capture, interruptGenerate() for Stop parity"
  - "ModelPickerEntry/ModelPicker browser-locus activation: disabled row +
    WebGPU caption when unsupported, inline Progress while loading, a Ready
    tag once loaded — selecting it awaits ensureLoaded() before persisting
    via the same chat.setModel path as any other model"
  - "chat.recordBrowserTurn — persists a finished browser turn (message pair,
    run, run_events, $0-but-metered cost ledger row) in ONE transaction, in
    the exact canonical shape server turns use"
  - "ConversationView's data-driven locus branch: send/stop route to
    useChatStream (server) or useWebllmEngine (browser) based on the
    registry's execution_locus, never a hardcoded per-model special case"
affects: []

# Tech tracking
tech-stack:
  added:
    - "@mlc-ai/web-llm ^0.2.84 (apps/web) — in-browser WebGPU LLM inference,
      vetted via the phase's package-legitimacy checkpoint (Apache-2.0,
      genuine MLC-AI project, 63k weekly downloads, actively maintained)"
  patterns:
    - "Dynamic import() of @mlc-ai/web-llm inside ensureLoaded() (never a
      static top-level import) — keeps the ~13MB browser-only package out of
      both the server bundle and the initial client bundle; next build's
      /chat route grew only 4kB/36kB (118kB->122kB / 292kB->328kB First Load
      JS) rather than the multi-MB jump a static import would cause"
    - "Module-level engine singleton (not per-hook-instance state) — a fresh
      useWebllmEngine() call (e.g. after switching conversations, since
      ConversationView is keyed and remounts) lazily reflects whatever the
      singleton already holds instead of re-downloading the model"
    - "ONE top-level useWebllmEngine() instance in ChatPage, threaded down as
      a prop to ConversationView/ModelPicker — avoids each conversation
      switch creating a new engine-hook instance with its own disconnected
      loading-state view"
    - "buildBrowserTurnRows — a pure, DB-free-tested function that computes
      the exact message/run_events/ledger row shapes recordBrowserTurn
      inserts, following 22-05/22-10's established no-ctx.db-mocking test
      convention (this codebase has zero precedent for mocking Drizzle query
      chains)"

key-files:
  created:
    - apps/web/src/app/chat/_hooks/use-webllm-engine.ts
    - apps/web/src/app/chat/_components/webllm-loading.tsx
    - packages/api-client/src/router/chat/browser-turn.ts
    - packages/api-client/src/router/chat/__tests__/browser-turn.test.ts
  modified:
    - apps/web/package.json
    - apps/web/src/app/chat/_components/model-picker-entry.tsx
    - apps/web/src/app/chat/_components/model-picker.tsx
    - apps/web/src/app/chat/page.tsx
    - packages/api-client/src/router/chat/index.ts
    - apps/email-listener/app/domain/services/chat_model_registry.py
    - apps/email-listener/tests/test_chat_provider_router.py
    - apps/email-listener/tests/test_cost_ledger_repository.py

key-decisions:
  - "Repointed the browser registry entry from 'webllm-gemma-3-4b' /
    'Gemma 3 4B (in-browser)' to 'webllm-qwen3-4b' / 'Qwen3 4B (in-browser)'
    (Rule 1 bug fix, cross-file — see Deviations). The vetted
    @mlc-ai/web-llm 0.2.84 package's prebuiltAppConfig ships no Gemma-3-4B
    build (confirmed by grepping the installed lib/index.js for every
    gemma-* model id — only gemma-2-* and gemma3-1b-it exist). D-08's own
    context text names 'Qwen3 4B or Gemma 3 4B' as equally acceptable
    curated options, and Qwen3-4B-q4f16_1-MLC IS a real, available 4B-class
    WebLLM prebuilt — so the fix stays within the decision's own sanctioned
    alternatives rather than requiring a new decision. Chose this over
    silently loading a different/smaller model under the 'Gemma 3 4B' label,
    which would have violated the phase's own D-05/D-06 'never advertise a
    capability/identity that isn't real' honesty contract."
  - "ModelPicker's onSelectBrowserModel seam signature changed from
    `(modelId) => void` (22-10's placeholder) to `(modelId) => Promise<void>`
    — ModelPicker now awaits it before persisting via chat.setModel, and the
    popover stays open (no premature setOpen(false)) while the browser model
    loads, so the inline Progress row is actually visible to the user. A
    rejected promise (load failure) aborts the selection with no persist,
    surfaced via the row's own webllm.status==='error' state."
  - "recordBrowserTurn's row-shape logic (buildBrowserTurnRows) is unit
    tested DB-free rather than via ctx.db-chain mocking, applying the SAME
    discretionary interpretation 22-10 already established for an identical
    literal-acceptance-criteria-vs-precedent conflict ('a test with a fake
    db asserts...' resolved as 'test the pure function that determines
    what gets written')."
  - "recordBrowserTurn also touches chat_conversations.model_id/title/
    updated_at (mirrors run_chat_turn.py's ChatConversationRepository.touch()
    for server turns) even though the plan's action text didn't spell this
    out explicitly — omitting it would leave browser-only conversations with
    a stale 'Untitled conversation' title and wrong rail recency ordering,
    breaking D-08's 'same shape as server turns' truth in a visible way."
  - "Added minimal Stop support for the browser locus (webllm.interrupt() ->
    engine.interruptGenerate(), tracked via a ref to label the terminal
    status 'stopped' vs 'completed'/'failed') even though Task 2's action
    text only mentions the send path. CHAT-03 (Stop) is a phase-wide,
    already-shipped requirement for the server locus; leaving the composer's
    Stop button a silent no-op during a browser generation would be a
    regression relative to the existing UI contract (Rule 2 — missing
    critical cross-cutting functionality)."

requirements-completed: [STREAM-01, STREAM-03]

# Metrics
duration: ~65min
completed: 2026-07-03
---

# Phase 22 Plan 11: Browser Model (WebLLM/WebGPU) Summary

**A real, WebGPU-gated in-browser chat model (`@mlc-ai/web-llm`, vetted via the phase's package-legitimacy checkpoint) that loads locally with an honest progressive-loading UX, streams a text-only reply entirely client-side, and persists the turn through `chat.recordBrowserTurn` in the exact same canonical message/run/event/ledger shape server turns use — a $0 but fully metered usage row, with the send path branching on the registry's `execution_locus` rather than any hardcoded per-model special case.**

## Performance

- **Duration:** ~65 min
- **Completed:** 2026-07-03
- **Tasks:** 2/2 completed (plus the package-legitimacy checkpoint, pre-resolved by the orchestrator's audit)
- **Files:** 4 created, 8 modified (2 apps/web components new, 1 api-client router file + test new, 3 apps/email-listener files touched for the Rule 1 registry fix)

## Package Legitimacy Audit (checkpoint resolution)

Resolved by the orchestrator before this plan executed (not re-litigated here, recorded per the plan's checkpoint task):

- **Package:** `@mlc-ai/web-llm`
- **Version installed:** 0.2.84
- **Registry:** npmjs.com/package/@mlc-ai/web-llm — Apache-2.0, `dependencies: { loglevel: ^1.9.1 }` (minimal transitive surface)
- **Repository:** github.com/mlc-ai/web-llm — the genuine MLC-AI project org
- **Downloads:** 63,217 weekly (confirmed via `npm view`)
- **Maintenance:** actively maintained, last publish 2026-05-27 (per `npm view` `dist-tags`/publish metadata)
- **Runtime approach confirmed:** WASM + WebGPU compute, model weights fetched from a CDN (huggingface.co/mlc-ai/*) at runtime — not bundled; ~2.5GB first-run download for the curated 4B-class model, matching the UI-SPEC's stated size
- **Decision:** Approved, installed via `npm install @mlc-ai/web-llm -w apps/web` (npm workspaces, `package-lock.json` canonical)

## Accomplishments

- **`useWebllmEngine`** (`use-webllm-engine.ts`): `navigator.gpu` WebGPU detection (client-only, via an effect — SSR-safe); a **module-level singleton** `MLCEngine` created lazily inside `ensureLoaded()` via a **dynamic `import("@mlc-ai/web-llm")`** so the ~13MB package never enters the server bundle or the initial client bundle; `initProgressCallback` mapped into the UI-SPEC's two ordered copy states ("Downloading model… (~2.5GB, first run only)" → "Loading into WebGPU…"); `generateStream()` uses the OpenAI-style `engine.chat.completions.create({ stream: true, stream_options: { include_usage: true } })` API to get both the growing text delta and the REAL final `prompt_tokens`/`completion_tokens` usage; `interrupt()` wraps `engine.interruptGenerate()` for composer Stop parity (CHAT-03).
- **`WebLLMLoading`** (`webllm-loading.tsx`): inline `@nauta/ui` `Progress` + label row, rendered directly inside the picker entry (not a separate modal) so the popover stays open and visible during the (first-run-only) download.
- **`ModelPickerEntry`/`ModelPicker`** activation: the browser-locus row now renders one of three states — a disabled row + "Your browser doesn't support WebGPU — choose another model." caption (WebGPU unsupported, `CommandItem disabled`), the inline `WebLLMLoading` Progress (loading), or a small green-dot "Ready" `Badge` (loaded). `ModelPicker.onSelectBrowserModel` is now `async`, awaited before persisting via the same `chat.setModel` mutation every other model uses — the popover stays open through the load and only closes once the model is ready (or the selection is aborted on a load failure).
- **`chat.recordBrowserTurn`** (`browser-turn.ts`): one Drizzle transaction writes the user message, a `chat_runs` row (`agent_id: "chat-agent-v1"` — the SAME id the server agent uses, SEAM-04), the assistant message, `started`/terminal `chat_run_events`, and a `chat_cost_ledger` row (`execution_locus: "browser"`, `cost_usd: "0"`, real `input_tokens`/`output_tokens` — D-22). Row-shape computation is the pure, exported `buildBrowserTurnRows` helper, unit-tested DB-free (11 tests, `browser-turn.test.ts`) per this codebase's established no-ctx.db-mocking convention. Also touches `chat_conversations.model_id`/`title`/`updated_at` on the first turn (mirrors the server agent's `touch()` behavior) so browser-only conversations get a correct title snippet and rail ordering.
- **`ConversationView` locus branch** (`page.tsx`): looks up the selected model's `execution_locus` from `chat.models` (never a hardcoded model-id comparison) and branches `send`/`stop` between the existing `useChatStream` (server, SSE) and a new `runWebllmTurn` (browser, local) — both feed the exact same `{parts, state}` shape into the SAME `MessageList`/`Composer`/`GeneratingIndicator`. A single top-level `useWebllmEngine()` instance lives in `ChatPage` and is threaded down, so the engine is never re-instantiated (or re-downloaded) when the user switches conversations.

## Task Commits

Each task was committed atomically:

1. **Task 1: Install web-llm + engine hook + picker entry activation** - `d28ae3d` (feat)
2. **Task 2: Browser-locus send branch + recordBrowserTurn persistence** - `4e7afa8` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `apps/web/src/app/chat/_hooks/use-webllm-engine.ts` — `useWebllmEngine` hook (WebGPU detect, lazy dynamic-import engine singleton, generateStream, interrupt)
- `apps/web/src/app/chat/_components/webllm-loading.tsx` — `WebLLMLoading` (inline Progress + label)
- `apps/web/src/app/chat/_components/model-picker-entry.tsx` — browser-locus row states (disabled/loading/ready)
- `apps/web/src/app/chat/_components/model-picker.tsx` — async `onSelectBrowserModel` gate before persisting
- `apps/web/src/app/chat/page.tsx` — `ChatPage`'s single `useWebllmEngine()`; `ConversationView`'s data-driven locus branch (`isBrowserLocus`, `runWebllmTurn`, `handleStop`, `toWebllmMessages`)
- `apps/web/package.json` — `@mlc-ai/web-llm` dependency
- `packages/api-client/src/router/chat/browser-turn.ts` — `recordBrowserTurn` mutation + `buildBrowserTurnRows`/`titleSnippetFor` pure helpers
- `packages/api-client/src/router/chat/__tests__/browser-turn.test.ts` — 11 DB-free tests
- `packages/api-client/src/router/chat/index.ts` — registers `browserTurnProcedures` in `chatRouter`
- `apps/email-listener/app/domain/services/chat_model_registry.py` — browser entry id/display_name repointed to Qwen3-4B (Rule 1 fix)
- `apps/email-listener/tests/test_chat_provider_router.py` — `_BROWSER_MODEL_ID` literal updated to match
- `apps/email-listener/tests/test_cost_ledger_repository.py` — example `model_id` literal updated to match

## Decisions Made

See `key-decisions` in frontmatter for full rationale on: the Qwen3-4B registry repoint (Rule 1, cross-file), the async `onSelectBrowserModel` seam signature change, the DB-free test convention for `recordBrowserTurn` (mirrors 22-10's precedent), the `chat_conversations.touch()`-equivalent write, and the minimal Stop/`interruptGenerate()` support.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, cross-file] Repointed the browser registry entry from Gemma-3-4B to Qwen3-4B**
- **Found during:** Task 1, immediately after installing `@mlc-ai/web-llm` and inspecting its bundled `prebuiltAppConfig` model list for the exact WebLLM model id to load.
- **Issue:** The FastAPI registry entry shipped in 22-02 (`chat_model_registry.py`) is `id="webllm-gemma-3-4b"` / `display_name="Gemma 3 4B (in-browser)"`. The vetted, now-installed `@mlc-ai/web-llm@0.2.84` package's `prebuiltAppConfig` has NO Gemma-3-4B build — only `gemma-2-*` variants and `gemma3-1b-it` (Gemma 3 at 1B, not 4B). Loading the smaller 1B model while the picker still advertised "Gemma 3 4B" would have been a real, user-visible honesty violation (a network inspection would show a completely different model downloading than the UI claims) — squarely against this phase's own D-05/D-06 "never omit/misrepresent a capability" contract.
- **Fix:** Confirmed `Qwen3-4B-q4f16_1-MLC` IS a real, available 4B-class prebuilt in the installed package (grepped `node_modules/@mlc-ai/web-llm/lib/index.js` for every `qwen`/`gemma` model-id literal to verify). D-08's own context text ("one small model (e.g. Qwen3 4B or Gemma 3 4B via WebLLM/WebGPU)") already named Qwen3-4B as an equally acceptable curated choice, so this is a substitution within the decision's own sanctioned alternatives, not a new architectural decision. Updated `chat_model_registry.py`'s browser entry (`id`, `display_name`, explanatory comment) and the two Python test files that referenced the old literal id (`test_chat_provider_router.py`, `test_cost_ledger_repository.py`) to match.
- **Files modified:** `apps/email-listener/app/domain/services/chat_model_registry.py`, `apps/email-listener/tests/test_chat_provider_router.py`, `apps/email-listener/tests/test_cost_ledger_repository.py`
- **Verification:** `uv run pytest tests/test_chat_model_registry.py tests/test_chat_provider_router.py tests/test_cost_ledger_repository.py -q --no-cov` — all 27 tests pass.
- **Commit:** `d28ae3d` (Task 1)

**2. [Rule 2 - missing critical functionality] Added minimal Stop support for the browser locus**
- **Found during:** Task 2, wiring the composer's existing `onStop` prop.
- **Issue:** The plan's Task 2 action text describes only the send path; without any change, clicking Stop during a browser-locus generation would silently do nothing (the composer's `onStop` was hardwired to `chatStream.stop`, which has no effect on a WebLLM generation) — a regression relative to CHAT-03's already-shipped, phase-wide Stop contract.
- **Fix:** Added `useWebllmEngine.interrupt()` (wraps `engine.interruptGenerate()`) and a `ConversationView.handleStop` that branches on `isBrowserLocus`; a ref tracks whether Stop was requested so the terminal status recorded (both client-side rendering and `recordBrowserTurn`'s persisted `status`) is honestly `"stopped"` rather than `"completed"`/`"failed"`.
- **Files modified:** `apps/web/src/app/chat/_hooks/use-webllm-engine.ts`, `apps/web/src/app/chat/page.tsx`
- **Verification:** `apps/web` `tsc --noEmit` clean, `next build` green (no manual WebGPU browser verification possible in this environment — see Issues Encountered).
- **Commit:** `4e7afa8` (Task 2)

No Rule 4 (architectural) escalations were needed — every file this plan touches already had an established seam (22-10's typed `onSelectBrowserModel` prop, `@nauta/ui`'s existing `Progress`/`Badge`/`Command` primitives, the `entities/mutations.ts`/`chat/cost.ts` Drizzle + Zod-at-boundary pattern) with no layering conflicts. The Qwen3-4B registry repoint touches a file outside this plan's declared `files_modified` list (`apps/email-listener/app/domain/services/chat_model_registry.py`), but is a same-shape, non-architectural string-literal correction (id/display_name/comment only — no schema, capability, or pricing change) required for this plan's own truth ("loads and runs locally via WebGPU" — with the model it actually claims to run) to hold.

## Known Stubs

None — the browser model is a real, functional locus end-to-end (load → stream → persist) for machine-verifiable gates. See "Manual Verification Deferred" below for the one thing that genuinely cannot be checked without a live WebGPU browser.

## Issues Encountered

- **No WebGPU/browser environment available in this session.** Per the standing overnight-autonomous-session directive, live browser-GPU verification (select the model → watch it download → confirm it streams a reply → confirm it persists across reload; confirm the disabled-row caption in a non-WebGPU browser) is **deferred as human_needed**. All machine-checkable gates passed instead:
  - `apps/web` `tsc --noEmit` — clean (both after Task 1 and after Task 2)
  - `apps/web` `next build` — compiled successfully; `/chat` route grew only 122 kB / 328 kB First Load JS (from 118 kB / 292 kB in 22-10) — confirms the dynamic `import("@mlc-ai/web-llm")` genuinely kept the ~13MB package out of the bundle rather than silently inlining it
  - `apps/web` `vitest run` — 20/20 tests passing (pre-existing suite, unaffected)
  - `packages/api-client` `vitest run` — 173/173 tests passing (11 new in `browser-turn.test.ts`)
  - `apps/email-listener` `pytest tests/test_chat_model_registry.py tests/test_chat_provider_router.py tests/test_cost_ledger_repository.py` — 27/27 passing after the Qwen3-4B registry repoint
- **No other issues.** Both tasks' machine gates passed on the first implementation attempt (the registry-model-id discovery in the deviation above was found and fixed during Task 1's own read-first/verify step, before any downstream code depended on the wrong id).

## User Setup Required

None for this plan's own code. Live end-to-end verification (once a WebGPU-capable browser is available) requires nothing beyond what's already shipped — no new environment variables, no external services (the model weights are fetched client-side directly from the public MLC-AI HuggingFace CDN, not proxied through this app's servers).

## Threat Flags

None beyond what the plan's own `<threat_model>` already enumerated (T-22-40 through T-22-43) — all implemented exactly as dispositioned:
- T-22-40 (forged/oversized browser-turn payload): `recordBrowserTurnInputSchema` bounds `userText`/`assistantText` to 100,000 chars and token counts to 1,000,000; all inserts are parameterized Drizzle builders.
- T-22-41 (XSS via untrusted browser-model text): browser-turn text renders through the SAME sanitized `MarkdownRenderer` (22-03) as every other turn — no new render path was introduced; the browser locus never offers `emit_ui_spec` (D-08), so there is no code path capable of persisting a `genui_spec`/tool-call part from a browser turn at all.
- T-22-42 (browser usage untracked): every browser turn writes a `chat_cost_ledger` row with `execution_locus="browser"`, `cost_usd="0"`, and the REAL captured `input_tokens`/`output_tokens` (never zeroed defensively) — confirmed by `browser-turn.test.ts`'s Test 2.
- T-22-43 (browser model reaching server tools/data): `generateStream()`'s request never includes a `tools` array; `recordBrowserTurn` is a fixed-shape write (Zod-validated text + counts) with no path to invoke any other procedure or forward arbitrary data server-side.
- T-22-SC (supply-chain: `@mlc-ai/web-llm` + CDN weights): the package-legitimacy checkpoint was resolved (see audit above) before install; the engine + its weights are loaded lazily (dynamic import, `ensureLoaded()` only fires on user selection) — never touched at build or first paint.

## Next Phase Readiness

- Phase 22 (Chat Spine + Persistence + Streaming) is now **feature-complete**: all 11 plans executed. The chat spine (persistence, streaming, cost breaker, model picker, regenerate/error-recovery, and now the browser/WebLLM locus) is live end-to-end for both server- and browser-executed models.
- The `execution_locus` branch point in `ConversationView` (`page.tsx`) and the registry-driven `ModelPicker` are both explicitly designed to extend to a future `remote-peer` locus (D-09's sovereign/distributed-inference seam) without a renderer rewrite — only a new branch arm and a new registry transport value would be needed.
- Manual WebGPU browser verification (the one item this session could not machine-check) is the natural first smoke-test once a connected/graphical environment is available for this milestone.

---
*Phase: 22-chat-spine-persistence-streaming*
*Completed: 2026-07-03*

## Self-Check: PASSED

All 4 created files confirmed present on disk (`use-webllm-engine.ts`, `webllm-loading.tsx`, `browser-turn.ts`, `browser-turn.test.ts`); all 8 modified files confirmed present with expected content; both task commits (`d28ae3d`, `4e7afa8`) confirmed present in `git log --oneline --all`.
