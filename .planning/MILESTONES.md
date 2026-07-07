# Milestones

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
