# Meta-Directory Assessment — .claude / GSD / config / skills

_Lane 11 of the 2026-07-24 system assessment. Read-only. Every claim cited to file:line._

## Bottom line

The meta apparatus is **thin where you'd expect machinery and bloated where you'd expect a
single pointer**. `.claude/` has almost nothing committed (one skill); the real "brain" is
`.planning/` (768 files) plus `CLAUDE.md`. `CLAUDE.md` itself is *accurate* about the build/env/test
footguns — every doc ref and script I checked resolves. The rot is **navigational**: the one
"where are we" pointer in `CLAUDE.md` aims at a stale 07-22 audit, while **three competing state
ledgers from three different days** all declare themselves ground truth and disagree with each
other. A fresh agent following `CLAUDE.md` lands on the oldest of the three. That is the
highest-leverage cleanup — not deleting files, but collapsing the ground-truth pointer to one place.

---

## 1. `.claude/` is nearly hollow (surprising, not necessarily wrong)

Only committed artifact under `.claude/` is a single skill:

- `.claude/skills/polytoken-design-system/` (SKILL.md + 2 build scripts + component-catalog.md).
  Skill is healthy: `scripts/build-catalog.mjs:16,23` pull from live shadcn/kibo registries; the
  skill is un-ignored via the negation line `.gitignore:74` exactly as `CLAUDE.md:44` warns.

Everything else the GSD prose assumes is **absent or gitignored**:
- No `settings.json` / `settings.local.json` anywhere in the tree (searched, none). `.gitignore:65`
  ignores `settings.local.json` but there is no committed `settings.json` either — permissions,
  env, hooks are all default/uncommitted.
- No `.claude/agents/`, no `.claude/gsd-support/` on disk (both gitignored: `.gitignore:75-76`).
- No `.claude/commands/`, no hooks dir, no plugins dir, no `.mcp.json` — none exist.
- `.claude/worktrees/` holds 5 transient fan-out worktrees (`wf_6f85ee71-d16-1..5`), correctly
  gitignored by the most recent commit `ebfea26` ("chore: gitignore transient Workflow worktrees",
  `.gitignore:78`). These map 1:1 to the 5 pending `wf1-*` task branches — transient, ignore.

**Implication:** the elaborate orchestration described in `ORCHESTRATOR-STATE.md` (an hourly backstop
Routine `trig_01FYyp3Kpfa2vgWBY56N4Gq1`, worktree-per-lane fan-out, skeptic verification) has **zero
committed configuration**. It lives entirely in prose + external Routine state. That is fine for a
solo operator but means the repo cannot reconstruct its own automation — a coherence gap, not a bug.

---

## 2. THE core problem — three competing state ledgers, three eras

Three files each present themselves as the authoritative "where are we," written on three
different days, and they **do not agree**:

| File | Committed | Self-claim | Says current work is… |
|---|---|---|---|
| `.planning/STATE.md` + `HANDOFF.json` | 07-23 09:52 | "State" / reconciled snapshot | v1.11 Phases 68-72 "BUILT-BUT-UNVERIFIED", verify next (`STATE.md:29-38`) |
| `research/2026-07-23-GRAND-COMPLETION-REPORT.md` | 07-23 | "Completion Report… map of what shipped" | seven waves shipped on branch `jzz1pg` tip `a5c5539` (`:1-3`) |
| `.planning/ORCHESTRATOR-STATE.md` | **07-24 11:31** | **"the single source of truth for 'where are we'"** (`:4-5`) | unattended run shipping canvas nodes; `jzz1pg` "consolidated onto main… nothing lost" (`:11-13`) |

- `ORCHESTRATOR-STATE.md:4` literally asserts *"This file is the single source of truth."*
  `STATE.md:15-20` is titled `# State` and is the file the GSD tooling reads. Two files, same claim.
- They disagree on **work mode**: `STATE.md` frames everything as GSD milestone/phase verification
  (v1.11, phases 68-72); `ORCHESTRATOR-STATE.md` describes a different regime entirely — a loop
  shipping `document`/`spreadsheet` canvas nodes to `main`, with the marquee items being
  "AI-builds-a-node" and "chat writes files into a node" (`ORCHESTRATOR-STATE.md:26-40`). Neither
  mentions the other's framing.
- They disagree on **branch**: `STATE.md:53-54` calls `claude/polytoken-email-infra-cont-jzz1pg`
  "in flight on a sibling branch"; `ORCHESTRATOR-STATE.md:10-11` says that branch was already
  consolidated to main and we are now on `qi9q5g` (the actual current branch,
  `git branch --show-current`).

An agent resuming cold cannot tell which regime is live without reading git log and inferring dates.

---

## 3. CLAUDE.md — accurate on footguns, stale on navigation

`CLAUDE.md` is genuinely good on the operational traps and I verified each:
- `build:local` / `NEXT_DIST_DIR=.next-verify` claim (`CLAUDE.md:10-12`) → real:
  `apps/web/package.json:11`.
- Env split, geometry/screenshot gates (`CLAUDE.md:14-27`) → `apps/web/package.json:7,18-19` and all
  referenced docs (`docs/RUN-LOCAL.md`, `docs/design/taste-references.md`, `58-IDENTITY.md`,
  `scripts/preflight-local.sh`) exist.
- The "where things live" table (`CLAUDE.md:29-41`) matches `package.json:7` workspaces.

**The one rotten line is the navigation pointer.** `CLAUDE.md:41` sends agents to
*"current audit: `.planning/research/2026-07-22-META-AUDIT.md`"*. That file exists but is the
**oldest** of the audits — it is superseded by 07-23 work sitting right beside it:
`2026-07-23-codebase-hygiene-audit.md`, `2026-07-23-GRAND-COMPLETION-REPORT.md`,
`HANDOFF-GAPS-2026-07-23.md`, and the 07-24 `ORCHESTRATOR-STATE.md`. `CLAUDE.md` contains **no
pointer at all** to `ORCHESTRATOR-STATE.md`, `STATE.md`, or `HANDOFF.json` (grep confirms line 41 is
the only such reference). So `CLAUDE.md` routes a fresh agent to a two-day-stale snapshot and never
names the file that calls itself the source of truth.

---

## 4. The "stale domain" narrative is INVERTED — a live-infra hazard (Landmine #1 confirmed)

The triggering handoff framed `magnitudetech.com.br` / `nauta-web` as stale drift to purge. **In the
committed code they are the LIVE production namespace:**
- SES is built entirely on `magnitudetech.com.br`: `infrastructure/aws/ses.tf:3` `domain =
  "magnitudetech.com.br"`; every receipt rule routes there (`ses.tf:126,144,163,204`); the
  personal-forward rule targets `pedro@magnitudetech.com.br` (`ses-forwarder.tf:155`,
  `variables.tf:98`); the catch-all is `magnitudetech.com.br` bare domain (`ses.tf:204`).
- The web prod domain **is** `polytoken.ai`, but the Vercel *project* is still literally named
  `nauta-web` (`docs/DEPLOY.md:20`).
- `var.project` default is `"nauta-services"` (`infrastructure/aws/variables.tf:16`); target-group
  prefix `nauta-el` (`locals.tf:4`); TF state bucket `nauta-services-terraform-state`
  (`main.tf:17`).

So an agent that reads a "magnitudetech is stale, rename it" instruction and acts on it would
rewrite the live SES domain and break Pedro's mail. **This is exactly the doc-vs-reality drift that
is "actively misleading an agent."** The meta layer should carry an explicit DO-NOT-RENAME note next
to Landmine #1; today nothing in `CLAUDE.md` warns of it, and `STATE.md:55` only softly flags
`nauta-services-*` as "parked (999.20)".

---

## 5. `.planning/` bloat — 768 files, no enforced hierarchy

- ~14 root-level docs, several very large: `PROJECT.md` 81KB, `ROADMAP.md` 72KB, `MILESTONES.md`
  49KB, `USER-STORIES.md` 28KB, `RETROSPECTIVE.md` 34KB. These are read-heavy for any agent trying
  to orient.
- `research/` holds 30+ files including **overlapping audits of the same week**: `META-AUDIT`,
  `COVERAGE-MATRIX`, `FEATURE-CATALOG`, `cost-reliability`, `tests-security-audit` (all 07-22) plus
  8 more dated 07-23. Plus version-scoped subdirs (`v1.3`, `v1.6-chat-knowledge`, `v1.7-…`, `v1.8-…`,
  `two-epoch-endgame`, `e7-inference`, `cloud-desktop`, `business`, `polytoken-vision`).
- `STATE.md:63-64` itself records the fix as a *deferred, not-started* reorg: "fold version-scoped
  `research/` dirs into milestone archives" and "split `night-run/` docs from runtime scripts." The
  tree knows it is bloated and hasn't acted.

---

## Recommended target shape (cleanup, not rewrite)

1. **Collapse ground truth to ONE file.** Pick `ORCHESTRATOR-STATE.md` *or* `STATE.md` as the single
   live ledger; make the other a pointer stub. Update `CLAUDE.md:41` to name that one file instead
   of the 07-22 `META-AUDIT`. Highest leverage, ~10 min, zero code risk.
2. **Add a Landmine-1 guard to `CLAUDE.md`**: one line — "`magnitudetech.com.br` / `nauta-*` are LIVE
   SES + Vercel names, NOT stale; renaming = mail outage. See `infrastructure/aws/ses.tf`." This
   directly neutralizes the inverted-drift hazard.
3. **Date-stamp or archive superseded audits.** Move the 07-22 research audits into a
   `research/archive/` (or milestone dir) so only the newest audit is at the top level; execute the
   already-recorded `STATE.md:63-64` reorg.
4. **Commit the automation config or document its absence.** Either check in a `settings.json`
   describing the Routine/worktree workflow, or add one `CLAUDE.md` line saying orchestration state
   is external (Routine `trig_…`) and not reconstructable from the repo — so no agent assumes a
   missing config file was lost.
5. **Leave `CLAUDE.md`'s footgun sections alone** — they are correct and load-bearing.
