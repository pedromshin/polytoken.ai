---
phase: 39-tool-round-ui-citation-chips
verified: 2026-07-09T08:00:00Z
status: human_needed
score: 12/12 must-haves verified (code-level)
overrides_applied: 0
human_verification:
  - test: "Live in-round activity affordance: send a chat message that triggers a real server tool (lookup_entity/search_emails/search_knowledge) against a running FastAPI backend + Next.js dev server, and observe the transcript while the round is in flight"
    expected: "A ToolRoundActivityRow (Loader2 spinner + gerund label, e.g. 'Searching knowledge…') appears DURING the round — not after a page refresh, not stuck, not delayed — then is replaced in-place by a collapsed ToolInvocationResultRow (label + result count + up to 5 real ProvenanceLink citation chips, or a '+N' overflow badge) the instant the round settles"
    why_human: "Code confirms the correct SSE mirror frames are emitted (server_tool_call/server_tool_result), the correct part-array replace-or-append logic exists in applyRunEvent, and the correct components are wired into message-turn.tsx's part switch — all proven by 37 passing unit tests across use-chat-stream.test.ts/provenance-link.test.tsx/tool-invocation-result-row.test.tsx. But actual live-stream timing (does the spinner appear the instant the round starts, does it visibly precede the result row with no flash/flicker), animation smoothness (motion-safe:animate-in/fade-in), and real chip rendering against a live Bedrock-backed tool round require a running connected stack + browser, which was not available in this execution/verification session (no playwright-core in this repo's dependency tree — confirmed by the executor and independently by this verifier)"
  - test: "Citation chip visual legibility and deep-link round-trip: click/middle-click a rendered ProvenanceLink chip"
    expected: "Chip shows the correct icon (Mail/Box/Share2) per kind, truncates gracefully at 160px, and middle-click/ctrl-click opens /emails/[id], /entities/[id], or /knowledge?focus={id} in a new tab without a full page reload disruption"
    why_human: "hrefFor's routing switch and the real <Link> (non-onClick-only) element are code/test-verified (mount test in provenance-link.test.tsx confirms href attribute + text content), but real new-tab-open behavior and visual truncation/legibility need a live browser"
---

# Phase 39: Tool-Round UI + Citation Chips Verification Report

**Phase Goal:** `/chat` visibly surfaces in-progress tool rounds and renders every tool result's
citations as chips through one shared `<ProvenanceLink>` primitive — closing the FOUND-7 UI gap and
building the primitive Phase 41's preview node will also consume.
**Verified:** 2026-07-09
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + PLAN must_haves, merged)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 (SC1) | `/chat` emits a UI delta while a tool round is in progress, visibly rendering a "searching knowledge…" (or equivalent) affordance during the round | ✓ VERIFIED (code-level) | `run_chat_turn.py:1220` constructs `ChatRunEvent(type="server_tool_call", data={"tool_name": tool_name, "id": tool_id})` immediately after the existing `tool_call` emit; `use-chat-stream.ts`'s `server_tool_call` branch (line 369) folds it into a `tool_invocation_streaming` part; `message-turn.tsx` line 210-212 renders `<ToolRoundActivityRow toolName={part.toolName} />` with the exact gerund-label map ("Searching knowledge…" for `search_knowledge`, etc.) from `tool-round-activity-row.tsx`. Live browser timing/appearance → human verification below. |
| 2 (SC2) | The `tool_call`/`tool_result` run-event types (already in the DB CHECK constraint) are now actually rendered as UI deltas — the pre-existing wiring silently mis-folded them into a stuck, empty `interactive_widget_streaming` skeleton | ✓ VERIFIED | Achieved via 2 new non-persisted mirror frame types (`server_tool_call`/`server_tool_result`, a documented Claude's-discretion naming choice per `39-CONTEXT.md`/`39-UI-SPEC.md`, since reusing the literal `tool_call`/`tool_result` strings would collide with the pre-existing `emit_ui_spec` reducer) PLUS a structural collision guard added as the first statement of `applyRunEvent`'s existing `tool_call` branch (`use-chat-stream.ts:302-304`: `if (typeof event.data.partial_json !== "string") return { parts: acc.parts, state: "streaming" };`, positioned before any destructuring). Proven by 2 dedicated regression tests (`"a PERSISTED-shaped tool_call event ... leaves parts completely UNCHANGED — the naming-collision fix"` and its non-empty-accumulator variant), both passing, plus all 15 pre-existing `partial_json`-bearing tests in the same describe block still passing unchanged. |
| 3 (SC3) | Tool results render inline citation chips through ONE shared `<ProvenanceLink kind id />` primitive | ✓ VERIFIED | `tool-invocation-result-row.tsx`'s `CitationChips` renders exclusively via `<ProvenanceLink kind={citation.kind} id={citation.id} />` (line 110-114) — no other chip-rendering path exists in the new surface. Capped at `MAX_VISIBLE_CHIPS = 5` with a non-link `+N` `<span>` overflow badge; deduped by `${kind}:${id}` before slicing; zero citations after dedup renders no chip container. Never the full result JSON (`grep "{content}"` on the file returns zero matches). |
| 4 (SC4) | Citation chips deep-link correctly to `/emails/[id]`, `/entities/[id]`, or `/knowledge?focus={id}` depending on `kind` | ✓ VERIFIED | `provenance-link.tsx`'s `hrefFor` (line 43-52) is a fixed 3-way switch, `encodeURIComponent`-wrapped, returning exactly those 3 paths. It reads `kind`+`id` only — a citation's own `route` field is parsed into `ParsedCitation.route` in `tool-invocation-result-row.tsx` but never passed to `<ProvenanceLink>` or `<Link href>` (T-39-05 mitigation, confirmed by reading both files). |
| 5 | A server-tool round emits `server_tool_call` at the same moment the persisted `tool_call` fires, and `server_tool_result` at the same moment `tool_result` fires | ✓ VERIFIED | `run_chat_turn.py:1213-1220` (call) and `1263-1288` (result) — both new `events.append(ChatRunEvent(...))` statements are the literal next statement after each existing persisted `_emit(...)` call, inside `_run_server_tool_round`. |
| 6 | Neither mirror frame is ever written to `chat_run_events` | ✓ VERIFIED | Both constructed via bare `ChatRunEvent(type=..., data=...)` — never `self._emit`/`self._runs.append_event` — leaving `id`/`run_id`/`seq` at dataclass defaults (`None`). `grep -n "server_tool_call\|server_tool_result"` on `run_chat_turn.py` shows neither string appears near `self._emit(`/`append_event(`. Test suite additionally asserts `fakes["runs"].events` (the persisted-event log) never contains either new type. |
| 7 | `server_tool_call`'s `data` omits `arguments` — exactly `{tool_name, id}` | ✓ VERIFIED | Line 1220: `data={"tool_name": tool_name, "id": tool_id}` — 2 keys only, `arguments` never included. |
| 8 | `server_tool_result`'s `data` mirrors the persisted `tool_result` event's data exactly | ✓ VERIFIED | Line 1281-1288 constructs `{"tool_name": tool_name, "id": tool_id, "content": tool_result_delta.content, "isError": tool_result_delta.is_error}` — same `tool_result_delta` values used 15 lines above for the persisted event. |
| 9 | `ChatRunEventType` widened additively — existing 10 entries unchanged, in the same order | ✓ VERIFIED | `chat_repositories.py:38-57` — original 10 entries (`started` … `interrupted`) preserved in exact order; `server_tool_call`/`server_tool_result` appended after, with an inline comment documenting the transport-only, non-persisted nature. |
| 10 | Zero DB/migration/CHECK-constraint changes | ✓ VERIFIED | `grep -rn "server_tool_call\|server_tool_result" packages/db/` → zero matches. |
| 11 | Every pre-existing `useChatStream`/chat-surface test stays green (additive-only) | ✓ VERIFIED | `use-chat-stream.test.ts`: 23/23 pass (8 new + 15 pre-existing, re-run directly). `npx vitest run src/app/chat`: 181/181 pass across 21 files (full chat-surface sweep, re-run directly). |
| 12 | Zero new npm deps, zero edits to the 3 locked renderer files, zero brand-accent (`primary`) color usage in new components | ✓ VERIFIED | `git diff 337afc6..HEAD --stat -- apps/web/package.json` → empty. `git diff 337afc6..HEAD --stat -- packages/genui/src/renderer/render-node.tsx packages/genui/src/renderer/spec-renderer.tsx apps/web/src/app/chat/_components/genui-part-boundary.tsx` → empty (all 3 locked files, at their real repo paths, byte-identical). `grep -n "primary\|ring-primary"` across the 3 new component files matches only a prose comment ("brand-accent (primary/teal) usage"), zero class usage. |

**Score:** 12/12 truths verified at the code level (static inspection + re-run automated tests, not
trusted from SUMMARY.md text). Truths 1 and (partially) 2 carry a live-browser/live-stream-timing
dimension that automated/static verification cannot exercise — routed to human verification below,
consistent with this project's established pattern (Phases 22/23/24/26/27/28/29/32).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/email-listener/app/domain/ports/chat_repositories.py` | `ChatRunEventType` widened additively | ✓ VERIFIED | Read in full; 10 original entries preserved in order, 2 appended with documentation comment |
| `apps/email-listener/app/application/use_cases/run_chat_turn.py` | `_run_server_tool_round` emits 2 mirror events at its 2 existing dispatch points | ✓ VERIFIED | Both `ChatRunEvent(type="server_tool_call"...)` / `ChatRunEvent(type="server_tool_result"...)` constructions read directly, confirmed exact placement and shape |
| `apps/email-listener/tests/application/test_run_chat_turn_tool_loop_e2e.py` | New tests proving emission/ordering/shape/non-persistence | ✓ VERIFIED | 13 tests total (11 pre-existing + 2 new), all pass (`uv run pytest ... -q --no-cov` re-run directly) |
| `apps/web/src/app/chat/_hooks/use-chat-stream.ts` | `MessagePart` +3 members, `ChatRunEventType`/`CHAT_RUN_EVENT_TYPES` +2, `applyRunEvent` collision guard + 2 new branches | ✓ VERIFIED | Full file read; all elements present at the exact lines cited above |
| `apps/web/src/components/provenance-link.tsx` | `ProvenanceLink`, `hrefFor`, `fallbackLabel` — named exports only | ✓ VERIFIED | 3 `export function` matches, 0 `export default`; file read in full, matches UI-SPEC anatomy verbatim |
| `apps/web/src/app/chat/_components/tool-round-activity-row.tsx` | `ToolRoundActivityRow` | ✓ VERIFIED | Read in full; `role="status"`, `Loader2` spinner, gerund label map, not wrapped in `GeneratingRing` |
| `apps/web/src/app/chat/_components/tool-invocation-result-row.tsx` | `ToolInvocationResultRow` | ✓ VERIFIED | Read in full; error/degraded/success anatomies all present, citation dedup+cap logic present, raw `content` never interpolated |
| `apps/web/src/app/chat/_components/message-turn.tsx` | 3 new `parts.map` branches wired | ✓ VERIFIED | `tool_invocation_streaming` → `ToolRoundActivityRow`, `tool_invocation` → `null`, `tool_invocation_result` → `ToolInvocationResultRow`, all confirmed at lines 210-229 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `_run_server_tool_round` | `chat_stream.py`'s SSE wire | existing `events` list → `_ServerRoundResult.events` → `_RoundAdvance.events` → `_execute_turn`'s `for event in advance.events: yield event` | ✓ WIRED | Confirmed unchanged in `chat_stream.py` (zero edits needed, `_format_sse_event` serializes generically); both new events reach the same `events` list `_run_server_tool_round` already returns |
| `use-chat-stream.ts`'s `applyRunEvent` | `message-turn.tsx` | `MessagePart` union's 3 new part types feeding the existing `parts.map` switch | ✓ WIRED | `part.toolName`/`part.content`/`part.isError` field names match exactly between the union definition and the component props consuming them |
| `message-turn.tsx` | `provenance-link.tsx` | `ToolInvocationResultRow`'s `CitationChips` rendering `<ProvenanceLink kind={...} id={...} />` | ✓ WIRED | Confirmed at `tool-invocation-result-row.tsx:110-114`, import at line 17 |
| `apps/email-listener`'s `server_tool_call`/`server_tool_result` SSE frames | `apps/web`'s `applyRunEvent` branches | the SSE wire, both sides built independently against `39-UI-SPEC.md`'s contract table | ✓ WIRED (contract-level) | Python `data` shapes (`{tool_name, id}` / `{tool_name, id, content, isError}`) match the TS branches' field reads (`event.data.id`/`event.data.tool_name`/`event.data.content`/`event.data.isError`) exactly; no runtime coupling to verify beyond shape match, per the plans' own design |

### Behavioral Spot-Checks / Test Runs (re-run directly by this verifier, not trusted from SUMMARY.md)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 39-01 targeted e2e file | `cd apps/email-listener && uv run pytest tests/application/test_run_chat_turn_tool_loop_e2e.py -q --no-cov` | 13 passed | ✓ PASS |
| 39-01 broader Phase-34 regression sweep | `uv run pytest tests/application/test_run_chat_turn_tool_loop_e2e.py tests/application/test_run_chat_turn.py tests/application/test_run_chat_turn_tool_loop_bugfixes.py tests/application/test_run_chat_turn_tool_loop.py tests/support/test_echo_tool_executor.py -q --no-cov` | 54 passed | ✓ PASS |
| 39-01 mypy | `uv run mypy app/domain/ports/chat_repositories.py app/application/use_cases/run_chat_turn.py` | Success: no issues found in 2 source files | ✓ PASS |
| 39-01 ruff | `uv run ruff check app/application/use_cases/run_chat_turn.py app/domain/ports/chat_repositories.py` | All checks passed! | ✓ PASS |
| 39-01 lint-imports | `uv run lint-imports` | 3 kept, 0 broken | ✓ PASS |
| No DB/migration touch | `grep -rn "server_tool_call\|server_tool_result" packages/db/` | zero matches | ✓ PASS |
| Full Python workspace suite (spot-check, not required) | `uv run pytest -q --no-cov` | Same 10 pre-existing `test_genui_retrieval_provider.py` failures (Python 3.13 `asyncio.get_event_loop()` API-removal issue, confirmed unrelated to this phase's diff and identical to the failure set independently documented in `36-VERIFICATION.md`); all other tests passed, 6 expected skips (credentials-gated) — 0 regressions attributable to Phase 39 | ✓ PASS (no regressions) |
| 39-02 use-chat-stream targeted file | `cd apps/web && npx vitest run src/app/chat/_hooks/__tests__/use-chat-stream.test.ts` | 23/23 passed (includes both collision-guard regression tests) | ✓ PASS |
| 39-02 provenance-link + tool-invocation-result-row | `npx vitest run src/components/provenance-link.test.tsx src/app/chat/_components/__tests__/tool-invocation-result-row.test.tsx` | 14/14 passed (6 + 8) | ✓ PASS |
| 39-02 full chat-surface sweep | `npx vitest run src/app/chat` | 181/181 passed, 21 files, 0 regressions | ✓ PASS |
| 39-02 typecheck | `npx tsc --noEmit -p apps/web` | clean, zero errors | ✓ PASS |
| Locked renderer files byte-identical | `git diff 337afc6..HEAD --stat -- packages/genui/src/renderer/render-node.tsx packages/genui/src/renderer/spec-renderer.tsx apps/web/src/app/chat/_components/genui-part-boundary.tsx` | empty output | ✓ PASS |
| Zero new npm deps | `git diff 337afc6..HEAD --stat -- apps/web/package.json` | empty output | ✓ PASS |
| Zero brand-accent color in new files | `grep -n "primary\|ring-primary" apps/web/src/components/provenance-link.tsx apps/web/src/app/chat/_components/tool-round-activity-row.tsx apps/web/src/app/chat/_components/tool-invocation-result-row.tsx` | 1 match, a prose comment only ("brand-accent (primary/teal) usage") — zero class usage | ✓ PASS |

### Success Criteria — Plan-Level Verdicts

**39-01-PLAN.md `<success_criteria>` (5 items):**

| # | Criterion | Verdict |
|---|-----------|---------|
| 1 | `_run_server_tool_round` emits mirror events at the 2 existing dispatch points | ✓ PASS |
| 2 | Neither mirror event is ever persisted (dataclass defaults + fake repo call log) | ✓ PASS |
| 3 | `ChatRunEventType` widened additively, 10 existing entries unchanged/unreordered | ✓ PASS |
| 4 | Zero DB/migration/CHECK-constraint changes | ✓ PASS |
| 5 | Full Phase 34 tool-loop regression sweep stays green | ✓ PASS |

**39-02-PLAN.md `<success_criteria>` (5 items):**

| # | Criterion | Verdict |
|---|-----------|---------|
| 1 | `ToolRoundActivityRow` renders during a round, replaced by `ToolInvocationResultRow` on completion — never after a page refresh only | ✓ PASS (code-level) — live-browser timing confirmation → human |
| 2 | Citation chips render exclusively through `<ProvenanceLink kind id />`, real `<Link>`s, capped at 5 with "+N" overflow | ✓ PASS |
| 3 | The naming-collision regression is fixed and permanently test-guarded | ✓ PASS |
| 4 | Zero new npm deps, zero edits to 3 locked renderer files, zero brand-accent usage | ✓ PASS |
| 5 | Full pre-existing `apps/web` chat-surface + `use-chat-stream` test suites stay green | ✓ PASS |

### Scope Discipline

`git diff 5196c13..HEAD --stat` (5196c13 = commit immediately before Phase 39's first commit,
confirmed via `git log 35f5f54^`) shows exactly 16 files changed, all within
`.planning/**`/`apps/email-listener/app/**`/`apps/email-listener/tests/**`/`apps/web/src/**` — zero
migrations, zero `package.json`/lockfile touches, zero unrelated files. All 7 phase commits
(`35f5f54`, `c105608`, `337afc6`, `1c43b2a`, `5734699`, `1a3dc58`, `e4e78f7`) accounted for in `git
log`. Uncommitted working-tree changes present at verification time (`.claude/skills/...SKILL.md`,
`.planning/HANDOFF.json`, `infrastructure/aws/ecs.tf`, various untracked files) are confirmed
unrelated to Phase 39 — HEAD sits exactly at `e4e78f7`, the last Phase-39 commit, and none of those
working-tree paths appear in any Phase-39 commit's diff.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| TUI-01 | 39-01, 39-02 | `/chat` visibly surfaces in-progress tool rounds via emitted tool-round UI deltas | ✓ SATISFIED (code-level) | Mirror-frame emission (39-01) + `ToolRoundActivityRow`/`applyRunEvent` wiring (39-02); live-render confirmation → human |
| TUI-02 | 39-02 | Tool results render citation chips through ONE shared `<ProvenanceLink kind id />` primitive | ✓ SATISFIED | `provenance-link.tsx` + `ToolInvocationResultRow`'s exclusive use of it |

No orphaned requirements — `REQUIREMENTS.md` maps only TUI-01/TUI-02 to Phase 39, both declared and
satisfied by the 2 plans.

### Anti-Patterns Found

None. `grep -n -E "TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER"` across all 8 phase-touched source files
(both Python files, the e2e test file, and the 5 web files) → zero matches. `grep -n -i
"placeholder|coming soon|will be here|not yet implemented|not available"` across the 3 new web
components → zero matches.

### Human Verification Required

See YAML frontmatter `human_verification` — 2 items covering: (1) the live in-round activity-row →
result-row transition timing/animation against a real streaming tool round, and (2) citation-chip
visual legibility + new-tab deep-link behavior. Both are browser-rendering/live-stream-timing
behaviors that static code inspection and automated DOM-mount tests (`createRoot`+`act`) cannot
fully exercise. This is accurately and non-silently documented in `39-02-SUMMARY.md`'s "Visual
Check" section (`Outcome: human_needed` — no `playwright-core` in this repo's dependency tree,
standing up the full connected stack — FastAPI backend with live AWS/Bedrock credentials + Next.js
dev server + a real LLM tool round — was not a cheap operation in the execution session), and this
verifier independently confirmed the same environmental constraint (no `playwright-core` anywhere
in the dependency tree, `node_modules` or `apps/web/package.json`). Per the project's established
v1.3/v1.4/v1.5 precedent (`STATE.md` → Deferred Items — Phases 22/23/24/26/27/28/29/32 all closed
`human_needed` without blocking milestone progression), this is NOT treated as a phase failure —
every mechanism is proven in unmocked automated tests (real DOM mounts, real SSE-shaped event
folding, real `<a href>` computation), only the final pixel/timing confirmation is deferred.

### Gaps Summary

No code-level gaps. All 12 observable truths (4 ROADMAP success criteria + 8 plan-level must-haves,
merged and deduped) are verified against live code — re-read directly by this verifier, not trusted
from SUMMARY.md text. All 10 plan-level `<success_criteria>` items (5 per plan) pass. Both Python
and web regression sweeps were re-run directly and stayed green (67 Python tests across the
targeted 39-01 sweep, 181+37 web tests across the 39-02 sweeps). Locked-file byte-identity, zero-new-
npm-deps, and zero-brand-accent constraints all independently confirmed via `git diff`/`grep`, not
taken from SUMMARY claims. Scope discipline confirmed: all 7 phase commits touch only
`apps/email-listener/**`/`apps/web/**`/`.planning/**`, zero migrations. The one deliberate
architectural deviation from a literal reading of ROADMAP SC2 (new mirror frame types rather than
directly fixing `tool_call`/`tool_result` semantics) is a documented, justified Claude's-discretion
choice (39-CONTEXT.md explicitly delegates "exact SSE frame names/payloads") that achieves the same
observable outcome and is not treated as a gap. The only outstanding item is the live-browser visual/
timing confirmation, honestly and non-silently documented as `human_needed` by the executor and
independently reconfirmed here — consistent with this project's long-standing verification pattern,
not a phase failure.

---

_Verified: 2026-07-09_
_Verifier: Claude (gsd-verifier)_
