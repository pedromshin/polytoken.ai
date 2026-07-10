# Requirements: v1.7 polytoken.ai Foundation — Rename, Auth & Tenancy

**Defined:** 2026-07-09
**Core Value:** Reliably receive every inbound email destined for the agent address and make it observable — now scoped per real user, under the product's real name.
**Research base:** `.planning/research/v1.7-polytoken-foundation/SUMMARY.md` (+ STACK/FEATURES/ARCHITECTURE/PITFALLS)

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Rename

- [x] **RENM-01**: Internal rename nauta → polytoken is atomic and complete — `@nauta/*` → `@polytoken/*` package scopes, workspace script selectors, vercel.json, CI YAML references, docs, and UI strings — with typecheck + test suites green and workspace symlinks regenerated (no hybrid states)
- [x] **RENM-02**: External renames (GitHub repo, AWS/Terraform resources, Vercel project, domain purchase/DNS) are delivered as a user runbook — documented, NOT executed; live AWS resource name strings stay untouched (ECR `force_delete=false` / local tfstate hazard)

### Auth

- [x] **AUTH-01**: User can sign in with Google (Supabase Auth PKCE via `@supabase/ssr`) and the session persists across browser refresh
- [x] **AUTH-02**: User can sign out; app surfaces require a session (signed-out visitors land on sign-in)
- [x] **AUTH-03**: tRPC procedures resolve the acting user server-side from the session context (the documented "no-auth" seam in `packages/api-client/src/trpc.ts`) — identity is never accepted from client input
- [x] **AUTH-04**: Server-side proxy routes to FastAPI forward the user's identity alongside `X-API-Key` (which remains the unchanged service-to-service boundary)
- [x] **AUTH-05**: Google Cloud OAuth client creation + env configuration is user-runbook'd; missing auth env vars surface at startup

### Tenancy

- [x] **TENA-01**: `user_id` is anchored on `importers` (scoping the hard-FK descendant tables via one join); `chat_conversations`/`chat_cost_ledger` get direct `user_id`; genui exact-match cache tables stay deliberately unscoped; all NEW tables carry tenant scoping (VISION guardrail #1)
- [x] **TENA-02**: All existing data is backfilled to the first real user account via expand→backfill→contract migrations
- [x] **TENA-03**: Every web route and tRPC procedure derives tenant scope from the session, never from client-supplied importer IDs — including the currently-unscoped attachments download route and the promote proxy — proven by an adversarial cross-tenant test that is a phase acceptance gate (absorbs backlog 999.1 as per-user scoping)
- [x] **TENA-04**: RLS policies exist as defense-in-depth on user-owned tables, with the enforcement architecture decision (app-boundary primary vs RLS primary, given the Drizzle superuser-connection precedent) recorded explicitly before policy work

### Threads

- [x] **THRD-01**: Ingested emails are grouped into threads via RFC `Message-ID`/`In-Reply-To`/`References` headers (Union-Find grouping behind a `ThreadResolver` domain port mirroring `ImporterResolver`, resolved at ingest time), with existing emails backfilled
- [ ] **THRD-02**: Forwarded mail (headers stripped by Gmail UI-forward) does not fragment threads — a conservative fallback tier ships with real Gmail-forward `.eml` fixtures
- [ ] **THRD-03**: User can see emails grouped by thread in the inbox list
- [x] **THRD-04**: A unique secret-token forwarding address seam exists (SES wildcard routing pattern) with a user onboarding runbook covering Gmail's own destination-verification handshake

### Hygiene

- [x] **HYGN-01**: The locally-feasible 999.3 connected-env verifications are executed with recorded evidence (eval harness vs baseline on the v1.2 corpus; Playwright code-island isolation spec) — the substrate is validated before v1.8 re-skins it
- [x] **HYGN-02**: 999.2 folds land — pytest event-loop cleanup and spreadsheet-grid colSpan

### Dossier

- [ ] **DSSR-01**: A brand-identity options document exists for v1.8 (polytoken naming/voice/logo directions, decision-ready)
- [ ] **DSSR-02**: A design-pattern research dossier exists mapping Claude/ChatGPT/Perplexity-class flows onto the v1.4 token system (the v1.8 re-skin's input, produced the way v1.6's research ran during v1.5)

## v2 Requirements

Deferred to v1.8+ (the taste-heavy E2 remainder). Tracked but not in current roadmap.

### Design re-skin (v1.8)

- **RSKN-01**: Total UI re-skin on the v1.4 token system per the DSSR dossier
- **RSKN-02**: Mobile-responsive answer (list/feed on small screens, canvas on desktop)
- **RSKN-03**: 999.4 Design Engine absorption (promptable design system, token extraction)
- **RSKN-04**: 999.7 editable genui panels / studio-on-canvas surfaces

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Gmail-API pull ingestion | Architecturally distinct from forwarding; not in the milestone brief (FEATURES.md anti-scope-creep) |
| Org/team collaboration primitives | Single-user-first product; enterprise tenancy is a different problem |
| Per-request JWT-forwarded RLS (`SET ROLE authenticated`) as primary boundary | Heavier lift, single community source, no demonstrated need — app-boundary primary + RLS defense-in-depth instead (measurement-gated evolution precedent) |
| Executing external renames (GitHub/AWS/Vercel/domain) | Outward-facing, needs the user (domain purchase, DNS, Terraform apply against live infra) — runbook'd instead |
| E3 email-cluster canvas features (thread cards, cluster context) | Next epoch; v1.7 only builds the thread model E3 needs |
| Native mobile app | VISION E2: web-first, mobile-responsive only |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| RENM-01 | Phase 42 | Complete |
| RENM-02 | Phase 42 | Complete |
| AUTH-01 | Phase 43 | Complete |
| AUTH-02 | Phase 43 | Complete |
| AUTH-03 | Phase 43 | Complete |
| AUTH-04 | Phase 43 | Complete |
| AUTH-05 | Phase 43 | Complete |
| TENA-01 | Phase 44 | Complete |
| TENA-02 | Phase 44 | Complete |
| TENA-03 | Phase 44 | Complete (spanned Plans 02/03/05/06/07/08/09; adversarial acceptance gate green — the chat-SSE gap found at Plan 08's sweep is CLOSED by Plan 09, see 44-SWEEP-INVENTORY.md "Known Gap — CLOSED by Plan 44-09") |
| TENA-04 | Phase 44 | Complete |
| THRD-01 | Phase 45 | Complete |
| THRD-02 | Phase 45 | Pending |
| THRD-03 | Phase 45 | Pending |
| THRD-04 | Phase 45 | Complete |
| HYGN-01 | Phase 46 | Complete |
| HYGN-02 | Phase 46 | Complete |
| DSSR-01 | Phase 46 | Pending |
| DSSR-02 | Phase 46 | Pending |

**Coverage:**
- v1 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-09*
*Last updated: 2026-07-09 after roadmap creation (traceability filled)*
