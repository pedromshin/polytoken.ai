---
created: 2026-07-06
title: Salvage or surface truncated/unparseable chat tool calls instead of silent drop
area: chat/streaming (run_chat_turn)
resolves_phase: 34
files:
  - apps/email-listener/app/application/use_cases/run_chat_turn.py
---

## Problem

When a chat model's `emit_ui_spec` (or widget) tool-call input fails `json.loads` at finalize
(`_finalize_pending_tool`, [run_chat_turn.py:713](apps/email-listener/app/application/use_cases/run_chat_turn.py#L713)),
the part is DROPPED with only a server-side `emit_ui_spec_tool_call_parse_failed` warning. The user
sees plain text as if the agent never tried to render anything — no error, no retry affordance.
Found live 2026-07-06: a "generate everything you can" prompt hit the old 4096-token output cap
mid-tool-JSON (ledger showed output_tokens == cap exactly). The cap was raised to 12000
(settings.py) but truncation is still reachable — any cap, any model hiccup.

## Solution (proposed)

Two complementary layers:
1. **Salvage**: on parse failure, attempt the same lenient JSON-prefix repair the web side already
   uses for progressive partial-tree streaming (GenuiPartBoundary's repair + Zod safeParse gate) —
   server-side equivalent: repair prefix → safeParse against spec schema → render the valid subtree
   with a "truncated" marker instead of dropping everything.
2. **Surface**: when stop_reason == max_tokens with a pending tool call (or salvage fails), emit a
   user-visible error part ("The generated UI was too large and got cut off — try asking for
   something more focused") instead of silently omitting — mirrors the existing inline retryable
   error recovery cards from Phase 22.

**Why:** silent feature failure reads as "the app doesn't work" during exactly the demos/tests
that matter; the repair machinery already exists client-side and in the genui pipeline.

**How to apply:** respects FOUND-6 (all untrusted input crosses a schema gate) — salvaged specs
still go through safeParse; no renderer changes needed.
