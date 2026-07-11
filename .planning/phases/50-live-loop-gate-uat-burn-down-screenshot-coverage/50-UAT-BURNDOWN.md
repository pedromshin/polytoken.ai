# Phase 50 UAT Burn-Down Roll-Up (LIVE-05)

**Acceptance bar: zero silently parked.** Every scenario below carries an explicit disposition —
`passed`, `fixed`, `tracked-fix`, or `moved-to-morning-checklist` — pulled directly from its
source `*-HUMAN-UAT.md` file (39/41/43/45/47/48), plus a concrete evidence pointer. No row is
`pending` or blank. This roll-up invents nothing; it aggregates what plans 50-01 through 50-04
already recorded.

## Disposition Summary

| Disposition | Count |
|---|---|
| passed | 17 |
| fixed | 0 |
| tracked-fix | 0 |
| moved-to-morning-checklist | 4 |
| **Total** | **21** |

Zero scenarios are `[pending]` in any of the six source UAT files as of this roll-up (confirmed
by direct read of all six — see Notes).

## All 21 Scenarios

| ID | Scenario | Disposition | Evidence Pointer |
|---|---|---|---|
| 39.1 | Live in-round tool activity affordance | passed | `apps/web/e2e/uat-39-tool-round.spec.ts` — real `search_emails` tool round against the live local stack, `chat_run_events` row (`type='tool_call'`) DB-verified, ToolRoundActivityRow → collapsed ToolInvocationResultRow transition observed live. Passed 2/2 consecutive runs. (50-02) |
| 39.2 | Citation chip visual legibility + deep-link round-trip | passed | Same spec — a real CONFIRMED `email_components`/`extraction_records` slice drives `search_emails`'s RRF(k=60) retrieval; rendered chip asserted `href="/emails/{id}"` + Mail icon via `toHaveAttribute`. (50-02) |
| 41.1 | Two-ring ellipse visual quality (tier-styled edges/dots) | passed | `apps/web/e2e/uat-41-knowledge-preview.spec.ts` ("41.1") — tier-diverse `knowledge_nodes`/`knowledge_node_edges` fixture (`seedKnowledgeGraphFixture`); DOM-asserted all 3 tier-styled edges (dashed/faint/solid) + all 4 node dots render correctly. 4/4 consecutive runs. (50-02) |
| 41.2 | Tooltip hover/dismiss behavior | passed | Same spec ("41.2") — Radix Tooltip full-label visibility on hover, clean dismiss on mouse-leave (two-step pointer-move pattern). (50-02) |
| 41.3 | Add-preview popover open/close feel | passed | Same spec ("41.3") — all 3 close paths (Cancel, successful Add, outside-click) DOM-verified against a live React Flow pane. (50-02) |
| 41.4 | New-node placement near viewport center | passed | Same spec ("41.4") — real mouse-drag pan, live `.react-flow__viewport` transform read, computed `screenToFlowPosition` result matched against the added node's placement. (50-02) |
| 41.5 | Remove-then-reload persistence round-trip | passed | Same spec ("41.5") — DB-polled `chat_canvas_layouts.nodes` until debounced save persisted the removal, then full `page.reload()` + re-select + DB/DOM re-verification. (50-02) |
| 43.1 | Live Google OAuth round-trip on the deployed app | moved-to-morning-checklist | Requires a real Google account + the deployed app — not locally runnable. `49-HUMAN-UAT.md` §1 (LIVE-03) / `MORNING-CHECKLIST.md` §A. Cross-reference note added to §A by this plan (Task 2). |
| 43.2 | Session persistence across refresh + new tab | passed | `apps/web/e2e/uat-43-auth.spec.ts` ("UAT 43.2") — seeded-session spec; survives full `page.reload()` and a second same-context tab without re-auth. 2/2 consecutive chromium runs. (50-03) |
| 43.3 | Sign-out loop end-to-end | passed | Same spec ("UAT 43.3") — real sidebar sign-out POST, `/login` landing, then a re-visit of `/` in the same context proves a real server-side session clear (protected-route re-redirect), not a cosmetic landing. 2/2 runs. (50-03) |
| 43.4 | Playwright auth-redirect smoke spec | passed | `apps/web/e2e/auth-redirect.spec.ts` (pre-existing, run unmodified alongside `uat-43-auth.spec.ts`) — signed-out visit to `/chat` redirects to `/login?redirectTo=%2Fchat`. (50-03) |
| 45.1 | Thread entries replace flat email rows | passed | `apps/web/e2e/uat-45-threads.spec.ts` ("45.1") — seeded 3-message thread fixture; single collapsed row with `Badge variant="secondary"` count "3" + latest snippet. (50-03) |
| 45.2 | Expand reveals members; reading preview + editor link unaffected | passed | Same spec ("45.2") — `aria-expanded` toggle + chevron rotation on click; "Open editor →" `href` asserted to the exact selected member's `/emails/{id}`. (50-03) |
| 45.3 | Singleton emails list cleanly (null thread_id) | passed | Same spec ("45.3") — seeded null-`thread_id` singleton fixture; row carries no `aria-expanded`/chevron, renders as the unmodified `InboxRow`. (50-03) |
| 45.4 | Styling stays minimal (45-UI-SPEC token compliance) | passed | Same spec ("45.4") — DOM-asserted `bg-secondary`/`text-secondary-foreground` Badge classes + `text-muted-foreground` snippet span, zero raw hex / new components. (50-03) |
| 45.5 | Gmail-forward fixture realism (THRD-02) | moved-to-morning-checklist | Requires the user's own Gmail UI (`Show original` → Download) to confirm `apps/email-listener/tests/fixtures/threads/gmail_forward_stripped.eml`'s header shape — not automatable. NEW destination added by this plan (Task 2): `49-HUMAN-UAT.md` item 7 / `MORNING-CHECKLIST.md` §F.1 (no prior item existed). |
| 45.6 | Forwarding round-trip end-to-end (live SES + Gmail) | moved-to-morning-checklist | Requires live SES + a real Gmail forwarding handshake — not runnable locally. `49-HUMAN-UAT.md` §2 (LIVE-04) / `MORNING-CHECKLIST.md` §B. Cross-reference note added to §B by this plan (Task 2). |
| 45.7 | Verification-code visibility in product UI | passed | `apps/web/e2e/uat-45-threads.spec.ts` ("45.7") — UI-visibility slice: a seeded synthetic verification-code email is visible in the inbox's reading preview (right pane) without DB access. The REAL-verification-email-arrival slice rides on 45.6 / `MORNING-CHECKLIST.md` §B (not a separate disposition — documented in `45-HUMAN-UAT.md`'s own split-disposition note). (50-03) |
| 47.1 | Brand-mark visual quality / brand fit (BRND-01) | moved-to-morning-checklist | Inherently subjective aesthetic judgment — no DOM/CSS assertion can close it. Real pixel evidence captured: `.planning/ui-reviews/2026-07-11T04-32-30-989Z/login-desktop.png`. `47-HUMAN-UAT.md` records `evidence-captured`; routed to `49-HUMAN-UAT.md` item 6 / `MORNING-CHECKLIST.md` §E.3 (added by 50-04, confirmed still present by this plan — no duplicate needed). |
| 48.1 | Live-browser confirmation of chip/success surfaces | passed | `apps/web/e2e/uat-48-token-surfaces.spec.ts` ("48.1") — `getComputedStyle` proved the ProvenanceLink chip's border-radius resolves to the pill token (9999px) and `/emails/[id]`'s confirm/deny controls resolve two distinct non-transparent colors (success vs destructive). Real pixels: `.planning/ui-reviews/2026-07-11T04-32-30-989Z/{chat,emails}-desktop.png`. (50-04) |
| 48.2 | Live-browser confirmation of knowledge-canvas graph/tier surfaces | passed | Same spec ("48.2") — `getComputedStyle` proved EXTRACTED vs INFERRED `knowledge_node_edges` resolve distinct stroke color AND `stroke-dasharray`, and the filter rail's 3 palette dots resolve 3 distinct colors. Real pixel: `.planning/ui-reviews/2026-07-11T04-32-30-989Z/knowledge-desktop.png`. (50-04) |

## Notes

- **Zero `[pending]` scenarios confirmed by direct read** of all six source files at roll-up time:
  `39-HUMAN-UAT.md` (status `complete`, 2/2 passed), `41-HUMAN-UAT.md` (status `complete`, 5/5
  passed), `43-HUMAN-UAT.md` (status `complete`, 3 passed + 1 moved-to-morning-checklist),
  `45-HUMAN-UAT.md` (status `complete`, 5 passed + 2 moved-to-morning-checklist, one split note on
  45.7), `47-HUMAN-UAT.md` (status `evidence-captured`, 1 moved-to-morning-checklist),
  `48-HUMAN-UAT.md` (status `complete`, 2/2 passed).
- **No `tracked-fix` scenarios among the 21.** Two real bugs were found and fixed during 50-02
  (a `chat-canvas.tsx` restore-race production bug, and several test-authoring/Playwright
  precision fixes) — both are recorded as `passed` in their source files because the fix landed
  in the SAME plan run and the scenario closed live, not deferred. See `50-02-SUMMARY.md`
  Deviations for the full account.
- **One unrelated todo was filed (not a burn-down scenario itself):**
  `.planning/todos/pending/2026-07-11-chat-cost-ledger-null-user-id.md` — a pre-existing
  `chat_cost_ledger` NOT NULL `user_id` violation found during 50-02, out of scope for any of the
  21 scenarios, filed for a future plan.
- **The `moved-to-morning-checklist` four (43.1, 45.5, 45.6, 47.1) are all actionable**, each with
  a real destination in `49-HUMAN-UAT.md` / `MORNING-CHECKLIST.md` — three pre-existing (43.1 →
  §A, 45.6 → §B, 47.1 → §E.3 added by 50-04) and one newly created by this plan's Task 2 (45.5 →
  new §F.1, since no prior item covered Gmail-forward raw-message fixture realism). 45.7's
  real-arrival residual slice rides on 45.6/§B rather than being counted as a fifth row — it is
  not a distinct scenario ID.
- This roll-up closes requirement **LIVE-05** for the locally-provable/evidence-capturable
  portion of all 21 scenarios. The four `moved-to-morning-checklist` items remain genuinely
  outstanding pending the user's morning session — LIVE-05 is not marked fully `Validated` in
  `PROJECT.md` until those close (see `50-05-SUMMARY.md` for the exact disposition language).
