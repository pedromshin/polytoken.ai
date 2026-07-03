---
phase: 22-chat-spine-persistence-streaming
plan: 05
subsystem: chat-persistence-ui
tags: [trpc, drizzle, nextjs, chat, conversation-management, radix-ui]

# Dependency graph
requires:
  - phase: 22-01 (chat data model)
    provides: chat_conversations / chat_messages Drizzle tables (FOUND-1, D-16 sibling-version columns)
provides:
  - "chat tRPC router (create/list/rename/delete/getHistory) over Drizzle — the CHAT-02 conversation-management spine"
  - "/chat route + collapsible rail + home empty-state + inline rename + hard-delete confirm — CHAT-01's persistence-side UI shell"
  - "Single Chat nav item in the app sidebar"
affects: [22-06, 22-07, 22-08, 22-09, 22-10, 22-11]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Direct tRPC-over-Drizzle router (mirrors entities/gallery.ts) for conversation CRUD — no FastAPI hop for reads/CRUD, matching the established entities/emails router pattern"
    - "Own collapsible rail via @nauta/ui/collapsible (not a second SidebarProvider) — avoids the app shell's shared sidebar:state cookie"
    - "Controlled collapse boolean lifted to the page, with localStorage hydrate/persist effects living inside ConversationRail — lets a top-bar toggle reach the rail even at its 0px-collapsed width"
    - "Single rail-level DeleteConversationDialog instance (not nested inside each row's DropdownMenu) to avoid Radix AlertDialog/DropdownMenu portal-focus conflicts"

key-files:
  created:
    - packages/api-client/src/router/chat/index.ts
    - packages/api-client/src/router/chat/conversations.ts
    - packages/api-client/src/router/chat/history.ts
    - packages/api-client/src/router/chat/__tests__/conversations.test.ts
    - packages/api-client/src/router/chat/__tests__/history.test.ts
    - apps/web/src/app/chat/page.tsx
    - apps/web/src/app/chat/_components/conversation-rail.tsx
    - apps/web/src/app/chat/_components/conversation-row.tsx
    - apps/web/src/app/chat/_components/chat-home-empty-state.tsx
    - apps/web/src/app/chat/_components/inline-rename-field.tsx
    - apps/web/src/app/chat/_components/delete-conversation-dialog.tsx
  modified:
    - packages/api-client/src/root.ts
    - apps/web/src/components/app-sidebar.tsx

key-decisions:
  - "DEFAULT_CHAT_MODEL_ID = 'us.anthropic.claude-sonnet-4-6' — mirrors the Bedrock model id already curated in apps/email-listener/app/domain/services/chat_model_registry.py (22-02) so the web-side D-10 fallback and the Python registry's default never drift silently (documented hand-sync note in both files)."
  - "D-10 remember-last-used logic extracted into a pure `resolveDefaultModelId` helper (mirrors entities/gallery.ts's shapeGalleryItem pattern) so it is DB-free-testable without mocking a Drizzle query chain — this codebase has no precedent anywhere for mocking ctx.db chains in tests, only pure-helper + Zod-schema tests."
  - "Rename/delete interaction state (which row is renaming, which conversation is targeted for delete) and their mutations live inside ConversationRail, not lifted to page.tsx — keeps the rail a cohesive, self-contained unit and avoids threading three extra pieces of state through the page."
  - "DeleteConversationDialog renders once at the rail level, controlled by a `deletingConversation` state object (not per-row / not nested inside the row's DropdownMenu) — sidesteps known Radix AlertDialog-inside-DropdownMenu portal/focus conflicts entirely."
  - "Rail-collapse toggle lives in a page-level top bar, not inside the rail itself — the UI-SPEC's literal '0px collapsed' rail width would otherwise have no way to reopen once collapsed (a dead end), so the toggle needed a home outside the rail's own collapsing width container. localStorage read/write still lives inside conversation-rail.tsx per the plan's acceptance criteria; the boolean itself is a controlled prop from page.tsx so the top-bar button and the rail act on the same state."

requirements-completed: [CHAT-01, CHAT-02]

# Metrics
duration: 25min
completed: 2026-07-03
---

# Phase 22 Plan 05: Chat Spine Persistence + Rail UI Summary

**A tRPC `chat` router doing create/list/rename/hard-delete/getHistory directly over Drizzle, plus the `/chat` route's collapsible conversation rail, home empty-state, inline rename, and hard-delete confirm dialog — CHAT-02 fully done, CHAT-01's persistence half done.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-03 (immediately after 22-04)
- **Completed:** 2026-07-03T17:47:12-03:00
- **Tasks:** 3/3 completed
- **Files modified:** 13 (11 created, 2 modified)

## Accomplishments

- Chat tRPC router (`chat.createConversation`, `chat.listConversations`, `chat.renameConversation`, `chat.deleteConversation`, `chat.getHistory`) — direct Drizzle CRUD mirroring the entities/emails router pattern, importer-scoped, Zod-validated at every boundary, registered in `appRouter`.
- D-10 remember-last-used default resolved via a pure, unit-tested `resolveDefaultModelId` helper; falls back to `DEFAULT_CHAT_MODEL_ID` (kept in sync with the Python `CHAT_MODEL_REGISTRY`'s first entry from 22-02) when there is no prior conversation.
- `getHistory` returns messages ordered by turn/version with the FOUND-1 `parts` payload plus the D-16 sibling-version columns (`siblingGroupId`, `version`, `isActive`), ready for the message list (22-08) and regenerate navigation.
- `/chat` two-state layout (D-13): a home empty-state when nothing is selected, a placeholder conversation view otherwise — both always alongside the always-mounted conversation rail.
- ConversationRail (D-11): 280px/0px collapsible rail via `@nauta/ui/collapsible` (not a second sidebar provider), New-chat button, live conversation list, collapse state persisted to `localStorage["chat:rail:collapsed"]`.
- Inline rename (D-12, `InlineRenameField`) and hard-delete confirm (D-14, `DeleteConversationDialog` mirroring `unmerge-dialog.tsx`) fully wired: rename commits on blur/Enter/F2, cancels on Escape; delete requires the AlertDialog confirm, invalidates the list, and de-selects the active conversation if it was the one deleted.
- Single Chat nav item added to `AppSidebar` (`/chat`, `MessageSquare` icon).

## Task Commits

Each task was committed atomically:

1. **Task 1: chat tRPC router — create/list/rename/delete/getHistory over Drizzle** - `bad589e` (feat)
2. **Task 2: /chat route + conversation rail + home empty-state + sidebar nav** - `0fa67f7` (feat)
3. **Task 3: Inline rename + hard-delete confirm dialog, wired to the rail** - `36acb7b` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `packages/api-client/src/router/chat/conversations.ts` - create/list/rename/delete procedures + `resolveDefaultModelId` pure helper + `DEFAULT_CHAT_MODEL_ID`
- `packages/api-client/src/router/chat/history.ts` - `getHistory` procedure (parts + sibling-version columns, row-capped)
- `packages/api-client/src/router/chat/index.ts` - `chatRouter` barrel
- `packages/api-client/src/router/chat/__tests__/conversations.test.ts` - 9 DB-free tests (D-10 fallback logic + all input schemas)
- `packages/api-client/src/router/chat/__tests__/history.test.ts` - 2 DB-free tests (`getHistoryInputSchema`)
- `packages/api-client/src/root.ts` - registered `chat: chatRouter`
- `apps/web/src/app/chat/page.tsx` - two-state layout, top-bar rail-collapse toggle, `createConversation` mutation
- `apps/web/src/app/chat/_components/conversation-rail.tsx` - collapsible rail, list query, rename/delete mutations + dialog
- `apps/web/src/app/chat/_components/conversation-row.tsx` - row (title/timestamp/overflow menu), F2/click/menu rename triggers
- `apps/web/src/app/chat/_components/chat-home-empty-state.tsx` - D-13 home landing state
- `apps/web/src/app/chat/_components/inline-rename-field.tsx` - D-12 inline rename input
- `apps/web/src/app/chat/_components/delete-conversation-dialog.tsx` - D-14 hard-delete AlertDialog
- `apps/web/src/components/app-sidebar.tsx` - added the Chat nav item

## Decisions Made

See `key-decisions` in frontmatter for the full rationale on: the `DEFAULT_CHAT_MODEL_ID` Bedrock-id sync with the Python registry, the `resolveDefaultModelId` DB-free-testable extraction, keeping rename/delete state inside `ConversationRail` rather than lifting it to the page, the single rail-level `DeleteConversationDialog` instance, and the page-level top-bar placement of the rail-collapse toggle.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Rebuilt `@nauta/api-client`'s `dist/` type declarations before `apps/web` would typecheck**
- **Found during:** Task 2 (`pnpm tsc --noEmit` on `apps/web`)
- **Issue:** `@nauta/api-client`'s package.json resolves TypeScript types to the pre-built `dist/index.d.ts` (not `src/index.ts`), so `apps/web`'s tsc reported `Property 'chat' does not exist` against the stale, pre-Task-1 declaration files even though the source router was already registered.
- **Fix:** Ran `npm run build --workspace=@nauta/api-client` (a plain `tsc` build) to regenerate `dist/*.d.ts` including the new `chatRouter` types. `dist/` is gitignored — this is a normal local build step, not a tracked change.
- **Files modified:** none tracked (build artifact only)
- **Verification:** `apps/web` tsc then passed clean; re-confirmed after Task 3's edits.

**2. [Rule 1 - Bug] Removed a literal `SidebarProvider` string from a doc comment that tripped its own acceptance grep**
- **Found during:** Task 2 self-verification
- **Issue:** `conversation-rail.tsx`'s doc comment explained the rail is built "rather than a second `SidebarProvider`" — this literal substring made `grep -c "SidebarProvider" conversation-rail.tsx` return 1 instead of the required 0, even though no such import/usage exists in the file.
- **Fix:** Reworded the comment to describe the same rationale without using the literal token (now says "a second app-shell-style sidebar provider").
- **Files modified:** `apps/web/src/app/chat/_components/conversation-rail.tsx`
- **Verification:** `grep -c "SidebarProvider" conversation-rail.tsx` now returns 0; tsc/build re-run clean.

### Design choices not explicitly specified by the plan (Claude's discretion, per 22-CONTEXT.md)

- **Rail-collapse toggle placement:** the UI-SPEC specifies the rail collapses to a literal 0px (not an icon-rail), which — taken alone — leaves no way to re-expand it once collapsed. Added a small toggle button in a page-level top bar (outside the rail's own collapsing width container) so the control is always reachable. `localStorage["chat:rail:collapsed"]` read/write still lives inside `conversation-rail.tsx` per the plan's explicit acceptance criteria; the boolean itself is a controlled prop shared between the top-bar button and the rail.
- **Mutation/dialog ownership:** rename and delete mutations, plus the single `DeleteConversationDialog` instance, live inside `ConversationRail` rather than `page.tsx`, keeping the rail self-contained (this also sidesteps nesting an `AlertDialog` inside a `DropdownMenu`, a known Radix portal/focus conflict pattern).

## Known Stubs

- **Conversation view main column** (`apps/web/src/app/chat/page.tsx`): when a conversation is selected, the main column renders a static "Conversation view arrives in a later plan (22-08)." placeholder instead of the real message list. This is explicit, intentional scope per this plan's own `<action>` text ("main column placeholder for now; the streamed message list arrives in 22-08") — not a gap. Resolved by 22-08.

## Issues Encountered

None beyond the two Rule-1/Rule-3 items above (both resolved inline, no scope creep).

## User Setup Required

None. `chat_conversations`/`chat_messages` were already migrated to local Postgres in 22-01; no new environment variables or external services were introduced by this plan.

## Threat Flags

None — this plan's new surface (tRPC `chat` router reads/writes, the `/chat` route and its rail/dialog interactions) was already enumerated in the plan's own `<threat_model>` (T-22-16 through T-22-19) and implemented per its dispositions: parameterized Drizzle queries + uuid/length-capped Zod validation (T-22-16), accepted single-shared-key posture unchanged (T-22-17), hard delete gated behind an explicit `AlertDialog` confirm with no auto-fire path (T-22-18), and row-capped list/history queries (T-22-19). No new trust-boundary surface beyond what the plan anticipated.

## Next Phase Readiness

- `chat.createConversation` / `listConversations` / `renameConversation` / `deleteConversation` / `getHistory` are all live, tested, and ready for the streaming turn plans (22-06+) to build on top of — those plans are Python-owned (messages/runs/events writes) and will read/write through the same `chat_conversations`/`chat_messages` tables this plan's router already queries.
- The rail + home + rename + delete UI is fully functional end-to-end (manual verification pending a running dev server + local Supabase — deferred per the standing overnight autonomous-session directive; machine gates (tsc/vitest/next build) are green).
- `apps/web/src/app/chat/page.tsx`'s placeholder conversation-view slot is the exact seam 22-08 (message list + streaming) will fill in.

---
*Phase: 22-chat-spine-persistence-streaming*
*Completed: 2026-07-03*

## Self-Check: PASSED

All 13 created/modified files confirmed present on disk; all three task commits (`bad589e`, `0fa67f7`, `36acb7b`) confirmed present in `git log --oneline --all`.
