# Phase 35: Cost + Eval Scaffolding - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning
**Mode:** Smart discuss, autonomous (recommendations auto-accepted + documented; sources: SYNTHESIS.md critic gaps (a)+(b), Phase 34 SUMMARYs, FOUND-3/FOUND-7 decisions)

<domain>
## Phase Boundary

A per-round cost ceiling distinct from the existing per-turn/session/day caps is enforced through
the FOUND-3 ledger with defined mid-round `cost_capped` abort semantics, AND retrieval-quality /
citation-faithfulness / injection-resistance become measurable Phase-16 harness dimensions — all
built and provable against Phase 34's echo stub, BEFORE real tools exist (Phases 36–38 wire real
data into this scaffolding). Requirements: COST-05, EVAL-06, EVAL-07. Gate G4 satisfied (Phase 34
verified passed). Touches Python (`apps/email-listener`) AND `packages/genui/src/eval` (TS) — no
other agents running, no contention. NO DB migrations.

</domain>

<decisions>
## Implementation Decisions

### Per-round cost ceiling (COST-05)
- Config-only cap following the existing chain's pattern (`settings.py` per-turn/session/day $0.50/$2.00/$5.00): add a per-round cap (default **$0.15**), fail-closed like the rest.
- Round-scoped accounting lives in `CostCircuitBreaker` (`app/domain/services/cost_circuit_breaker.py`): a round-scoped check (e.g. `should_abort_round(...)`) fed by usage accumulated since the current round began — Phase 34 already accumulates UsageDelta correctly (bug fix) and already re-checks the breaker at round boundaries; this phase adds the DISTINCT per-round ceiling + a mid-round check inside tool-round streaming.
- Mid-round `cost_capped` abort MUST emit the same visible partial-text part contract Phase 34 established for round-cap exhaustion ("never silent", never a bare `stopped`) — reuse/mirror the exhaustion path in `run_chat_turn.py`/`run_chat_turn_tool_loop.py`. The existing cost-capped card UX (v1.3) stays; this only adds the tool-round variant.
- Ledger rows unchanged in shape — per-round is an ENFORCEMENT concept, not a new ledger table. No migration.

### Eval dimensions home + shape (EVAL-06/07, FOUND-7)
- Single home: **`packages/genui/src/eval/`** (the Phase-16 harness convention — golden-set.json + assets tests + index.ts exports). Register NEW dimensions there; NEVER a parallel harness (FOUND-7). Follow existing golden-set.json/README/assets-test pattern for each new fixture file.
- **Retrieval golden set (EVAL-06):** fixture file `retrieval-golden-set.json` — entries `{id, query, expected_ids: [{kind, id}], notes}` + a scoring contract (recall@k / precision@k). Ship 5–10 SEED entries exercising the echo stub + fixture-shaped data now; real-data entries land with Phases 36/37 (deferred, noted in fixtures README).
- **Citation-faithfulness (EVAL-07):** structural checker — every `citations[]` entry must be `{kind: email|entity|knowledge, id, route}` with route matching the canonical templates (`/emails/[id]`, `/entities/[id]`, `/knowledge?focus={id}`), and every cited id must appear in the tool-result envelope it accompanies. LLM-judge "claims trace to citations" rubric is registered as a dimension STUB (rubric text + runner contract) but live-judge runs are connected-env (999.3-style) — not CI-gated.
- **Injection-resistance (EVAL-07):** fixture format `{name, retrievedText, expectedBehavior}` (Fork 3's shape, mirroring Phase 20's adversarial.ts) + a scorer that checks the VISIBLE TEXT of a turn for leak canaries (marker strings from quarantined content), beyond "didn't call a tool". Phase 35 seeds 3–5 canary fixtures against the echo stub; the full adversarial suite is Phase 38's (QUAR-02).
- **Python↔TS bridge:** golden/adversarial fixture JSONs live in `packages/genui/src/eval/`; the Python side gets a small pytest eval module (`apps/email-listener/.../evals/` or tests dir per repo idiom) that loads those same JSON files by monorepo-relative path and scores against the stub executor — one fixture source of truth, two runners. Document the path contract in the fixtures README.

### Claude's Discretion
- Exact breaker method signature/naming; where round-spend state lives (loop-local vs breaker-internal); pytest module placement; scorer function decomposition; whether recall@k uses k=5 or k=8 defaults (match TOOL-01/03 top-5/top-8).
- If wiring the mid-round check requires a small refactor of the Phase-34 round loop helpers, keep it additive and keep 34's 76-test suite green.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `app/domain/services/cost_circuit_breaker.py` — FOUND-3 breaker; Phase 34 re-checks it at round boundaries; config caps in `settings.py`.
- Phase 34 artifacts (read the three `34-0*-SUMMARY.md` files): `app/domain/ports/tool_executor.py`, `run_chat_turn_tool_loop.py` (pure helpers), `EchoToolExecutor` (tests/support), round loop in `_execute_turn`, visible-text-part exhaustion path — the eval scaffolding exercises THESE.
- `packages/genui/src/eval/` — golden-set.json + golden-set.README.md + index.ts + `__tests__/eval-assets.test.ts` (the registration/validation pattern to copy for new fixture files).

### Established Patterns
- Fail-closed config-driven caps; "never silent" visible text parts (Phase 34 motto); FOUND-7 one-harness rule; fixtures-with-README-and-assets-test convention.

### Integration Points
- `run_chat_turn.py` round boundary (mid-round breaker check), `settings.py` (new cap), `packages/genui/src/eval/index.ts` (dimension exports), Python pytest eval module reading the shared JSON fixtures.

</code_context>

<specifics>
## Specific Ideas

- COST-05 verbatim: per-round ceiling DISTINCT from per-turn, enforced through the FOUND-3 ledger, with mid-round `cost_capped` abort that still emits the visible partial-text part.
- EVAL-07's injection-resistance is explicitly "beyond 'didn't call a tool'" — the scorer must inspect visible turn text for leaked quarantined canaries.

</specifics>

<deferred>
## Deferred Ideas

- Real-data golden-set entries → after Phases 36/37 tools exist.
- Full adversarial fixture suite + live-model harness runs → Phase 38 (QUAR-02).
- LLM-judge citation-faithfulness calibration runs → connected-env (999.3 family).
- Any expansion of ledger schema — not needed; enforcement-only.

</deferred>
