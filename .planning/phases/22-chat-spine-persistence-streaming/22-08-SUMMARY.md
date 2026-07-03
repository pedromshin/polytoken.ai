---
phase: 22-chat-spine-persistence-streaming
plan: 08
subsystem: chat-streaming-ui
tags: [nextjs, sse, react, streaming, chat, markdown, tanstack-query]

# Dependency graph
requires:
  - phase: 22-03 (MarkdownRenderer)
    provides: sanitized assistant-markdown renderer consumed for every text part
  - phase: 22-05 (chat spine persistence + rail UI)
    provides: chat tRPC router (getHistory/listConversations/createConversation),
      /chat route + rail shell with a placeholder conversation-view slot
  - phase: 22-07 (FastAPI SSE + emit_ui_spec tool)
    provides: POST /v1/chat/stream + /v1/chat/regenerate (X-API-Key-gated
      text/event-stream endpoints), the ChatRunEvent frame shape this plan's
      proxy/hook consume verbatim
provides:
  - "Next.js SSE proxy routes (/api/chat/stream, /api/chat/regenerate) injecting
    EMAIL_LISTENER_API_KEY server-side (D-24) — the ONLY place the chat streaming
    key is read"
  - "useChatStream hook: parseSseChunk + applyRunEvent pure helpers folding a raw
    SSE byte stream into an idle->streaming->terminal state machine with D-18
    interleaved text/genui_spec parts"
  - "MessageList/MessageTurn/Composer/JumpToBottomButton — the first end-to-end
    streamed conversation UI wired into /chat"
affects: [22-09 (regenerate siblings, error recovery, progressive genui —
  GenuiPartBoundary replaces this plan's Card placeholder), 22-10 (model
  picker + cost meter mount in the same toolbar/composer area), 22-11]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fetch + ReadableStream.getReader() SSE consumption (no EventSource) —
      required because EventSource cannot send a POST body or custom headers;
      the browser fetches the Next.js proxy (never FastAPI directly) exactly
      as a normal streaming POST."
    - "Chunk-boundary-safe SSE parser: parseSseChunk(buffer, chunk) returns
      {events, remainder} — a frame split across two reads is buffered and
      reassembled on the next chunk rather than dropped or corrupted."
    - "Pure accumulator reducer (applyRunEvent) mirrors the Python
      _TurnState/_apply_delta split from run_chat_turn.py (22-07) almost
      exactly on the client: text_delta_checkpoint merges into the trailing
      text part, tool_result finalizes a genui_spec part, five terminal event
      types settle `state` without touching `parts` again."
    - "Radix ScrollArea viewport access via its own
      data-radix-scroll-area-viewport attribute (queried once mounted) —
      @nauta/ui/scroll-area only forwards a ref to the non-scrolling Root, so
      auto-scroll/jump-to-bottom logic needs the actual viewport DOM node."
    - "Send<->Stop as ONE button element (variant/icon swap by state), not two
      conditionally-rendered buttons — avoids any layout shift or focus loss
      across the morph (22-UI-SPEC.md Accessibility)."

key-files:
  created:
    - apps/web/src/app/api/chat/stream/route.ts
    - apps/web/src/app/api/chat/regenerate/route.ts
    - apps/web/src/app/chat/_hooks/use-chat-stream.ts
    - apps/web/src/app/chat/_hooks/__tests__/use-chat-stream.test.ts
    - apps/web/src/app/chat/_components/message-list.tsx
    - apps/web/src/app/chat/_components/message-turn.tsx
    - apps/web/src/app/chat/_components/composer.tsx
    - apps/web/src/app/chat/_components/jump-to-bottom-button.tsx
  modified:
    - apps/web/src/app/chat/page.tsx

key-decisions:
  - "Test file placed at _hooks/__tests__/use-chat-stream.test.ts, not the
    plan frontmatter's literal _components/__tests__/ path — the plan's own
    <verify> command for Task 1 explicitly names the _hooks/__tests__ path
    (matching where use-chat-stream.ts itself lives, and the established
    colocated-test convention from 22-03's markdown-renderer.test.tsx). Took
    the more specific, executable signal (the verify command) over the
    frontmatter listing."
  - "getListenerConfig() is duplicated inline in BOTH route.ts files rather
    than extracted to a shared module — the plan's own acceptance grep
    (`grep -c EMAIL_LISTENER_API_KEY apps/web/src/app/api/chat/stream/
    route.ts`) requires the literal string to appear IN route.ts itself; an
    extracted shared helper would make that grep return 0 (the same class of
    self-inflicted grep false-negative documented in 22-03/22-05's
    deviations, avoided here by not creating the shared file at all)."
  - "ConversationView is a function component defined inside page.tsx (not a
    new file) — Task 3's action text says 'wire ... into page.tsx's
    conversation view (replacing the 22-05 placeholder)' and page.tsx is the
    only file the plan's frontmatter lists as modified for this task; kept
    the wiring logic (useChatStream, optimistic state, getHistory merge) in
    that one file rather than introducing an undeclared component file."
  - "Only chat.getHistory rows with isActive=true are rendered — the D-16
    sibling-version column exists from 22-01/22-05 but no regenerate UI is
    wired yet in this plan (deferred to 22-09), so filtering to the active
    row is a defensive default: once regenerate does land, un-filtered
    history would otherwise render every retired sibling as a separate,
    confusing duplicate turn."
  - "A visually-hidden aria-live=\"polite\" announcer (state transitions
    only — 'Generating response' / 'Response complete' / etc., never the
    growing delta text) was added in ConversationView even though no task's
    <acceptance_criteria> line item names it explicitly — 22-UI-SPEC.md's
    Accessibility section specifies this exact contract and the plan's
    <context> block names the UI-SPEC as binding for a11y; treated as a
    Rule 2 (missing critical accessibility functionality), not scope creep."

requirements-completed: [CHAT-01, CHAT-03, CHAT-06, CHAT-07, STREAM-01]

# Metrics
duration: ~35min
completed: 2026-07-03
---

# Phase 22 Plan 08: Streamed Chat Core Summary

**End-to-end streamed chat: a Next.js SSE proxy injecting the FastAPI API key server-side, a `useChatStream` hook folding the SSE frames into an idle→streaming→terminal state machine, and a MessageList/Composer that actually stream a live conversation with optimistic send, auto-scroll, and a Stop button.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-03
- **Tasks:** 3/3 completed
- **Files:** 8 created, 1 modified

## Accomplishments

- **SSE proxy routes** (`/api/chat/stream`, `/api/chat/regenerate`): read `EMAIL_LISTENER_URL`/`EMAIL_LISTENER_API_KEY` at request time, Zod-validate the request body (defense-in-depth mirroring FastAPI's own Pydantic models), forward to FastAPI with `X-API-Key`, and pipe the upstream body straight through as `text/event-stream` — the key never reaches client-importable code (D-24, T-22-29; grep gate: 0 `NEXT_PUBLIC` references, ≥1 `EMAIL_LISTENER_API_KEY` reference in each route file).
- **`useChatStream`**: consumes the proxied stream via `ReadableStream.getReader()`, decoding chunks through two pure, independently unit-tested helpers — `parseSseChunk` (chunk-boundary-safe frame splitting, malformed/unknown-`type` frames silently dropped, T-22-30) and `applyRunEvent` (folds one `ChatRunEvent` into a running `{parts, state}` accumulator, preserving D-18 interleaved text/genui_spec order). Exposes `{ state, parts, send(userText, modelId), regenerate(assistantMessageId, modelId), stop() }`. `stop()` aborts via `AbortController`; the resulting abort resolves to `state: 'stopped'` internally and is never re-thrown (T-22-32).
- **MessageList/MessageTurn**: renders turns in a `max-w-3xl` reading column; text parts through `MarkdownRenderer` (22-03), `genui_spec` parts as a bordered `Card` placeholder (real `GenuiPartBoundary` arrives in 22-09). Auto-scroll sticks to the bottom while streaming unless the user has scrolled away, in which case `JumpToBottomButton` appears (reads the Radix `ScrollArea`'s `data-radix-scroll-area-viewport` attribute for scroll-position tracking). `GeneratingIndicator` reuses `generation-state-chrome.tsx`'s `Loader2` + "Generating…" idiom, visible only while `state === 'streaming'`.
- **Composer**: 44px-min auto-growing textarea (`max-h-52`), Enter submits / Shift+Enter newlines, disabled while streaming (CHAT-06). Send morphs into Stop in the same button slot — one element, icon/variant swap, no layout shift (CHAT-03) — and focus stays in the textarea across submit.
- **`/chat` wiring**: `ConversationView` (inside `page.tsx`) merges `chat.getHistory` (filtered to `isActive` rows) with the live streaming turn, optimistically renders the user's message the instant it's submitted, and invalidates `chat.getHistory` on every terminal state so the persisted row replaces the transient streamed parts on the next read. The conversation's own `modelId` (from `chat.listConversations`) feeds `send()`, honoring D-10's remembered-model default from 22-05.
- **Accessibility**: a visually-hidden `aria-live="polite"` announcer reports state transitions only ("Generating response" / "Response complete" / "Response stopped by user" / "Response failed" / "Cost limit reached") — never the growing delta text, per 22-UI-SPEC.md.

## Task Commits

Each task was committed atomically (Task 1 split RED/GREEN per its `tdd="true"` frontmatter):

1. **Task 1 RED — failing parser/state-machine tests** - `db998d9` (test)
2. **Task 1 GREEN — SSE proxy routes + useChatStream** - `43fca45` (feat)
3. **Task 2 — MessageList/MessageTurn + jump-to-bottom + generating indicator** - `ec8bb22` (feat)
4. **Task 3 — Composer + conversation-view wiring** - `0f1fe57` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `apps/web/src/app/api/chat/stream/route.ts` — SSE proxy for `POST /v1/chat/stream`
- `apps/web/src/app/api/chat/regenerate/route.ts` — SSE proxy for `POST /v1/chat/regenerate`
- `apps/web/src/app/chat/_hooks/use-chat-stream.ts` — `parseSseChunk`/`applyRunEvent` pure helpers + `useChatStream` hook
- `apps/web/src/app/chat/_hooks/__tests__/use-chat-stream.test.ts` — 9 unit tests (parser + state-machine + D-18 interleaving)
- `apps/web/src/app/chat/_components/message-list.tsx` — `MessageList` + `GeneratingIndicator`
- `apps/web/src/app/chat/_components/message-turn.tsx` — `MessageTurn` (interleaved parts, streaming caret)
- `apps/web/src/app/chat/_components/composer.tsx` — `Composer` (Send↔Stop morph)
- `apps/web/src/app/chat/_components/jump-to-bottom-button.tsx` — `JumpToBottomButton`
- `apps/web/src/app/chat/page.tsx` — `ConversationView` + rail/toolbar wiring (replaces 22-05's placeholder)

## Decisions Made

See `key-decisions` in frontmatter for full rationale on: the test file's actual path (verify-command signal over frontmatter listing), duplicating `getListenerConfig()` inline in both route files (grep-gate-driven), keeping `ConversationView` inside `page.tsx` rather than a new file, filtering history to `isActive` rows defensively, and adding the `aria-live` announcer per the UI-SPEC's binding accessibility contract.

## Deviations from Plan

### Auto-fixed Issues

None required a fix-in-place during implementation — the three items below are **discretionary implementation choices** (Claude's-discretion per 22-CONTEXT.md), not corrections to broken behavior, and are recorded in `key-decisions` rather than here as Rule 1/2/3 fixes:

- Test file path (`_hooks/__tests__/` vs. the frontmatter's `_components/__tests__/`).
- `getListenerConfig()` duplicated per-route-file instead of extracted to a shared module.
- `aria-live="polite"` announcer added (Rule 2 — missing critical accessibility functionality per the binding UI-SPEC contract), the closest thing to an auto-fix in this plan.

No Rule 4 (architectural) escalations were needed — the plan's file split and interfaces matched the existing codebase's conventions (mutations.ts's `X-API-Key` fetch pattern, the trpc route.ts precedent, MarkdownRenderer's existing export) with no layering conflicts.

## Known Stubs

- **`genui_spec` parts render as a static bordered `Card` placeholder** (`message-turn.tsx`): "Interactive widget — renders here in a later plan (22-09)". This is explicit, plan-sanctioned scope — Task 2's own `<action>` text says "genui parts as a bordered Card placeholder for now — the real GenuiPartBoundary arrives in 22-09." Not a gap; resolved by 22-09.
- **`useChatStream.regenerate()` is implemented but has no UI entry point yet** — no `SiblingNav`/regenerate button exists in this plan's `MessageTurn`/`TurnActionRow` (that mechanic, plus error-recovery `Retry` and the `InlineErrorCard`/`CostCapBlockedCard` status markers, are explicitly deferred to 22-09 per this plan's own objective text: "Rich mechanics (regenerate siblings, error recovery, progressive genui) layer on in 22-09"). The hook's `regenerate` function is exported and ready for 22-09 to wire up.

## Issues Encountered

None. All three tasks' machine gates passed on the first implementation attempt: `pnpm vitest run src/app/chat/_hooks` (9/9 tests), `apps/web` `tsc --noEmit` (clean after every task), and `next build` (compiled successfully, `/chat` route + both new API routes registered) — re-verified once more after all three tasks landed (full `src/app/chat` vitest suite: 14/14 tests passing, including the pre-existing `markdown-renderer.test.tsx`).

Manual browser verification (send → live stream → persists across reload; Enter/Shift+Enter; Stop keeps the partial) is **deferred** per the standing overnight autonomous-session directive — machine gates only for this session.

## User Setup Required

None for this plan's own code. Running the live streamed flow end-to-end requires `EMAIL_LISTENER_URL`/`EMAIL_LISTENER_API_KEY` to be set in the web app's environment (already required by every other FastAPI-proxying tRPC mutation in this codebase — no new env var introduced) and a running `apps/email-listener` instance exposing the 22-07 `/v1/chat/stream` endpoints.

## Threat Flags

None beyond what the plan's own `<threat_model>` already enumerated (T-22-29 through T-22-32) — all implemented exactly as dispositioned:
- T-22-29: `EMAIL_LISTENER_API_KEY` read only inside each route handler's local `getListenerConfig()`, at request time; grep gate confirms 0 `NEXT_PUBLIC` references in `apps/web/src/app/api/chat/`.
- T-22-30: every SSE frame is defensively JSON-parsed; malformed JSON and unrecognized `type` values are dropped in `parseSseChunk`/`toChatRunEvent`, never thrown — covered by 2 dedicated unit tests.
- T-22-31: all text parts (user and assistant) render through the 22-03 sanitized `MarkdownRenderer`; no `dangerouslySetInnerHTML` anywhere in this plan's files.
- T-22-32: `stop()`'s `AbortController` plus the existing 22-07 server-side cost breaker and disconnect-cancellation handling together bound a runaway client stream; the proxy also forwards the Next.js request's own `AbortSignal` to the upstream `fetch`, so a browser-side abort propagates toward FastAPI's disconnect polling as well as being caught client-side.

## Next Phase Readiness

- The full send → stream → persist → reload loop is live: `useChatStream.send()` hits the proxy, the proxy hits FastAPI's `/v1/chat/stream` (22-07), events fold into `parts`/`state`, and on any terminal state `chat.getHistory` is invalidated so the next read shows the persisted row (22-05/22-06).
- `useChatStream.regenerate()` and the `genui_spec` Card placeholder are the exact seams 22-09 fills: wiring a `SiblingNav`/regenerate action in `MessageTurn`'s action row, and swapping the placeholder `Card` for the real schema-validated, progressively-rendering `GenuiPartBoundary`.
- 22-10's model picker + cost meter mount into the same toolbar area this plan left available above `MessageList` (currently just the rail-collapse top bar).

---
*Phase: 22-chat-spine-persistence-streaming*
*Completed: 2026-07-03*

## Self-Check: PASSED

All 8 created files confirmed present on disk; `page.tsx`'s modification confirmed; all 4 task commits (`db998d9`, `43fca45`, `ec8bb22`, `0f1fe57`) confirmed present in `git log --oneline --all`.
