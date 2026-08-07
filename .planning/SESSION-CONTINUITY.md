# SESSION CONTINUITY — cold-start brief for the vLAUNCH driver

> **Read this first if you are a fresh session, a post-compaction driver, or the cron
> backstop taking over.** It is the minimum you need to resume without re-deriving anything.
> Everything here is durable; nothing important lives only in chat.

## 1. Where we are, in one paragraph

vLAUNCH (phases 78–81, "Durable Mail & First Dollar") is OPEN and blessed. **Every unit of
agent-executable work in the milestone is finished.** Waves 0 through 0.10 shipped overnight
2026-08-07: the pre-bless prep pack, three rounds of 10-angle review fixes, a breadth burn on
discoverability debt, the recorded-queue burn, the upsell banner, a security fix, and the
post-gate execution kits. What remains is **entirely Pedro-gated**: two sittings, and the
waves that run downstream of them.

## 2. Orientation order (do not skip)

1. `.planning/ORCHESTRATOR-STATE.md` ⭐ **CURRENT block** — the live "where are we".
2. `.planning/MORNING-REPORT-2026-08-07.md` — what shipped, the incidents, the one-screen ask.
3. `.planning/BATCH-A-SITTING.md` — Pedro's ordered script (the gate everything waits on).
4. `.planning/ASSUMPTIONS-2026-08-07.md` — **A1–A14**, every assume-positive call + its backcheck.
5. `.planning/milestones/VLAUNCH-WAVE-PLAN.md` — **§4 rails are LAW** for any lane you launch.
6. `.planning/milestones/vlaunch-prep/` — runsheets, BILL-04 harness, UAT pack.

## 3. Standing orders in force (Pedro, 2026-08-07)

- **Ultracode is standing** for all of vLAUNCH: use the Workflow tool for every fan-out;
  worktree isolation per lane; **no lane self-certifies** — hostile review before every merge.
- **Nonstop / assume-positive**: never ask, never stall waiting for input; when a check would
  need Pedro, assume the positive outcome, **record it in the ASSUMPTIONS register**, continue.
- **Never touch** (hard limits, unchanged): staging `--yes`, PROD_* secrets, `terraform apply`,
  Stripe, flag flips, prod DB writes.
- **Two-strikes rule**: a lane stalling twice on the same error is stopped and surfaced in the
  morning report, never retried a third time.
- **Ignore credential rotation** — long-standing explicit order; it stays a named debt, not an ask.

## 4. Hard-won laws (violating these cost real damage once)

- **WORKTREE JUNCTION LAW** (VLAUNCH-WAVE-PLAN §4): lane junctions point ONLY inside their own
  worktree. Cleanup = `git worktree remove --force` first; for leftovers delete reparse points
  individually, THEN the directory. **Never `rm -rf` a worktree dir.** Violating this followed a
  junction into the main checkout and deleted 1265 tracked files (recovered via `git restore .`).
- **Stale-dist trap**: after changing a `packages/api-client` router, `npm run build -w
  @polytoken/api-client` BEFORE typechecking apps/web, or tsc resolves a stale `AppRouter`.
- **jsdom proves logic, never layout** — anything geometric/visual needs the real-browser gates.
- **"Inert by construction" is worthless unless code ENFORCES it** — the 2026-08-07 security fix
  exists because a comment claimed a path was unreachable and nothing made it so.

## 5. The gate matrix (what "full gates" means)

- **Listener** (any `apps/email-listener/**` change — merge = live mail-receiver redeploy):
  `cd apps/email-listener && uv run pytest` (full) `&& uv run mypy app && uv run ruff check &&
  uv run lint-imports`.
- **TS**: `SKIP_ENV_VALIDATION=1 npm run test -w @polytoken/<ws>` per touched workspace +
  `npm run typecheck -w <ws>` (apps/web's typecheck now also runs the e2e tsconfig leg).
- **Never** bare `next build` (use `build:local`), never bare `npx playwright test`.

## 6. What is left, precisely

| Step | Owner | Unblocks |
|---|---|---|
| **Batch A sitting** (BATCH-A-SITTING.md) | Pedro | Waves 1–2 |
| Waves 1–2 (verification, staging cutover rehearsal) | driver, unattended | Batch B |
| **Batch B sitting** (prod flips, BILL-05 written GO, first dollar, screenshot verdicts) | Pedro | Waves 3–4 |
| Waves 3–4 (prod cutover finishers, WEDG-01..04, BURN-06) | driver, unattended | close |
| `/gsd:audit-milestone` → `/gsd:complete-milestone` → **sauce backup (blocker-grade)** | driver + Pedro | vLAUNCH done |

Pre-staged so the post-gate waves need zero research: `scripts/verify-wave1.mjs`,
`scripts/verify-cutover.mjs`, `scripts/collect-wedge-evidence.mjs`,
`scripts/fill-wedge-baseline.mjs`, `scripts/check-close-readiness.mjs`,
`scripts/merge-wave.mjs` (+ their `docs/*.md`) — all verify-only, prod-write-refusing.

## 7. Decisions only Pedro can make (do not assume these)

**A11** tier-for-enforcement (a `past_due` pro enforces as free) · **A12** widget-submit answers
consume chat allowance but are ungated · **A13** the upsell banner reads the display tier, not the
enforced one · **A14** the capability-binding kill switch stays default-OFF · **BILL-05** the
legal/MoR written GO (gates public pricing and any third-party charge; a lane was correctly
safety-blocked on it) · the SES case reply.
