# Deferred Items — Phase 42 (Atomic Rename nauta → polytoken), Plan 42-01

## Pre-existing, out-of-scope `npm run check` failures (not caused by this plan)

Task 3's workspace regeneration (`rm -rf node_modules && npm install`) was the
first time this session ran the FULL, unscoped `npm run check` aggregate gate
(`lint && format && typecheck && architecture && test`) across the entire
`apps/email-listener` Python tree. It fails — but every failure below is
either already-documented pre-existing debt from an earlier phase, or newly
surfaced tooling-version drift (`ruff>=0.8.0` resolved to `0.15.16` this
session) that has zero overlap with the ~16 Python files this plan's rename
script touched. Cross-checked via `git diff --name-only` against Task 1's
commit (`82d3c8b`) for every flagged file below — none intersect.

### `npm run lint` (`ruff check .`) — 281 pre-existing errors

Spans files never touched by any Phase 42 commit (e.g.
`tests/test_genui_retrieval_provider.py`, last modified Phase 17 per
`git log`; `tests/test_supabase_ui_spec_template_repository.py`). Dominant
class: `PT023` (`@pytest.mark.unit()` → should be `@pytest.mark.unit`,
parenthesis style), plus assorted `F401`/`F841`/`I001` unused-import and
import-ordering violations. None reference `@nauta/`, `nauta-teal`, or any
string this plan's substitution script touches — confirmed by grepping the
ruff output for `polytoken`/`nauta`, which surfaces only 2 matches, both
`PT023` decorator-parenthesis hits on lines that happen to sit next to
already-correctly-renamed `"polytoken-teal"` docstring text (the flagged
token is the parenthesis, not the string).

**Root cause (most likely):** `pyproject.toml` pins `ruff>=0.8.0` (floor
only, no ceiling); the resolved `0.15.16` is far newer and enforces the
already-`select`ed `PT` rule family more strictly than whatever version last
produced a clean run. This plan did not touch `pyproject.toml`'s
`[tool.ruff]` block (only the `[project].description` string — verified via
`git show 82d3c8b -- apps/email-listener/pyproject.toml`).

**Action:** Not fixed — 281 errors across dozens of untouched files is
disproportionate to a rename phase and violates the executor's scope-boundary
rule (only auto-fix issues directly caused by the current task's changes). A
future hygiene phase should either pin `ruff` to an exact version or run
`ruff check --fix` deliberately with its own review pass.

### `npm run format` (`ruff format --check .`) — 75 files would reformat

Same root-cause hypothesis (ruff formatter opinion drift between versions).
Spans files never touched this session (e.g.
`app/domain/ports/anticipatory_ports.py`,
`app/infrastructure/supabase/knowledge_graph_repository.py`). 6 of the 75
are among this plan's touched files (`genui_artifacts.py`, `genui.py`,
`run_eval.py`, `test_cache_key.py`, `test_generate_ui_spec.py`,
`test_genui_eval_style.py`) — but the diffs `ruff format` would apply are
whitespace/quote-style only, identical in kind to the other 69 untouched
files, confirming systemic drift rather than anything introduced by this
plan's pure string substitutions.

**Action:** Not fixed — same scope-boundary reasoning as the lint findings.

### `npm run typecheck` (`mypy app`) — 22 pre-existing errors in 8 files

None of the 8 flagged files (`genui_code_generator_adapter.py`,
`supabase_ui_spec_template_repository.py`,
`supabase_chat_widget_interaction_repository.py`, 4
`test_run_chat_turn_*.py` files, `test_submit_widget_interaction.py`,
`genui_generator_adapter.py`) were touched by this plan. STATE.md's Phase
36-02/37-02/40-01 entries already document "12 pre-existing errors in 4
unrelated infrastructure files" — this session's count (22/8) reflects
additional debt accumulated since those notes (Phase 39-41 code), still
unrelated to this rename.

**Action:** Not fixed — pre-existing, out of scope.

### `npm run test` (`pytest`) — 10 pre-existing failures (exact repeat of Phase 38-02's finding)

`tests/test_genui_retrieval_provider.py::TestLexicalRetrievalProviderBehavior`
— all 10 tests fail with `RuntimeError: There is no current event loop in
thread 'MainThread'` (Python 3.13's `asyncio.get_event_loop()` behavior
change). This is a byte-identical re-confirmation of the finding already
logged in
`.planning/milestones/v1.6-phases/38-quarantine-adversarial-eval/deferred-items.md`
— same file, same root cause, same "last modified Phase 17, zero diff"
scope boundary. Re-verified this session:
`git diff HEAD -- apps/email-listener/tests/test_genui_retrieval_provider.py`
is empty (untouched by any Phase 42 commit).

Coverage also lands at 66.67% (below the 80% gate) — a downstream
consequence of the 10 failing tests not exercising their target module, not
a new regression.

**Action:** Not fixed — already-documented pre-existing debt (Phase 38-02).

## Verification performed in place of the blocked aggregate gate

Since `npm run check`'s `&&` chain short-circuits at the first failing
sub-command (`lint`), each sub-gate was run independently to prove Phase 42's
own changes are clean:

| Gate | Result | Phase-42-caused issues |
|------|--------|------------------------|
| `ruff check .` | 281 pre-existing errors | 0 |
| `ruff format --check .` | 75 pre-existing files | 0 |
| `mypy app` | 22 pre-existing errors | 0 |
| `lint-imports` | 3 kept, 0 broken | 0 |
| `pytest` | 10 pre-existing failures (Phase 38-02 finding), 1192 passed | 0 |

All 5 TypeScript/JS gates (`npm ci`, 5× `typecheck -w @polytoken/*`, 3×
`test -w @polytoken/*`) pass clean — see 42-01-SUMMARY.md.
