---
status: partial
phase: 24-dual-channel-genui
source: [24-VERIFICATION.md]
started: 2026-07-05T21:40:00Z
updated: 2026-07-05T21:40:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live proposal-card round-trip (real browser)
expected: Card group renders; click disables the group + shows "Submitting…"; chosen card locks with ring + "Selected" badge, others dim; compact `Selected "{title}"` entry appears in transcript; same state reflected in the canvas panel
result: [pending]

### 2. Live clarify-widget (form) round-trip (real browser)
expected: Form renders via the Phase-19 engine; fill + submit locks to the "Your response" + "Submitted" badge + key-value-list view; a 422 (e.g. clearing a required field via devtools before submit) re-enables the form with the inline error row
result: [pending]

### 3. End-to-end round-trip against real AWS Bedrock
expected: Full stack (Next → FastAPI → Bedrock → FastAPI → Next) round-trips a genuine model-authored widget (emit_proposal_cards / emit_clarify_widget) and a genuine continuation turn — not a fake/test provider
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0

## Note

All underlying mechanisms are proven in unmocked automated tests (real SpecRenderer + real DOM
click events in vitest; real Supabase-backed CAS lock; server-side re-validation, staleness, and
double-submit all covered by pytest). These 3 items require a live browser or a live-Bedrock model
in the loop, consistent with this project's standing deferred-verification convention
(EVAL-LIFT / ISO-RUN class).
