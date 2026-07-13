---
created: 2026-07-13
title: 9 stale app/presentation __tests__ fail (pre-44-09 auth shape) and CI never collects app/**/__tests__
area: apps/email-listener (test collection + presentation tests)
files:
  - apps/email-listener/app/presentation/api/v1/__tests__/test_chat_widget.py
  - apps/email-listener/pyproject.toml
resolves_phase: null
---

## Problem

`pyproject.toml` sets `testpaths = ["tests"]`, so plain `uv run pytest` (what CI and the
deploy gate run) never collects the co-located `app/**/__tests__/` suites. Found 2026-07-13
while running everything explicitly: 9 tests in
`app/presentation/api/v1/__tests__/test_chat_widget.py` fail with 401 — they predate Phase
44-09, which added `Depends(require_user_id)` (X-User-Id) + `assert_conversation_owned` to
the endpoint; the tests send neither the header nor provide a ChatConversationRepository in
their fake DI container. They've been broken-but-invisible ever since.

## Fix direction

1. Update the 9 tests to the 44-09 endpoint contract (X-User-Id header + conversations
   provider in the fake container), mirroring how chat_stream's own tests were updated.
2. Decide whether `app/**/__tests__/` should be collected by default (add to testpaths) —
   if yes, expect a coverage-number shift; if no, document that these suites are
   plan-verification-only and must be run explicitly.
