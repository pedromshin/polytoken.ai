# Project Research Summary — v1.7 polytoken.ai Foundation (Rename, Auth & Tenancy)

**Project:** nauta.services.email-listener → polytoken.ai
**Domain:** Retrofitting product foundations (auth, per-user tenancy, email threading, atomic rename) onto an existing single-tenant personal-AI-workspace
**Researched:** 2026-07-09 (4 parallel researchers: STACK / FEATURES / ARCHITECTURE / PITFALLS)
**Confidence:** HIGH (repo-grounded claims are file:line-cited; Supabase Auth wiring MEDIUM-HIGH pending JWT signing-key mode check)
**Synthesis note:** SUMMARY written inline by the orchestrator — the synthesizer agent was cut off by a session limit after all four researchers completed. Content drawn from the four committed research docs (66a6869).

## Executive Summary

v1.7 is a retrofit milestone, and the research's central good news is that the substrate already
anticipates all four features: `emails` has carried `message_id`/`in_reply_to`/`references_ids`
since Phase 4 (threading is a grouping/backfill problem, not ingestion work); every domain table
already carries `importer_id` (tenancy is wiring an existing partition column to a real identity,
not greenfield); the tRPC context is literally documented "no-auth… add auth here later"; and the
browser never calls FastAPI directly (clean BFF topology), so user auth lives only in `apps/web`
while `X-API-Key` stays the service-to-service boundary.

All four docs converge on the same settled decisions: **Supabase Auth (GoTrue) with Google
provider** — not Auth.js v5 (still beta, no native `auth.uid()`/RLS JWT shape) and not custom —
requiring exactly ONE new npm package (`@supabase/ssr`) and zero new Python packages; **rename
first** (mechanical, ~210–246 files, so new auth/tenancy code is authored once under
`@polytoken/*`); and **app-code enforcement as the PRIMARY tenancy boundary** (session-derived
`user_id`, never client-supplied) **with RLS as defense-in-depth** — because Drizzle deliberately
connects as the Postgres superuser (`client.ts:28-36`, the transaction-mode pooler broke
`auth.uid()`), RLS policies alone would be theater. That architecture decision must be recorded
explicitly at the tenancy phase before any policy is written.

The main risks are all "forgotten corner" shaped: client-supplied tenant IDs already exist in
production paths (the attachments download route has ZERO tenant scoping — any UUID works; the
knowledge-promote proxy takes `importerId` from the request body), the Terraform/CI naming for AWS
is two unsynced sources of truth with `force_delete=false` on ECR and local-only tfstate (rename
must NOT touch live AWS resource name strings), and Gmail UI-forwards strip the very
`In-Reply-To`/`References` headers naive threading depends on — fatal for an app whose core intake
IS forwarded mail, so a fallback tier must be designed in from the start.

## Key Findings

### Recommended Stack (STACK.md)

**Core technologies:**
- **Supabase Auth (GoTrue) + `@supabase/ssr`** (the ONE new npm dep): Google OAuth PKCE flow,
  cookie sessions in Next.js App Router; already enabled in `supabase/config.toml`;
  `@supabase/supabase-js` + `supabase-py` + transitively-resolved `PyJWT` already installed
- **RLS enforcement mechanics (zero new deps):** Drizzle — transaction wrapper with
  `set_config`/`SET LOCAL ROLE` over the POOLED url (new path beside the existing superuser
  client); FastAPI — request-scoped (never the `@lru_cache` singleton) `supabase-py` client with
  `.postgrest.auth(user_jwt)`, verified against postgrest-py source
- **Threading: hand-rolled Union-Find** over the already-populated RFC headers; `jwzthreading`
  (PyPI) is abandoned since 2010 and oversolves
- **Rename: zero-dependency Node script** — literal `@nauta/` → `@polytoken/` substring
  substitution (not ast-grep/jscodeshift); regenerate workspace symlinks after
  (`rm -rf node_modules && npm install`)

### Expected Features (FEATURES.md)

**Must have (table stakes):**
- Google sign-in page, session persistence, sign-out, minimal account surface
- Per-user isolation with existing data backfilled to the first real account (expand→backfill→contract)
- Thread grouping by RFC headers with subject-fallback handled conservatively
- Forwarding onboarding: unique unguessable secret-token address (Trello/Asana pattern — the
  secrecy IS the verification), routed via SES wildcard/catch-all; copy must explain Gmail's own
  destination-verification handshake (outside our control)

**Anti-scope-creep (explicitly out):** Gmail-API pull ingestion, org/team collaboration
primitives — architecturally distinct, not in the milestone brief.

### Architecture Approach (ARCHITECTURE.md)

Auth is an entirely new orthogonal layer in `apps/web` only; `require_api_key` stays untouched as
the service trust boundary. The user's JWT can be forwarded through the existing server-side proxy
seam when FastAPI needs identity.

**Major components:**
1. **Identity anchor:** `user_id` on `importers` itself — one join scopes the 7 hard-FK descendant
   tables with zero migration on them; `chat_conversations`/`chat_cost_ledger` get direct
   `user_id` columns; genui exact-match cache tables stay deliberately UNscoped (cross-tenant
   cache hits are the point)
2. **`ThreadResolver` domain port** mirroring the existing `ImporterResolver` precedent
   (`app/domain/ports/importer_resolver.py`), resolved at INGEST time, materialized into a real
   `threads` table (cheaper `emails.thread_id`-only fallback documented)
3. **Build order (settled):** rename → auth → tenancy → threads (threads technically independent,
   but shares the `emails` migration surface with tenancy — coordinate migration passes)

### Critical Pitfalls (PITFALLS.md — 15 total, top 5)

1. **RLS theater** — Drizzle superuser connection bypasses RLS permanently; record the explicit
   enforcement decision (app-boundary primary + RLS defense-in-depth) BEFORE policy work
2. **Client-supplied tenant IDs** — live gaps TODAY: `attachments/[id]/route.ts:44-49` (zero
   scoping), `promote/route.ts:21` (`importerId` from body), `emails.py:113-116` (query param);
   the route/procedure sweep with an adversarial cross-tenant test is worth MORE than the RLS
   policies and must be an explicit acceptance gate
3. **Terraform/CI naming drift** — `var.project` and the deploy workflow hardcode names
   independently; ECR `force_delete=false` makes naive renames FAIL `terraform apply`; tfstate is
   local-only. Rename phase does NOT touch live AWS resource name strings; infra rename is a
   separate user-runbook'd operation reviewed via `terraform plan`
4. **Forwarded mail breaks threading** — Gmail UI-forward strips RFC threading headers; budget a
   fallback tier + real Gmail-forward `.eml` fixtures from the start
5. **Rename surface beyond imports** — root `package.json` `-w @nauta/*` script selectors,
   `vercel.json` build command, Docker/CI references; npm symlink regeneration required

## Implications for Roadmap

Suggested phase structure (numbering continues from 41):

### Phase 42: Atomic Rename nauta → polytoken
**Rationale:** mechanical and lowest-risk first; all subsequent new code authored once under `@polytoken/*` ("rename once" guardrail)
**Delivers:** internal rename (packages, imports, scripts, vercel.json, CI YAML, docs, UI strings) + external-rename user runbook (GitHub repo, AWS/Terraform, Vercel project, domain) — live AWS name strings untouched
**Avoids:** Pitfalls 3 & 5 (Terraform destroy/recreate; workspace selector breakage)

### Phase 43: Auth — Google OAuth + Sessions (Supabase Auth)
**Rationale:** nothing else has an identity to scope against; tenancy backfill needs a first real user
**Delivers:** `@supabase/ssr` PKCE flow, sign-in/out UX, session in tRPC context (the documented "no-auth" seam), JWT-forwarding through the existing FastAPI proxy seam; live Google Cloud OAuth client creation user-runbook'd
**Uses:** STACK.md's settled auth pick

### Phase 44: Tenancy — user_id Scoping + Enforced Isolation
**Rationale:** depends on auth; the milestone's security payload
**Delivers:** `users`↔`importers` anchoring, direct `user_id` on chat tables, first-user backfill (expand→backfill→contract), session-derived-scoping sweep across ALL routes/procedures (kills client-supplied importer IDs, fixes the attachments route), RLS policies as defense-in-depth, adversarial cross-tenant test as acceptance gate; absorbs backlog 999.1
**Avoids:** Pitfalls 1 & 2

### Phase 45: Email Threads + Forwarding Seam
**Rationale:** technically independent of auth/tenancy but shares the `emails` migration surface — sequence after 44 to coordinate migrations
**Delivers:** `ThreadResolver` port + `threads` table + Union-Find grouping + backfill; forwarded-mail fallback tier with real Gmail-forward fixtures; unique secret-token forwarding address seam (SES wildcard) + onboarding runbook

### Phase 46: Kickoff Hygiene + v1.8 Brand & Design Dossier
**Rationale:** independent of the chain; hygiene (999.3 locally-feasible connected-env verifications, 999.2 folds) validates the substrate before v1.8 re-skins it; the dossier is v1.7's hand-off to v1.8 (run like v1.6's research ran during v1.5)
**Delivers:** verification evidence + brand-identity options + Claude/ChatGPT/Perplexity-class design-pattern dossier

### Phase Ordering Rationale

- rename → auth → tenancy is a hard dependency chain (identity before scoping; mechanical diff before new code)
- threads deferred behind tenancy only to coordinate the shared `emails` migration surface (FEATURES + ARCHITECTURE both flag this)
- hygiene + dossier are parallelizable with anything; scheduled last as the v1.8 bridge

### Research Flags

- **Phase 43 (auth):** check the Supabase project's JWT signing-key mode (legacy HS256 vs ES256) before implementing FastAPI verification
- **Phase 44 (tenancy):** record the RLS-enforcement architecture decision explicitly at plan time; full-retrofit-vs-user-owned-tables scope call
- **Phases 42/45:** standard patterns, skip deeper research (mechanical rename; well-understood threading algorithm)

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Official docs + repo evidence; JWT key mode MEDIUM (dashboard check needed) |
| Features | HIGH | OAuth/RLS/threading canonical sources; forwarding onboarding MEDIUM (pattern-matched, no single spec) |
| Architecture | HIGH | Every current-system claim file:line-cited; Supabase wiring MEDIUM (not yet proven in this repo) |
| Pitfalls | HIGH | 15/15 pitfalls carry repo evidence |

**Overall confidence:** HIGH

### Gaps to Address

- `threads` table vs `emails.thread_id` column: recommendation is the table (E3 sets up email-cluster workflow); confirm at phase planning
- Exact forwarding mode (Forward vs Redirect/Resend) changes which header-loss mode dominates — decide during Phase 45 planning
- ECR in-place rename support: check provider docs at runbook-writing time, not assumed

## Sources

### Primary (HIGH confidence)
- Direct repo reads (file:line cited throughout the four docs) — client.ts, mime_parser.py, emails schema, trpc.ts, migrations 0020/0026–0030, Terraform + CI YAML
- Supabase official docs (Auth/SSR/RLS), postgrest-py source, jwz.org threading algorithm, Gmail API docs

### Secondary (MEDIUM confidence)
- CVE-2025-48757 + 2025–2026 RLS-misconfiguration prevalence analyses
- Trello/Asana forwarding-address onboarding docs; Auth.js v5 beta status

---
*Research completed: 2026-07-09*
*Ready for roadmap: yes*
