---
created: 2026-07-11
title: chat_cost_ledger insert fails NOT NULL user_id on every server-locus chat turn
area: apps/email-listener (cost ledger recording)
files:
  - apps/email-listener/app/infrastructure/supabase/supabase_cost_ledger_repository.py
resolves_phase: null
---

## Problem

Found live during Phase 50 Plan 02 (LIVE-05 UAT burn-down) while driving real chat turns against
the local stack via `uat-39-tool-round.spec.ts`. Every server-locus chat turn (success or
failure) logs a caught-but-fatal error when recording cost:

```
2026-07-11T05:13:02.727202Z [error] cost_ledger_record_failed execution_locus=server
  importer_id=00000000-0000-0000-0000-000000000001 model_id=us.anthropic.claude-sonnet-4-6
  table=chat_cost_ledger
postgrest.exceptions.APIError: {'message': 'null value in column "user_id" of relation
  "chat_cost_ledger" violates not-null constraint', 'code': '23502', ...}
```

`SupabaseCostLedgerRepository.record()`
(`apps/email-listener/app/infrastructure/supabase/supabase_cost_ledger_repository.py:89`) inserts
a row with `user_id` unset/null on every call — reproduced on BOTH a genuinely successful turn
(tool round + citation + genui card all rendered correctly) and a genuinely failed turn (Bedrock
`ConnectTimeout`). The exception is caught and logged (never crashes the turn — SSE stream still
completes normally from the user's perspective), but `chat_cost_ledger` receives **zero rows** for
every server-locus turn today, silently breaking cost tracking (`CostMeter`'s "Session: $0.00"
badge is  wrong/always-zero — matches: it read an empty ledger).

## Scope note

Out of scope for Phase 50 Plan 02 (UAT burn-down for Phase 39/41 scenarios) — pre-existing,
unrelated to the files that plan touches. Filed per the deviation-rules scope boundary rather than
auto-fixed.

## Solution (proposed)

- Read `record()`'s call site — the caller almost certainly already has the authenticated
  `user_id` in context (the chat run's owning conversation); thread it through into the insert
  payload alongside `importer_id`/`model_id`.
- Regression test: a real (or mocked-Supabase) `record()` call asserts the inserted row includes a
  non-null `user_id` matching the conversation's owner.
- Once fixed, `CostMeter` should start reflecting real per-session cost instead of a permanently
  empty ledger.
