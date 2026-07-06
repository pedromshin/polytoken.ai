# Deferred Items — Phase 25 (out-of-scope discoveries, not fixed)

## 25-02: Pre-existing mypy errors surfaced transitively via app/container.py

`uv run mypy app/container.py` reports 12 errors, but ALL of them are in files
container.py merely imports (not touched by 25-02): `genui_generator_adapter.py`,
`genui_code_generator_adapter.py`, `supabase_ui_spec_template_repository.py` (x3),
`supabase_chat_widget_interaction_repository.py` (x6 union-attr errors on one line).

Confirmed pre-existing: `git stash` (removing all 25-02 changes) then re-running
`uv run mypy app/container.py` reproduces the IDENTICAL 12 errors. None reference
`container.py` itself or any file this plan created/modified
(`evaluate_anticipatory_candidates.py`, `anticipatory_ports.py`, `stubs.py`,
`anticipatory_judge_adapter.py`, `in_memory_cap_store.py`). Out of scope per the
executor's SCOPE BOUNDARY rule — not fixed here.
