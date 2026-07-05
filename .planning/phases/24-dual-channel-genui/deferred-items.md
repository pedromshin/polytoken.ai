# Deferred Items — Phase 24 (Dual-Channel GenUI)

Out-of-scope discoveries logged during execution (not fixed — pre-existing, unrelated to the
task in progress when found).

## 24-02

- **Pre-existing mypy errors in `supabase_chat_widget_interaction_repository.py::is_stale`**
  (line ~149, 6x `union-attr` on `message_rows[0].get(...)` — postgrest-py's `APIResponse.data`
  item type is a recursive `JSON` union mypy can't narrow without an escape hatch). Confirmed
  present in the original 24-01 commit (`git show HEAD:...` reproduces identically) — not
  introduced or touched by 24-02's additive `interaction_id` param change to `create_pending`.
  Same class of gap 24-01-SUMMARY.md already noted as accepted elsewhere in this codebase
  (e.g. `genui_generator_adapter.py`). Left as-is (out of scope for 24-02).

- **Pre-existing full-suite failures in `tests/test_genui_retrieval_provider.py`** (9 tests,
  `TestLexicalRetrievalProviderBehavior`) — all fail with `RuntimeError: There is no current
  event loop in thread 'MainThread'` from `asyncio.get_event_loop().run_until_complete(...)`, a
  Python 3.13 compatibility break in a pre-existing (Phase 17-02) test helper, last touched
  2026-06-28 — unrelated to Phase 24. Confirmed via `git log` that this file was never touched
  by any 24-01/24-02 commit. Every other test in the full `apps/email-listener` suite (run with
  `--ignore=tests/test_genui_retrieval_provider.py`) is green. Left as-is (out of scope).
