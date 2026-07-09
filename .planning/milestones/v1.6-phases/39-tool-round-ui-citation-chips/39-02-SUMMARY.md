---
phase: 39-tool-round-ui-citation-chips
plan: 02
subsystem: chat-transcript-ui
tags: [SSE, tool-loop, TUI-01, TUI-02, provenance-link, citation-chips, message-turn]
dependency_graph:
  requires:
    - "apps/web/src/app/chat/_hooks/use-chat-stream.ts (Phase 22-06/22-07 SSE fold state machine)"
    - "apps/web/src/app/chat/_components/message-turn.tsx (Phase 22-09/24 parts.map switch)"
    - "39-01 (sibling Python plan) -- server_tool_call/server_tool_result SSE mirror frames, same wire contract, no runtime coupling"
  provides:
    - "MessagePart union +3 members: tool_invocation_streaming/tool_invocation/tool_invocation_result"
    - "ChatRunEventType + CHAT_RUN_EVENT_TYPES +2 entries: server_tool_call/server_tool_result"
    - "applyRunEvent collision-guard fix for the tool_call/server-tool naming collision"
    - "ProvenanceLink, hrefFor, fallbackLabel (apps/web/src/components/provenance-link.tsx) -- named exports for Phase 41 reuse"
    - "ToolRoundActivityRow, ToolInvocationResultRow (apps/web/src/app/chat/_components/*)"
  affects:
    - "Phase 41 (knowledge-preview canvas node) -- will import ProvenanceLink/hrefFor unchanged"
tech_stack:
  added: []
  patterns:
    - "Structural (not heuristic) discriminator: applyRunEvent's tool_call branch guards on typeof event.data.partial_json !== 'string' as its first statement -- provably scoped, proven by both the collision-guard regression test AND the full pre-existing test suite passing unchanged"
    - "Route computed internally, never trusted from caller data (hrefFor's fixed kind+id switch) -- mirrors use-data-bindings.ts's compile-time-switch-never-model-authored discipline, applied to route selection"
key_files:
  created:
    - apps/web/src/components/provenance-link.tsx
    - apps/web/src/components/provenance-link.test.tsx
    - apps/web/src/app/chat/_components/tool-round-activity-row.tsx
    - apps/web/src/app/chat/_components/tool-invocation-result-row.tsx
    - apps/web/src/app/chat/_components/__tests__/tool-invocation-result-row.test.tsx
  modified:
    - apps/web/src/app/chat/_hooks/use-chat-stream.ts
    - apps/web/src/app/chat/_hooks/__tests__/use-chat-stream.test.ts
    - apps/web/src/app/chat/_components/message-turn.tsx
decisions:
  - "provenance-link.tsx explicitly imports `* as React from \"react\"` (unlike entity-chips.tsx's no-import convention) -- required because this repo's vitest config (no @vitejs/plugin-react, tsconfig jsx:\"preserve\") relies on esbuild's classic JSX transform under test, which throws 'React is not defined' at runtime without an explicit import; confirmed by a live probe before committing. Matches generating-ring.tsx's own convention, which IS vitest-tested."
metrics:
  duration: "~50 min"
  completed: 2026-07-09
---

# Phase 39 Plan 02: Tool-Round UI + Citation Chips (web) Summary

Renders Phase 39's TUI-01/TUI-02 visible surface in `/chat`: a live "Searching knowledge…" activity
row while a server-tool round streams, a quiet collapsed result row with citation chips once it
settles, and every citation through ONE shared `<ProvenanceLink kind id />` primitive. Also fixes a
real, already-live SSE-event naming collision where a real server-tool round's persisted `tool_call`
event was silently mis-folded into a permanently-stuck, empty `interactive_widget_streaming`
skeleton.

## What Was Built

### Task 1 — `use-chat-stream.ts` contract extension + the naming-collision fix

`MessagePart` gained 3 new members (`tool_invocation_streaming { toolUseId, toolName }`,
`tool_invocation { toolUseId, toolName, arguments }`, `tool_invocation_result { toolUseId, toolName,
content, isError }`), field-for-field matching `build_tool_invocation_part`/
`build_tool_invocation_result_part`'s persisted part shape so a client-built part and a
server-persisted part are byte-identical. `ChatRunEventType` + the `CHAT_RUN_EVENT_TYPES` runtime
`Set` both gained `"server_tool_call"`/`"server_tool_result"` (additive, appended after
`"interrupted"`).

**The collision-guard fix (the core bug fix):** `applyRunEvent`'s existing `if (event.type ===
"tool_call")` branch now begins with a guard — `if (typeof event.data.partial_json !== "string")
return { parts: acc.parts, state: "streaming" };` — before any of the branch's existing
destructuring. This is a **structural** discriminator (presence of `partial_json`, never a heuristic
on tool name), so a real server-tool round's persisted `tool_call` event (`data: {tool_name, id,
arguments}` — never `partial_json`) now no-ops instead of getting folded into an empty
`interactive_widget_streaming` skeleton. Two new `applyRunEvent` branches (`server_tool_call`,
`server_tool_result`) build the 3 new part types: `server_tool_call` fires exactly once per round
(replace-or-append, no chunk concatenation, unlike `genui_spec_streaming`'s accumulator);
`server_tool_result` replaces the matching trailing `tool_invocation_streaming` part by `toolUseId`
or appends defensively when no match exists (mirrors the existing orphaned-partial precedent).

**The regression test proving the fix: `"a PERSISTED-shaped tool_call event (no partial_json,
carries arguments) leaves parts completely UNCHANGED — the naming-collision fix"`** (in
`use-chat-stream.test.ts`'s `describe("applyRunEvent")` block), plus a second variant asserting the
same guard on a non-empty seeded accumulator. All 6 new behaviors (A–D, G, plus the collision-guard
pair) got independently named tests; every one of the 15 pre-existing `applyRunEvent`/`parseSseChunk`
tests (all of which include `partial_json` in their `tool_call` event data) still passes unchanged —
23/23 total in the file, 0 regressions.

### Task 2 — `ProvenanceLink` shared citation-chip primitive (TUI-02)

New `apps/web/src/components/provenance-link.tsx`: 3 named exports, no default export.
`hrefFor(kind, id)` is a fixed 3-way switch (`email` → `/emails/{id}`, `entity` → `/entities/{id}`,
`knowledge` → `/knowledge?focus={id}`), every id `encodeURIComponent`-wrapped — **never** consumes a
citation's own `route` string (T-39-05, mirrors `use-data-bindings.ts`'s compile-time-switch
discipline applied to route selection). `fallbackLabel(kind, id)` formats
`` `${Capitalize(kind)} · ${id.slice(0,8)}` ``. `ProvenanceLink` renders a real Next `<Link>` (never
`onClick`-only — middle-click/new-tab work natively) with `onClick={stopPropagation}` (mirrors
`entity-chips.tsx`), an icon-per-kind (`Mail`/`Box`/`Share2` from `lucide-react`), and the exact
neutral-palette chip class string from 39-UI-SPEC.md (`bg-muted`/`hover:bg-accent`/
`focus-visible:ring-ring` — zero `primary`/teal usage). All 5 planned behaviors covered plus 1 extra
(encodeURIComponent-changing-character assertion split into its own test) — 6/6 pass.

### Task 3 — `ToolRoundActivityRow` + `ToolInvocationResultRow`, wired into `message-turn.tsx`

New `tool-round-activity-row.tsx`: `role="status"`, `Loader2` spinner + gerund label
(`lookup_entity`→"Looking up an entity…", `search_emails`→"Searching emails…",
`search_knowledge`→"Searching knowledge…", unrecognized→"Running a lookup…"), deliberately **not**
wrapped in `<GeneratingRing>` (bare status line, not bounded panel content, per the UI-SPEC's
Component 1 rationale — confirmed by a `grep -B2` sweep showing no preceding `<GeneratingRing`).

New `tool-invocation-result-row.tsx`: on `isError`, the fixed per-tool error label (never the raw
`content` string — proven by the marker-token-absence test), `role="alert"`, zero chips, zero retry
button. On success, `try { JSON.parse(content) }`; on parse failure (the `cap_tool_output`
mid-token-truncation edge case), the degraded `"{baseLabel} — details unavailable."` row, no chips,
no throw. On parse success: singular/plural result-count label
(`"Looked up an entity — 1 result"` vs `"— 3 results"`), citations deduped by `` `${kind}:${id}` ``
BEFORE slicing, capped at `MAX_VISIBLE_CHIPS = 5` with a non-link `+N` `<span>` overflow badge, zero
citations after dedup renders no chip container at all. All 8 planned behaviors covered, 8/8 pass.

`message-turn.tsx`'s existing `parts.map` switch gained 3 new branches immediately after
`interactive_widget_streaming`: `tool_invocation_streaming` → `<ToolRoundActivityRow>` (bare, not
`GeneratingRing`-wrapped), `tool_invocation` → `null` (the paired result row already narrates the
round — DO-NOT 7), `tool_invocation_result` → `<ToolInvocationResultRow>`. `part` is correctly
narrowed by TypeScript inside each branch with no cast needed. The 3 locked renderer files
(`spec-renderer.tsx`, `render-node.tsx`, `genui-part-boundary.tsx`) confirmed byte-identical
(`git diff --stat` empty on all 3).

## Verification

```
cd apps/web && npx vitest run src/app/chat/_hooks/__tests__/use-chat-stream.test.ts \
  src/components/provenance-link.test.tsx \
  src/app/chat/_components/__tests__/tool-invocation-result-row.test.tsx
# 3 test files, 37 tests, all passed

cd apps/web && npx vitest run src/app/chat
# 21 test files, 181 tests, all passed -- full chat-surface sweep, 0 regressions

cd .  (repo root) && npx tsc --noEmit -p apps/web
# clean, zero errors

grep -n "tool_invocation_streaming\"\|tool_invocation\"\|tool_invocation_result\"" \
  apps/web/src/app/chat/_hooks/use-chat-stream.ts
# matches all 3 new MessagePart union members

grep -n "\"server_tool_call\"\|\"server_tool_result\"" apps/web/src/app/chat/_hooks/use-chat-stream.ts
# matches inside both ChatRunEventType and CHAT_RUN_EVENT_TYPES (4 occurrences)

grep -n "export function ProvenanceLink\|export function hrefFor\|export function fallbackLabel" \
  apps/web/src/components/provenance-link.tsx
# all 3 match; `grep -c "export default"` on the same file -> 0

grep -n "primary\|ring-primary" apps/web/src/components/provenance-link.tsx
# only a comment mentions "primary/teal" in prose -- no class usage

grep -n "tool_invocation_streaming\"\|tool_invocation\"\|tool_invocation_result\"" \
  apps/web/src/app/chat/_components/message-turn.tsx
# exactly 3 new part.type === checks

grep -n "{content}" apps/web/src/app/chat/_components/tool-invocation-result-row.tsx
# no matches -- raw content string never interpolated verbatim

git diff --stat packages/genui/src/renderer/render-node.tsx \
  packages/genui/src/renderer/spec-renderer.tsx \
  apps/web/src/app/chat/_components/genui-part-boundary.tsx
# empty -- all 3 locked renderer files byte-identical
```

## Regression test naming (the collision-guard proof)

The exact test proving the applyRunEvent naming-collision fix, in
`apps/web/src/app/chat/_hooks/__tests__/use-chat-stream.test.ts`:

**`"a PERSISTED-shaped tool_call event (no partial_json, carries arguments) leaves parts completely
UNCHANGED — the naming-collision fix"`**

(plus a companion `"a PERSISTED-shaped tool_call event leaves a NON-EMPTY accumulator's parts
completely unchanged too"` covering the non-empty-accumulator case.)

## Deviations from Plan

None — plan executed exactly as written. Task 2's file needed one non-architectural addition beyond
the plan's literal action text: an explicit `import * as React from "react"` in
`provenance-link.tsx` (Rule 3, blocking issue). The plan's own precedent file, `entity-chips.tsx`,
omits this import and relies on Next's production SWC automatic-JSX-runtime injection, but this
repo's vitest config has no `@vitejs/plugin-react` and `tsconfig.json` sets `"jsx": "preserve"`,
so esbuild's classic-transform default under test throws `ReferenceError: React is not defined`
without an explicit import — confirmed via a live probe (a minimal `<a onClick>` mount) before
fixing. `generating-ring.tsx`, which IS vitest-tested, already follows the explicit-import
convention; `provenance-link.tsx` now matches it.

## Known Stubs

None. All 3 new components are fully wired and exercised: `ProvenanceLink` renders real `<Link>`
elements with real computed hrefs; `ToolRoundActivityRow`/`ToolInvocationResultRow` are wired into
`message-turn.tsx`'s live part switch, consuming the exact field names Task 1's `MessagePart` union
defines. No hardcoded empty values or placeholder text anywhere in the new surface.

## Threat Flags

None beyond the plan's own `<threat_model>` register (T-39-04/05/06/07), all pre-declared and
mitigated exactly as specified:
- T-39-04 (malformed `content` crashing `JSON.parse`): try/caught in `ToolInvocationResultRow`,
  proven by Test 7 (malformed content, no throw).
- T-39-05 (trusting a citation's own `route`): `hrefFor` recomputes from `kind`+`id`; `route` is
  parsed but never read for navigation (`ParsedCitation.route` exists only to match the envelope
  shape, never passed to `<Link href>` or `ProvenanceLink`).
- T-39-06 (LLM-adjacent output rendered as text/URL segments): plain JSX text interpolation only,
  no `dangerouslySetInnerHTML`; `id` only ever reaches a URL via `encodeURIComponent` inside
  `hrefFor`.
- T-39-07 (the collision fix's own repudiation/integrity risk): gated strictly on `partial_json`
  presence, a structural discriminator, proven by the dedicated regression test plus the full
  pre-existing `applyRunEvent` suite passing unchanged.

## Visual Check

**Outcome: `human_needed`.** No `playwright-core` installation was found anywhere in this repo's
dependency tree (root or `apps/web`), and standing up the full local chat stack to exercise a real
tool round visually — the FastAPI `apps/email-listener` backend (Bedrock/AWS-credentialed), the
Next.js `apps/web` dev server, plus driving an actual chat turn that triggers `search_knowledge`/
`lookup_entity` through to a rendered `ToolRoundActivityRow`/`ToolInvocationResultRow` with citation
chips — is not a cheap, readily-available operation in this execution session (multiple services,
live AWS credentials, a real LLM round-trip). This follows the established v1.4/v1.5 precedent
(`STATE.md` → Deferred Items) of marking connected-env/browser visual verification `human_needed`
rather than blocking plan completion on it. The implementation was cross-checked structurally
instead: every anatomy/class-string/copy-table element in `39-UI-SPEC.md`'s Component 1/Component 2/
`<ProvenanceLink>` sections was transcribed verbatim into the 3 new components (confirmed via the
greps above), and all 8+6+2 behavior-level unit tests exercise the DOM output (real `<a>` elements,
`role` attributes, text content, class-adjacent structural assertions) via `createRoot`+`act` mounts.

## Self-Check: PASSED

- FOUND: apps/web/src/app/chat/_hooks/use-chat-stream.ts (MessagePart +3 members, ChatRunEventType +2,
  CHAT_RUN_EVENT_TYPES +2, applyRunEvent collision guard + 2 new branches present)
- FOUND: apps/web/src/app/chat/_hooks/__tests__/use-chat-stream.test.ts (23 tests, 8 new)
- FOUND: apps/web/src/components/provenance-link.tsx (ProvenanceLink/hrefFor/fallbackLabel present,
  0 default exports)
- FOUND: apps/web/src/components/provenance-link.test.tsx (6 tests)
- FOUND: apps/web/src/app/chat/_components/tool-round-activity-row.tsx
- FOUND: apps/web/src/app/chat/_components/tool-invocation-result-row.tsx
- FOUND: apps/web/src/app/chat/_components/__tests__/tool-invocation-result-row.test.tsx (8 tests)
- FOUND: apps/web/src/app/chat/_components/message-turn.tsx (3 new part.type branches wired)
- FOUND commit 1c43b2a (Task 1 — feat(39-02): extend use-chat-stream contracts + fix tool_call naming collision)
- FOUND commit 5734699 (Task 2 — feat(39-02): add ProvenanceLink shared citation-chip primitive (TUI-02))
- FOUND commit 1a3dc58 (Task 3 — feat(39-02): render tool-round activity + result rows in the transcript (TUI-01/TUI-02))
