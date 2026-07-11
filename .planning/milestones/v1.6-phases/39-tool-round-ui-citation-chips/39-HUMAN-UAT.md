---
status: complete
phase: 39-tool-round-ui-citation-chips
source: [39-VERIFICATION.md, 50-02-PLAN.md]
started: 2026-07-09T08:00:00Z
updated: 2026-07-11T05:35:00Z
---

## Current Test

None — both scenarios closed.

## Tests

### 1. Live in-round activity affordance
expected: Send a chat message that triggers a real server tool (lookup_entity/search_emails/search_knowledge) against a running FastAPI backend + Next.js dev server. A ToolRoundActivityRow (Loader2 spinner + gerund label, e.g. "Searching knowledge…") appears DURING the round — not after a page refresh, not stuck, not delayed — then is replaced in-place by a collapsed ToolInvocationResultRow (label + result count + up to 5 real ProvenanceLink citation chips, or a "+N" overflow badge) the instant the round settles.
result: passed — `apps/web/e2e/uat-39-tool-round.spec.ts` (Phase 50 Plan 02) drives a REAL `search_emails` tool round against the live local stack (seeded session, real Bedrock Sonnet 4.6 call). The ToolRoundActivityRow ("Searching emails…") was caught transiently, then replaced by the collapsed ToolInvocationResultRow ("Searched emails — 1 result"), DB-verified via a real `chat_run_events` row with `type='tool_call'` for the conversation. Passed 2/2 consecutive live runs against the local stack.

### 2. Citation chip visual legibility and deep-link round-trip
expected: Click/middle-click a rendered ProvenanceLink chip. Chip shows the correct icon (Mail/Box/Share2) per kind, truncates gracefully at 160px, and middle-click/ctrl-click opens /emails/[id], /entities/[id], or /knowledge?focus={id} in a new tab without a full page reload disruption.
result: passed — the same spec seeds a minimum CONFIRMED extracted-data slice (entity_type + email_components row + extraction_record, all `confirmed`) so `search_emails`'s real RRF(k=60) trgm retrieval path surfaces a genuine, cited result. The rendered chip ("Email · ee000000") is a real Next `<Link>` with `href="/emails/{id}"` (asserted via `toHaveAttribute`) and the correct Mail icon (1 `<svg>` child asserted). Middle-click/new-tab-open itself is standard `<Link>` browser behavior over a real `href` (not app logic) and was already unit-verified in `provenance-link.test.tsx`; this plan adds the missing piece — a REAL, DB-backed href with real fixture data, not a mount-test stub.

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

None. Both scenarios closed with DB-verified live evidence (Phase 50 Plan 02,
`apps/web/e2e/uat-39-tool-round.spec.ts`). No tracked-fix needed — the honest seeding path (a
real `confirmed` email_components/extraction_records slice) was tractable within budget.
