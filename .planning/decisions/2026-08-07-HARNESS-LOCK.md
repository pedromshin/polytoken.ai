# DECISION — Harness lock through v2.0 · 2026-08-07

**Decider:** Pedro (final for this stretch; relayed 2026-08-07 after a dedicated harness deep-dive
in a parallel session). **Status:** LOCKED. **Scope:** every milestone up to and including v2.0.

## The decision

**v2.0 and everything before it runs on Claude Code + gsd plugin 4.5.3 + the `.planning/` format.**
No harness experiments mid-milestone.

## Why GSD Pi is disqualified NOW (evidence from the 2026-08-07 deep-dive)

GSD Pi (open-gsd/gsd-pi, successor of GSD-2) has a genuinely stronger autonomy engine — enforced
per-unit tool policies, SQLite-checkpointed crash recovery, stuck detection, budget ceilings with
model downgrade, headless overnight restart — but migrating now fails on the facts:

- The importer **silently destroys decision bodies** (open issue **#1607**).
- The importer produces **inconsistent completion state** (open issue **#1606**).
- It does not model VISION / learnings / UAT / ORCHESTRATOR-STATE — those become a verbatim
  archive only, i.e. this repo's live planning-state machinery would go dead on arrival.
- The migration is **one-way for multi-milestone layouts** (this repo has ~20 milestones).
- v1.12.0 (3 days old at decision time) already has **loop-stopping auto-mode regressions**
  (**#1614**, **#1619**).

## Re-entry criteria (verbatim, per Pedro)

> Revisit when #1606 + #1607 are closed AND a v1.12.x stabilization lands; then trial on a
> throwaway project first, and run /gsd migrate's preview against a COPY of this repo before any
> real migration. No harness experiments mid-milestone.

## Operating rules that come with the lock

1. **Plugin update route (the ONLY sanctioned one):**
   `claude plugin marketplace update gsd-plugin && claude plugin update gsd@gsd-plugin`,
   then `/reload-plugins` once per session. **Never `/gsd:update`** — pre-4.5.2 it could overlay
   the npm open-gsd distribution over the plugin install.
2. **Calendar fact — Buildomator rebrand:** the plugin has rebranded to Buildomator. `/gsd:*` and
   `gsd-sdk` **hard-retire at v5.0 on 2026-10-01** (pure prefix swap to `/bm:*`, same plugin).
   → Schedule a small chore phase for the prefix swap when v5 nears (put it in the milestone
   after next's backlog at the latest).
3. **Vendored gsd-core** (`.claude/gsd/`, unprefixed `/gsd-*`, separate lineage from the plugin):
   bump 1.8.0 → 1.9.1 (Windows spawn hardening + worktree fixes) via the SOURCE_COMMIT.txt
   vendoring process — in flight 2026-08-07.
4. **Sauce-backup ritual** (standing, blocker-grade): at EVERY milestone close run
   `scripts/sauce-backup.ps1` — dated `sauce-*` tag pushed to origin + full-ref git bundle +
   non-git zip (agent memory dir, user-scope `.claude` agents/commands/skills/gsd, CLAUDE.md)
   into `C:\Users\pc\polytoken-backups\`. That content is the product's core IP; **backup failure
   blocks the close**, it is not a warning. First capture: `sauce-2026-08-06-pre-v2.0` (done).

## Companion work directions recorded the same day

- vLAUNCH (phases 78–81, Durable Mail & First Dollar — `.planning/milestones/PROPOSAL-vLAUNCH.md`)
  is **BLESSED** as proposed; execute on this harness, starting after Pedro's `/reload-plugins`.
- The long arc is fixed on **v2.0 = E4+E5+E6** (local agent platform); Arc-1 retention data sets
  the pace, not the destination.
- The 7 vNEXT audit seams + SES reply + Legal/MoR are consolidated in
  `.planning/PEDRO-DECISION-SHEET-2026-08-07.md` — answered in one sitting, never blanket-resolved.
