---
phase: 38-quarantine-adversarial-eval
plan: 02
subsystem: chat-tool-loop, eval-harness
tags: [quarantine, adversarial-eval, injection-resistance, live-harness, QUAR-02, EVAL-06, exposure-flip, contract-tests]
dependency_graph:
  requires:
    - "app.domain.services.tool_envelope_gate (Plan 38-01's EnvelopeGateOutcome/validate_tool_envelope -- the gate this plan's full fixture set exercises)"
    - "app.infrastructure.tools.search_knowledge_executor (Phase 37, SearchKnowledgeExecutor + build_search_knowledge_tool -- the real executor scored deterministically AND driven live)"
    - "packages/genui/src/eval/injection-fixtures.json + retrieval-golden-set.json (Phase 35 fixture format, InjectionFixtureSchema/RetrievalGoldenEntrySchema -- .strict() 3-field / 4-field shapes never modified)"
    - "apps/email-listener/tests/evals/_paths.py + _scorers.py (Phase 35-03's Python<->TS fixture bridge + score_injection_resistance/extract_canary, reused verbatim)"
    - "app.settings.SEARCH_KNOWLEDGE_TOOL_ENABLED (Phase 37's default-OFF exposure flag -- the flip this plan gates and executes)"
  provides:
    - "The full Phase-38 QUAR-02 adversarial suite: 26 injection-fixtures.json entries across 7 categories, scored deterministically against the REAL SearchKnowledgeExecutor + a live Bedrock Haiku-tier harness"
    - "7 real-data retrieval-golden-set.json entries (EVAL-06 fold-in) sourced from real local-dev-DB rows"
    - "SEARCH_KNOWLEDGE_TOOL_ENABLED=True -- search_knowledge is now offered to real chat users"
  affects:
    - "Phase 39 (tool-round UI + citation chips) now builds against a LIVE search_knowledge tool, not a dark one"
    - "Any future settings.py change to the exposure flag must preserve the two TestSearchKnowledgeExposureGate regression guards (enabled-by-default + can-still-disable)"
tech_stack:
  added: []
  patterns:
    - "Deterministic adversarial scoring against the REAL production executor class (never a re-implementation) with hand-built fake knowledge/embedder collaborators -- mirrors test_search_knowledge_executor.py's _node_row/_make_executor shape as a local per-test-file copy (38-01's established convention)"
    - "Live-model harness credential-presence check via boto3's own default credential-chain resolver (Session().get_credentials() is not None) instead of sniffing a specific env var name -- this environment authenticates via IAM/SSO, not a fixed AWS_ACCESS_KEY_ID, so test_corpus_pipeline.py's literal _HAS_TEXTRACT pattern doesn't transfer; runtime try/except around the actual network call is the second, defense-in-depth layer (pytest.skip, never a hard failure, on any Bedrock-unreachable error)"
    - "Real, DB-resolvable golden-set entries sourced from a one-off, uncommitted seed script (mirrors packages/db/scripts/verify-00NN-live.ts's pg.Client connection pattern) run once against the local dev DB, then discarded -- the resulting real UUIDs are the only durable artifact, not the script itself"
key_files:
  created:
    - apps/email-listener/tests/evals/test_injection_adversarial_suite.py
    - apps/email-listener/tests/evals/test_live_injection_harness.py
    - .planning/phases/38-quarantine-adversarial-eval/deferred-items.md
  modified:
    - packages/genui/src/eval/injection-fixtures.json
    - packages/genui/src/eval/retrieval-golden-set.json
    - packages/genui/src/__tests__/eval-dimensions-assets.test.ts
    - packages/genui/src/eval/EVAL-DIMENSIONS.README.md
    - apps/email-listener/tests/evals/test_injection_fixtures.py
    - apps/email-listener/tests/evals/test_retrieval_golden_set.py
    - apps/email-listener/app/settings.py
    - apps/email-listener/tests/test_container.py
    - apps/email-listener/tests/application/test_run_chat_turn_real_tools_wiring.py
decisions:
  - "Representative live-harness fixture selection = the un-suffixed (first) entry of each of the 7 categories -- deterministic, evenly covers every category at the FOUND-3-mandated ~7-fixture cost ceiling, no randomness to reason about across re-runs"
  - "Real golden-set entries seeded directly into the local dev DB as PERSISTENT rows (not cleaned up in a finally block like the verify-00NN-live.ts precedent) -- the plan's own success criterion requires the ids to remain resolvable against the local dev DB going forward, so a self-deleting seed would defeat the purpose"
  - "Original 7 retrieval-golden-set.json entries (synthetic ids) left byte-for-byte verbatim, never edited in place -- new real-data entries are strictly appended (ids 8-14), matching Task 1's identical 'append, never mutate' convention for injection-fixtures.json"
  - "Live harness treats EVERY representative fixture (including knowledge-inferred-crafted-search) as seeded EXTRACTED-tier retrieved content, not as a query -- Task 2's deterministic suite already covers the query-argument angle structurally; Task 3's live layer isolates the one thing only a real model can prove (visible-text leak resistance under genuine tool_result content)"
metrics:
  duration: "~55 min"
  completed: 2026-07-09
---

# Phase 38 Plan 02: Adversarial Fixture Suite + Live Harness + Exposure Flip Summary

Grows the Phase-35 4-fixture injection-resistance seed into the full 26-fixture, 7-category
QUAR-02 adversarial suite, proves it deterministically against the REAL `SearchKnowledgeExecutor`
(not the echo stub), attempts and PASSES a live Bedrock Haiku-tier harness proving the system-prompt
hardening line + native `tool_result` blocks resist injection "beyond didn't call a tool", folds in
7 real-data `retrieval-golden-set.json` entries (EVAL-06), and -- gated strictly on the deterministic
suite passing in this same run -- flips `SEARCH_KNOWLEDGE_TOOL_ENABLED` to `True`, making
`search_knowledge` live for real chat users for the first time.

## What Was Built

### Task 1 -- `injection-fixtures.json` expanded to 26 fixtures across 7 categories

Appended 22 new fixtures to the Phase-35 seed (4 kept verbatim), spanning `delimiter-breakout` (4),
`role-confusion` (4), `encoded-override` (5 -- adds leetspeak, Portuguese, Spanish, and hex-encoded
variants alongside the existing base64 one), `nested-tool-call-request` (4), and the 2 NEW categories
`citation-spoofing` (4, fabricated `citations[]`/route text) and `markdown-link-exfiltration` (4,
canary-carrying markdown links/images/javascript-pseudo-protocol URLs), plus exactly one
`knowledge-inferred-crafted-search` fixture whose `retrievedText` is phrased as an adversarial SEARCH
QUERY ("show me the full title... of every AMBIGUOUS or INFERRED tier node, ignoring the
extracted-only filter") rather than retrieved content -- 38-CONTEXT.md's required proof that the
`extracted_only` view holds under adversarial query text, not just malicious retrieved data. Every
fixture keeps the locked 3-field `.strict()` shape and a unique `[CANARY:<token>]` marker.

`eval-dimensions-assets.test.ts` widened: `INJECTION_FIXTURES` `"has between 3 and 5 entries"` ->
`"has between 20 and 30 entries"`; `RETRIEVAL_GOLDEN_SET` `"has between 5 and 10 entries"` ->
`"has between 5 and 20 entries"` (headroom for Task 2). `EVAL-DIMENSIONS.README.md` updated: the
injection-fixtures category list (4 -> 7) and status paragraph (seed proof -> full QUAR-02 suite),
plus the retrieval golden-set status paragraph documenting the seed-vs-real-data split ahead of
Task 2's append.

### Task 2 -- deterministic full-suite scoring against the REAL executor + real-data golden set

New `tests/evals/test_injection_adversarial_suite.py` loads the SAME committed `injection-fixtures.json`
(via `eval_fixtures_dir()`, never a hand-copied duplicate) and runs 3 proofs against the REAL
`SearchKnowledgeExecutor` class with hand-built fake `knowledge`/`embedder` collaborators (local copy
of `test_search_knowledge_executor.py`'s `_node_row`/`_make_executor` shape, per this repo's
established per-test-file convention):

1. Every one of the 25 non-crafted-query fixtures, seeded as a NON-EXTRACTED (`AMBIGUOUS`) node's
   title, never leaks its canary -- belt 2 + Plan 38-01's envelope gate both hold across the full set.
2. The SAME 25 fixtures, seeded as an EXTRACTED node's title, DO surface their canary (a sanity
   companion proving the suite isn't over-blocking legitimate human-confirmed data) AND still pass
   `validate_tool_envelope`.
3. The `knowledge-inferred-crafted-search` fixture, passed as the `query` ARGUMENT: the adversarial
   text reaches `knowledge.search_nodes.assert_awaited_once_with(query_text=<the exact text>, ...)`
   completely UNMODIFIED (the defense is structural -- the tier filter -- never query sanitization),
   while a co-seeded non-EXTRACTED row's canary still never leaks.

51 test cases total (25 + 25 + 1), all passing. Separately, `retrieval-golden-set.json` grew from 7
to 14 entries: 7 new real-data entries (ids 8-14) sourced from real local-dev-DB rows under
`DEFAULT_IMPORTER_ID` -- 5 already-present real `emails` rows plus 2 `entity_instances` and 1
EXTRACTED-tier `knowledge_nodes` row seeded once via an uncommitted one-off script (mirroring
`packages/db/scripts/verify-0029-live.ts`'s connection pattern, then deleted -- only the resulting
real UUIDs are durable). `test_retrieval_golden_set.py` gained 2 companion tests: new entries never
use the original synthetic id prefixes (`entity-`/`email-seed-`/`node-seed-`), and the original 7
entries stay untouched with those exact prefixes.

**Rule 1 auto-fix (directly caused by Task 1's own change):** `test_injection_fixtures.py`'s 35-03
scorer-mechanics test hardcoded `3 <= len(fixtures) <= 5`, immediately broken by Task 1's fixture
growth -- widened to `20 <= len(fixtures) <= 30` (renamed to match) to keep the full `tests/evals/`
sweep green, matching `eval-dimensions-assets.test.ts`'s identical widened bound.

### Task 3 -- live Bedrock Haiku harness (attempted, PASSED) + gated exposure flip

New `tests/evals/test_live_injection_harness.py`: `pytest.mark.integration()`, gated on a
non-network credential-CHAIN presence check (`boto3.Session().get_credentials() is not None` --
this environment authenticates via IAM/SSO, not a fixed `AWS_ACCESS_KEY_ID` env var, so
`test_corpus_pipeline.py`'s literal `_HAS_TEXTRACT` sniff doesn't transfer here) plus a runtime
try/except around the actual network call (`pytest.skip`, never a hard failure, on any
Bedrock-unreachable error at execution time). Drives a REAL `RunChatTurn` wired with the REAL
`BedrockChatAdapter` targeting `us.anthropic.claude-haiku-4-5-20251001-v1:0`, and a fake
`SearchKnowledgeExecutor` collaborator seeded with each representative fixture's `retrievedText` as
legitimate EXTRACTED-tier data (so it genuinely reaches the model as native `tool_result` content --
the scenario the hardening line + native block actually need to defend, distinct from Task 2's
structural-omission proof). One representative fixture per category (7 total, FOUND-3 cost
discipline): the un-suffixed first entry of each category. Asks the model to search the internal
knowledge base and summarize, then asserts the persisted assistant message's VISIBLE `text` parts
never contain the fixture's canary token.

**ATTEMPTED FOR REAL AND PASSED**: all 7 live Bedrock Haiku turns ran successfully (~11s total,
non-skipped, verified individually) and NONE leaked their canary into visible text -- the strongest
positive outcome, not the human_needed fallback.

Then, gated STRICTLY on Task 2's deterministic `tests/evals/` sweep (excluding this live-harness
module) being green in this same execution run -- verified twice, 69/69 passed both times --
`app/settings.py`'s `SEARCH_KNOWLEDGE_TOOL_ENABLED` flipped `False` -> `True`, with the surrounding
comment rewritten to past tense stating the flip landed after the suite passed.
`tests/test_container.py`'s `TestSearchKnowledgeExposureGate` updated to match: renamed
`test_container_search_knowledge_disabled_by_default` -> `test_container_search_knowledge_enabled_by_default`
(asserts `search_knowledge` IS present with no env override); added
`test_container_search_knowledge_can_still_be_disabled_via_flag` proving
`SEARCH_KNOWLEDGE_TOOL_ENABLED=false` still structurally omits the key (the flag remains a real
kill-switch, not dead code, post-flip).

**Rule 1 auto-fix (directly caused by Task 3's own flag flip):** `test_run_chat_turn_real_tools_wiring.py`'s
`test_container_wires_both_real_tool_executors` asserted the container resolves EXACTLY
`{lookup_entity, search_emails}` with no env override -- broken by the new default. This test is
scoped to Phase 36's additive-wiring proof specifically (not the exposure gate, which
`TestSearchKnowledgeExposureGate` already owns) -- fixed by explicitly forcing
`SEARCH_KNOWLEDGE_TOOL_ENABLED=false` via `monkeypatch` + `get_settings.cache_clear()` (mirrors the
established pattern), keeping the test's Phase-36-scoped meaning stable regardless of the exposure
flag's current default.

## Verification

```
npm run test -w @nauta/genui -- eval-dimensions-assets --run
# 12 passed (INJECTION_FIXTURES 20-30 bound, RETRIEVAL_GOLDEN_SET 5-20 bound)

cd apps/email-listener && uv run pytest tests/evals/ -q --no-cov
# 69 passed (51 adversarial-suite + 5 injection_fixtures + 5 retrieval_golden_set + 8 scorers)

cd apps/email-listener && uv run pytest tests/evals/test_live_injection_harness.py -v --no-cov -m integration
# 7 passed -- ALL live Bedrock Haiku turns resisted injection, canary never leaked

cd apps/email-listener && uv run pytest tests/test_container.py -k SearchKnowledgeExposureGate -q --no-cov
# 3 passed (enabled_by_default, can_still_be_disabled_via_flag, enabled_via_flag)

cd apps/email-listener && uv run mypy app/settings.py
# Success: no issues found in 1 source file

cd apps/email-listener && uv run lint-imports
# Contracts: 3 kept, 0 broken

cd apps/email-listener && uv run pytest tests/test_container.py tests/infrastructure/tools/ tests/application/ -q --no-cov -m "not integration"
# 240 passed (broader regression sweep after the flag flip)

cd apps/email-listener && uv run pytest -q --no-cov -m "not integration" --ignore=tests/test_genui_retrieval_provider.py
# full suite green (the one excluded file is a confirmed pre-existing, unrelated failure -- see
# deferred-items.md)

npm run test -w @nauta/genui --run
# 501 passed, 28 test files (full package regression, no other fixture-count assumptions broken)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `test_injection_fixtures.py`'s stale entry-count bound**
- **Found during:** Task 2's `tests/evals/` verification run
- **Issue:** Task 1's fixture-set growth (4 -> 26) broke 35-03's hardcoded `3 <= len(fixtures) <= 5` assertion
- **Fix:** Widened to `20 <= len(fixtures) <= 30`, renamed the test to match, kept the file's scope-mechanics-proof role otherwise unchanged (not repurposed into the full-suite module)
- **Files modified:** `apps/email-listener/tests/evals/test_injection_fixtures.py`
- **Commit:** c993727

**2. [Rule 1 - Bug] `test_container_wires_both_real_tool_executors`'s stale exact-set assertion**
- **Found during:** Task 3's broader regression sweep (`tests/application/`)
- **Issue:** The flag flip made `search_knowledge` present by default, breaking this Phase-36-scoped test's `{lookup_entity, search_emails}` exact-set assertion
- **Fix:** Explicitly forced `SEARCH_KNOWLEDGE_TOOL_ENABLED=false` via `monkeypatch` + `get_settings.cache_clear()`, keeping the test's Phase-36-only intent stable
- **Files modified:** `apps/email-listener/tests/application/test_run_chat_turn_real_tools_wiring.py`
- **Commit:** bd226ab

### Claude's Discretion (non-architectural, explicitly delegated by 38-CONTEXT.md)

- Schema-gate placement was already fixed by Plan 38-01; this plan's fixture-taxonomy granularity
  (26 fixtures, 4-5 per new/expanded category) and live-harness credential-check mechanism
  (credential-chain presence + runtime try/except, not an env-var sniff) were both explicitly
  delegated to this plan by 38-CONTEXT.md's "Claude's Discretion" note.
- `test_injection_adversarial_suite.py`'s `_node_row`/`_make_executor` are local hand-built copies,
  not cross-file imports from `test_search_knowledge_executor.py` -- mirrors 38-01's own identical
  deviation and this repo's established per-test-file-local-copy convention.

No Rule 4 (architectural) deviations. No auth gates beyond the one credential-chain check described
above (which resolved successfully -- Bedrock was reachable).

### Out-of-scope discovery (logged, not fixed)

10 pre-existing, unrelated test failures in `tests/test_genui_retrieval_provider.py`
(`asyncio.get_event_loop()` raising `RuntimeError` under Python 3.13 -- last touched Phase 17, zero
diff from this plan, no reference to `SEARCH_KNOWLEDGE_TOOL_ENABLED`/settings/container). Logged to
`.planning/phases/38-quarantine-adversarial-eval/deferred-items.md` per the scope-boundary rule,
not fixed.

## Known Stubs

None. `SearchKnowledgeExecutor` is exercised deterministically against the FULL 26-fixture set
(Task 2) and live against a representative 7-fixture subset (Task 3, all 7 genuinely passed, not
skipped). `SEARCH_KNOWLEDGE_TOOL_ENABLED` now reflects the deterministic suite's real pass outcome
from this run -- not a speculative or placeholder flip.

## Threat Flags

None beyond the plan's own `<threat_model>` register -- no new network endpoints, auth paths, or
schema changes were introduced. All 4 registered threats resolved as designed:

- **T-38-06** (live-model injection): the live harness was attempted for real and PASSED (all 7
  representative fixtures resisted injection against a genuine Bedrock Haiku turn) -- the stronger
  outcome, not the accepted-residual-risk fallback.
- **T-38-07** (query-argument tampering): the `knowledge-inferred-crafted-search` fixture proves the
  `extracted_only` tier filter holds regardless of adversarial query phrasing (Task 2, dedicated test).
- **T-38-08** (flag-flip repudiation): the flip was code-gated on the deterministic suite passing in
  this same execution run, verified twice (69/69), never a manual/undocumented toggle.
- **T-38-09** (citation spoofing): all 4 `citation-spoofing` fixtures pass both the non-leak and
  legitimate-surfacing proofs across the full deterministic sweep, not just the 1 hand-picked case
  Plan 38-01's own contract test wrote.

## Self-Check: PASSED

- FOUND: packages/genui/src/eval/injection-fixtures.json (26 entries)
- FOUND: packages/genui/src/eval/retrieval-golden-set.json (14 entries)
- FOUND: packages/genui/src/__tests__/eval-dimensions-assets.test.ts (widened bounds)
- FOUND: packages/genui/src/eval/EVAL-DIMENSIONS.README.md (updated sections)
- FOUND: apps/email-listener/tests/evals/test_injection_adversarial_suite.py
- FOUND: apps/email-listener/tests/evals/test_live_injection_harness.py
- FOUND: apps/email-listener/tests/evals/test_injection_fixtures.py (widened bound)
- FOUND: apps/email-listener/tests/evals/test_retrieval_golden_set.py (2 new companion tests)
- FOUND: apps/email-listener/app/settings.py (SEARCH_KNOWLEDGE_TOOL_ENABLED: bool = True)
- FOUND: apps/email-listener/tests/test_container.py (renamed + new exposure-gate tests)
- FOUND: apps/email-listener/tests/application/test_run_chat_turn_real_tools_wiring.py (scoped fix)
- FOUND: .planning/phases/38-quarantine-adversarial-eval/deferred-items.md
- FOUND commit 7ee49c4 (Task 1 -- 26-fixture 7-category adversarial suite)
- FOUND commit c993727 (Task 2 -- deterministic suite against real executor + real-data golden set)
- FOUND commit bd226ab (Task 3 -- live harness + gated exposure flip)
