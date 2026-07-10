---
phase: 45-email-threads-forwarding-seam
plan: 06
subsystem: api
tags: [trpc, crypto, drizzle, next.js, forwarding, csprng]

# Dependency graph
requires:
  - phase: 45-email-threads-forwarding-seam
    plan: 01
    provides: "forwarding_addresses table (UNIQUE token, UNIQUE user_id) + assertForwardingAddressOwnership"
  - phase: 43-auth-google-oauth-sessions-supabase-auth
    plan: 03
    provides: "protectedProcedure + ctx.user (session-verified identity)"
provides:
  - "forwardingRouter.getOrCreateMyAddress — CSPRNG token get-or-create, idempotent under concurrency"
  - "apps/web/settings/forwarding — minimal web surface (address + copy + runbook link)"
  - "FORWARDING-RUNBOOK.md — user-gated SES catch-all + Gmail verification handshake runbook"
  - "FORWARDING_EMAIL_DOMAIN env var contract (documented, not yet applied — see 45-USER-SETUP.md)"
affects: [45-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "getForwardingDomain() reads FORWARDING_EMAIL_DOMAIN at CALL TIME (not module init), mirroring _listener-config.ts's getListenerConfig() idiom — same class of api-client env-var guard, reusable for the next server-side-only env var this package needs"
    - "get-or-create idempotency under concurrency via insert().onConflictDoNothing({target: uniqueCol}).returning() + a re-select fallback when returning() comes back empty — no raw postgres error code catching needed"

key-files:
  created:
    - packages/api-client/src/router/forwarding/index.ts
    - packages/api-client/src/router/forwarding/__tests__/forwarding.test.ts
    - apps/web/src/app/_components/forwarding-address-card.tsx
    - apps/web/src/app/settings/forwarding/page.tsx
    - .planning/phases/45-email-threads-forwarding-seam/FORWARDING-RUNBOOK.md
    - .planning/phases/45-email-threads-forwarding-seam/45-USER-SETUP.md
  modified:
    - packages/api-client/src/root.ts
    - apps/web/.env.example

key-decisions:
  - "requirements.mark-complete NOT run for THRD-04 despite it being this plan's own frontmatter requirement — ROADMAP.md's wave breakdown assigns THRD-04 to BOTH 45-05 (FastAPI token resolution) and 45-06 (this plan, token generation). 45-05 has not executed yet (no 45-05-SUMMARY.md on disk) and the seam only 'exists' end-to-end once resolution also lands. Marking THRD-04 complete now would repeat the exact premature-completion bug documented and reverted in 44-02-SUMMARY.md and explicitly avoided in 45-01-SUMMARY.md. REQUIREMENTS.md's THRD-04 row stays 'Pending'."
  - "No .input() at all on getOrCreateMyAddress (not even z.object({}))" — the procedure needs zero client-supplied fields; omitting .input() entirely is a stronger structural guarantee than an empty-but-present schema that there is nothing for an attacker to inject as a userId override."

patterns-established:
  - "Env var read-at-call-time-with-clear-throw pattern (getForwardingDomain) is now used twice in packages/api-client (getListenerConfig, getForwardingDomain) — the next server-only env var this package needs should follow the same shape rather than reaching for a Zod schema (that's apps/web/src/lib/env.ts's job for its own disjoint public/server var set, not api-client's)."

requirements-completed: []

# Metrics
duration: ~25min
completed: 2026-07-10
---

# Phase 45 Plan 06: Forwarding Seam (Web Half) Summary

**`forwarding.getOrCreateMyAddress` tRPC procedure issuing a CSPRNG-derived, idempotent `u-{token}@{domain}` address per user, a minimal `/settings/forwarding` surface with copy-to-clipboard, and a user-gated FORWARDING-RUNBOOK.md covering the still-unapplied SES catch-all rule and Gmail's destination-verification handshake.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-10T08:00Z (approx.)
- **Completed:** 2026-07-10T08:24Z
- **Tasks:** 3 completed
- **Files modified:** 8 (6 created, 2 modified)

## Accomplishments

- `forwardingRouter.getOrCreateMyAddress` (protectedProcedure, no `.input()` at all): SELECTs
  the caller's existing `forwarding_addresses` row by `ctx.user.id`; on first call, generates a
  256-bit CSPRNG token (`node:crypto` `randomBytes(32).toString("base64url")`) and INSERTs via
  `onConflictDoNothing({ target: userId }).returning()`; if a concurrent call won the race
  (`returning()` comes back empty), re-selects the winner's row rather than throwing. Registered
  as `forwarding: forwardingRouter` in `root.ts`.
- `getForwardingDomain()` reads `FORWARDING_EMAIL_DOMAIN` at call time (not module init,
  mirroring the existing `_listener-config.ts` idiom) and throws a specific error naming the var
  when absent — a missing env var fails loudly, never silently builds a blank/invalid address.
- `buildForwardingAddress(token, domain)` composes the exact `u-{token}@{domain}` seam contract
  the FastAPI resolver (Plan 45-05) will parse.
- `forwarding-address-card.tsx`: client component rendering the address in a read-only field
  with a copy-to-clipboard button (Check/Copy icon swap, 1.5s reset), loading skeleton, friendly
  error state (raw error only reaches `console.error`, never the address itself), and a link to
  `FORWARDING-RUNBOOK.md`.
- `settings/forwarding/page.tsx`: new standalone route mounting the card. `inbox-three-pane.tsx`
  (owned by Plan 45-04) was never opened or modified — zero file overlap.
- `FORWARDING-RUNBOOK.md`: 5 sections + troubleshooting — (1) the SES domain-level catch-all
  receipt rule as a reviewable terraform draft (drafted, explicitly NOT applied — `ses.tf` today
  only has three exact-recipient rules, none of which match `u-{token}@`), (2) getting the
  address at `/settings/forwarding`, (3) Gmail's "Forwarding and POP/IMAP" setup, (4) retrieving
  Gmail's numeric confirmation code from the app's own ingested inbox (citing Plan 45-05's own
  test assertion that the verification mail is saved, not dropped), (5) an end-to-end
  verification round-trip flagged as manual UAT. States plainly that `FORWARDING_EMAIL_DOMAIN`
  must equal the SES-verified domain.
- `apps/web/.env.example` documents `FORWARDING_EMAIL_DOMAIN` (server-side only) with its
  correctness contract (must match both the SES-verified domain and the still-unapplied
  catch-all rule's domain).
- `45-USER-SETUP.md` generated (plan frontmatter has a `user_setup` block): the one item is the
  `FORWARDING_EMAIL_DOMAIN` env var plus the gated `terraform apply` for the SES catch-all rule.
- 7 new tests (fake-Drizzle-chain idiom matching `emails-user-scoping.test.ts`): create+address
  shape+userId-from-ctx, idempotent second call, concurrent-insert-conflict re-select, session
  required (0 db calls when sessionless), missing-env fail-fast, token entropy/charset,
  `buildForwardingAddress` contract. Full `packages/api-client` suite: **334/334 passing** (28
  files, up from the 308+ baseline).
- `npx tsc --noEmit` clean in both `packages/api-client` and `apps/web` (zero new errors outside
  the pre-existing `src/app/dev/design` baseline).

## Task Commits

Each task was committed atomically:

1. **Task 1: forwarding tRPC router — getOrCreateMyAddress** - `1758078` (feat)
2. **Task 2: Minimal web surface — forwarding address card + settings page** - `165fbc5` (feat)
3. **Task 3: FORWARDING-RUNBOOK.md — SES routing + Gmail verification handshake** - `7709c69` (docs)

**Plan metadata:** (this SUMMARY.md commit, following)

## Files Created/Modified

- `packages/api-client/src/router/forwarding/index.ts` - `forwardingRouter.getOrCreateMyAddress` + `generateForwardingToken`/`getForwardingDomain`/`buildForwardingAddress` helpers
- `packages/api-client/src/router/forwarding/__tests__/forwarding.test.ts` - 7 tests, fake-Drizzle-chain idiom
- `packages/api-client/src/root.ts` - Registers `forwarding: forwardingRouter`
- `apps/web/src/app/_components/forwarding-address-card.tsx` - Address display + copy + loading/error states + runbook link
- `apps/web/src/app/settings/forwarding/page.tsx` - Standalone route mounting the card
- `.planning/phases/45-email-threads-forwarding-seam/FORWARDING-RUNBOOK.md` - User-gated SES catch-all + Gmail handshake runbook
- `.planning/phases/45-email-threads-forwarding-seam/45-USER-SETUP.md` - `FORWARDING_EMAIL_DOMAIN` + gated terraform apply
- `apps/web/.env.example` - Documents `FORWARDING_EMAIL_DOMAIN`

## Decisions Made

- **No `.input()` at all** on `getOrCreateMyAddress` — stronger than an empty `z.object({})`: there is structurally nothing for a client to supply, so the "userId always from ctx" guarantee holds by construction, not just by convention.
- **`onConflictDoNothing` + re-select over a try/catch on a raw unique-violation error code** — idiomatic Drizzle, avoids coupling to postgres's `23505` error shape, and the re-select path is exercised by Test 3 (`insertConflict: true`).
- **`requirements.mark-complete` skipped for THRD-04** — see key-decisions in frontmatter. The seam isn't real until Plan 45-05 (resolution) also lands; REQUIREMENTS.md stays accurate at "Pending".
- **SES catch-all rule left as a draft in the runbook, not applied** — per the plan's own scope (`terraform apply` against live SES is explicitly user-gated, same discipline as `EXTERNAL-RENAME-RUNBOOK.md`). The address the app generates today is therefore correct in shape but **not yet routable** until the user applies Section 1 of the runbook.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Rebuilt a stale, gitignored `packages/api-client/dist/` build artifact**
- **Found during:** Task 2, running `npx tsc --noEmit` in `apps/web`
- **Issue:** Identical root cause to 43-03-SUMMARY.md's Deviation 2 — `apps/web`'s `tsc` resolves `@polytoken/api-client`'s types via `package.json`'s `exports["."].types` → `./dist/index.d.ts`, a stale local build artifact that predated this plan's new `forwarding` router. `apps/web` reported `Property 'forwarding' does not exist on type ...` even though `src/root.ts` was correct.
- **Fix:** Ran `npm run build` in `packages/api-client` to regenerate `dist/` from current source. `dist/` is gitignored — confirmed `git status --short packages/api-client/dist` is empty after the rebuild.
- **Files modified:** none (gitignored build output only, not committed)
- **Verification:** Re-ran `npx tsc --noEmit` in `apps/web` — zero errors outside the pre-existing `src/app/dev/design` baseline.
- **Committed in:** N/A (untracked/ignored artifact; documented in the Task 2 commit message `165fbc5` for traceability, same as 43-03's precedent)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking, a recurring pre-existing tooling nuance, not a logic error in this plan's own code — third occurrence of this exact class after 43-03).
**Impact on plan:** Necessary to get an accurate `tsc` signal; zero scope creep, zero committed side effects.

## Issues Encountered

- **`npm run lint` cannot run in `apps/web` — no ESLint config exists anywhere in the repo.** `next lint` drops into an interactive "How would you like to configure ESLint?" wizard (no non-interactive answer), and running `npx eslint` directly confirms: "ESLint couldn't find an eslint.config.(js|mjs|cjs) file." Confirmed via `git log --all` that no `.eslintrc*`/`eslint.config.*` has ever existed in `apps/web`'s history — this is a pre-existing, repo-wide gap, not something this plan's files introduced. Out of scope per the deviation rules' scope boundary (scaffolding a whole ESLint config for the app is a substantial, unrequested tooling change well beyond a "minimal web surface" plan). `npx tsc --noEmit` is clean and was used as the available signal instead. Logged here rather than silently skipped; not fixed.

## User Setup Required

**External SES configuration requires manual, user-gated action.** See
[45-USER-SETUP.md](./45-USER-SETUP.md) and
[FORWARDING-RUNBOOK.md](./FORWARDING-RUNBOOK.md) for:
- `FORWARDING_EMAIL_DOMAIN` env var (documented in `apps/web/.env.example`)
- The SES domain-level catch-all receipt rule (drafted in the runbook as reviewable terraform,
  `terraform apply` deliberately NOT run by this plan)
- The full Gmail forwarding + destination-verification round-trip (flagged as manual UAT)

## Next Phase Readiness

- THRD-04's web half (token generation + minimal surfacing + runbook) is code-complete. THRD-04
  itself stays `Pending` in REQUIREMENTS.md until Plan 45-05 (FastAPI token resolution) also
  lands — the seam is not real end-to-end until both halves exist.
- Plan 45-05 (`ForwardingAddressResolver` + Supabase adapter + ingest wiring) can now be
  developed/tested against a real `u-{token}@` address contract — this plan's `buildForwardingAddress`
  and 45-05's own planned `token_from_recipient` both parse/emit the identical `u-` prefix.
  45-05 was already unblocked on the schema side (Plan 45-01); this plan adds nothing 45-05
  structurally depends on beyond the shared address-contract convention (already documented in
  the schema comment since 45-01).
  25-05 has not yet been executed as of this SUMMARY (no `45-05-SUMMARY.md` on disk) — confirmed via
  `.planning/phases/45-email-threads-forwarding-seam/*.md` listing at the start of this plan's execution.
- No blockers for the remaining phase plans (45-04, 45-05).

---
*Phase: 45-email-threads-forwarding-seam*
*Completed: 2026-07-10*

## Self-Check: PASSED

- FOUND: packages/api-client/src/router/forwarding/index.ts
- FOUND: packages/api-client/src/router/forwarding/__tests__/forwarding.test.ts
- FOUND: apps/web/src/app/_components/forwarding-address-card.tsx
- FOUND: apps/web/src/app/settings/forwarding/page.tsx
- FOUND: .planning/phases/45-email-threads-forwarding-seam/FORWARDING-RUNBOOK.md
- FOUND: .planning/phases/45-email-threads-forwarding-seam/45-USER-SETUP.md
- FOUND: commit 1758078 (feat(45-06): forwarding tRPC router — getOrCreateMyAddress)
- FOUND: commit 165fbc5 (feat(45-06): minimal web surface — forwarding address card + settings page)
- FOUND: commit 7709c69 (docs(45-06): FORWARDING-RUNBOOK.md — SES catch-all routing + Gmail verification handshake)
- Re-ran plan-level `<verification>`:
  - `npx tsc --noEmit` in packages/api-client — clean
  - `npx tsc --noEmit` in apps/web — clean (zero new errors outside src/app/dev/design baseline)
  - `npm run lint` in apps/web — CANNOT RUN (no ESLint config exists anywhere in the repo; see Issues Encountered — pre-existing, out of scope)
  - `npm run test -- forwarding` in packages/api-client — 7/7 passing
  - Full packages/api-client suite — 334/334 passing (28 files)
  - `test -f FORWARDING-RUNBOOK.md && grep -qi verification FORWARDING-RUNBOOK.md` — PASS
- Acceptance criteria re-verified: no new `package.json`/lockfile diffs across all 3 task commits (`git diff --stat` — empty, confirms T-45-06-SC "no new npm installs")
