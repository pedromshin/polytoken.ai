---
status: partial
phase: 45-email-threads-forwarding-seam
source: [45-04-PLAN.md Task 3 checkpoint]
started: 2026-07-10T06:20:00Z
updated: 2026-07-10T06:20:00Z
---

## Current Test

[awaiting human testing]

## Prerequisite

Full visual verification of `/` requires an authenticated session (Phase 43,
AUTH-02 middleware redirects a signed-out visitor to `/login`). Live Google
OAuth sign-in is itself still pending the user's `GOOGLE-OAUTH-RUNBOOK.md`
setup — see `43-HUMAN-UAT.md` Test 1. Automated verification in this run
confirmed: `npm run dev` compiles and serves cleanly with these changes
(`GET /login` -> 200, `GET /` -> 307 to `/login?redirectTo=%2F`, no server
errors in the dev log) — the app is runtime-healthy; only the auth-gated
visual confirmation below requires the human + a signed-in session. Local
Supabase (`nauta` project, port 54321) is running; Plan 45-03's backfill has
already been executed live locally (16 emails -> 9 threads — see
`45-03-SUMMARY.md`), so thread data exists to verify against once signed in.

## Tests

### 1. Thread entries replace flat email rows
expected: Visiting `/` (once signed in) shows THREAD entries in the middle
pane, not one row per email. A known local reply chain (e.g. the
"Fwd: Packing List — Multi-Forming Machine BF-80 — vessel TOBA via Kobe"
3-email chain noted in `45-03-SUMMARY.md`) appears as a SINGLE entry with a
message-count Badge > 1 and the latest message's snippet/date.
result: [pending]

### 2. Expand reveals members; reading preview + editor link unaffected
expected: Clicking a multi-message thread entry expands it (chevron rotates,
`aria-expanded` toggles) and reveals its member emails via the existing
`InboxRow` component. Selecting a member email shows it in the reading
preview (right pane), and the "Open editor →" link reaches
`/emails/[id]` — the unmodified detail/editor page — for that exact email.
result: [pending]

### 3. Singleton emails list cleanly
expected: A single-message thread (count 1 — including any pre-backfill
orphan with a null `thread_id`) renders as a flat row identical to the
pre-grouping inbox — no chevron, no count badge, no disclosure chrome.
result: [pending]

### 4. Styling stays minimal (45-UI-SPEC compliance)
expected: The count Badge, snippet, and date use only existing tokens
(`Badge variant="secondary"`, `text-muted-foreground`) — no new colors,
components, or visual language beyond what `45-UI-SPEC.md` specifies. The
change reads as "the same inbox, now grouped" rather than a redesign.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps

- Blocked on live Google OAuth sign-in (43-HUMAN-UAT.md Test 1, still
  pending) — the auth middleware gates `/` for every signed-out visitor, so
  none of the above can be screenshotted/clicked through until the user
  completes `GOOGLE-OAUTH-RUNBOOK.md` and signs in once.
