# Retrospective — nauta.services.email-listener

Living retrospective, one section per milestone. Newest first.

## Milestone: v1.3 — Conversational GenUI: Chat, Canvas & Dual-Channel

**Shipped:** 2026-07-06
**Phases:** 4 (22–25) | **Plans:** 25 (24 planned + 1 gap-closure) | **Tasks:** ~65 | **Timeline:** ~3 days (2026-07-03 → 2026-07-06) | **Commits:** ~173 since v1.2

### What Was Built
- **Phase 22 — Chat spine + streaming:** persistent `/chat` (5-table data model, RLS deny-all), a `ChatProvider` port + curated 7-model registry (Bedrock/OpenRouter + a WebGPU in-browser WebLLM model), FastAPI SSE (`ConverseStream`) → Next proxy → `useChatStream` state machine, regenerate-as-versioned-siblings, progressive partial-tree genui rendering behind the unmodified `SpecRenderer`, and a fail-closed application-level cost circuit breaker. Closed GEN-04.
- **Phase 23 — 2D canvas + shared state:** React Flow canvas of genui panels-as-nodes, versioned `NODE_TYPE_REGISTRY` (content-hash), one lifted `useConversationController` shared by docked + canvas views, exact layout persistence (`chat_canvas_layouts`, ~800ms debounced), a per-chat Zustand store reusing the v1.1 bounded 5-mutation grammar, and data-carrying edges. Gap-closure 23-06 bridged the store WRITE path (button→ActionRegistry→store) after the first verification found zero production call sites.
- **Phase 24 — Dual-channel genui:** `emit_proposal_cards` + `emit_clarify_widget` tools → `chat_widget_interactions` row → `POST /v1/chat/widget/submit` (validate→stale→DB-CAS→continuation over the SAME Phase-22 SSE transport). Widgets render through the unmodified `SpecRenderer` in transcript AND canvas from one message-part source of truth; the `bare` GenuiPartBoundary variant also closed Phase-23's triple-nest UI-review finding.
- **Phase 25 — Anticipatory prompting (SPIKE):** a real-but-flag-OFF pipeline — 3 read-only deterministic triggers → independent appropriateness-eval (Haiku, fail-toward-suppress) + frequency cap → explicit-accept via the unchanged Phase-24 proposal card, with a deterministic fixture×scenario evidence matrix. Verdict: **ship-with-conditions** (7 named seams).

### What Worked
- **Locked-renderer discipline held.** `SpecRenderer` stayed byte-identical (ecc7a46) across all 4 phases; every new capability rode existing seams (ActionRegistry from 23-06, the `data`/`actions` props, catalog registry). This is the single biggest reason integration came back clean.
- **Gap-closure loop caught a real hole.** 23's first verification honestly failed criterion #5 (write path had no call sites); the `--gaps` plan closed it AND surfaced two latent production bugs (missing React import, `useSyncExternalStore` snapshot instability) that would have infinite-looped a live edge.
- **Independent verification paid off.** Re-running gates myself after session-limit cutoffs (24-03) caught nothing broken but confirmed the executor's claims against a `next build` + both vitest suites — the honest path, not trusting the SUMMARY.
- **UI review as a real gate.** 24's advisory audit found a genuine state-contradiction bug (FormComponent "Submitted ✓" colliding with the boundary chrome); fixing it inline (24-05) kept the phase truly done rather than done-with-known-bug.

### What Was Inefficient
- **Repeated session-limit cutoffs** interrupted the planner (24) and executors (24-03) mid-task. Recovery via resume-from-transcript worked, but "commit each task as soon as green, don't batch" had to become an explicit executor instruction to avoid lost work.
- **`gsd-sdk state.add-decision` / `roadmap.update-plan-progress`** don't fit this project's free-form STATE.md — decisions were logged inline instead. Minor friction, repeated per phase.
- **Pre-existing tech debt surfaced mid-run** (12 unrelated mypy errors, uncommitted old-phase-dir deletions) had to be consciously side-stepped rather than swept in.

### Patterns Established
- **Dark-by-default spike posture:** ship a real, DI-registered, flag-OFF pipeline + a documented go/no-go, rather than a throwaway prototype or a paper study. Reversible, testable, honest.
- **One message-part source of truth (D-08):** transcript and canvas both render from the same controller surface — never duplicate interactive state across views.
- **Async-resume round-trip (D-01):** widget submit is a fresh request that starts a NEW streamed continuation — no held-open streams — with the declared response schema persisted server-side for after-the-fact re-validation.

### Key Lessons
- A locked "do-not-touch" core file is a force multiplier: it forces every feature onto reusable seams and makes cross-phase integration verifiable by `git log` on one path.
- In autonomous runs, deferring live-browser/Bedrock UAT to per-phase `*-HUMAN-UAT.md` (with the mechanism proven in unmocked tests) is the right honesty posture — `human_needed`, not a fake `passed`.
- When an executor is cut off, verify from the filesystem + git + a real build, not from the returned text.

### Cost Observations
- Model mix: orchestrator on Opus 4.8 [1m] (some Fable-5 stretches); all subagents (planner/executor/verifier/UI) on Sonnet; anticipatory + code-island judges on Haiku by design.
- Sessions: ~4 (multiple session-limit resets across a ~3-day span).
- Notable: subagents-as-context-firewalls kept the orchestrator lean across 25 plans + lifecycle; the main cost sink was re-running full gates independently after cutoffs (worth it).

## Milestone: v1.4 — Chat & Studio Design Uplift

**Shipped:** 2026-07-07
**Phases:** 3 (26–28) | **Plans:** 15 | **Tasks:** 36

### What Was Built
A zero-new-dependency visual/token-discipline uplift of `/chat` + `/studio`: eleven contract-drift
fixes (React Flow chrome, app-wide `font-medium` purge, token discipline, node differentiation,
shared JsonPane/EmptyState, hover/dock/scrollbar/role chrome), five narrowly-adopted external picks
(impeccable bans appendix, FileTree port, GeneratingRing, ux reference docs, hand-authored reveal
transitions), and the token-layer upgrade (hue-164 neutral split, teal chart/sidebar rebase,
elevation scale, radius steps, mount/stagger entrances) guarded by two committed regression tests.
Plus two folded backlog fixes (generator dataRef prompt, dagre nodesep) and two same-day live-test
fixes (chat output-cap truncation, globals.css comment self-termination).

### What Worked
- Pre-baked research as a locked CONTEXT-equivalent: zero re-research, every UI-SPEC/plan/executor
  copied literal values from one source of truth — the fastest milestone so far (~1 day).
- The UI-SPEC → checker revision loop caught real spec defects cheaply (off-grid spacing twice)
  before any code was written.
- Execution-time license vetting did its job: the transitions.dev no-license discovery triggered the
  documented SKIP-not-substitute path, resolved by clean-room hand-authoring with an evidence trail.
- User live-testing during the run surfaced two real defects (truncated tool calls, CSS build break)
  that no offline gate covered — fixed same-day with root causes, not patches.

### What Was Inefficient
- Executors gate on typecheck+vitest, which never compile CSS — the `--duration-*/` comment
  self-termination broke the dev build and was only caught by the user. A postcss/tailwind compile
  belongs in the per-plan gate for any globals.css-touching plan.
- FIX-02's app-dir-scoped grep missed shared-primitive leaks (tabs/sidebar) that only the milestone
  audit's integration checker caught — contract checks must trace packages/ui, not just app dirs.
- Two zombie next-dev process trees corrupted a fresh `.next` during the service restart — kill by
  command-line match, not by port PID alone.

### Patterns Established
- Fix design-contract violations at the design-system SOURCE (one primitive edit > N call-site sweeps).
- Committed regression gates over point-in-time checks (WCAG contrast; token-family registration
  against the "var exists, utility unregistered" bug class).
- Clean-room reimplementation from locked numeric values as the standard answer to unlicensed
  external sources.
- docs/design/ as the standing home for externally-derived design guidance (attributed, paraphrased).

### Key Lessons
- "Silently dropped" is the worst failure mode: the truncated emit_ui_spec tool call rendered as
  plain text with no error — always surface degradation to the user (salvage todo filed).
- Advisory UI reviews are worth acting on immediately: all 8 warnings across 3 phases were
  closed inline within minutes each; deferring them would have compounded into audit blockers.

### Cost Observations
- Model mix: orchestrator on Fable-5; planners on Opus; executors/verifiers/UI agents on Sonnet.
- Sessions: ~2 (one session-limit reset mid-execution, one mid-audit).
- Notable: 15 sequential executors (worktrees disabled) was the wall-clock bottleneck; disjoint
  files_modified across all plans made ordering trivially safe.

## Milestone: v1.5 — Knowledge-Graph Uplift

**Shipped:** 2026-07-08
**Phases:** 4 (29–32) | **Plans:** 11

### What Was Built
Activated the dormant Phase-11 knowledge-graph substrate: tier ladder (migrations 0026–0028) +
live D-13 synthesis hook (confirm → EXTRACTED edges with OCR token-polygon provenance) + suggest-only
promotion gate (deterministic suggestions, fail-closed promote endpoint, EXTRACTED-only injection
read path) + the cheap recall win (few-shot rendering seam closed, aliases/identifiers injected) +
retrieval-miss-rate instrumentation + `/knowledge` tiered exploration canvas (encoding, filter,
bounded expandNode, promote popover).

### What Worked
- Scope taken verbatim from the user's own theory note (999.10 NOTE.md) — its staged cost/benefit
  ordering became the phase structure with almost no translation loss; "do NOT borrow" lists in the
  scope source made scope-creep rejection mechanical.
- One up-front Explore scout fed all four phases' CONTEXT files; its biggest catch (the few-shot
  rendering seam was never built) re-shaped Phase 31 before planning started.
- The [BLOCKING] migration-apply + live-pg-verify task pattern (0026/0027/0028 each with a
  committed verify script) caught nothing this time precisely because it forced executors to start
  Docker/Supabase and prove schema live — no false-positive verification.
- Cross-plan gap flagging worked: 32-02 documented that expand-merged edges skipped the tier
  filter; 32-03 was instructed to close it and did — the integration checker later verified the fix
  in code.

### What Was Inefficient
- Two session-limit cutoffs mid-executor (29 planning, 30-01 execution) required recovery passes;
  the RED-test-on-disk recovery for 30-01 worked cleanly but cost a re-read of plan state.
- The SDK's `milestone.complete` accomplishment extraction produced junk ("Task 1 — …" fragments)
  and a wrong task count — hand-rewritten; MILESTONES.md quality still needs the human-grade pass.
- UI review (19/24) surfaced a real spec violation (active-segment weight) the executor missed —
  advisory reviews still catch contract drift the acceptance criteria didn't encode.

### Patterns Established
- Measurement-gated architecture evolution: stage-3 graph work is behind a committed, runnable
  miss-rate artifact, not a judgment call.
- "Gate ships before consumer": `list_injectable_edges` exists with zero callers so the future
  consumer can never bypass it.
- Tier-as-governance: trust tier is a schema property with a fail-toward-least-trust default,
  promotion is the only trust-raising action, and it is human-only.

### Key Lessons
- Autonomous milestone selection is safe when there is a same-day user-authored scope note to
  anchor to; the smart-discuss "auto-accept + document" mode preserved decision legibility.
- Pre-existing debt found by phase-scoped audits (glassmorphism on /knowledge) should be logged as
  todos, not fixed inline — scope discipline held.

### Cost Observations
- Model mix: orchestrator on Fable-5; planners on Opus; executors/verifiers/UI agents on Sonnet.
- Sessions: ~4 (two session/weekly-limit cutoffs with mid-plan recovery, one user-interrupt resume).
- Notable: 11 sequential executors (worktrees disabled); Phase 31 was fully independent and could
  have run parallel to 29/30 had worktrees been enabled.

## Milestone: v1.6 — Chat × Knowledge Convergence

**Shipped:** 2026-07-09
**Phases:** 9 (33–41) | **Plans:** 20 (45 tasks)

### What Was Built
The v1.3 chat agent gained read access to its own extracted data: a bounded mid-turn tool loop
(ToolExecutor port, ≤4 rounds, capability-gated) running 3 tiered knowledge tools with structural
injection quarantine (three independent belts; exposure code-gated on a 26-fixture adversarial
suite + live Bedrock Haiku harness), per-round cost ceilings, visible tool rounds with citation
chips (`<ProvenanceLink>`), live data-bound genui panels (`spec.bindings` finally alive, zero
renderer edits), chat-confirmable knowledge promotions (CAS + edge-tier staleness 409), and a
knowledge-preview canvas node. Migrations 0029–0030. Two latent production bugs + one live client
bug fixed with regression guards.

### What Worked
- **Max parallelization via background agents**: wave 1 ran Phase 33 (web) ∥ Phase 34 (Python) on
  disjoint trees with zero collisions; planning for phase N+1 pipelined during execution of N;
  Phase 40 jumped the queue when its gate analysis showed it only needed shipped v1.5. Net: 9
  phases in ~2 days wall-clock despite 3 session-limit cutoffs.
- **Disk-state reconciliation on interruption**: every crash recovery started by diffing
  commits/SUMMARYs/uncommitted files against plans before resuming — no work re-done, no work lost
  (35-02's uncommitted tests adopted after verification; 41-02's mini-graph reconciled).
- **Locked research → 1:1 roadmap**: the pre-baked synthesis (5 forks + critic) made planning
  cheap and drift-visible; the roadmapper mapped its 9-phase build order verbatim.
- **Gated exposure as a pattern**: the flag-flip-only-after-suite-passes task shape made "safe to
  expose" a testable property, not a judgment call.

### What Was Inefficient
- Session-limit cutoffs killed 3 agents mid-flight (planner ×2, executor ×1) — recovery cost
  ~1 resume cycle each; the resumable-agent transcript feature made this cheap but not free.
- SUMMARY frontmatter `requirements_completed` convention drifted (only Phase 35 populated it),
  making `milestone.complete`'s auto-accomplishment extraction garbage — hand-rewritten at close.
- CRLF/LF line-ending churn in .planning files caused two fix commits by different agents with
  opposite conventions (verifier later established the repo is LF at byte level).
- The 39∥40 wave-6 parallel plan had to be abandoned when 39's plans grew a Python SSE task —
  cross-tree phase splits should be caught at planning time, not scheduling time.

### Patterns Established
- Background-agent-per-phase orchestration with a scheduler main context (strategic-compact posture).
- Three-belt structural unreachability for trust-tiered data (view → field omission → boundary gate).
- SSE mirror frames (non-persisted) alongside persisted run events for live UI without migrations.
- Server-recomputed provenance routes (never trust data-supplied route strings).

### Key Lessons
- Concurrent executors in one working tree ARE safe when file trees are disjoint AND git staging
  is path-explicit — but shared files (run_chat_turn.py) force serialization; check plan
  `files_modified` overlap before parallelizing, not phase labels.
- Custom SQL migrations need manual `_journal.json` entries (drizzle silently skips otherwise) —
  now recorded in two SUMMARYs; candidate for a repo doc.
- An invalidation contract (BIND-02) established in one phase must be explicitly re-audited when a
  later phase adds a second mutation path — the milestone audit caught what phase verification
  structurally couldn't.

### Cost Observations
- Model mix: orchestrator on Fable-5 (scheduler-only, strategic-compact); planners/executors/
  verifiers/UI agents on Sonnet (one Opus planner early, before the limit hit).
- Sessions: ~4 main-context sessions, 3 session-limit interruptions absorbed.
- Notable: ~20 background agents total; the heaviest phases (38, 39) ran 1.9–3.5h each in
  background with zero main-context cost between dispatch and notification.

## Milestone: v1.7 — polytoken.ai Foundation: Rename, Auth & Tenancy

**Shipped:** 2026-07-10
**Phases:** 5 | **Plans:** 25 (incl. one gap-closure plan 44-09)

### What Was Built
Atomic internal rename nauta → polytoken (242 files, one committed script, external renames
runbook'd); Google OAuth + sessions via @supabase/ssr (middleware guard, ctx.user +
protectedProcedure, X-User-Id BFF forwarding); enforced per-user tenancy (migrations 0031–0034,
central ownership chokepoint, full tRPC/FastAPI sweep, RLS on 13 tables, two-user adversarial
acceptance gates); email threads at ingest (Union-Find + forwarded-mail fallbacks, idempotent
backfill) + thread-grouped inbox + personal-forwarding seam (CSPRNG u-{token}@ addresses,
ingest resolution, runbooks); hygiene folds (asyncio, grid colSpan, connected-env evidence) +
decision-ready v1.8 brand/design dossier.

### What Worked
- The adversarial acceptance-gate plan (44-08) as a distinct final plan caught a REAL cross-tenant
  hole (chat SSE) that seven sweep plans and the plans' own tests all missed — the "gate as its own
  plan" pattern paid for itself.
- Same-run gap-closure escalation (plan-phase --gaps → 44-09 → re-verify) closed a security gap in
  ~40 min without breaking the autonomous cadence; the park-vs-escalate judgment call (security gap
  in a tenancy milestone → escalate) was the right default override.
- Resume-from-disk after the account-switch cutoff worked exactly as designed: all pre-cutoff work
  (42 complete, 43-01, 46-01/02) was recovered from SUMMARYs/commits with zero rework.
- Requirement premature-completion discipline (executors refusing to mark TENA-03/THRD-04 until the
  spanning plan landed) kept the traceability table honest across 9 plans.
- Mid-plan failure recovery via SendMessage transcript-resume (44-06 connection drop) preserved
  uncommitted work with no duplicate commits.

### What Was Inefficient
- Two executor sessions were cut by API errors (43-05, 44-06) — both recovered, but each cost an
  orchestrator round-trip of disk forensics.
- The 43-01 env.ts design bug (full-schema Zod parse imported by a client component) shipped through
  code-level verification and was only caught by the user's live dev server — a browser smoke check
  in verification would have caught it.
- Drizzle journal/snapshot drift (stale 0025–0030 snapshots, future-dated timestamps) resurfaced in
  BOTH 44-01 and 44-04 despite being documented — tooling-level debt keeps taxing every migration
  until fixed at the source.

### Patterns Established
- Acceptance-gate-as-final-plan for security-bearing phases (adversarial two-user suites).
- Ownership chokepoint: ONE helper module (@polytoken/db/ownership + _ownership.ts wrapper) consumed
  by every router — never ad-hoc checks.
- env.ts (server, full schema) / env.public.ts (browser, literal access) split.
- Runbook-not-executed for anything touching external dashboards (OAuth client, SES, renames).

### Key Lessons
- "Unreachable via ANY route" success criteria need a sweep INVENTORY artifact — enumerating
  surfaces is what surfaced the SSE gap.
- Verifiers should re-run suites independently, not trust SUMMARYs — the habit caught zero lies this
  milestone but priced-in confidence for the tech_debt-0-blockers audit verdict.
- Client/server env access is a boundary that Zod cannot straddle; validate per-bundle.

### Cost Observations
- Model mix: opus for planning (2 phase plans + 1 gap plan), sonnet for all executors/verifiers/
  checkers, Fable orchestrating.
- Sessions: 1 orchestrator session post-cutoff (plus the pre-cutoff session that shipped 42/43-01/46-01/02).
- Notable: sequential executors (worktrees disabled) were the whole-run bottleneck; wave parallelism
  was declared but unused. ~15 subagents, ~3.5M subagent tokens.

## Milestone: v1.8 — Polytoken Re-skin: Brand & Design-System Foundation (SCOPE CUT)

**Shipped:** 2026-07-10 (opened and closed the same day)
**Phases:** 2 (47–48; opened as 47–51) | **Plans:** 10

### What Was Built
- Polytoken brand foundation: node/brain BrandMark (currentColor, zero raw hex) in sidebar/login/
  favicon, warm first-person copy register across every surface, brand guide + USER-LOCKED naming
  record (collision with the polytoken CLI explicitly accepted).
- Verification tooling the milestone's own re-skin never got to use: pinned Playwright
  (chromium+firefox), both long-parked e2e specs finally executed green, screenshot harness with
  real 12-PNG artifacts.
- Token-system extensions: 14 new aliases across all 6 packs (pill radius, success pair, code
  family, novel tier-ladder + closed graph palette), computational WCAG-AA + registration gates,
  consumed at chips/code/confirm/knowledge-canvas surfaces; hover-active + breakpoint conventions.

### What Worked
- Additive-only token extension (zero renames, git-diff-proven) made 5 plans land in one day with
  103/103 theme tests green throughout.
- The verifier + independent adversarial audit caught real overclaims (tab-pill wording, dossier
  boilerplate node list) and produced a recorded override instead of silent drift; the integration
  checker re-ran 127 tests live rather than trusting SUMMARYs.
- Honest user feedback mid-milestone ("the project is still literally what it was before") was
  converted same-day into a recorded structural decision rather than another deferral row.

### What Was Inefficient
- The milestone was opened as paint (Phases 49–51 re-skin/mobile) before the product had ever been
  used live — the scope cut is the correction, not the failure.
- 999.16 (entity-chips/StatusBadge off-token) existed because 48-03's chip search was grep-scoped
  to /chat only; repo-wide sweeps for a semantic should be the default.
- The screenshot harness shipped without /emails/[id] in SURFACES (W-1) — the surface list was
  written before the success-token consumers landed and never revisited.

### Patterns Established
- **Two-epoch endgame** (ENDGAME-PLAN.md): all remaining vision compresses into v1.9 Cloud
  Workspace + v2.0 Local Agent Platform; E7 parked as a venture decision.
- **Standing rule:** deploy/OAuth/live-UAT gates are first-class phase work, never
  deferrable-by-default. A milestone isn't done until the user touches the capability live.
  Deferred items now carry designated landing spots, not open-ended rows.
- Scope cuts are recorded as first-class decisions (REQUIREMENTS "Moved" section + traceability
  "Moved" status + audit scope_note) so audits stay honest against the cut bar.

### Key Lessons
- Six consecutive tech_debt closes with deferred live gates compound into a product the user has
  never felt — the per-milestone pattern was individually honest and cumulatively wrong.
- Foundation/paint sequencing must be interleaved with felt value; the killer feature being
  "one epoch away" for three milestones is the smell.

### Cost Observations
- Model mix: Fable orchestrating (incl. audit + close), sonnet executors/verifiers/checkers.
- Sessions: 2 (phase execution in a parallel session; audit/close in this one).
- Notable: integration checker ~150k subagent tokens with 62 tool calls — live re-running of
  suites is affordable and should stay the norm.

## Cross-Milestone Trends

| Milestone | Phases | Plans | Shipped | Audit | Deferred (connected-env) |
|-----------|--------|-------|---------|-------|--------------------------|
| v1.1 | 12–15 | — | 2026-06-27 | — | — |
| v1.2 | 16–20 | — | 2026-07-03 | tech_debt | 15 |
| v1.3 | 22–25 | 25 | 2026-07-06 | tech_debt | 6 |
| v1.4 | 26–28 | 15 | 2026-07-07 | tech_debt | 4 |
| v1.5 | 29–32 | 11 | 2026-07-08 | tech_debt | 4 |
| v1.6 | 33–41 | 20 | 2026-07-09 | tech_debt | 7 |
| v1.7 | 42–46 | 25 | 2026-07-10 | tech_debt | 8 |
| v1.8 | 47–48 | 10 | 2026-07-10 | tech_debt | 6 |

**Recurring theme:** this project consistently ships code-complete milestones with a small set of live-browser/Bedrock verifications deferred to a connected-env pass. Through v1.6 this read as a stable, honest pattern; at the v1.8 close the user called its cumulative effect — a product never experienced live — and the pattern was retired as a default: from v1.9 on, live gates (deploy, OAuth, real email, UAT) are first-class phase work (ENDGAME-PLAN.md standing rule), and every v1.8 deferral carries a designated v1.9 landing spot. The locked-renderer + reusable-registry discipline (FOUND-2) has held across eight milestones; committed regression gates and live re-run verification (127/127 at the v1.8 audit) continue to replace one-off checks. v1.5 added measurement-gated architecture evolution; v1.6 added suite-gated exposure flips and fully-autonomous parallel execution; v1.7 added adversarial acceptance gates that found and same-run-closed a real security hole; v1.8 added recorded overrides against overclaiming success criteria and the scope-cut-as-decision mechanism.
