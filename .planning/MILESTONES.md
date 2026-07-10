# Milestones

## v1.7 polytoken.ai Foundation — Rename, Auth & Tenancy (Shipped: 2026-07-10)

**Phases completed:** 5 phases, 25 plans, 61 tasks

**Key accomplishments:**

- Repo-wide npm scope + workspace + UI chrome + Python identifier rename from nauta to polytoken (242 files, one reviewable committed script), with node_modules regenerated and all 8 TS/Python verification gates independently proven — while every KEEP surface (nauta_id/nauta_sync legacy DB column, live AWS/Terraform resource names, pre-existing dirty working-tree files) stayed provably untouched.
- User-executed runbook (259 lines) documenting GitHub/AWS-Terraform/Vercel/domain external renames — including the ECR `force_delete=false` destroy/recreate hazard, the local-only tfstate hazard, and the Terraform-`var.project`-vs-GitHub-Actions-YAML two-source-of-truth reconciliation, verbatim — with zero live resource-name strings changed in the repo.
- Installed `@supabase/ssr` (the milestone's one new npm dependency), added a Zod-validated fail-fast env schema (AUTH-05), and created the three canonical browser/server/middleware `@supabase/ssr` client helpers that every downstream Phase 43 plan will import.
- Next.js middleware refreshes and guards every app route via a pure, unit-tested `resolveAuthRedirect`/`safeNextPath` pair; a Google-only `/login` card and `/auth/callback` complete the PKCE sign-in loop; a form-POST `/auth/signout` route and sidebar button close it.
- Filled the documented "no-auth" seam in `packages/api-client/src/trpc.ts`: `ctx.user` is now session-derived, `protectedProcedure` rejects sessionless calls with `UNAUTHORIZED`, and a dedicated identity-injection test proves a client-supplied `input.userId` can never override the server-verified `ctx.user.id`.
- Server-derived X-User-Id now rides alongside X-API-Key on all 4 FastAPI-proxying BFF routes; FastAPI gained a non-enforcing `extract_user_id` reader for Phase 44 to enforce, with `require_api_key` left byte-for-byte unchanged.
- A six-section Google Cloud + Supabase runbook, a `supabase/config.toml` provider block that reads client id/secret exclusively via `env(...)`, four new placeholder vars in `.env.example`, and an authored-not-run Playwright signed-out→`/login` redirect spec — zero external OAuth clients created, zero secrets committed.
- Added `user_id uuid REFERENCES auth.users(id)` to importers/chat_conversations/chat_cost_ledger via a live expand→backfill→contract migration sequence (0031-0033), recorded the app-boundary-primary/RLS-defense-in-depth decision in PROJECT.md, and fixed two pre-existing Drizzle tooling defects (stale snapshot drift from 0025-0030 custom migrations, and a synthetic future-dated journal timestamp that silently no-ops new migrations) that would have blocked every future migration in this repo.
- 1. [Rule 1 - Bug] Reverted premature TENA-03 "Complete" mark in REQUIREMENTS.md
- Enforcing `require_user_id` + an owned-importer resolver now gate every user-scoped FastAPI route — `list_emails`/`get_email`/`download_attachment`/`reprocess_email` scope strictly to the caller's owned importers (never a raw query-param importer_id), and `PromoteEdgeUseCase` gained an additive user-ownership guard so a client-supplied body `importer_id` can no longer promote another user's knowledge edge.
- Migration 0034 replaces the authenticated RESTRICTIVE deny-all with `auth.uid()`-scoped PERMISSIVE ownership policies on 13 user-owned tables, applied and live-verified locally with zero regression across the api-client vitest and email-listener pytest suites.
- The emails tRPC router (reads + 17 component mutations, the largest cluster in the TENA-03 sweep) is fully on `protectedProcedure` + `@polytoken/db/ownership`: `emails.list` scopes to `userOwnedImporterIds` via a new pure `resolveListScope` helper, `byId`/`detail`/`entitySummary` reject cross-tenant targets, and every mutation asserts ownership (including every id in multi-id ops) before proxying to FastAPI.
- The entities, entity-types, and knowledge tRPC routers (9 files, 14 procedures) are fully on `protectedProcedure` + `@polytoken/db/ownership`: feeds scope to `userOwnedImporterIds` via a shared `resolveListScope`, id-addressed reads/writes assert the row's importer, NULL-importer system-default entity types stay readable but become write-rejected, and `knowledge.expandNode`'s "expand any node id" gap is closed with a seed-ownership gate.
- Chat router moved onto direct `chat_conversations.user_id` scoping (not importer-anchored), genui auth-gated with its generation cache deliberately left cross-tenant while `genui.historyList`/`historyById` became owned-importer-scoped (closing backlog 999.1), and the previously completely unscoped attachments download route gained a session + `assertImporterOwnership` gate — closing a live IDOR.
- Two-user adversarial suites (26 tRPC/web tests + 2 attachments tests + 16 FastAPI tests, all green) prove no cross-tenant read/write reaches another user's data across every router/endpoint this phase swept, backed by a full sweep inventory — and the sweep itself surfaced a real, previously-undiscovered gap on the FastAPI chat SSE surface, now locked by 4 strict-xfail regressions rather than silently missed.
- All three FastAPI chat SSE endpoints (`/v1/chat/stream`, `/v1/chat/regenerate`, `/v1/chat/widget/submit`) now enforce `require_user_id` + a pre-stream `ChatConversationRepository.owner_user_id` ownership assertion (404 fail-closed), and the chat confirm_action dispatch path finally threads the caller's `user_id` into `PromoteEdgeUseCase.execute`, closing the single highest-priority tenancy gap flagged at Plan 44-08's sweep.
- Migration 0035 adds an importer-anchored `threads` table + nullable `emails.thread_id` (SET NULL) and a direct-user_id `forwarding_addresses` table (unique token, unique user_id), both carrying Phase-44-style RLS defense-in-depth, plus `assertThreadOwnership`/`assertForwardingAddressOwnership` extending the central ownership chokepoint.
- Pure `thread_grouping.py` domain service: hand-rolled Union-Find over RFC threading headers (Tier 0) + body-embedded-Message-ID fallback (Tier 1) + conservative normalized-subject/time-window fallback (Tier 2), built test-first with real `.eml` fixtures proving Gmail-UI-forwarded mail does not fragment threads.
- ThreadResolver domain port + SupabaseThreadRepository adapter (Tier 0/1 header-linked neighbor search, Tier 2 subject/window fallback, deterministic min-id merge) wired into live ingest as a best-effort collaborator, plus an idempotent backfill script executed against the local DB (16 emails -> 9 threads, re-run verified 0/0 net changes).
- `emails.listThreads` tRPC projection (tenant-scoped identically to `emails.list`, pure `groupEmailsIntoThreads` aggregation) backs a new expandable `InboxThreadGroup` inbox row — the milestone's one real UI change, governed by a written `45-UI-SPEC.md` contract, with the existing `/emails/[id]` detail view left untouched.
- `ForwardingAddressResolver` port + Supabase adapter resolving `u-{token}@{domain}` recipients to their owning user_id at ingest time, threaded through `sns_inbound.py` and `IngestInboundEmailUseCase` to anchor newly-created importers to the resolved user and close the latent Phase-44 `importers.user_id NOT NULL` gap — with a test-proven guarantee that Gmail's forwarding-verification email is ingested, not dropped.
- `forwarding.getOrCreateMyAddress` tRPC procedure issuing a CSPRNG-derived, idempotent `u-{token}@{domain}` address per user, a minimal `/settings/forwarding` surface with copy-to-clipboard, and a user-gated FORWARDING-RUNBOOK.md covering the still-unapplied SES catch-all rule and Gmail's destination-verification handshake.
- Live-Bedrock proof the genui eval harness works end-to-end (real IAM transport, real judge scoring), captured honestly around a genuine Bedrock rate-limit + a newly-discovered Windows encoding crash in the harness's own error path; code-island isolation recorded as blocked-by-concurrency-lock with the deterministic 39/39 AST-allowlist vitest suite run as the locally-feasible substitute.
- Two backlog-999.2 debt folds landed: the 10 Python-3.13-broken `get_event_loop()` tests migrated to `asyncio.run()` (11 call sites, single textual swap), and the genui grid's Phase-17 child-count clamp made colSpan-aware so `cols:12` with 8/4-span children now renders a true 12-track asymmetric main+sidebar layout instead of collapsing to 2 columns — generator guidance corrected to match.
- Two decision-ready v1.8 kickoff research docs: a 4-direction polytoken brand-identity options paper (recommending "Cortex," with a confirmed naming-collision risk flagged) and a design-pattern dossier mapping Claude.ai/ChatGPT/Perplexity-class chat/canvas/panel/knowledge/mobile flows onto the real v1.4 DTCG token aliases and style packs, closing with 8 concrete additive token-system follow-ups.

---

## v1.6 Chat × Knowledge Convergence (Shipped: 2026-07-09)

**Phases completed:** 9 phases (33–41), 20 plans, 45 tasks

**Delivered:** The v1.3 chat agent now reads its own extracted data: a bounded mid-turn tool loop
(≤4 rounds, one ChatRun per turn) executes three knowledge tools (lookup_entity, search_emails,
search_knowledge) behind a capability gate, with structural prompt-injection quarantine (typed
envelopes, EXTRACTED-only free text via a DB view + field omission + a FOUND-6 envelope gate),
per-round cost ceilings, visible tool-round UI with citation chips, live data-bound genui panels,
chat-confirmable knowledge promotions over the Phase-24 CAS spine, and a knowledge-preview canvas
node — the v1.3 "product convergence is a config change" promise, cashed in. 19/19 requirements;
audit tech_debt (0 blockers, 9/9 integration seams WIRED). Executed fully autonomously
(`/gsd:autonomous parallelize what possible`) across parallel background-agent waves, surviving 3
session-limit interruptions with disk-state reconciliation.

Known deferred items at close: 7 (2 human_needed visual verification gaps + 2 UAT files for
Phases 39/41; 3 pending todos — see STATE.md Deferred Items).

**Key accomplishments:**

- **Bounded mid-turn tool loop (Phase 34):** new `ToolExecutor` domain port + `tool_invocation`/`tool_invocation_result` part types + `max_tool_rounds` capability gate (2 Bedrock Claude models only); fixed 2 latent production bugs research found — UsageDelta overwrite (cost under-reporting) and silent tool-parse-failure drop ("never silent" is now a tested contract), closing the 2026-07-06 truncated-tool-call todo.
- **3 knowledge tools, tiered and cited (Phases 36–37):** `lookup_entity` + `search_emails` as thin wrappers over existing repos (zero new backend; emails return quarantined fields, never raw body) and `search_knowledge` (search|expand) over an extended Python `KnowledgeGraphRepository` + migration 0029's `knowledge_nodes_extracted_only` view + BlendedRAG RPCs — non-EXTRACTED text structurally unreachable through three belts (SQL view, field omission, envelope gate); every envelope carries server-built `citations[]`.
- **Adversarially-proven exposure (Phase 38):** `search_knowledge` went user-facing ONLY after a 26-fixture/7-category injection suite passed in the same run (code-gated flag flip), including a real Bedrock Haiku live harness (7/7, zero canary leaks) and the one instructional hardening line the codebase lacked.
- **Cost + eval scaffolding (Phase 35):** distinct $0.15-default per-round ceiling on the FOUND-3 breaker (mid-round + boundary checks, visible partial text on abort) + retrieval-quality/citation-faithfulness/injection-resistance dimensions registered into the Phase-16 harness with ONE fixture source of truth consumed by both TS and Python runners.
- **Tool rounds became visible (Phase 39):** non-persisted `server_tool_call`/`server_tool_result` SSE mirror frames → "Searching knowledge…" activity rows + quiet collapsed result rows with citation chips via ONE shared `<ProvenanceLink>` primitive; also fixed a live client bug (persisted tool_call events mis-folding into a stuck widget skeleton).
- **Chat-confirmable knowledge (Phase 40):** `emit_confirm_action` carries only a `suggestion_ref` (server re-reads the live edge and freezes the schema at emission); submit re-checks edge tier against the declaration snapshot (409 stale on out-of-band promotion, proven by test) before an explicit 2-entry dispatch table reaches v1.5's promote_edge — migration 0030 extends widget_kind.
- **Live data-bound panels + knowledge preview (Phases 33, 41):** `spec.bindings` resolved via a compile-time switch over the 5 allowlisted procedures with staleTime/invalidation freshness (zero renderer edits — locked files byte-identical all milestone); a 3rd `NODE_TYPE_REGISTRY` entry renders a bounded, non-interactive two-ring ego mini-graph (SVG + real links, tier styles imported 1:1 from /knowledge, cap 25, always-present deep-link footer) — nested React Flow rejected as designed.

---

## v1.5 Knowledge-Graph Uplift (Shipped: 2026-07-08)

**Phases completed:** 4 phases (29–32), 11 plans, 30 tasks

**Delivered:** Activated the dormant knowledge-graph substrate — human confirms now materialize
confidence-tiered `knowledge_node_edges` (with OCR token-polygon provenance) through a suggest-only
promotion gate — adopting graphify's *algorithms* (tier ladder, bounded neighbour-expand,
tier-pruned detail) onto the live Postgres store per backlog 999.10's staged plan. Stage-3
(BFS-into-prompts) stays explicitly deferred behind the new measurable retrieval-miss-rate gate.
11/11 requirements; audit `tech_debt` (0 blockers, 6/6 integration seams WIRED). Selected and
executed fully autonomously (`/gsd:new-milestone /gsd:autonomous`).

Known deferred items at close: 4 (2 human_needed verification gaps — live Bedrock/browser checks
for Phases 29+32; 2 pending todos — truncated-tool-call salvage (carried), pre-existing /knowledge
UI debt; see STATE.md Deferred Items).

**Key accomplishments:**

- **Tier ladder live (migration 0026):** `knowledge_trust_tier` enum (EXTRACTED | INFERRED | AMBIGUOUS, NOT NULL DEFAULT 'AMBIGUOUS' — fail toward least trust) on both knowledge tables, plus `provenance jsonb` + `is_active` + an active-identity partial index on edges; `confidence real` kept as the intra-tier score.
- **The D-13 synthesis hook is real:** `ConfirmRegionUseCase` calls a `KnowledgeSynthesizer` domain port best-effort (confirm never fails on synthesis errors); `KnowledgeSynthesizerService` writes a node 1:1 with the confirmed region and EXTRACTED edges (component anchor, conditional entity-instance "about", co-occurrence) with OCR token∩polygon provenance via a helper extracted from `edit_region.py`; re-confirm supersedes deactivate-then-insert — never DELETE, no duplicates/orphans.
- **Suggest-only promotion gate:** the same synthesizer emits INFERRED/AMBIGUOUS *suggestion* edges (deterministic heuristics, no LLM); `list_injectable_edges` is the single EXTRACTED-only sanctioned injection read path (seeded three-tier exclusion test); migration 0027 adds `promotion jsonb`; `POST /v1/knowledge/edges/{id}/promote` promotes fail-closed (load → tenant → active → tier → CAS) recording promotion provenance distinct from synthesis provenance.
- **Cheap recall win + the stage-3 gate:** closed the never-built few-shot rendering seam in the Bedrock autofill adapter (retrieved examples now actually reach the model) and injected the resolved entity's `aliases[]`/`identifiers` as a delimited user-turn block; migration 0028's `autofill_retrieval_events` records every run best-effort, and `packages/db/scripts/retrieval-miss-rate.ts` (+ written Type-A/Type-B miss definition) computes the number that gates KGX-01..03.
- **/knowledge became a tiered exploration canvas:** EXTRACTED solid / INFERRED dashed / AMBIGUOUS faint edge encoding + legend (token-only), a cumulative tier filter ("Confirmed only" → "+ Inferred" → "+ Ambiguous") that also governs expand-merged edges, `knowledge.expandNode` bounded BFS (depth ≤2, ~50-node budget, importer-scoped) behind click-to-expand, and an edge-detail popover whose "Promote to confirmed" button round-trips through a server-keyed Next proxy to the FastAPI promote endpoint.
- **Design-case narrative now literally true in the schema:** "a confidence-graded knowledge graph with a suggest-only promotion gate, grounded in OCR token provenance" — every clause is a queryable column, a tested gate, or a visible canvas behavior.

---

## v1.4 Chat & Studio Design Uplift (Shipped: 2026-07-07)

**Phases completed:** 3 phases, 15 plans, 36 tasks

**Delivered:** A no-bloat visual/token-discipline uplift of `/chat` + `/studio`'s hand-built chrome —
zero new npm dependencies — executing the pre-baked 3-phase punch list (zero-dep contract fixes →
narrowly-adopted external picks → design-system token upgrades) from
`.planning/research/CHAT-STUDIO-DESIGN-UPLIFT.md`. 23/23 requirements; audit `tech_debt`
(deferred browser/OS visual checks only); milestone audit closed one integration blocker
(FIX-02 leaks via tabs/sidebar primitives) before archive.

Known deferred items at close: 4 (1 pending todo — truncated-tool-call salvage; 3 human_needed
verification gaps — browser/OS visual checks; see STATE.md Deferred Items).

**Key accomplishments:**

- One shared `JsonPane` component (header bar + ScrollArea/pre + Copy/Check clipboard button) now backs all three studio Spec JSON debug panes, and `history-island.tsx` is fully token-compliant (zero `font-medium`, zero `amber`, destructive-token `FallbackNotice`).
- Replaced code-island-frame's 6-entry raw amber/emerald/red PHASE_TONE map and 2-recipe red/amber ViolationList with 3 semantic-token buckets, gave the catalog prop table a muted header band + zebra rows, and cleared 8 of 11 remaining studio `font-medium` sites — zero new dependencies.
- Purged `font-medium` at its root cause (`packages/ui/src/button.tsx`'s `buttonVariants` base, app-wide blast radius) plus 2 chat drift sites, added eased `transition-colors` + `hover:bg-muted` affordances to conversation rows and turn-action buttons, and gave assistant messages a neutral left-rail role marker — zero new dependencies, app-wide FIX-02 grep gate now passes.
- ChatNode gets a teal `border-l-primary` stripe + `MessageSquare` icon, GenuiPanelNode gets a lighter `bg-muted/40` header + `PanelsTopLeft` icon, and dagre's `nodesep` widened 32→64 so sibling genui-panels stop cramming into one vertical rank.
- Token-colored React Flow Controls/MiniMap/Background chrome, a full-width composer dock band, and one Radix-ScrollArea-matching scrollbar aesthetic across every native-scroll spot on `/chat` — zero new npm dependencies, zero token-value changes.
- One `EmptyState` primitive (layout/tone/size/action/caption variant props) replacing three near-identical icon+heading+body JSX recipes across ChatHomeEmptyState, CanvasEmptyState, and UnknownNodeTypePlaceholder — pixel-identical output, zero copy changes.
- Taught the declarative genui generator's system prompt to bind declared-state display through `dataRef`-bound `list`/`conditional` nodes instead of an uninterpolated `{{mustache}}` text literal, and clarified `setState`'s absolute-vs-increment semantics — a prompt-only fix with zero renderer/schema changes.
- Created `docs/design/` (repo's first standing design-reference directory) with a paraphrased impeccable.style product-register + 13-item bans appendix and 3 copied ux-designer-skill reference files, both fully attributed.
- Hand-ported Magic UI's `file-tree` into a trimmed, data-driven `FileTree` component on raw `@radix-ui/react-accordion`, mounted as the Code-Island tab's preset browser (4 preset folders → `island.js` leaves), replacing the old `<Select>` — zero new npm dependencies.
- Landed the `.generating-ring` teal-only, reduced-motion-gated background-position sweep technique (hand-ported from Magic UI's shine-border + animated-shiny-text, MIT-confirmed) in globals.css, plus the `<GeneratingRing>` wrapper primitive mounted at both designated consumer sites — Studio's Generation Sandbox (`chromeProps.isPending`) and Chat's two streaming genui part branches in `message-turn.tsx` — without touching the locked `GenuiPartBoundary`/`InteractiveWidgetBoundary`/`spec-renderer.tsx` files.
- ADOPT-05 license discipline: execution-time vetting found transitions.dev carries NO license grant for its CSS snippets (the only "MIT" text covers an unrelated CLI tool), so the verbatim copy was SKIPPED and the 3 reveal utilities were hand-AUTHORED clean-room from the UI-SPEC's locked timing values, each wired to its single designated consumer (delete-conversation dialog, conversation-rail collapse, model-picker dropdown) — plus the FIX-02 typography spillover closed in `packages/ui/src/command.tsx`.
- TOKEN-01/02 rebased secondary/muted/accent to tonally-distinct hue-164 neutrals and chart/sidebar onto teal-anchored values, guarded by two committed regression tests (WCAG-AA contrast over all 6 neutral pairs in both modes; token-family registration against the unregistered-utility bug class).
- Wired the 28-01 elevation scale into its 4 named consumers (card, composer, both canvas node shells) and gave GenuiPanelNode's outer shell a motion-reduce-safe fade+zoom mount entrance via the already-installed tailwindcss-animate plugin.
- Studio history/page-ideas lists now cascade in with a capped-6, 40ms-step stagger; the last standing glassmorphism exception (conversation-rail's backdrop-blur-md) is resolved to a solid bg-background/95 surface; both bans-doc obligations (blur-debt closure, TOKEN-04 radius-allowlist forward guidance) are recorded -- closing every v1.4 requirement.

---

## v1.3 Conversational GenUI: Chat, Canvas & Dual-Channel (Shipped: 2026-07-06)

**Phases completed:** 4 phases, 24 plans, 65 tasks

**Key accomplishments:**

- Five Drizzle tables (conversations, runs, messages with typed parts + sibling versions, append-only run_events, cost ledger) plus migration 0023 with RLS deny-all, applied to local Supabase Postgres.
- One `ChatProvider` port with typed stream deltas, a curated 7-entry model registry (2 Bedrock + 4 OpenRouter + 1 browser/WebLLM) with honest capability flags and a content-hash version, two real streaming adapters (Bedrock + OpenRouter) both capturing real token usage, and an authed `GET /v1/chat/models` endpoint.
- Sanitized `MarkdownRenderer` built on react-markdown + remark-gfm + rehype-sanitize + rehype-highlight, mapping all markdown heading levels into the app's existing 2-weight (400/600) type system — CHAT-07/D-28.
- A fail-closed application-level cost circuit breaker (ledger port + Supabase adapter + CostCircuitBreaker domain service, config-only $0.50/$2.00/$5.00 per-turn/session/day caps) plus the D-22 fix that stops the genui declarative generator and code-island judge from silently dropping real token usage into the audit ledger.
- A tRPC `chat` router doing create/list/rename/hard-delete/getHistory directly over Drizzle, plus the `/chat` route's collapsible conversation rail, home empty-state, inline rename, and hard-delete confirm dialog — CHAT-02 fully done, CHAT-01's persistence half done.
- RunChatTurn — an async-generator chat agent (SEAM-04) that assembles D-26 token-trimmed history, routes through the 22-02 registry, gates every turn behind the 22-04 fail-closed cost breaker, streams typed run events (SEAM-03), and persists user/assistant messages as FOUND-1 canonical parts with full turn-control lifecycle (mid-stream cost abort, cancellation, failure, and D-16 sibling-version regenerate).
- FastAPI SSE (`POST /v1/chat/stream` + `/regenerate`) wrapping the 22-06 chat agent, plus a capability-gated `emit_ui_spec` tool whose partial-JSON tool-call streams into a D-18-interleaved `genui_spec` message part.
- End-to-end streamed chat: a Next.js SSE proxy injecting the FastAPI API key server-side, a `useChatStream` hook folding the SSE frames into an idle→streaming→terminal state machine, and a MessageList/Composer that actually stream a live conversation with optimistic send, auto-scroll, and a Stop button.
- Regenerate-as-versioned-siblings with a `‹ N/M ›` navigator, inline retryable error recovery that never touches the composer draft, a distinct no-retry cost-cap-blocked card, neutral stopped/cost-capped marker badges, and GenuiPartBoundary — progressive partial-tree genui rendering (render-what's-valid + skeleton placeholders) wrapping the unmodified SpecRenderer behind a hand-rolled lenient JSON-prefix repair + Zod safeParse gate.
- A tRPC proxy to the curated multi-provider registry feeding a cmdk model picker (honest capabilities, real cost lines, Recommended marker, D-10 persistence) plus a Drizzle-backed session cost meter with a per-turn breakdown popover — both mounted in the conversation-view toolbar, both purely display/selection surfaces with all enforcement staying server-side.
- A real, WebGPU-gated in-browser chat model (`@mlc-ai/web-llm`, vetted via the phase's package-legitimacy checkpoint) that loads locally with an honest progressive-loading UX, streams a text-only reply entirely client-side, and persists the turn through `chat.recordBrowserTurn` in the exact same canonical message/run/event/ledger shape server turns use — a $0 but fully metered usage row, with the send path branching on the registry's `execution_locus` rather than any hardcoded per-model special case.
- `chat_canvas_layouts` Drizzle table (migration 0024, RLS deny-all, live in local Postgres) plus `chat.getCanvasLayout`/`chat.saveCanvasLayout` tRPC procedures gated by a `CanvasSnapshotSchema` Zod boundary that rejects prototype pollution, embedded spec content, and over-cap payloads.
- Versioned `NODE_TYPE_REGISTRY` (chat/genui-panel) with a browser-safe FNV-1a content-hash `NODE_REGISTRY_VERSION`, plus `GenuiPanelNode` — a memoized React Flow node rendering a genui spec by provenance through the unmodified `SpecRenderer`, reading volatile content from a new `CanvasSpecContext` seam instead of `node.data`.
- React Flow canvas (chat node + dagre-placed genui-panel nodes) mounted behind a per-conversation Chat<->Canvas toggle, both views sharing ONE lifted `useConversationController` instance so switching never interrupts a stream.
- `useCanvasPersistence` closes the CANVAS-02 loop (exact restore, unknown-type degrade, live historyRows reconciliation, ~800ms debounced coalesced save) and CANVAS-04's responsiveness contract (volatile genui content flows through `CanvasSpecProvider`'s context seam, never the React Flow `nodes` array).
- 1. [Rule 3 - Blocking] Plan's literal `pnpm --filter @nauta/web add zustand` command doesn't apply — this repo is npm-workspaces canonical
- A genui-spec button's `onClick`/`action` now fires through `ActionRegistryContext` into a new per-panel `setState`-only bridge that routes writes through the existing bounded 5-mutation grammar — closing the verifier's "zero production call site" gap and proving, with an unmocked end-to-end test, that one panel's click populates the store, the picker's own field-discovery lists it, and a data-carrying edge live-feeds the target panel across successive writes.
- A `chat_widget_interactions` table stores each pending widget's declared response schema and lifecycle state, backed by a DB-level compare-and-swap double-submit lock (`try_submit`), a staleness query (`is_stale`), and a pure fail-closed JSON-Schema re-validator (`validate_result_against_schema`) — the safety spine every later Phase-24 plan (tool emission, submit endpoint, UI) builds on top of.
- The agent can now call `emit_proposal_cards` to end its turn with one pending, schema-bearing widget, and `POST /v1/chat/widget/submit` enforces re-validation + a DB-level double-submit lock + turn-bound staleness as pre-stream HTTP rejections before streaming the continuation turn over the existing SSE transport.
- DCUI-01 is observable end-to-end: an agent-emitted proposal-card group renders through the UNMODIFIED SpecRenderer in BOTH the transcript and a canvas genui-panel node from one message-part source of truth; a click POSTs the optionId through a two-hop-key SSE proxy, the run resumes as a streamed continuation, and the group locks to the UI-SPEC's Selected/dimmed contract — with typing-supersedes, staleness, and a validation-retry error row all driven by pure, tested display-state derivation.
- A new `emit_clarify_widget` tool (schema-enforced non-empty `submitLabel`, server-derived response schema) drives the UNMODIFIED Phase-19 form engine end-to-end: submitting returns structured field values through the existing 24-02/24-03 round-trip machinery, renders the compact submitted key-value-list + transcript entry, and typing now durably supersedes pending widgets server-side (D-02).
- A read-only observation surface over a fixture-shaped chat+canvas state snapshot, a typed `AnticipatoryCandidate` proposal contract, and three deterministic (no-ML) triggers — idle-after-genui, completed-artifact, ambiguous-intent — each proposing but never firing a candidate, all gated dark behind `ANTICIPATORY_PROMPTING_ENABLED=False`.
- Two independent gates — a Bedrock Haiku appropriateness judge that fails toward suppression (D-07) and an in-memory multi-window/day frequency cap (D-10) — both must pass before an `AnticipatoryCandidate` maps onto the unchanged Phase-24 proposal-card explicit-accept path (D-11), with every transition recorded as an ordered lifecycle event (D-13) and the whole pipeline dark by default (D-12) yet fully DI-constructible (D-01).
- A deterministic end-to-end harness proves the trigger→independent-gate-chain→explicit-accept pipeline behaves exactly as designed across all three fixtures, and `25-SPIKE-FINDINGS.md` delivers the phase's exit criterion: an explicit `ship-with-conditions` verdict naming the seven seams a real feature would need before the flag is ever flipped on.

---

## v1.2 Generative UI: Realism & Interactivity (Shipped: 2026-07-03)

**Phases completed:** 5 phases, 14 plans, 17 tasks

**Delivered:** the generative-UI engine grew from a reliable declarative catalog into a hybrid that
can produce *any* design — a jailed-eval sandboxed code-island — grounded by design-token style packs,
richer components, a zero-eval form engine, and an eval-driven studio.

**Key accomplishments:**

- **Phase 16 — Studio foundation (eval-driven):** eval harness + LLM-judge UI-quality rubric, plus History and Page-Ideas studio tabs.
- **Phase 17 — Tier A grounding:** 6 WCAG-AA W3C-DTCG design-token "style packs" + ThemedRoot CSS-var wrapper + assembly RAG (retrieval-before-generation).
- **Phase 18 — Catalog expansion:** real domain components (avatar / input / nav / feed-item / tabs / section) with a standing wire↔render parity gate.
- **Phase 19 — Declarative form engine:** a zero-eval `form` node (AJV rejected — it compiles via `new Function`; bounded custom validator instead), declarative conditional logic, and SEAM-02 submit.
- **Phase 20/21 — Sandboxed code-island (jailed-eval, USER SIGN-OFF):** iframe opaque-origin jail + inline-CSP + host-side AST allowlist + v0-style validate→autofix→run→heal→fallback loop; live Bedrock code generation **verified working**; parallel multi-candidate + LLM judge for quality.
- **Cost/safety:** $30/month AWS budget alert; conservative multi-candidate defaults (2 + Haiku judge); generation is manual-click only (idle spend = $0).

**Known deferred items at close:** 15 (see STATE.md → Deferred Items) — all connected-env / browser
verifications (human-UAT + eval-lift-vs-baseline measurements needing live Bedrock). Audit status:
`tech_debt`, 0 gaps (see milestones/v1.2-MILESTONE-AUDIT.md).

---
