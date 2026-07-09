# Feature Research — v1.7 polytoken.ai Foundation

**Domain:** Auth + tenancy + email-threading for a single-user-first personal AI workspace
(becoming product-shaped, not enterprise SaaS)
**Researched:** 2026-07-09
**Confidence:** HIGH (OAuth/sessions, RLS, email threading — official docs + well-documented
prior art) / MEDIUM (forwarding onboarding — pattern-matched from known products, no single
canonical spec)

## Scope Note

This document covers ONLY the four new v1.7 feature areas named in PROJECT.md: Google OAuth +
sessions, per-user tenancy, email threads, personal forwarding onboarding. Existing shipped
features (ingestion, review UI, entities/knowledge graph, chat + knowledge tools, genui canvas)
are explicitly out of scope per the milestone brief and are not re-litigated here.

**Grounding in the existing codebase** (verified by reading source, not assumed):
- Stack is already Next.js 15 (App Router) + `@supabase/supabase-js` + tRPC + Drizzle — no new
  framework choice is needed for auth, only a decision of *which auth layer* to add.
- `emails` (`packages/db/src/schema/emails.ts`) already stores `messageId`, `inReplyTo`, and
  `referencesIds` (RFC 5322 `References`, stored as a text array) but has **no `thread_id`** —
  threading is a pure grouping/backfill addition, not a new ingestion capability.
- Tenancy scaffolding already exists: every domain table carries `importer_id` (see
  `packages/db/src/schema/importers.ts` — "one row per customer / forwarding sender"), and
  today there is exactly **one** seeded default importer (fixed UUID, per project memory) behind
  a single shared `X-API-Key`. Per-user tenancy is "make the existing scoping column mean
  something real," not "introduce tenancy from scratch."
- No auth library is present today (`grep` for `next-auth`/`NextAuth`/`iron-session` found only
  unrelated `Authorization`/`X-API-Key` header handling in the chat/widget API routes). This is
  a from-scratch add.

---

## Feature Landscape

### 1. Google OAuth Sign-In + Sessions

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| "Continue with Google" as the (only) sign-in method | Claude, ChatGPT, and Perplexity all offer Google OAuth as a top sign-in option; for a single-user-first product it can be the *only* method — no password flow to build or secure | LOW | Given the existing `@supabase/supabase-js` dependency, Supabase Auth's Google provider (server-side PKCE via `@supabase/ssr`, callback route exchanges code→session, cookie-persisted) is the lowest-new-surface choice — avoids adding Auth.js/Better Auth as a second identity system next to Supabase |
| Session persists across browser restarts | Users expect not to re-login every visit; ChatGPT/Claude/Perplexity all keep you signed in for weeks | LOW–MED | Supabase's server client manages this via cookies automatically once the callback route calls `exchangeCodeForSession` |
| Post-login redirect to the page the user was trying to reach | Standard `next`/`return_to` param; breaking this is a common rough edge | LOW | |
| Sign-out clears session and returns to sign-in | Baseline expectation | LOW | |
| Minimal account surface: avatar/initial + email, small dropdown with "Sign out" | Matches Claude/ChatGPT/Perplexity's corner-menu pattern (small, unobtrusive, not a settings-heavy account page) | LOW | No profile-editing UI needed — Google is the source of truth for name/avatar |
| All routes/tRPC procedures require a session; unauthenticated → redirect to sign-in | Fails closed, matching the project's existing "auth fails closed outside development" convention (X-API-Key today) | MED | Touches Next.js middleware + every tRPC procedure/API route — largest surface item in this feature, not the sign-in page itself |
| Friendly error handling for OAuth failures (consent denied, revoked grant) | Silent failures or raw OAuth error pages break trust immediately | LOW | |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Surface the Gmail address from the OAuth profile and suggest it as the forwarding source | Removes a manual step in Feature 4's onboarding — "we noticed you signed in with x@gmail.com" — ties identity to the personal-email use case the product is actually for | LOW–MED | Real integration payoff between two of this milestone's features, not a generic auth nicety |
| Zero-friction: one Google click produces an immediately usable, fully-provisioned personal workspace (no separate "create your workspace" step) | Removes the B2B-SaaS-shaped setup ceremony (org name, invite teammates) that doesn't apply to a single-user product | LOW | Depends on Feature 2's first-user backfill being automatic on first sign-in |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Username/password auth alongside OAuth | "Some users don't want Google" | Adds password storage, reset-flow, and credential-stuffing attack surface for a product with exactly one intended user right now | Google-only; add providers only when a real second identity need appears |
| Multiple OAuth providers (GitHub, Microsoft, Apple) at launch | "More options = more accessible" | Each provider is its own config, consent-screen review, and test surface; no current user need | Ship Google only; the auth layer (Supabase Auth) supports adding providers later without a rewrite |
| Org/team switcher, invite-teammate flows, RBAC roles | "We'll need it eventually" | Collaboration is explicitly E3+ in VISION.md, not v1.7; building it now is speculative and untested against real multi-user needs | Single-user-per-account model now; team concepts get designed against the *actual* E3 collaboration feature, not guessed at |
| "Remember me" checkbox | Familiar pattern from older sites | Sessions should simply persist by default — the checkbox is a UX relic that only adds a decision the user shouldn't have to make | Always-persistent session (matches Claude/ChatGPT/Perplexity) |
| MFA/2FA on top of Google sign-in | "More secure" | Redundant — Google's own account security (their MFA, device trust, suspicious-login detection) already protects the OAuth identity; app-level MFA doubles UX cost for no real security gain in a delegated-auth model | None needed; rely on Google's account security |
| Custom-branded Google consent screen polish | "Should look like our product" | Cosmetic, deferred to v1.8's dedicated brand/design pass; doing it now duplicates work once real brand identity exists | Use Google's default OAuth consent UI; revisit at v1.8 |

---

### 2. Per-User Data Isolation (Tenancy)

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Every user-owned table scoped by a tenant column, enforced NOT NULL where feasible | Baseline for "my data is mine" — this is the literal meaning of "per-user" | LOW (schema) / MED (review surface) | The scoping column (`importer_id`) already exists on every domain table per D-05 (see `emails.ts`, `entity-instances.ts`, `components.ts`, `attachments.ts`, `chat-cost-ledger.ts` etc.) — this is "wire it to something real," not "add it everywhere" |
| Supabase RLS policies that **actually enforce** isolation (`user_id = auth.uid()` or an equivalent join), not just exist on paper | Real security boundary, matching the project's own existing posture ("auth fails closed outside development," today: RESTRICTIVE deny-all + one shared API key) | MED–HIGH | This is the highest-risk item in the whole milestone (see Anti-Features + confidence note below) — RLS must be tested from the actual client SDK path, not just assumed correct from policy text |
| No cross-tenant leakage through *any* read path, not just the obvious CRUD screens | Users expect isolation to be total — a leak in search/chat retrieval is just as bad as a leak in the entity gallery | MED | The project's BlendedRAG/pgvector retrieval RPCs (`search_knowledge`, entity resolution) are non-obvious leak surfaces — they must carry the same scoping, not just the simple table reads |
| First-user backfill: the single pre-existing default-importer's data becomes the first signed-in user's data, with no manual DB surgery required | There is exactly one real dataset today (fixed default-importer UUID); it must not become orphaned or require the user to "re-import" their own existing emails/entities/knowledge graph | LOW–MED for one user | Standard "expand → backfill → contract" migration shape: add the new user-scoping column nullable, backfill it to point at the first authenticated user, then tighten to NOT NULL |
| Fail-closed default: a table with no explicit policy denies all access | Matches existing project convention; prevents the most common real-world RLS bug class (see below) | LOW | Already the project's stated posture for the current API-key auth — carry it forward, don't regress |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|--------------------|------------|-------|
| RLS enforced at the DB layer as defense-in-depth, even though tRPC procedures also check | Positions the product as *not* shipping the extremely well-documented "AI-scaffolded Supabase app with RLS disabled/misconfigured" vulnerability class — CVE-2025-48757 affected 170+ apps in this exact failure mode, and independent 2025-2026 analyses found ~70% of AI-generated Supabase apps ship with critical RLS gaps and 83% of Supabase data exposures trace to RLS misconfiguration | MED | This is a genuine, currently-relevant differentiator: doing per-user isolation *correctly* is the exception, not the norm, in this exact stack right now |
| `service_role` bypass reserved strictly for background/ingestion jobs (the SES pipeline), never used on any user-facing request path | Prevents the most common regression that reintroduces the vulnerability class above (a route quietly using the admin client "to make something work") | LOW–MED | Architectural discipline, not user-visible, but is what keeps the differentiator above true over time |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Full multi-tenant "organization" model (teams, shared workspaces, granular per-resource ACLs) | "Real SaaS needs orgs" | This is B2B SaaS shape; the product is explicitly single-user-per-account isolation right now — building org/team primitives before any collaboration feature is scoped is pure speculation | Per-account isolation only; design org concepts against the real E3+ collaboration feature when it exists |
| Custom admin/impersonation panel for support | "We'll need to debug users' data" | Premature for one (the developer's own) user — direct DB access is sufficient at this scale and building admin tooling now is pure overhead | Direct DB/Supabase-dashboard access until real multi-user support load exists |
| Per-resource sharing/permissions UI ("share this knowledge node with…") | "Feels like a natural feature" | There is no second user to share with yet; building a permissions UI with nobody to grant access to is speculative | Defer until E3 (Email-Cluster Workflow) or later actually introduces multiple users interacting with shared data |
| Enabling RLS with permissive `USING (true)` policies "to get it working, tighten later" | Feels like a safe intermediate step | This is *precisely* the failure mode behind CVE-2025-48757-class incidents — "tighten later" reliably doesn't happen before it matters | Write real `user_id`-scoped policies from the start; if a policy can't be written correctly yet, deny access (fail closed) rather than allow-all |

---

### 3. Email Thread Handling

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Group messages into threads via RFC 5322 `In-Reply-To` + `References` headers (the JWZ-style algorithm nearly every modern client uses) | This is the industry-standard mechanism — Gmail, Outlook, Superhuman, and virtually every mail client build on this | LOW–MED | The needed raw data (`inReplyTo`, `referencesIds`) is **already captured** on every `emails` row — this feature is a grouping/`thread_id` addition over existing columns, not new ingestion work |
| Subject-line fallback when headers are missing or broken (normalize by stripping `Re:`/`Fwd:`/`[List]` prefixes + whitespace, then group by normalized subject + participants) | Real-world mail is messy — plenty of senders (especially transactional/marketing mail) omit or mangle threading headers; without a fallback those messages never thread at all | MED | Per JWZ practice this must stay a *fallback*, not the primary signal (false-positive risk — see anti-features) |
| Thread list view: subject, last-message snippet, participant names, message count, last-activity time | Standard inbox-list UX — this is table stakes for *any* email UI, not a novel ask | LOW–MED | Extends the existing `/emails` list surface rather than replacing it |
| Thread detail view: chronological message stack, each message collapsible/expandable | This is literally what "conversation view" means in Gmail/Superhuman — users expect a thread to read top-to-bottom as one scroll | MED | |
| New inbound messages with matching thread headers append to the existing thread, not a new row | Otherwise every reply looks like a brand-new unrelated email — breaks the entire point of threading | MED | This is the ingestion-pipeline-facing half of the feature |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|--------------------|------------|-------|
| Gmail-style *aggressive* grouping (participants + normalized subject even without any threading headers present) rather than strict RFC-only matching | Reduces "why didn't this thread?" surprise — Gmail itself is known to thread more aggressively than the RFC spec because real-world headers are unreliable | MED | Explicit tradeoff: more aggressive = fewer missed threads but higher false-positive risk; Gmail accepts this tradeoff and users are already trained on Gmail's behavior |
| Supersede-safe, append-only thread assignment consistent with the project's existing D-03 convention ("nothing is ever mutated after insert") | Matches the house architectural discipline already proven in `emails` (append-only) and the knowledge-graph tier ladder (supersede, never overwrite) | LOW–MED | If a later message reveals two threads should actually merge, that should be an explicit, auditable operation — not a silent row rewrite |
| `thread_id` designed as the load-bearing FK for VISION.md's E3 "thread cards on the canvas" / "chat attached to a thread" features | Nothing extra to build now, but naming/shaping the column so E3 doesn't require a rename or backfill later is free if done at v1.7 time | LOW | This is a dependency/sequencing note, not new v1.7 scope — E3 itself stays out of scope per PROJECT.md's phase split |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Full JWZ reply-tree / nested-hierarchy visualization | "More accurate than a flat list" | Overbuild — this is what desktop clients like early Thunderbird did, and it's *not* what Gmail/Superhuman/ChatGPT-era users expect; a flat chronological stack is simpler to build and matches the mental model users already have | Flat chronological message stack per thread (Gmail's actual UX) |
| Auto-merging threads purely on fuzzy subject similarity, with no header evidence | "Catches more related messages" | High false-positive risk — two unrelated emails both titled "lunch?" get merged; JWZ explicitly treats subject matching as a last-resort fallback, never primary | Subject fallback only when reply-headers are entirely absent; never override real header-based grouping |
| Manual thread split/merge UI | "Users will want to fix mistakes" | Real differentiator eventually, but there's no evidence yet (no real forwarding volume) that mis-threading will be a frequent enough problem to justify UI investment now | Defer until Feature 4 (real personal forwarding) surfaces actual mis-threaded volume, then revisit |

---

### 4. Personal Email Forwarding Onboarding

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| One unique, unguessable inbound address per user (the Trello/Asana pattern: a secret-token local part, not a predictable slug) | This is the established pattern across every "add-by-email" product (Trello's per-member board address, Asana's `x@mail.asana.com`) — the address's *secrecy* is the security model, no separate verification handshake needed on the app side | LOW–MED | Reuses the existing provider-agnostic SES receiving infra (PROJECT.md: "webhook is provider-agnostic by decision") — the change is routing by a per-user secret key instead of the single fixed default-importer address; AWS SES supports catch-all subdomain + wildcard recipient rules for exactly this shape |
| Copy-to-clipboard address + plain-language setup instructions ("Gmail → Settings → Forwarding → add this address") | Users forwarding for the first time need the exact click path, not just an address | LOW | |
| Clear onboarding page explaining *why* (what this address is, what happens to forwarded mail) | Assuming familiarity with "forward your email to an agent" is a bad assumption for a first-time user | LOW | |
| First-forwarded-email confirmation ("We received your first email!") | Closes the loop — without this the user has no signal that setup actually worked | LOW–MED | |
| Onboarding copy that walks the user through **Gmail's own** forwarding-address verification step | Gmail requires confirming ownership of any new forwarding destination (a confirmation code/link Gmail itself sends) before a filter can use it — this is entirely outside the app's control and must be set correct user expectations, or users will think the app is broken when nothing arrives yet | LOW | This is a real, well-documented deliverability gotcha specific to Gmail's forwarding feature, distinct from the address-secrecy model above |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|--------------------|------------|-------|
| No app-side verify-you-own-this-address round trip, because the address itself is the secret | Simpler onboarding than the classic "enter code we emailed you" flow — same trust model as Trello/Asana, and it composes cleanly with Feature 2 (the address routes directly to the correct tenant, no separate claim step) | LOW | Verification is implicit in the address's unguessability; Gmail's *own* destination-verification (separate from this) still applies per the table-stakes item above |
| Tie the suggested forwarding address setup to the Google-OAuth identity from Feature 1 | "We noticed you signed in with x@gmail.com — here's exactly what to paste into that account's forwarding settings" — removes a manual "which email do I forward from" decision | LOW–MED | Cross-feature integration payoff, not new infrastructure |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Gmail API pull-based ingestion (OAuth Gmail scopes, push notifications, polling) instead of forward-based | "More reliable than asking users to set up forwarding" | Fundamentally different (and much heavier) architecture than the existing forward-based pipeline; the milestone brief explicitly scopes this as an "own-email forwarding seam," not a Gmail API integration — conflating the two is a scope-creep trap | Stay forward-based; a Gmail-API pull integration is a distinct, larger feature for a later milestone if ever needed |
| Custom/vanity domains or arbitrary custom local-parts per user | "Feels more personal" | Premature — one unique address per user under polytoken's own domain is sufficient for a single-user-first product; custom domains add DNS/verification complexity with no current demand | One system-generated unique address per user |
| Real-time deliverability monitoring / bounce-handling dashboard | "Should know if forwarding breaks" | Overbuild for a single early user — a basic "email received" confirmation (table stakes above) already closes the most important feedback loop | Simple received-confirmation UX now; revisit monitoring if/when real multi-user volume exists |

---

## Feature Dependencies

```
Google OAuth sign-in + sessions
    └──requires──> nothing new (Supabase already a project dependency)

Per-user data isolation (RLS enforcement)
    └──requires──> Google OAuth sign-in + sessions
                       (need a real auth.uid()-equivalent identity to write policies against)

First-user data backfill (existing default-importer data → first account)
    └──requires──> Google OAuth sign-in + sessions
                       (need a real user row to backfill data ONTO)
    └──requires──> Per-user data isolation schema
                       (the user-scoping column must exist before backfill runs;
                        "expand → backfill → contract" ordering)

Unique per-user forwarding address
    └──requires──> Per-user data isolation
                       (the address must resolve to a real user/tenant for correct routing —
                        an address with nowhere to route is meaningless)

Email thread grouping (thread_id)
    └──requires──> nothing NEW from this milestone (the header data already exists on `emails`;
                    grouping logic runs regardless of tenancy)
    └──interacts-with──> Per-user data isolation
                       (both add columns to the same `emails` table and both need indexes —
                        sequence/migrate together rather than as two uncoordinated passes)

OAuth-identity-suggests-forwarding-address (differentiator)
    └──requires──> Google OAuth sign-in + sessions
    └──requires──> Unique per-user forwarding address

E3 "thread cards on canvas" / "chat attached to thread" (OUT OF SCOPE for v1.7)
    └──requires──> Email thread grouping (thread_id) — this is why thread_id's *shape* matters
                    now even though the consuming feature is deferred
```

### Dependency Notes

- **Per-user isolation requires OAuth first:** there is no `auth.uid()`-equivalent identity to
  scope RLS policies against until sign-in exists — this fixes the build order (auth phase before
  or concurrent with, never after, the tenancy phase).
- **First-user backfill requires both OAuth and the tenancy schema:** this is the
  expand→backfill→contract pattern — add the new scoping column, backfill the one existing
  dataset onto the first real account, then (only then) tighten constraints to NOT NULL.
- **Forwarding addresses require tenancy:** issuing a unique address before there's a concept of
  "whose address is this" produces an address with nowhere correct to route mail — sequence
  tenancy ahead of (or atomically with) the forwarding-address feature.
- **Threading and tenancy both touch `emails`:** neither strictly blocks the other, but both add
  columns/indexes to the same hot table — coordinating them into fewer migration passes avoids
  redundant table rewrites.
- **OAuth-identity-suggests-forwarding-address conflicts with nothing** but has no value until
  both of its dependencies exist — pure integration polish, sequence last.

---

## MVP Definition

### Launch With (v1.7)

Minimum viable product for this milestone — what's needed to make the product real-usable by
one actual person, not a demo.

- [ ] Google OAuth sign-in + persistent session + sign-out + minimal account menu — the product
      cannot be "a product" without a real identity boundary
- [ ] Per-user RLS enforced (not just present) on every existing user-owned table + first-user
      backfill of the existing default-importer's data — without real enforcement, "per-user" is
      cosmetic; without backfill, the existing user loses their own data
- [ ] Email thread grouping (RFC 5322 headers + subject fallback) surfaced as a thread list +
      thread detail view — the stated E2 requirement ("ingestion pipeline is message-oriented
      today") and prerequisite for E3
- [ ] One unique, unguessable forwarding address per user + onboarding page + first-email
      confirmation — this is what makes the product usable for the user's *own* real email, the
      explicit stated goal ("real personal use")

### Add After Validation (v1.7.x / v1.8)

- [ ] OAuth-identity-suggested forwarding address (prefill the Gmail address from sign-in) —
      trigger: once basic onboarding is proven to work, this is a pure friction-reduction pass
- [ ] Manual thread merge/split — trigger: only if real forwarding volume actually surfaces
      mis-threaded messages (don't build ahead of evidence)

### Future Consideration (v2+ / E3–E4)

- [ ] Thread-as-canvas-node, chat-bound-to-thread — defer: explicitly E3 scope per VISION.md and
      PROJECT.md's own phase split; v1.7 only needs to shape `thread_id` correctly for it
- [ ] Multi-provider OAuth (GitHub/Microsoft) — defer until a real second-provider need appears
- [ ] Org/team collaboration, sharing, invites — defer until a real collaboration feature (E3+)
      is scoped against actual multi-user needs
- [ ] Gmail API pull-based ingestion — defer indefinitely unless forward-based ingestion proves
      insufficient; architecturally distinct, don't build speculatively
- [ ] Deliverability monitoring/bounce-handling dashboard — defer until multi-user volume exists

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|----------------------|----------|
| Google OAuth sign-in + sessions | HIGH | LOW–MED | P1 |
| Per-user RLS enforcement + first-user backfill | HIGH | MED–HIGH | P1 |
| Email thread grouping (headers + fallback) | HIGH | MED | P1 |
| Unique per-user forwarding address + onboarding | HIGH | LOW–MED | P1 |
| OAuth-identity-suggests-forwarding-address | MEDIUM | LOW–MED | P2 |
| Manual thread merge/split | LOW (unproven need) | MED | P3 |
| Multi-provider OAuth | LOW (no current need) | LOW–MED | P3 |
| Org/team collaboration primitives | LOW (no current users) | HIGH | P3 |

**Priority key:**
- P1: Must have for v1.7 to be "the foundation" (per PROJECT.md's own framing)
- P2: Should have, cheap once P1 dependencies exist
- P3: Explicitly deferred — no evidence of need yet, or explicitly scoped to a later epoch

---

## Competitor Feature Analysis

| Feature Area | Claude / ChatGPT / Perplexity | Gmail / Superhuman | Trello / Asana | Our Approach |
|---------------|-------------------------------|---------------------|------------------|--------------|
| Sign-in | Google OAuth as a top option; minimal corner account menu (avatar, sign out, settings) — no org switcher for free/personal tier | N/A (email providers, not app sign-in) | N/A | Match Claude/ChatGPT/Perplexity's minimal single-account pattern exactly — Google-only, corner menu, no org switcher |
| Session model | Long-lived, silent persistence; no "remember me" decision surfaced to the user | N/A | N/A | Same — persistent by default via Supabase-managed cookies |
| Data isolation | Per-account by default (no visible tenancy concept to the user at all) | Per-mailbox (the account IS the boundary) | Per-board/per-workspace membership | Per-account (`user_id`/`importer_id`), invisible to the user — the isolation should feel like "this is just my data," never surfaced as a tenancy concept |
| Thread grouping | N/A (chat threads, not email) | RFC 5322 headers + aggressive subject/participant fallback; flat chronological conversation view | N/A | Same algorithm family (JWZ + fallback), flat chronological view — deliberately match the pattern users are already trained on from Gmail |
| Add-content-by-email onboarding | N/A | Gmail requires destination-verification handshake for auto-forward filters (outside any third-party app's control) | Unique unguessable per-user/per-board address, no separate app-side verification | Unique unguessable per-user address (Trello/Asana model) + onboarding copy that also walks the user through Gmail's own separate verification step |

---

## Sources

- [Row Level Security | Supabase Docs](https://supabase.com/docs/guides/database/postgres/row-level-security) — HIGH confidence, official docs
- [Supabase Auth Google OAuth guide](https://supabase.com/docs/guides/auth/social-login/auth-google) — HIGH confidence, official docs (fetched directly)
- [Supabase RLS Best Practices — makerkit.dev](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices) — MEDIUM confidence, third-party but consistent with official guidance
- [message threading — jwz.org](https://www.jwz.org/doc/threading.html) — HIGH confidence, the original/canonical algorithm source virtually every mail client credits
- [Manage threads | Gmail API — Google Developers](https://developers.google.com/workspace/gmail/api/guides/threads) — HIGH confidence, official docs
- [How does Gmail decide to group emails into conversations? — cloudHQ](https://support.cloudhq.net/how-does-gmail-decide-to-group-emails-into-conversations/) — MEDIUM confidence, third-party but consistent across multiple independent sources
- [email threading explained — LobsterMail](https://lobstermail.ai/blog/email-threading-explained-how-in-reply-to-and-references-headers-keep-conversations-together) — MEDIUM confidence
- [Create cards by email — Trello / Atlassian Support](https://support.atlassian.com/trello/docs/creating-cards-by-email/) — HIGH confidence, official docs; confirms the unique-unguessable-address-no-verification pattern
- [How to generate random email addresses for Trello boards — TechRepublic](https://www.techrepublic.com/article/how-to-generate-email-trello-boards/) — MEDIUM confidence, corroborating third-party
- [Manage Incoming Emails at Scale with Amazon SES — AWS Messaging Blog](https://aws.amazon.com/blogs/messaging-and-targeting/manage-incoming-emails-with-ses/) — HIGH confidence, official AWS docs; confirms catch-all subdomain + wildcard recipient routing for per-user addresses
- [Amazon SES email receiving concepts — AWS Docs](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-concepts.html) — HIGH confidence, official docs
- CVE-2025-48757 / AI-generated-app RLS-gap prevalence: [vibeappscanner.com/supabase-security](https://vibeappscanner.com/supabase-security), [byteiota.com Supabase RLS flaw](https://byteiota.com/supabase-security-flaw-170-apps-exposed-by-missing-rls/) — MEDIUM confidence (aggregator/analysis sites, not a primary CVE database lookup in this session, but the CVE ID and the ~170-app/70%-gap figures were independently corroborated across multiple distinct sources)
- Codebase inspection (this session): `packages/db/src/schema/emails.ts`, `importers.ts`,
  `entity-instances.ts`, `chat-conversations.ts`, `attachments.ts`, `components.ts`;
  `apps/web/package.json`; grep for existing auth libraries — HIGH confidence, primary source

---
*Feature research for: v1.7 polytoken.ai Foundation — auth, tenancy, email threads, forwarding onboarding*
*Researched: 2026-07-09*
