# Architecture Research — v1.7 polytoken.ai Foundation Integration

**Domain:** Auth / tenancy / email-threading integration onto an existing dual-backend
(Next.js tRPC + FastAPI Clean Architecture) npm-workspaces monorepo sharing one Supabase
Postgres instance.
**Researched:** 2026-07-09
**Confidence:** HIGH for everything about the *current* codebase (all claims below are grounded
in direct reads of the files cited — no guessing about what exists today). MEDIUM for the
*new* Supabase-Auth/RLS wiring recommendation (WebSearch-verified against current official
Supabase docs, not yet proven against this specific repo).

This is a **subsequent-milestone integration** doc, not a greenfield "pick a stack" doc — the
stack, the layering, and most of the naming conventions are fixed by ~40 already-shipped
phases. The job here is to say exactly where four new capabilities attach to that existing
system, in dependency order.

---

## 0. Current State (the substrate v1.7 attaches to)

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Browser                                                                       │
│   /chat /emails /entities /knowledge /studio  (Next.js App Router, client)   │
└───────────────────────────────┬────────────────────────────────────────────-┘
                                 │ same-origin fetch only — browser NEVER calls
                                 │ FastAPI directly (verified: EMAIL_LISTENER_URL /
                                 │ EMAIL_LISTENER_API_KEY are read ONLY inside
                                 │ server-side files)
┌───────────────────────────────▼────────────────────────────────────────────-┐
│ apps/web (Next.js, deploys to Vercel)                                        │
│                                                                               │
│  ┌─────────────────────────────┐   ┌───────────────────────────────────┐    │
│  │ tRPC (packages/api-client)   │   │ Plain Route Handlers (streaming)   │    │
│  │ createTRPCContext = {        │   │ app/api/chat/stream/route.ts       │    │
│  │   headers, db  }  <-- LITERALLY   │ app/api/chat/regenerate/route.ts   │    │
│  │  "no-auth" per trpc.ts       │   │ app/api/chat/widget/submit/...     │    │
│  │  docstring today             │   │ app/api/knowledge/edges/.../promote│    │
│  └──────────────┬───────────────┘   └────────────────┬────────────────-┘    │
│                 │ Drizzle, connects as postgres        │ fetch() + X-API-Key  │
│                 │ (bypasses RLS by design)              │ (EMAIL_LISTENER_API_ │
│                 ▼                                       │  KEY, server-only)   │
└─────────────────┼───────────────────────────────────────┼───────────────────┘
                   │                                       ▼
                   │                        ┌───────────────────────────────────┐
                   │                        │ apps/email-listener (FastAPI)      │
                   │                        │ 4-layer Clean Architecture         │
                   │                        │ EVERY router except sns_inbound/   │
                   │                        │ health: Depends(require_api_key)   │
                   │                        │ (fail-closed outside dev)          │
                   │                        │ connects to Supabase as            │
                   │                        │ service-role (bypasses RLS)        │
                   │                        └────────────────┬──────────────────┘
                   ▼                                          ▼
        ┌──────────────────────────────────────────────────────────────┐
        │ Supabase Postgres (packages/db owns schema + all migrations) │
        │ RLS today: ENABLE ROW LEVEL SECURITY + RESTRICTIVE deny-all  │
        │ for anon/authenticated on every app table (0001, 0020...).   │
        │ service_role/postgres bypass RLS — i.e. BOTH backends bypass │
        │ RLS today. RLS currently has zero enforcement value; it only │
        │ blocks a hypothetical direct anon/authenticated client.      │
        └────────────────────────────────────────────────────────────-┘
```

**The load-bearing fact for Q1:** there is already a clean BFF (backend-for-frontend)
topology. The browser only ever talks to `apps/web`. `apps/web` is the ONLY holder of
`EMAIL_LISTENER_API_KEY` (`packages/api-client/src/router/_listener-config.ts`,
`apps/web/src/app/api/chat/stream/route.ts` — both read it server-side, never
`NEXT_PUBLIC_`). `require_api_key` (`apps/email-listener/app/presentation/middleware/auth.py`)
protects **every** FastAPI router that isn't `sns_inbound.py` (SNS-signed) or `health.py`. This
key is a **service-to-service** trust boundary, not a user boundary, and today the tRPC layer
has **no** user boundary at all — `createTRPCContext` (`packages/api-client/src/trpc.ts`)
literally only carries `{ headers, db }`.

### Tenant partitioning today: `importer_id`, not auth

`importer_id` (FK → `importers.id`) is the only partitioning concept that exists. Full
inventory (grep-verified across `packages/db/src/schema/*.ts`):

| Scoping shape | Tables |
|---|---|
| `importer_id uuid NOT NULL` FK, `onDelete: cascade` | `attachments`, `components`, `emails`, `entity_instances`, `sender_profiles`, `knowledge_nodes`, `extraction_records` |
| `importer_id uuid` FK, **nullable** (NULL = system-default/shared) | `entity_types`, `entity_type_fields` |
| `importer_id uuid`, plain column, **no FK**, nullable | `chat_conversations`, `genui_generation_events`, `ui_spec_templates`, `autofill_retrieval_events` |
| `importer_id uuid`, plain column, **no FK**, NOT NULL | `chat_cost_ledger` |
| No `importer_id` column — scope derived by join to a parent | `chat_messages` (→ `conversation_id`), `chat_runs` (→ `conversation_id`), `chat_run_events` (→ `run_id`), `chat_widget_interactions` (→ `conversation_id`/`message_id`), `chat_canvas_layouts` (→ `conversation_id`, 1:1), `component_links` (→ component), `knowledge_node_edges` (→ `source_node_id` → `knowledge_nodes.importer_id`) |
| Global, unscoped by design | `importers` itself |

The single-tenant installation runs entirely on one seeded row,
`00000000-0000-0000-0000-000000000001` (`packages/db/migrations/0005_seed_default_importer.sql`),
and `DEFAULT_IMPORTER_ID` is duplicated as a literal constant in **three** places:
`apps/email-listener/app/settings.py`, `packages/api-client/src/router/chat/browser-turn.ts`,
and implicitly via `RunChatTurn(default_importer_id=settings.DEFAULT_IMPORTER_ID, ...)` in
`apps/email-listener/app/container.py`. Nothing in the chat streaming path
(`chat_stream.py`'s `ChatStreamRequest` Pydantic model) even accepts an `importer_id` field
today — the whole chat/genui/knowledge surface is implicitly single-tenant.

Two read-side procedures already treat `importerId` as an **optional client-supplied filter**,
with a comment that is effectively a standing TODO for this exact milestone:
`packages/api-client/src/router/entities/gallery.ts:33` and
`packages/api-client/src/router/knowledge/list.ts:24` — *"D-12: importerId is an optional data
filter applied via `eq()` — never a session/header claim."* Tenancy work converts exactly this:
optional/client-supplied → mandatory/session-derived.

### Ingestion pipeline precedent that Q3 mirrors

`apps/email-listener/app/domain/ports/importer_resolver.py` is a one-method `Protocol`
(`resolve(sender_address) -> importer_id`, find-or-create, malformed input falls back to a
configured default, never hard-fails ingestion). It is injected into
`IngestInboundEmailUseCase.__init__` (`app/application/use_cases/ingest_inbound_email.py`) and
called once at the top of `.execute()`, before the `Email` entity is built. The `Email` domain
entity (`app/domain/entities/email.py`) already carries `in_reply_to: str | None` and
`references_ids: tuple[str, ...]` (RFC 5322 threading headers), populated by `parse_mime` and
already flowing into every ingested row — nothing derives a `thread_id` from them yet. This is
the exact shape a `ThreadResolver` needs to reuse.

---

## 1. Q1 — Where the auth/session boundary lives

**Recommendation: two independent, orthogonal boundaries, one new, one untouched.**

1. **Browser ↔ `apps/web`** (NEW): a real user session, via **Supabase Auth** (GoTrue) with
   Google as the configured OAuth provider — not a bespoke NextAuth/custom-JWT stack. This is
   the only choice that makes "Supabase RLS actually enforced" a coherent goal at all, since RLS
   policies read `auth.uid()` off a Supabase-issued JWT; a non-Supabase auth provider would
   leave `auth.uid()` NULL for every request and RLS would have nothing to key off. Confirmed
   `@supabase/supabase-js` is **already** an `apps/web` dependency
   (`apps/web/package.json:25`) but is unused today — no `@supabase/ssr`, no `middleware.ts`, no
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` anywhere in `.env.example`.
   - Package: `@supabase/ssr` (current, non-deprecated — `@supabase/auth-helpers-nextjs` is in
     maintenance-only mode per Supabase's own docs). MEDIUM confidence, WebSearch-verified against
     `supabase.com/docs/guides/auth/server-side/nextjs`.
   - New files: `apps/web/middleware.ts` (refreshes the session cookie on every request — Server
     Components can't write cookies, so this is required, not optional), `apps/web/src/lib/
     supabase/server.ts` (`createServerClient`, used in Server Components, Route Handlers, and
     the tRPC context factory), `apps/web/src/lib/supabase/client.ts` (`createBrowserClient`, used
     only by the sign-in button), `apps/web/src/app/auth/callback/route.ts` (PKCE code exchange
     after the Google redirect — `exchangeCodeForSession`).
   - Google Cloud OAuth **client creation** (Cloud Console → OAuth consent screen → credentials)
     is a manual, external, one-time step — matches PROJECT.md's own framing exactly ("live OAuth
     client creation in Google Cloud documented for the user"). Supabase's Auth dashboard (Auth →
     Providers → Google) is where the client id/secret are pasted; `apps/web` itself needs no
     Google-specific env vars, only `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     (new — `.env.example` currently only has server-side `SUPABASE_URL`/`SUPABASE_SECRET_KEY`,
     apps/email-listener's shape, not apps/web's).
   - tRPC context (`packages/api-client/src/trpc.ts`): `createTRPCContext` gains a `session`/`user`
     field, resolved server-side in `apps/web/src/app/api/trpc/[trpc]/route.ts` via the new
     `lib/supabase/server.ts` client before calling `appRouter`. A new `protectedProcedure` (tRPC
     middleware throwing `UNAUTHORIZED` when `ctx.session` is null — the standard tRPC-recommended
     pattern) is added alongside the existing `publicProcedure`; existing procedures migrate to it
     during the tenancy phase (see §4), not the auth phase — auth's own scope is "sign-in works,
     a session exists," not "every procedure is now gated."
   - A `profiles` (or `users`) mirror table is needed — Supabase's own convention is *not* to FK
     application tables directly at `auth.users` (a Supabase-managed schema whose shape isn't an
     app-owned contract) but at a `public.profiles` row with
     `id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE`, populated by a Postgres
     trigger on `auth.users` INSERT. New file: `packages/db/src/schema/users.ts` (Drizzle can't
     express the trigger — it goes in a custom-SQL migration, same idiom already used for the
     `moddatetime` trigger on `knowledge_nodes.updated_at` and the HNSW indexes drizzle-kit can't
     emit). MEDIUM confidence — well-documented Supabase pattern, not yet proven in this repo.

2. **`apps/web` ↔ `apps/email-listener`** (UNCHANGED): `require_api_key`
   (`apps/email-listener/app/presentation/middleware/auth.py`) stays exactly as it is. It is a
   service-to-service trust boundary — only `apps/web`'s server holds
   `EMAIL_LISTENER_API_KEY` — and it should **not** be replaced or weakened by user auth. The two
   boundaries answer different questions at different hops of the same request: "is this caller
   our trusted Next.js server" (X-API-Key, existing) vs. "which end user initiated this" (Supabase
   session, new, Next.js-side only).
   - Concretely: FastAPI never independently validates a Supabase JWT. Once the caller has
     already proven it's the trusted Next.js server (X-API-Key), FastAPI **trusts the `user_id`
     that server asserts** in the request body — a "trusted subject assertion," the same shape
     `importer_id` already uses today (nothing FastAPI-side re-derives `importer_id` from a
     header; it's either resolved from `sender_address` at ingest time via `ImporterResolver`, or
     passed explicitly by the caller). Concretely this means adding a required `user_id: str`
     field to Pydantic request models on every FastAPI route the Next.js server proxies —
     `ChatStreamRequest`/`ChatRegenerateRequest` in `chat_stream.py`, the widget-submit request in
     `chat_widget.py`, the promote-edge request in `knowledge_edges.py` — and threading it through
     `RunChatTurn`/`SubmitWidgetInteraction`'s constructors/call signatures the same way
     `importer_id` is threaded today (`container.py`'s `_provide_run_chat_turn` factory).
   - `sns_inbound.py` (raw SES/SNS webhook, SNS-signature-authenticated, no `require_api_key`) is
     untouched by any of this — no end user is in that request path; identity there stays
     `ImporterResolver`-based (see §3's note connecting importer resolution to user resolution).

**Anti-pattern to avoid:** do not let the browser call FastAPI directly "for simplicity" once
OAuth exists. The existing BFF topology (proxy-everything-through-Next.js) is what makes
`EMAIL_LISTENER_API_KEY` safe to keep as a single shared secret; a direct browser→FastAPI path
would force re-deriving user identity independently in Python (a second, divergent session
implementation) for zero benefit.

---

## 2. Q2 — How `user_id` flows into existing tables

**Core decision: `user_id` becomes the primary tenant boundary; `importer_id` becomes a
secondary partition scoped *within* a user, not a competing concept.** PROJECT.md is explicit
that 999.1's per-importer *authorization* idea is superseded, becoming per-user scoping — but
`importer_id`'s other job (partitioning ingested email by forwarding-sender/organization) is
orthogonal and shouldn't be conflated or removed.

### 2.1 Anchor: add `user_id` to `importers`, not to every FK'd table

Add `user_id uuid NOT NULL REFERENCES public.profiles(id)` directly to the `importers` table
(`packages/db/src/schema/importers.ts`). This is the cheapest correct change because it makes
**every** table that already has `importer_id uuid NOT NULL FK` (the first row of the §0
inventory — `attachments`, `components`, `emails`, `entity_instances`, `sender_profiles`,
`knowledge_nodes`, `extraction_records`) transitively user-scoped through one join, with **zero**
migration on those tables themselves. RLS policies on them upgrade from today's blanket
`RESTRICTIVE ... USING (false)` to:

```sql
CREATE POLICY "user_scoped_emails" ON "emails"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM importers WHERE importers.id = emails.importer_id
      AND importers.user_id = auth.uid()
  ));
```

`entity_types`/`entity_type_fields` (nullable `importer_id`, NULL = system-default) need no
change beyond the same join for authorization purposes — a taxonomy override is a
data-shape concept tied to how one importer's mail is structured, not to who's logged in; system
defaults (`importer_id IS NULL`) stay globally readable by every authenticated user, which is
correct (they're shared seed data, not per-tenant secrets).

`knowledge_node_edges` (no `importer_id` column at all — scope derived via
`source_node_id → knowledge_nodes.importer_id`) gets the same two-hop join treatment; no new
column needed, consistent with its existing join-derived, unconstrained-`target_ref_id` design.

### 2.2 Tables that need their *own* `user_id` column

The nullable/no-FK-`importer_id` tables were **deliberately** built loose (their own doc
comments call this out — "mirrors the genui_generation_events idiom" — because these are
audit/analytics/cache rows, not hard tenant data). Treat them individually, not uniformly:

- **`chat_conversations`** — add `user_id uuid NOT NULL REFERENCES public.profiles(id)`
  directly (not derived). A conversation is inherently per-user (chat history), and its
  `importer_id` is already optional/soft — deriving user scope through it would be backwards.
  `chat_messages`, `chat_runs`, `chat_run_events`, `chat_widget_interactions`,
  `chat_canvas_layouts` keep deriving scope via `conversation_id`/`run_id` joins exactly as they
  do for every other concern today (no new columns — avoids denormalization drift, consistent
  with the codebase's existing "scope lives on the owning row, not copied onto children" pattern).
- **`chat_cost_ledger`** — add `user_id` directly (cheap column, avoids a join in the
  `CostCircuitBreaker`'s hot per-turn/session/day-cap read path,
  `app/domain/services/cost_circuit_breaker.py`) — and because per-user budget caps are a
  realistic near-future feature once this is multi-tenant, distinct from today's global
  `COST_CAP_PER_*_USD` settings.
- **`genui_generation_events`, `ui_spec_templates`, `autofill_retrieval_events`** — leave
  loose/optional as today. These are best-effort audit + an **exact-match cache** keyed by
  content hash (`ui_spec_templates.cache_key`) — forcing hard `user_id` scoping onto the cache
  would destroy a real feature (identical-intent cache hits across users/tenants), not just add
  overhead. This is the concrete answer to "which tables must be scoped vs. stay global": cache
  and audit tables stay optionally-tagged, not tenant-locked.

### 2.3 Backfill

There is no user yet at migration-apply time — `user_id NOT NULL` on `importers` can't be added
in one step. Two-phase: (1) add the column nullable, ship auth first (§4 ordering), (2) a
one-time **claim** step where the first successful Google sign-in claims the existing default
importer (`00000000-0000-0000-0000-000000000001`) if it is still unclaimed — a small
`application/use_cases`-level operation (or an idempotent `packages/db/scripts/` one-off script,
matching the existing `retrieval-miss-rate.ts`/`verify-0029-live.ts` idiom) — then a follow-up
migration adds `NOT NULL`. Same two-phase shape for `chat_conversations.user_id` /
`chat_cost_ledger.user_id` (backfill to the claiming user).

### 2.4 New tables going forward

Per VISION.md's irreversibility guardrail #1 ("keep user_id/tenant scoping columns on new tables
from E2 onward... no cross-tenant PK schemes"): every table created in v1.7+ gets
`user_id uuid NOT NULL REFERENCES public.profiles(id)` from day one, mirroring the `importer_id`
idiom exactly but promoted to the primary scope key.

---

## 3. Q3 — Where the thread model fits in the Clean Architecture pipeline

**Recommendation: ingest-time resolution, mirroring `ImporterResolver` exactly, materialized
into a real (thin) `threads` table — not read-time grouping.**

### Why ingest-time, not read-time

- **Precedent match.** `ImporterResolver` is the *identical* shape of problem (derive a
  parent-scope id from message content, find-or-create, inject via the same constructor slot)
  already solved once in this codebase. A `ThreadResolver` port that mirrors it exactly is the
  lowest-risk, most idiomatic path — not a new pattern to review and defend.
- **SNS redelivery idempotency already assumes write-time resolution.**
  `IngestInboundEmailUseCase.execute()` already keys off `find_by_message_id(importer_id,
  message_id)` for idempotent redelivery; a stored `thread_id` column makes redelivery
  idempotent for threading too (same email redelivered → same `thread_id`, no recomputation).
  Read-time derivation (grouping by `references_ids` chains at query time) would need a
  recursive/window query over the **whole** `emails` table on every list read, duplicated across
  both backends (FastAPI review UI + any future web read) — expensive and inconsistent with the
  project's established "materialize at write time, read cheaply" bias (the identical tradeoff
  v1.5 already made explicitly: "confirming a region materializes `knowledge_nodes` +
  `knowledge_node_edges`... rather than deriving at read time").
- **Must be scoped within one importer.** Thread matching has to search only within the same
  `importer_id`'s emails — matching across different importers on a coincidentally-repeated
  `Message-ID` would be a cross-tenant leak. This means `ThreadResolver.resolve()` needs
  `importer_id` as an input and must be called **after** `ImporterResolver.resolve()` in the same
  `execute()` method, not before or in parallel.

### Concrete shape

- **New port:** `apps/email-listener/app/domain/ports/thread_resolver.py` — one-method
  `Protocol`, structurally identical to `importer_resolver.py`:
  ```python
  class ThreadResolver(Protocol):
      async def resolve(
          self, importer_id: str, in_reply_to: str | None,
          references_ids: tuple[str, ...], subject: str | None,
      ) -> str: ...
  ```
  Find-or-create by RFC 5322 semantics: look up any existing email (within `importer_id`) whose
  `message_id` appears in this email's `references_ids`/`in_reply_to`; adopt that email's
  `thread_id` if found, else mint a new UUID (this email becomes the thread's root). Malformed/
  missing headers never fail ingestion — fall back to a fresh thread, same fail-open posture as
  `ImporterResolver`'s malformed-sender fallback.
- **New table (recommended over a bare column):** `threads` — `id`, `importer_id` FK NOT NULL
  (cascade, same idiom as every other hard-scoped table), `subject` (snapshot from the root
  email), `root_email_id`, `last_message_at` (denormalized, avoids a `GROUP BY`/`MAX` over
  `emails` on every thread-list read), `created_at`/`updated_at`. A real table (not just a bare
  UUID column with no owning row) is worth the small extra cost here because E3
  ("Email-Cluster Workflow" — VISION.md) explicitly wants thread cards on the canvas and
  chat-panels bound to a thread's context; those need a stable joinable PK to attach to, not a
  scattered UUID. This mirrors exactly how `importers` itself grew from "just a partition key"
  into a real table because it needed independent attributes.
  *Cheaper fallback if the roadmapper wants to descope v1.7's thread work to the bare minimum:*
  skip the table, add `emails.thread_id uuid NOT NULL` only, and treat "thread" as purely the set
  of emails sharing that UUID (root computed at read time by `MIN(received_at)` — cheap only
  because per-thread cardinality is small). This loses the E3 attachment points and denormalized
  `last_message_at`, so it is not the primary recommendation, just a legitimate lighter option.
- **Modified:** `apps/email-listener/app/domain/entities/email.py` gains `thread_id: str`.
  `apps/email-listener/app/application/use_cases/ingest_inbound_email.py`'s
  `IngestInboundEmailUseCase.__init__` gains a `thread_resolver: ThreadResolver` param; `.execute()`
  calls it immediately after `importer_id = await self._importer_resolver.resolve(...)` and
  stitches the result onto the `Email(...)` construction. `packages/db/src/schema/emails.ts`
  gains `threadId: uuid("thread_id").notNull().references(() => Threads.id)`.
- **New infrastructure adapter:** `apps/email-listener/app/infrastructure/supabase/
  thread_repository.py` (mirrors `importer_repository.py`'s find-or-create-against-Supabase
  shape), wired in `container.py` next to `_provide_importer_resolver` /
  `provider.provide(_provide_importer_resolver, provides=ImporterResolver)`, and added as a new
  constructor param on the `_provide_ingest_use_case` factory.
- **Migration:** new table + `emails.thread_id`. Because existing rows have no thread yet, this
  is a two-step migration like the `user_id` backfill in §2.3: add `thread_id` nullable, run a
  one-time backfill script (`packages/db/scripts/`, same idiom as `retrieval-miss-rate.ts`) that
  walks existing `emails` ordered by `received_at` and applies the identical find-or-create logic
  the live `ThreadResolver` will use, then a follow-up migration adds `NOT NULL` + the FK.
- **RLS:** `threads` gets the same deny-all → `auth.uid()`-via-`importers`-join policy as every
  other importer-scoped table (§2.1's pattern, one more join hop).

**Anti-pattern to avoid:** do not build thread grouping as a tRPC/web-layer concern (e.g. a
`groupBy` in `packages/api-client`). Threading is an ingestion-pipeline concept that both
backends need consistently (the FastAPI review UI and any future web read), and computing it
once at write time in Python is the only way both consumers see the same answer without
duplicating the RFC 5322 matching logic in TypeScript too.

---

## 4. Q4 — Dependency-ordered build order

```
Phase A: RENAME (nauta -> polytoken)
         │  mechanical, zero DB/runtime state touched, must be FIRST
         │  so every subsequent v1.7 file is born correctly named
         ▼
Phase B: AUTH (Google OAuth + Supabase sessions)
         │  produces: auth.users rows, profiles table, working sign-in,
         │  tRPC ctx.session, protectedProcedure — NOT yet any user_id
         │  columns on domain tables
         ▼
Phase C: TENANCY (user_id scoping + RLS enforcement)
         │  HARD dependency on B: cannot backfill importers.user_id or
         │  write auth.uid()-keyed RLS policies without real users existing
         ▼
   (Phase D: THREADS can run independently/in parallel with B+C —
    see below; sequenced last here only for authoring-consistency,
    not a technical dependency)
```

1. **Rename first — hard ordering constraint, not just tidiness.** 246 files reference
   `@nauta/` (grep count across `*.ts`/`*.tsx`/`*.json`, excluding `node_modules`/`.next`), 6
   `package.json` files declare `@nauta/*` scopes, the root `package.json`'s own `name` and every
   `npm run ... -w @nauta/*` script alias, and UI strings all need the same mechanical rewrite.
   VISION.md's own guardrail #5 is explicit: *"Rename once — no partial polytoken/nauta hybrid
   states... E2 does it atomically."* Doing it first means auth/tenancy/thread files are authored
   under the final name and never touched again for renaming — doing it last (or interleaved)
   means re-touching every new v1.7 file a second time. No dependency on anything else; isolated,
   revertible, should be its own phase with nothing else changed alongside it.
   - **Do not conflate with rename scope:** `entity_instances.nautaId`/`nautaId` (`entity-
     instances.ts:48`, doc comment: *"Stable Nauta record ID"*) refers to an **external upstream
     system's** record identifier that entities were synced from — semantically unrelated to this
     repo's own package/brand name. Renaming `@nauta/*` package scopes must not touch this column.
   - **Explicitly out of scope for the autonomous rename** (per PROJECT.md, confirmed against
     `infrastructure/aws/ecs.tf`'s ECR repo name `email_listener`, S3 bucket
     `nauta-services-ses-inbound-emails` — stateful external AWS resources): GitHub repo name, AWS
     resource names, Vercel project name, domain purchase/DNS — these become a **user runbook**,
     not code changes, because renaming a live S3 bucket/ECR repo/ALB is a genuinely risky,
     stateful operation distinct from a code-level find/replace.

2. **Auth before tenancy — hard dependency, not preference.** Tenancy's deliverable is `user_id`
   scoping + RLS keyed on `auth.uid()`. Both are impossible without (a) `auth.users` actually
   having rows, (b) a `profiles` table to FK against, and (c) a real signed-in user to run the
   `importers.user_id` backfill against (§2.3). Auth's own phase boundary stops at "sign-in works,
   a session exists in `ctx.session`, `protectedProcedure` exists" — it deliberately does **not**
   yet touch `importer_id`/tenant columns on any domain table; that is entirely tenancy's job.
   This split keeps auth independently testable/shippable (can verify Google sign-in end-to-end
   with zero data-model risk) before the wider, harder-to-revert tenancy migration begins.

3. **Tenancy consumes auth's output.** Concrete tasks, in the dependency order §2 implies: (a)
   `importers.user_id` nullable column + migration, (b) claim-default-importer backfill step, (c)
   `NOT NULL` follow-up migration, (d) same nullable→backfill→`NOT NULL` two-step for
   `chat_conversations.user_id` / `chat_cost_ledger.user_id`, (e) RLS policy rewrite (deny-all →
   `auth.uid()`-via-join) across every table in §2's inventory, (f) `packages/api-client`
   procedures upgraded from optional client-supplied `importerId` filters
   (`entities/gallery.ts`, `knowledge/list.ts`) to `protectedProcedure`-derived mandatory
   `ctx.session.userId` filters, (g) FastAPI Pydantic models (`ChatStreamRequest` et al.) gain a
   required `user_id` field threaded through `RunChatTurn`/`SubmitWidgetInteraction` the same way
   `container.py` already threads `importer_id` today.

4. **Threads — no technical dependency on auth or tenancy.** The `ThreadResolver`/`threads`
   integration point is entirely inside the Python ingestion pipeline and is scoped by
   `importer_id`, which already exists today independent of whether Google OAuth has landed. It
   can genuinely run in parallel with phases B/C (a Python-only workstream with zero overlap with
   the Next.js auth/tenancy files) if throughput matters — this repo's own recent milestones
   (v1.5/v1.6, per project history) have used parallel autonomous background agents successfully
   for exactly this kind of non-overlapping split. The only reason to sequence it *after* tenancy
   rather than in true parallel is consistency of authorship: the `threads` table's RLS policy and
   migration idiom should match whatever pattern phase C establishes, so writing it after C avoids
   a second, possibly-inconsistent draft of "how do we RLS-scope a new importer-owned table."
   Recommendation: parallelize if capacity allows, else sequence last.

5. **Orthogonal, unblocked by all of the above:** kickoff hygiene (999.3 locally-feasible
   connected-env verifications, 999.2 pytest/grid folds) and the v1.8 brand/design research
   dossier — both explicitly framed in PROJECT.md/VISION.md as parallel tracks with no code
   dependency on rename/auth/tenancy/threads.

---

## Patterns to Follow

### Pattern 1: Trusted-subject assertion across a service boundary

**What:** A downstream service (FastAPI) that already authenticates its caller as "the trusted
Next.js server" (via a shared secret) does **not** re-validate end-user identity independently —
it accepts a `user_id`/`importer_id` field the caller asserts in the request body as ground
truth, because the channel itself is the trust boundary.
**When:** Any BFF topology where the browser never talks to the backend service directly.
**Trade-off:** Simpler (no JWT-verification code duplicated in Python, no second session
implementation) but means a compromised Next.js server can impersonate any user to FastAPI —
acceptable here because that server already holds the one shared secret guarding every FastAPI
write anyway; it is not a new trust expansion.

### Pattern 2: Find-or-create resolver at ingest time, injected via the same DI slot

**What:** `Protocol` with one `resolve(...)` method, an infrastructure adapter querying Supabase,
wired in `container.py`, invoked once near the top of a use case's `.execute()`, result stitched
onto the frozen dataclass entity before persistence.
**When:** Any "derive a parent-scope id from message content, cheaply, once, idempotently under
redelivery" problem — `ImporterResolver` today, `ThreadResolver` in v1.7, generalizable to future
resolvers (e.g. a per-user forwarding-address resolver for the "own-email forwarding" feature).
**Trade-off:** Pays resolution cost once at write time instead of on every read; requires a
two-step nullable→backfill→`NOT NULL` migration when applied retroactively to existing rows.

### Pattern 3: Anchor tenant ownership at the parent table, not every child

**What:** Add `user_id` to `importers` (one row) rather than to every table that already has a
hard `importer_id` FK — every descendant becomes user-scoped through one join, zero migrations
on the descendants.
**When:** Whenever a NEW scope dimension (user) is layered on top of an EXISTING hard scope
dimension (importer) that every relevant table already references.
**Trade-off:** RLS policies on descendant tables need one extra `EXISTS (...)` join hop instead
of a flat `= auth.uid()`; negligible cost given existing importer-scoped indexes.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Re-validating a Supabase JWT inside FastAPI

**What people might do:** forward the browser's Supabase access token all the way to FastAPI and
verify it there, in addition to `X-API-Key`.
**Why it's wrong:** duplicates session-verification logic in a second language/runtime, doubles
the places a session bug can hide, and the browser never talks to FastAPI anyway (§1) — there is
no request path where FastAPI would ever see a raw user JWT that Next.js hasn't already validated.
**Instead:** trusted-subject assertion (Pattern 1) — `X-API-Key` stays the only FastAPI-facing
credential; `user_id` rides inside the already-authenticated body.

### Anti-Pattern 2: Scoping the exact-match generation cache by user

**What people might do:** add `user_id NOT NULL` to `ui_spec_templates`/`genui_generation_events`
"for consistency" with every other table.
**Why it's wrong:** `ui_spec_templates.cache_key` is a content-addressed exact-match cache
(`SHA-256(canonical_intent ‖ data_shape_hash ‖ registry_version ‖ context)`) — two different
users issuing the identical intent against the identical data shape *should* share a cache hit;
hard-scoping it by user silently kills that flywheel with no compensating benefit (it's an
audit/cache table, not tenant data).
**Instead:** leave these tables' `importer_id`/`user_id` optional, exactly as documented today.

### Anti-Pattern 3: Deriving threads at read time via a `references_ids` scan

**What people might do:** compute thread grouping on the fly in a tRPC procedure or the FastAPI
review-UI query, since the raw headers already exist on every `emails` row.
**Why it's wrong:** duplicates RFC 5322 matching logic across two backends/languages, costs a
recursive/window query on every list read instead of once at ingest, and breaks the "materialize
at write time" precedent this project already established for knowledge-graph edges (v1.5).
**Instead:** ingest-time `ThreadResolver`, materialized `thread_id` (Q3).

---

## Integration Points

### Internal Boundaries (file/dir-level)

| Boundary | Integration | New / Modified |
|---|---|---|
| Browser ↔ `apps/web` | `apps/web/middleware.ts`, `apps/web/src/lib/supabase/{server,client}.ts`, `apps/web/src/app/auth/callback/route.ts` | **New** |
| `apps/web`'s tRPC context | `packages/api-client/src/trpc.ts` — `createTRPCContext` gains `session`; new `protectedProcedure` | **Modified** |
| `apps/web` route handler wrapping the router | `apps/web/src/app/api/trpc/[trpc]/route.ts` — `createContext` resolves the Supabase server client | **Modified** |
| Read-side tRPC procedures | `packages/api-client/src/router/entities/gallery.ts`, `.../knowledge/list.ts` — optional `importerId` filter → mandatory `ctx.session`-derived filter | **Modified** |
| Streaming/proxy Route Handlers | `apps/web/src/app/api/chat/stream/route.ts`, `.../chat/regenerate/route.ts`, `.../chat/widget/submit/route.ts`, `.../knowledge/edges/[edgeId]/promote/route.ts` — add `user_id` to the forwarded body | **Modified** |
| `apps/web` ↔ `apps/email-listener` | `require_api_key` (`apps/email-listener/app/presentation/middleware/auth.py`) | **Unchanged** |
| FastAPI request models | `apps/email-listener/app/presentation/api/v1/chat_stream.py` (`ChatStreamRequest`/`ChatRegenerateRequest`), `chat_widget.py`, `knowledge_edges.py` — add `user_id: str` | **Modified** |
| Chat turn orchestration | `apps/email-listener/app/application/use_cases/run_chat_turn.py`, `apps/email-listener/app/container.py`'s `_provide_run_chat_turn` — `importer_id` becomes per-call, not `settings.DEFAULT_IMPORTER_ID`-only | **Modified** |
| Ingestion pipeline (threads) | `apps/email-listener/app/domain/ports/thread_resolver.py` (new port, mirrors `importer_resolver.py`), `apps/email-listener/app/infrastructure/supabase/thread_repository.py` (new adapter), `apps/email-listener/app/application/use_cases/ingest_inbound_email.py` (modified — new ctor param + `.execute()` call site), `apps/email-listener/app/domain/entities/email.py` (modified — `thread_id` field) | **New + Modified** |
| DI wiring | `apps/email-listener/app/container.py` — new `_provide_thread_resolver` next to `_provide_importer_resolver`; `_provide_ingest_use_case` gains the param | **Modified** |
| Schema — tenancy anchor | `packages/db/src/schema/importers.ts` (add `user_id`), `packages/db/src/schema/users.ts` (new `profiles` table + trigger, custom-SQL migration) | **New + Modified** |
| Schema — direct-scoped tables | `packages/db/src/schema/chat-conversations.ts`, `chat-cost-ledger.ts` (add `user_id`) | **Modified** |
| Schema — threads | `packages/db/src/schema/threads.ts` (new), `packages/db/src/schema/emails.ts` (add `thread_id`) | **New + Modified** |
| RLS policies | `packages/db/migrations/00XX_*.sql` — rewrite every `deny_all_*` RESTRICTIVE policy (pattern set in `0001_rls_deny_all.sql`, `0020_knowledge_node_edges_rls.sql`) to `auth.uid()`-via-`importers`-join PERMISSIVE policies | **Modified** |
| Backfill scripts | `packages/db/scripts/` — claim-default-importer, email→thread backfill (mirror `retrieval-miss-rate.ts`/`verify-0029-live.ts` idiom) | **New** |
| Rename | `@nauta/*` → `@polytoken/*` across 6 `package.json` files + ~246 referencing files; root `package.json` `name` + `-w @nauta/*` script aliases | **Modified (repo-wide, mechanical)** |

### External Services

| Service | Integration Pattern | Notes |
|---|---|---|
| Supabase Auth (GoTrue) | `@supabase/ssr` server/browser clients + Google as a configured Auth provider (Supabase dashboard, not app code) | Google Cloud OAuth client creation itself is a manual user step (matches PROJECT.md's stated scope) |
| Google Cloud OAuth | Consent screen + credentials, pasted into Supabase Auth → Providers → Google | User runbook, not autonomous |
| Vercel (apps/web hosting) | New env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.example` currently has neither — only server-side `SUPABASE_URL`/`SUPABASE_SECRET_KEY` (the FastAPI-shaped vars) |

---

## Sources

- Direct codebase reads (HIGH confidence, cited inline by path throughout): `.planning/PROJECT.md`,
  `.planning/research/polytoken-vision/VISION.md`, `packages/db/src/schema/*.ts`,
  `packages/db/migrations/0001_rls_deny_all.sql`, `0005_seed_default_importer.sql`,
  `0020_knowledge_node_edges_rls.sql`, `packages/api-client/src/trpc.ts`, `root.ts`,
  `_listener-config.ts`, `router/chat/browser-turn.ts`, `router/entities/gallery.ts`,
  `router/knowledge/list.ts`, `apps/web/src/app/api/trpc/[trpc]/route.ts`,
  `apps/web/src/app/api/chat/stream/route.ts`, `apps/web/package.json`, root `package.json`,
  `apps/email-listener/app/main.py`, `container.py`, `settings.py`,
  `app/presentation/middleware/auth.py`, `app/presentation/api/v1/chat_stream.py`,
  `app/domain/entities/email.py`, `inbound_email.py`, `app/domain/ports/importer_resolver.py`,
  `app/application/use_cases/ingest_inbound_email.py`, `app/application/use_cases/
  receive_inbound_email.py`, `infrastructure/aws/ecs.tf`.
- [Setting up Server-Side Auth for Next.js — Supabase Docs](https://supabase.com/docs/guides/auth/server-side/nextjs) — MEDIUM confidence, current `@supabase/ssr` pattern (middleware token refresh, PKCE callback route), verified against training-data assumption of deprecated `auth-helpers-nextjs`.
- [Login with Google — Supabase Docs](https://supabase.com/docs/guides/auth/social-login/auth-google) — MEDIUM confidence, provider-config-in-dashboard flow.
- [Row Level Security — Supabase Docs](https://supabase.com/docs/guides/database/postgres/row-level-security) — MEDIUM confidence, `auth.uid()` semantics and service-role bypass behavior (cross-checked against this repo's own migration comments, which independently state the same bypass behavior — HIGH confidence for the bypass fact specifically, since it's asserted twice: once in Supabase's own docs, once in this repo's `0020_knowledge_node_edges_rls.sql` comment).
- [Restore Supabase RLS with Drizzle using tRPC middlewares — Mortadha Ghanmi](https://mortadha.dev/blog/restore-supabase-rls-with-drizzle-using-trpc-middlewares/) — LOW/MEDIUM confidence, single-source community pattern for the *alternative*, heavier "true per-request RLS via JWT-forwarded `SET ROLE`" approach; flagged in this doc as a valid but not-required future hardening step, not the v1.7 recommendation (the recommendation is app-layer `user_id` filtering + RLS as a real-but-secondary defense layer, matching this project's existing `importer_id` idiom and its own precedent of gating heavier architecture on measured need rather than building it speculatively).

---
*Architecture research for: v1.7 polytoken.ai Foundation (auth, tenancy, email threads, atomic rename)*
*Researched: 2026-07-09*
