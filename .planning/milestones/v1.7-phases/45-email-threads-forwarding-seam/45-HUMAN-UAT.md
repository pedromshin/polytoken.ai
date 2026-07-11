---
status: complete
phase: 45-email-threads-forwarding-seam
source: [45-04-PLAN.md Task 3 checkpoint, 50-03-PLAN.md]
started: 2026-07-10T06:20:00Z
updated: 2026-07-11T07:30:00Z
---

## Current Test

[45.1-45.4 + 45.7(UI) dispositioned; 45.5/45.6 moved to the morning checklist]

## Prerequisite

Full visual verification of `/` requires an authenticated session (Phase 43,
AUTH-02 middleware redirects a signed-out visitor to `/login`). Live Google
OAuth sign-in is itself still pending the user's `GOOGLE-OAUTH-RUNBOOK.md`
setup — see `43-HUMAN-UAT.md` Test 1. Scenarios 1-4 and 7's UI-visibility
slice were subsequently closed via a SEEDED local session (Phase 50 Plan 03,
`apps/web/e2e/uat-45-threads.spec.ts`) — no interactive Google needed for the
local-provable half (see `apps/web/e2e/helpers/seed-session.ts`). Local
Supabase (`polytoken` project, port 54321) is running; a deterministic thread
fixture (`apps/web/e2e/helpers/uat-thread-fixtures.ts`) seeds a real
multi-message thread, a null-`thread_id` singleton, and a verification-code
email — independent of ambient local mail (the 16→9 backfill noted in
`45-03-SUMMARY.md` remains true separately but is no longer load-bearing for
this file's scenarios 1-4/7).

## Tests

### 1. Thread entries replace flat email rows
expected: Visiting `/` (once signed in) shows THREAD entries in the middle
pane, not one row per email. A known local reply chain (e.g. the
"Fwd: Packing List — Multi-Forming Machine BF-80 — vessel TOBA via Kobe"
3-email chain noted in `45-03-SUMMARY.md`) appears as a SINGLE entry with a
message-count Badge > 1 and the latest message's snippet/date.
result: passed — `apps/web/e2e/uat-45-threads.spec.ts` ("45.1"), run against a
seeded 3-message thread fixture. Asserted the collapsed row shows ONE entry
with a `Badge variant="secondary"` reading "3" and the latest member's
snippet, and that the other two members carry no separate top-level row.

### 2. Expand reveals members; reading preview + editor link unaffected
expected: Clicking a multi-message thread entry expands it (chevron rotates,
`aria-expanded` toggles) and reveals its member emails via the existing
`InboxRow` component. Selecting a member email shows it in the reading
preview (right pane), and the "Open editor →" link reaches
`/emails/[id]` — the unmodified detail/editor page — for that exact email.
result: passed — `apps/web/e2e/uat-45-threads.spec.ts` ("45.2"). Asserted
`aria-expanded` toggles false->true and the chevron gains `rotate-90` on
click; selecting the OLDEST member set the "Open editor →" link's `href` to
that exact member's `/emails/{id}`, and clicking it landed on the unmodified
editor page with the matching `<h1>` subject heading.

### 3. Singleton emails list cleanly
expected: A single-message thread (count 1 — including any pre-backfill
orphan with a null `thread_id`) renders as a flat row identical to the
pre-grouping inbox — no chevron, no count badge, no disclosure chrome.
result: passed — `apps/web/e2e/uat-45-threads.spec.ts` ("45.3"), run against a
seeded null-`thread_id` singleton fixture (the exact pre-backfill-orphan
shape). Asserted the row carries no `aria-expanded` attribute and no `svg`
(no chevron) — it is the unmodified `InboxRow`, not the thread-group
disclosure wrapper.

### 4. Styling stays minimal (45-UI-SPEC compliance)
expected: The count Badge, snippet, and date use only existing tokens
(`Badge variant="secondary"`, `text-muted-foreground`) — no new colors,
components, or visual language beyond what `45-UI-SPEC.md` specifies. The
change reads as "the same inbox, now grouped" rather than a redesign.
result: passed — `apps/web/e2e/uat-45-threads.spec.ts` ("45.4"). DOM-asserted
the count Badge carries the literal `bg-secondary`/`text-secondary-foreground`
token classes (`packages/ui/src/badge.tsx`'s `secondary` variant) and the
snippet span carries `text-muted-foreground` — no raw hex, no new component.

### 5. Gmail-forward fixture realism (THRD-02)
expected: Forward a real email to yourself from Gmail's UI, save the raw
message (`Show original` → Download), and confirm
`apps/email-listener/tests/fixtures/threads/gmail_forward_stripped.eml`
matches its header shape (References/In-Reply-To stripped, `Fwd:` subject,
embedded original headers in body). Replace the constructed fixture with the
real one if they differ; re-run
`uv run pytest tests/domain/services/test_thread_grouping.py --no-cov`.
result: moved-to-morning-checklist — requires the user's own Gmail UI to
forward a real email and download the raw source; not automatable. The user
performs this fixture-realism confirmation directly (no cross-reference to a
separate LIVE-0x gate — it is its own manual confirmation step).

### 6. Forwarding round-trip end-to-end (FORWARDING-RUNBOOK.md)
expected: Following `FORWARDING-RUNBOOK.md`: SES catch-all routes
`u-{token}@{domain}` to the listener; Gmail's destination-verification email
arrives, is ingested (visible in the inbox — never dropped), and its
verification code/link is readable; after confirming, real forwarded mail
lands under an importer anchored to your user.
result: moved-to-morning-checklist — requires live SES + a real Gmail
forwarding handshake; not runnable locally. See `49-HUMAN-UAT.md` §2
(LIVE-04).

### 7. Verification-code visibility in product UI
expected: The Gmail verification email's code is findable via the app UI
(inbox → email detail) without needing direct DB access.
result: split disposition. UI-visibility slice PASSED locally —
`apps/web/e2e/uat-45-threads.spec.ts` ("45.7") seeded a synthetic
verification-code email and asserted the code is visible in the inbox's
reading preview (right pane, `p.whitespace-pre-line`) after selecting the
row — no DB access needed. Note: `/emails/[id]`'s editor renders plain-text
body only via a PDF/attachment preview pane (no attachment on a plain-text
email means no body text there today) — the inbox reading preview is the
surface that genuinely satisfies "findable via inbox → email detail" for
this content type; documented here rather than silently assumed. The
REAL-verification-email-arrival slice (an actual Gmail-forwarding
verification code landing via live SES) rides on Test 6 / 49-HUMAN-UAT.md §2
(LIVE-04) — moved-to-morning-checklist.

## Summary

total: 7
passed: 5
issues: 0
pending: 0
skipped: 0
blocked: 0
moved-to-morning-checklist: 2 (Tests 5 and 6; Test 7's real-arrival slice
rides on Test 6)

## Gaps

None locally provable for scenarios 1-4 and 7's UI-visibility slice — closed
via seeded-session DB/DOM verification (Phase 50 Plan 03). The two remaining
scenarios (5, 6) genuinely require the user's own Gmail UI and a live SES
forwarding round-trip; tracked at `49-HUMAN-UAT.md` §2 (LIVE-04) for Test 6,
and Test 5 as a standalone fixture-realism confirmation.
