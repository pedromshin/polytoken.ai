# Deferred Items — Phase 38 (Quarantine + Adversarial Eval)

## Pre-existing, out-of-scope test failures (not touched by 38-01 or 38-02)

### `tests/test_genui_retrieval_provider.py` — `asyncio.get_event_loop()` RuntimeError (10 tests)

Discovered during Plan 38-02's full-suite regression sweep
(`uv run pytest -q --no-cov -m "not integration"`). All 10 failures in
`TestLexicalRetrievalProviderBehavior` raise the same error:

```
RuntimeError: There is no current event loop in thread 'MainThread'.
```

**Root cause:** `asyncio.get_event_loop()` (Python 3.13's stdlib raises when
called outside a running loop with no current loop set on the thread — a
behavior change from older Python versions). Every failing test calls
`asyncio.get_event_loop().run_until_complete(...)` directly instead of
`asyncio.run(...)` or a `pytest.mark.asyncio` async test.

**Scope:** Last modified in Phase 17 (commit `f2303fc`, "add failing tests
for RetrievalProvider port + LexicalRetrievalProvider (RED)"). Zero diff
from this plan's changes (`git diff HEAD -- tests/test_genui_retrieval_provider.py`
is empty). Unrelated to `SEARCH_KNOWLEDGE_TOOL_ENABLED`, `container.py`, or
any file this plan touches — confirmed by grep (no references to settings/
search_knowledge in the file).

**Action:** Not fixed (out of scope per the executor's scope-boundary rule —
only auto-fix issues directly caused by the current task's changes). A
future plan touching this file should replace `asyncio.get_event_loop()`
with `asyncio.run()` across all 10 call sites.
