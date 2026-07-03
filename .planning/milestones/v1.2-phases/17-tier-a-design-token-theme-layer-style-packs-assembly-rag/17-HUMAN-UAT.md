---
status: partial
phase: 17-tier-a-design-token-theme-layer-style-packs-assembly-rag
source: [17-VERIFICATION.md]
started: 2026-06-28
updated: 2026-06-28
---

## Current Test

[awaiting human + connected-env verification]

## Context

Phase 17 is **code-complete**: 13/13 code-verifiable must-haves passed verification, the code review's
2 blockers + 5 warnings were fixed, genui TS is 302 tests green, and the Python modules pass standalone.
The three items below are the only remaining verification — they require a browser and/or live AWS
Bedrock credentials, so they were deferred during the autonomous run (not code gaps).

## Tests

### UAT-17-01 — Visual pack differentiation (browser)
- **Status:** pending
- **How to verify:** Open `/studio`. Generate the same intent (e.g. "a SaaS pricing page") with the
  pack dropdown set to `nauta-teal`, then again set to `brutalist` (or `warm-editorial`).
- **Expected:** The two renders visibly differ in color, radius, and typography (not just a tint), and the
  provenance badge shows the selected pack id.

### UAT-17-02 — Auto/Surprise distribution (browser)
- **Status:** pending
- **How to verify:** Set the pack selector to **Auto/Surprise** and click Generate 5–6 times.
- **Expected:** At least 2 different pack ids appear in the provenance badge across runs (same intent
  visibly differs on demand — success criterion 2).

### UAT-17-03 — Connected-env live `--all-packs` eval (STYLE-04, ops)
- **Status:** pending
- **How to verify:** With AWS Bedrock credentials + a seeded DB, from `apps/email-listener`:
  `uv run python -m scripts.genui_eval.run_eval --all-packs --label style-pack-win-baseline`
  then `compare_reports.py` against the recorded Phase-16 baseline (record the baseline first if
  `reports/` has only `.gitkeep`).
- **Expected (STYLE-04 pass bar):** no a11y HARD regression (incl. the new WCAG-AA contrast check),
  positive style-distinctiveness, retrieval-overlap above floor on the majority of prompts, and the
  four-criterion aggregate at or above the Phase-16 baseline (lift on composed-not-placeholder / on-intent).
  The eval machinery is fully shipped and offline-unit-tested; this is the live measurement that closes
  STYLE-04.

## Notes

- Pre-existing, non-blocking: cross-file pytest event-loop isolation pollution (deprecated
  `asyncio.get_event_loop().run_until_complete()` in some test files) causes failures only when many
  Python test files run in one pytest process; each file passes standalone. Not a Phase-17 defect —
  candidate for a small test-harness cleanup (migrate to `pytest.mark.asyncio` / `asyncio.run`).
- Deferred review item IN-02 (per-pack breakdown table in the eval markdown report) — non-trivial
  `EvalReport` structural change; follow-up.
