# Phase 45: Email Threads + Forwarding Seam - Context

**Gathered:** 2026-07-09
**Status:** Ready for planning
**Mode:** Autonomous smart discuss — 4 grey areas proposed, all recommendations auto-accepted per autonomous contract

**Rename note:** Executes post-rename and post-tenancy — new tables MUST carry tenant scoping (VISION guardrail #1, TENA-01).

<domain>
## Phase Boundary

Emails group into threads at ingest time, resilient to forwarded mail; existing emails are backfilled; the inbox shows thread groups; and the unique secret-token forwarding-address seam exists with an onboarding runbook. NOT in this phase: E3 thread-cards-on-canvas features, Gmail-API pull ingestion, full forwarding onboarding UX.

</domain>

<decisions>
## Implementation Decisions

### Thread model
- Real `threads` table (research recommendation over emails.thread_id-only) + `thread_id` FK on `emails`; threads carry tenant scoping via their importer (TENA-01 guardrail: all NEW tables tenant-scoped)
- `ThreadResolver` domain port mirroring the existing `ImporterResolver` port (`app/domain/ports/importer_resolver.py`), resolved at ingest time in the pipeline
- Hand-rolled Union-Find grouping over RFC headers (`Message-ID`/`In-Reply-To`/`References` — already parsed and stored since Phase 4 via `mime_parser.py`); no external threading lib (jwzthreading abandoned since 2010)
- Backfill: run the same Union-Find over already-stored headers for existing emails (script or migration — planner's choice, must be re-runnable/idempotent)

### Forwarded-mail fallback (THRD-02)
- Gmail UI-forward STRIPS References headers — fallback tiers required from the start:
  - Tier 1: extract original `Message-ID`s embedded in the forwarded body (Gmail embeds original headers in the forwarded block when present)
  - Tier 2: conservative heuristic — normalized subject (Re:/Fwd:-stripped) + same importer + bounded time window; when uncertain, DO NOT merge (false-split beats false-merge)
- Fixtures: prefer REAL Gmail-forward `.eml`s sourced from already-ingested emails in the local DB / existing fixtures; if none exist, construct from documented Gmail-forward structure and flag the real-mail loop as a manual UAT item

### Inbox UI (THRD-03)
- Inbox list groups emails into thread entries: subject + message count + latest snippet/date, expandable to member emails; existing email detail view untouched
- Intentionally minimal styling on the v1.4 token system — v1.8 re-skins it; a UI-SPEC design contract will be generated for this phase (the milestone's one real UI change)

### Forwarding seam (THRD-04)
- Per-user secret-token forwarding address (e.g. `u-{token}@` the inbound domain) using the SES wildcard receipt pattern already in place; ingest resolves token → importer/user
- Seam scope only: token generation + resolution path + minimal surfacing of the user's address; full onboarding UX deferred
- User runbook covers Gmail's destination-verification handshake — Gmail emails a confirmation code to the forwarding address, which lands in OUR pipeline; runbook shows how to retrieve it (and the code path must not quarantine/drop it)

### Claude's Discretion
- Union-Find implementation details, thread subject derivation, exact fallback window, token format/length, migration mechanics

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `emails` table already stores `messageId`/`inReplyTo`/`referencesIds` (Phase 4, `mime_parser.py`) — the algorithm's inputs exist for ALL historical rows
- `ImporterResolver` port is the architectural template; SES wildcard routing + `sns_inbound.py` webhook are live
- Inbox list UI exists in apps/web (email list per importer)

### Established Patterns
- Hexagonal FastAPI service: domain ports + adapters; ingest pipeline is where resolution hooks in
- Tenancy from Phase 44: new tables scoped, ownership helpers available for the inbox queries

### Integration Points
- Ingest pipeline (thread resolution step), packages/db schema (threads table + FK), inbox list route/tRPC + web UI, SES receipt/routing config docs for the seam

</code_context>

<specifics>
## Specific Ideas

- False-split beats false-merge: a fragmented thread is recoverable; a wrongly-merged thread is user-visible corruption
- E3 (email-cluster canvas) consumes this thread model — keep the model clean, resist UI scope creep

</specifics>

<deferred>
## Deferred Ideas

- Thread cards / cluster context on canvas — E3, next epoch
- Gmail-API pull ingestion — explicitly out of scope (FEATURES.md anti-scope-creep)
- Full forwarding onboarding UX — seam only in v1.7

</deferred>
