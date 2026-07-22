# Claude Code / agentic-engineering ecosystem scan — 2026-07-22

Scope: what polytoken's solo, AI-driven, phone-heavy development should adopt from the current
Claude Code ecosystem. Grounded in `CLAUDE.md` and `.planning/research/2026-07-22-META-AUDIT.md`
(read first), plus `.planning/config.json` (repo runs **GSD** in yolo mode, parallelization on,
graphify on) and `.claude/` (one skill: `polytoken-design-system`; **no** `settings.json`, hooks,
commands, or agents — the META-AUDIT P1 "under-tooled" finding is confirmed).

**Caveat on numbers:** star counts and dates below come from secondary blog coverage surfaced by
web search; several are mutually inconsistent (e.g. GSD reported at both ~35k and ~59k stars;
Superpowers at ~94k and ~174k). Treat all star figures as *reported, unverified* — directionally
"large and actively maintained," nothing more. Where a claim is my inference, it is labeled
**Assumption**.

Verdict key: **ADOPT** (wire it in the next hygiene phase) · **TRIAL** (time-boxed experiment,
keep only if it earns its context cost) · **SKIP** (not for this repo now).

---

## 0. Repo reality that drives every verdict

1. Solo developer (Pedro), frequently driving from a phone; long unattended "night-run" builds.
2. GSD already installed and load-bearing (`.planning/` tree, config.json) — but drifted:
   STATE.md 5,451 lines, four sources disagree on "current" (META-AUDIT §1).
3. Zero harness hardening: no permissions allowlist, no hooks, and `CLAUDE.md` references a
   skill (`verify-rendered-geometry`) that does not exist on disk; `.gitignore` swallows
   `.claude/skills/` (META-AUDIT P0/P1).
4. Known footguns that hooks could mechanically prevent: `pnpm install` pollution, the 999.22
   `.next` corruption trap, env-split confusion, credential-capture files landing in the repo.
5. Stack: Next.js 15 / React 19 / Tailwind 4 / tRPC / Drizzle / Supabase local / FastAPI+uv —
   i.e. fast-moving frameworks where stale training data bites, and a Postgres DB that
   `CLAUDE.md` says is the source of truth ("verify against the DB, not terminal output").

---

## 1. Trending repos in agentic coding (day/week/month/year view)

Precise per-day GitHub trending snapshots aren't retrievable after the fact; below is the
consensus "what's hot mid-2026" from roundups ([Analytics Vidhya July 2026](https://www.analyticsvidhya.com/blog/2026/07/trending-ai-github-repositories/),
[Firecrawl](https://www.firecrawl.dev/blog/best-github-repos), [ODSC](https://odsc.medium.com/top-agentic-ai-github-repos-worth-watching-in-2026-so-far-d841e998d524),
[KDnuggets](https://www.kdnuggets.com/10-github-repositories-to-master-claude-code)). The macro
trend: innovation moved from models to **harness tooling** — frameworks, MCP servers, gateways.

| Repo / tool | What it is | Maturity | Benefit here | Verdict |
|---|---|---|---|---|
| `gsd-build/get-shit-done` (GSD) | Spec-driven planning system this repo already runs; v1.40.0 as of May 2026, 138 contributors, 57 releases since Dec 2025 ([Augment Code](https://www.augmentcode.com/learn/gsd-58k-stars-claude-code), [GitHub](https://github.com/gsd-build/get-shit-done/)) | High, very active | Repo's install predates months of upstream fixes. **Assumption:** local GSD is a snapshot/fork (config has `graphify`, `nyquist_validation` keys I can't confirm upstream). Upstream has iterated on exactly the STATE.md-bloat and state-drift problems META-AUDIT documents | **ADOPT** (upstream refresh, after reconciling state first — never mid-drift) |
| `obra/superpowers` | Jesse Vincent's skills framework: brainstorm→spec→plan→TDD→subagent-dev→review→finalize, shipped as auto-activating markdown skills / marketplace plugin ([Marc Nuri](https://blog.marcnuri.com/superpowers-claude-code-skills-framework), [agentconn](https://agentconn.com/blog/obra-superpowers-agentic-skills-framework-guide/)) | High, huge adoption | Overlaps GSD's job. Running both process frameworks = context bloat + fighting instructions. But its *individual* skills (systematic debugging, requesting-code-review) are cherry-pickable | **SKIP** as framework; **TRIAL** cherry-picked debugging/code-review skills |
| `affaan-m/everything-claude-code` (ECC) | Kitchen-sink harness: 135 agents, hooks graph (SessionStart/PreCompact memory persistence), rules, MCP configs; installable as plugin ([GitHub](https://github.com/affaan-m/everything-claude-code)) | High stars, aggregator-style | Wholesale install would drown a solo repo in agents it won't use. Its `hooks/` directory is the best public reference implementation for the hooks polytoken needs | **SKIP** install; **ADOPT** as reference when writing our own hooks |
| Hallmark (design skill) | Anti-"AI slop" UI design skill with ~57 gate checks + self-critique ([Analytics Vidhya](https://www.analyticsvidhya.com/blog/2026/07/trending-ai-github-repositories/)) | New, trending July 2026 | Repo already has design law (`taste-references.md`, 58-IDENTITY, `polytoken-design-system` skill). A generic gate could contradict the committed identity | **TRIAL** only as inspiration for a *polytoken-specific* pre-emit checklist inside the existing design skill; don't install verbatim |
| OmniRoute (AI gateway, 231 providers) | Single endpoint routing Claude Code/Codex/Cursor across providers ([Analytics Vidhya](https://www.analyticsvidhya.com/blog/2026/07/trending-ai-github-repositories/)) | New | Polytoken is Claude-native on a Max/CCR setup; multi-provider routing solves a problem we don't have and adds an infra hop | **SKIP** |
| OfficeCLI | Office-file automation binary for agents | New | No Word/Excel deliverables in this product; the harness already has docx/xlsx skills | **SKIP** |
| "Karpathy rules" behavioral skill (reported ~156k stars) | Four hard rules encoding common LLM coding pitfalls | Unverified virality | CLAUDE.md already encodes repo-specific pitfalls, which beat generic ones | **SKIP** |

---

## 2. Awesome lists (indexes, not installs)

- `hesreallyhim/awesome-claude-code` (~37k stars) — the canonical hand-curated index ([claudefa.st roundup](https://claudefa.st/blog/tools/resources/awesome-claude-code)).
- `awesome-claude-skills` (~13k stars) and marketplace aggregators ([scriptbyai list](https://www.scriptbyai.com/claude-code-resource-list/), [designrevision](https://designrevision.com/blog/awesome-claude-code-skills), [awesome-skills.com](https://awesome-skills.com/)).
- Anthropic's official plugin marketplace: ~101 plugins as of March 2026, 33 by Anthropic
  (language servers, `feature-dev`, `code-review`, `security-guidance`) ([buildtolaunch review](https://buildtolaunch.substack.com/p/best-claude-code-plugins-tested-review)).

**Verdict: ADOPT as bookmarks / periodic (monthly) scan targets; never bulk-install.** The tested
review above found only 4 of 11 popular plugins worth keeping — consistent with the rule that
every installed skill/plugin taxes context on every session. For polytoken, the official
`code-review` and `security-guidance` plugins are the two worth trying first (META-AUDIT flags
~60 `except Exception` swallow sites and a credential-capture file — exactly what those catch).

---

## 3. MCP servers worth wiring

Consensus dev stack is GitHub + Context7 + Playwright, plus a DB server ([Builder.io](https://www.builder.io/blog/best-mcp-servers-2026), [Tembo](https://www.tembo.io/blog/best-mcp-servers), [UI Bakery](https://uibakery.io/blog/best-mcp-servers)). Mapped to this repo:

| Server | Maturity | Benefit to polytoken | Verdict |
|---|---|---|---|
| **Postgres MCP (read-only mode)** | Mature, most-used DB server | Direct hit on CLAUDE.md's law "verify against the DB, not terminal output". Agents can check `entity_instances`, seed state, migration results without ad-hoc psql. Read-only mode prevents an agent mutating the dev DB | **ADOPT** (read-only against local Supabase Postgres) |
| **Supabase MCP** | Mature; local CLI serves it at `http://localhost:54321/mcp` (limited toolset locally, no OAuth) ([designrevision](https://designrevision.com/blog/supabase-mcp-server), [claudedirectory](https://www.claudedirectory.org/mcp-servers/supabase-community-supabase-mcp)) | Adds Auth/Storage introspection beyond raw SQL — useful for the GoTrue-session seeding the Playwright suites depend on. Overlaps Postgres MCP for pure SQL | **TRIAL** (only if Postgres MCP proves insufficient for auth/storage debugging; don't run both permanently) |
| **Playwright MCP** (Microsoft) | Mature, among most-starred MCP servers; accessibility-tree based | Complements (does not replace) `test:geometry` / `screenshot:review`: lets an agent interactively poke the running app on :3000 mid-task instead of full suite runs. Must respect repo law: never spawn a server, serial only (magic-link invalidation) | **ADOPT**, with a wrapper note in CLAUDE.md/skill restating the no-server-spawn + serial rules |
| **Context7** | Mature, widely adopted docs injector | Next 15 / React 19 / Tailwind 4 / Drizzle are exactly the version-churny surface where stale model knowledge produces wrong APIs | **ADOPT** |
| **GitHub MCP** (official) | Mature | Already available in this CCR environment; needed for PR-steward-style flows | **ADOPT** (already effectively present; codify in `.mcp.json`) |
| Slack / Linear / Notion / etc. | Mature | Solo dev, planning lives in `.planning/` — no team-tool surface | **SKIP** |

Wiring note: commit a project `.mcp.json` (none exists today) so every session — including
phone-initiated cloud sessions — gets the same servers. Keep the roster ≤4; each server's tool
schemas cost context every turn.

---

## 4. Subagent orchestration frameworks

- **Native subagents / `.claude/agents/`** — orchestrator-worker pattern, isolated contexts,
  optional worktrees ([hidekazu-konishi guide](https://hidekazu-konishi.com/entry/claude_code_subagents_and_orchestration_guide.html), [Addy Osmani](https://addyosmani.com/blog/code-agent-orchestra/)). Mature, built-in. **ADOPT** —
  specifically 2–3 *project* agent definitions: `db-verifier` (Postgres MCP + read tools only),
  `geometry-verifier` (runs the browser gates and reads PNGs), `email-pipeline-auditor` (traces
  swallow-branches in the FastAPI ingest, per META-AUDIT §3's bug surface).
- **Agent Teams** (built-in, experimental, off by default) — shared task list, teammates talk to
  each other ([Shipyard](https://shipyard.build/blog/claude-code-multi-agent/)). **TRIAL** for the
  next night-run-style build march: the 2026-07-20 march produced "built code without planning
  artifacts"; a team-lead session enforcing GSD PLAN/VERIFICATION per phase is the fix shape.
  Experimental status = don't make it load-bearing yet.
- **Claude Code Workflows** (built-in, newer) — deterministic control flow instead of
  turn-by-turn model decisions ([alexop.dev](https://alexop.dev/posts/claude-code-workflows-deterministic-orchestration/)). **TRIAL** for the wire-and-verify 68–72 closeout, where the
  step order is already known and drift is the enemy.
- **Third-party orchestrators** (claude-flow-style swarm frameworks, GSD Pro fork with
  multi-model routing ([gsd-pro](https://github.com/itsjwill/gsd-pro))) — **SKIP**: GSD's own
  parallelization (`max_concurrent_agents: 3`, already enabled in config.json) plus native
  subagents cover a solo repo; extra orchestration layers add failure modes with no reviewer
  headcount to absorb them.

---

## 5. Skills / plugins / hooks patterns

Hooks are the highest-leverage gap (repo has literally none). Standard 2026 patterns
([aiorg.dev](https://aiorg.dev/blog/claude-code-hooks), [kjetilfuras](https://kjetilfuras.com/claude-code-hooks/), [totalum playbook](https://www.totalum.app/blog/claude-code-hooks-totalum)): PreToolUse deny via exit-2/JSON,
PostToolUse formatters, SessionStart context injection, secret scanning, 10+ lifecycle events.

Concrete, repo-specific hook set to **ADOPT** (each maps to a documented footgun):

1. **PreToolUse (Bash): block `pnpm install`/`pnpm add`** anywhere in the tree → CLAUDE.md's #1
   package-management rule, enforced mechanically instead of by prose.
2. **PreToolUse (Bash): block plain `next build` / `npm run build` under `apps/web`** when port
   3000 is listening → the 999.22 `.next` corruption trap; hook message points to `build:local`.
3. **PreToolUse (Bash): deny `rm -rf` outside scratchpad, force-push, `supabase db reset`
   without confirmation** → standard destructive-command guard, extra important for unattended
   night runs in yolo mode.
4. **PostToolUse (Edit/Write): secret scan** on written files → META-AUDIT found
   `.pending-auth-captures.jsonl` (credential probe log) tracked in the repo; stop the next one
   at write time.
5. **PostToolUse (Edit/Write): prettier for TS, `uv run ruff format` for `apps/email-listener`**
   → removes a whole class of lint-fix churn turns.
6. **SessionStart: inject 10-line env-split + build-trap cheat sheet** → survives compaction,
   which prose CLAUDE.md does not always do late in long sessions.

Skills: **ADOPT** creating the missing `verify-rendered-geometry` skill (CLAUDE.md already
references it — P0 in META-AUDIT) and fix `.gitignore` so `.claude/skills/` is tracked.
**ADOPT** a committed `.claude/settings.json` permissions allowlist (the harness's
`fewer-permission-prompts` skill can generate it from transcript history) — this is what makes
phone-driven sessions viable, since every permission prompt is a phone interruption.
Official Anthropic skills worth pulling: `webapp-testing`, `frontend-design` ([firecrawl skills roundup](https://www.firecrawl.dev/blog/best-claude-code-skills)) — **TRIAL**.

---

## 6. GSD-style planning systems and alternatives

Landscape ([MarkTechPost comparison](https://www.marktechpost.com/2026/05/08/9-best-ai-tools-for-spec-driven-development-in-2026-kiro-bmad-gsd-and-more-compare/), [Ewan Mak on what each constrains](https://medium.com/@tentenco/superpowers-gsd-and-gstack-what-each-claude-code-framework-actually-constrains-12a1560960ad), [techtimes](https://www.techtimes.com/articles/316927/20260521/ai-codings-discipline-turn-three-open-source-frameworks-superpowers-gstack-gsd-outpace-model.htm)):

- **GSD** — lean, low-ceremony, solo-dev-oriented; the repo's incumbent. **ADOPT (keep + refresh
  upstream)**. Fourteen milestones of history live in GSD's formats; migration cost is enormous
  and the META-AUDIT problems (state drift, STATE.md bloat, phases built without artifacts) are
  *operational discipline* failures, not framework failures — no alternative fixes them for free.
- **BMAD-METHOD** — heavier, role-based ceremony (analyst/PM/architect personas). **SKIP**: built
  for simulating a team; polytoken is one human + agents, and GSD explicitly positions as the
  lean alternative to it.
- **GitHub Spec Kit** — most community-adopted spec-driven option, GitHub-native. **SKIP** for
  now: would fragment planning across `.planning/` and specs; revisit only if GSD stalls upstream.
- **gstack / Superpowers as planning layer** — see §1/§4; **SKIP** as replacements.
- **GSD Pro** (fork; multi-model routing, rollback) — **SKIP**: fork-of-a-fork risk, and the
  repo's `graphify`-extended config may not survive it.

The actionable planning-system work is the META-AUDIT §2 P0 list (reconcile STATE/ROADMAP/
HANDOFF, untrack 25 MB graph blobs, rotate STATE.md) — do that *before* any upstream GSD
refresh so the update lands on reconciled state.

---

## 7. Phone-driven Claude Code (Pedro's primary mode)

- **Claude Code Remote Control** (built-in, shipped 2026-02-25): encrypted bridge from a local
  terminal session to the Claude iOS/Android app or claude.ai/code — QR-pair, full local env
  (filesystem, MCP, hooks) stays local; requires Max; macOS/Linux/WSL ([claudefa.st guide](https://claudefa.st/blog/guide/development/remote-control-guide), [builder.io](https://www.builder.io/blog/claude-code-mobile-phone)). **ADOPT** — first-party, zero infra, and it means the
  hooks/permissions/MCP investment above follows Pedro to the phone. Pairs with the
  Windows-host reality noted in META-AUDIT (preflight is PowerShell): run under WSL.
- **Cloud sessions (claude.ai/code / CCR)** — already in use (this session). Complementary:
  cloud for repo work that doesn't need the live local stack; Remote Control when the task needs
  the running Supabase/dev-server/DB. Gap to fix for cloud: a bash equivalent of
  `preflight-local.ps1` (META-AUDIT P1) plus a SessionStart hook so cloud sessions can run
  tests/linters (the harness's `session-start-hook` skill scaffolds this). **ADOPT**.
- **Happy** (`slopus/happy`, happy.engineering): open-source, E2E-encrypted mobile/web client
  wrapping Claude Code + Codex; free; self-hostable; realtime voice ([GitHub](https://github.com/slopus/happy), [comparison](https://happy.engineering/docs/comparisons/alternatives/)). **TRIAL** as
  backup/multi-session dashboard — its multi-machine session list beats Remote Control when
  night-run daemons and interactive sessions coexist. Only if Remote Control leaves gaps.
- **Omnara** — $9/mo, stores conversations server-side in plaintext unless self-hosted
  ([Happy's comparison page](https://happy.engineering/docs/comparisons/alternatives/) — biased
  source, labeled as such). **SKIP**: dominated by free/E2E alternatives for this use case.
- **Tactic Remote** and similar commercial layers ([tacticremote.com](https://tacticremote.com/)) — **SKIP**: first-party feature covers it.

---

## 8. Consolidated verdicts (priority order)

| # | Action | Verdict | Effort |
|---|---|---|---|
| 1 | Commit `.claude/settings.json`: permissions allowlist + the 6 hooks in §5 | ADOPT | S |
| 2 | Create `verify-rendered-geometry` skill; un-ignore `.claude/skills/` | ADOPT | S |
| 3 | Commit `.mcp.json`: Postgres (read-only), Playwright, Context7, GitHub | ADOPT | S |
| 4 | Claude Code Remote Control as the phone path; bash preflight + SessionStart hook for cloud sessions | ADOPT | S–M |
| 5 | GSD state reconciliation (META-AUDIT P0), then upstream GSD refresh | ADOPT | M |
| 6 | Project subagents: db-verifier, geometry-verifier, email-pipeline-auditor | ADOPT | M |
| 7 | Official `code-review` + `security-guidance` plugins; `webapp-testing` skill | TRIAL | S |
| 8 | Agent Teams / Workflows for the 68–72 wire-and-verify closeout | TRIAL | M |
| 9 | Happy as multi-session phone dashboard | TRIAL | S |
| 10 | Superpowers/ECC/Hallmark — mine for patterns only | TRIAL (read-only) | S |
| 11 | BMAD, Spec Kit, GSD Pro, OmniRoute, OfficeCLI, Omnara, swarm orchestrators | SKIP | — |

**Governing principle:** the repo's failure modes (state drift, silent corruption traps, swallowed
errors, unverified night builds) are *enforcement* problems. Everything ADOPTed above is
deterministic enforcement (hooks, allowlists, read-only DB access, first-party phone bridge);
everything SKIPped is another layer of model-mediated process on top of an already-working GSD.

---

## Sources

- https://www.analyticsvidhya.com/blog/2026/07/trending-ai-github-repositories/
- https://www.firecrawl.dev/blog/best-github-repos
- https://odsc.medium.com/top-agentic-ai-github-repos-worth-watching-in-2026-so-far-d841e998d524
- https://www.kdnuggets.com/10-github-repositories-to-master-claude-code
- https://claudefa.st/blog/tools/resources/awesome-claude-code
- https://www.scriptbyai.com/claude-code-resource-list/
- https://designrevision.com/blog/awesome-claude-code-skills
- https://awesome-skills.com/
- https://buildtolaunch.substack.com/p/best-claude-code-plugins-tested-review
- https://www.firecrawl.dev/blog/best-claude-code-skills
- https://uibakery.io/blog/best-mcp-servers
- https://www.builder.io/blog/best-mcp-servers-2026
- https://www.tembo.io/blog/best-mcp-servers
- https://designrevision.com/blog/supabase-mcp-server
- https://www.claudedirectory.org/mcp-servers/supabase-community-supabase-mcp
- https://hidekazu-konishi.com/entry/claude_code_subagents_and_orchestration_guide.html
- https://addyosmani.com/blog/code-agent-orchestra/
- https://shipyard.build/blog/claude-code-multi-agent/
- https://alexop.dev/posts/claude-code-workflows-deterministic-orchestration/
- https://aiorg.dev/blog/claude-code-hooks
- https://kjetilfuras.com/claude-code-hooks/
- https://www.totalum.app/blog/claude-code-hooks-totalum
- https://github.com/gsd-build/get-shit-done/
- https://www.augmentcode.com/learn/gsd-58k-stars-claude-code
- https://www.marktechpost.com/2026/05/08/9-best-ai-tools-for-spec-driven-development-in-2026-kiro-bmad-gsd-and-more-compare/
- https://medium.com/@tentenco/superpowers-gsd-and-gstack-what-each-claude-code-framework-actually-constrains-12a1560960ad
- https://www.techtimes.com/articles/316927/20260521/ai-codings-discipline-turn-three-open-source-frameworks-superpowers-gstack-gsd-outpace-model.htm
- https://github.com/itsjwill/gsd-pro
- https://blog.marcnuri.com/superpowers-claude-code-skills-framework
- https://agentconn.com/blog/obra-superpowers-agentic-skills-framework-guide/
- https://github.com/affaan-m/everything-claude-code
- https://claudefa.st/blog/guide/development/remote-control-guide
- https://www.builder.io/blog/claude-code-mobile-phone
- https://github.com/slopus/happy
- https://happy.engineering/docs/comparisons/alternatives/
- https://tacticremote.com/
