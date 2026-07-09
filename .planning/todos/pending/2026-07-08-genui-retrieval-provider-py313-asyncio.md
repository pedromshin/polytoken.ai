---
created: 2026-07-08
title: Fix 10 pre-existing failures in test_genui_retrieval_provider.py (Python 3.13 asyncio.get_event_loop removal)
area: email-listener/tests (genui retrieval provider)
files:
  - apps/email-listener/tests/test_genui_retrieval_provider.py
---

## Problem

Full-suite run during Phase 36 verification (v1.6) surfaced 10 failing tests, all in
`tests/test_genui_retrieval_provider.py`. Confirmed byte-identical pre/post Phase 36
(`git diff 94f7d6d..0840045`) — pre-existing, unrelated to v1.6 work. Root cause: the tests (or
the code path they exercise) rely on `asyncio.get_event_loop()` semantics removed/changed in
Python 3.13.

## Solution (proposed)

Migrate the affected tests/fixtures to `asyncio.run()` / explicit event-loop fixtures
(`pytest-asyncio` current idioms). Small, mechanical; verify the production provider itself
doesn't share the deprecated call.
