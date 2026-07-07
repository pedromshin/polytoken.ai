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

## Cross-Milestone Trends

| Milestone | Phases | Plans | Shipped | Audit | Deferred (connected-env) |
|-----------|--------|-------|---------|-------|--------------------------|
| v1.1 | 12–15 | — | 2026-06-27 | — | — |
| v1.2 | 16–20 | — | 2026-07-03 | tech_debt | 15 |
| v1.3 | 22–25 | 25 | 2026-07-06 | tech_debt | 6 |
| v1.4 | 26–28 | 15 | 2026-07-07 | tech_debt | 4 |

**Recurring theme:** this project consistently ships code-complete milestones with a small set of live-browser/Bedrock verifications deferred to a connected-env pass — a stable, honest pattern, not slippage. The locked-renderer + reusable-registry discipline (FOUND-2) has held across four milestones, and the deferred-item count keeps shrinking (15 → 6 → 4) as committed regression gates replace one-off checks.
