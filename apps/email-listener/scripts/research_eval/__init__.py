"""Research-quality eval harness (Phase 72 / RSRCH-05).

A fixed question set + a scored, deterministic rubric so a research-quality
*regression is detectable* rather than felt. Mirrors the shape of
``scripts.genui_eval`` (rubric + runner + report), but scores a
*research-run output* (sources + claims + report body) instead of a GenUI spec.

Purity guarantee (mirrors genui_eval, D-11): this package NEVER imports
anthropic, boto3, supabase, or any network library. It scores a *given*
research-run output — it does not itself call Bedrock. Executing a live
research run against Bedrock is deliberately out of scope for this slice
(the orchestrator's note: "Do NOT wire it to live Bedrock"); the harness
takes the run output as data.

Phase 72 aspiration (item 4): the eval harness is itself a registry capability
so the self-building product measures itself with its own substrate. That
binding lives on the TS ``packages/capabilities`` side; this Python package is
the deterministic scorer the capability's ``execute`` would call. The seam is a
pointer, not built here.
"""
