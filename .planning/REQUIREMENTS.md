# Requirements: polytoken — v1.9 Cloud Workspace

**Defined:** 2026-07-10
**Core Value:** Reliably receive every inbound email and make it observable — now as a product
the user actually lives in: their real email flowing, every shipped capability touched live,
and the email-cluster workflow working end-to-end on their real inbox.

Sources: `.planning/research/two-epoch-endgame/ENDGAME-PLAN.md` §2 (Epoch A — plan of record),
`milestones/v1.8-ROADMAP.md` §49–51 (RSKN/MOBL/PANL seed specs, moved 2026-07-10),
`research/polytoken-vision/VISION.md` E3, backlog 999.16, todos
2026-07-07-knowledge-preexisting-ui-debt + 2026-07-09-knowledge-cache-invalidation-gap,
STATE.md → Deferred Items (v1.2–v1.8 UAT/verification carry).

**STANDING RULE (locked 2026-07-10):** deploy/OAuth/live-UAT gates are first-class phase work,
never deferrable-by-default. User-executed steps surface as in-phase checkpoint tasks. Band 1
completes before any Band 2/3 work starts.

## v1 Requirements

### Live-Loop Gate (LIVE — Band 1, strictly first)

- [x] **LIVE-01**: The local stack runs green end-to-end (login → inbox → thread → email detail → chat with tool rounds → genui panel → /knowledge) via a documented, reproducible start procedure — no zombie-process ambiguity, verified against the DB not the terminal
- [ ] **LIVE-02**: Migrations 0026–0035 are applied to staging AND production (migrations-first per the deploy playbook) and live-verified; ECS + Vercel deploys are green on the renamed codebase
- [ ] **LIVE-03**: Google OAuth works on the deployed app — GOOGLE-OAUTH-RUNBOOK.md executed (user console steps as in-phase checkpoint tasks), the user signs in with their real Google account, session persists, sign-out works
- [ ] **LIVE-04**: The user's real email flows into polytoken — FORWARDING-RUNBOOK.md + SES rule wired, a real forwarded message lands, threads group correctly, attachments stored
- [x] **LIVE-05**: The deferred UAT backlog is burned down — all open scenarios in 39/41/43/45/47/48-HUMAN-UAT.md executed via /gsd:verify-work (auth-gated ones after LIVE-03), each closed or converted to a tracked fix
- [x] **LIVE-06**: W-1 closed — the screenshot harness SURFACES covers /emails/[id] and captures authenticated surfaces once a seeded session exists
- [ ] **LIVE-07**: External-identity leftovers are decided, not parked — EXTERNAL-RENAME-RUNBOOK.md items executed or explicitly re-parked by the user; the local Supabase nauta→polytoken project-id decision recorded

### Total UI Re-skin (RSKN — Band 2; carried verbatim from v1.8 + scope extensions)

- [x] **RSKN-01**: `/chat` is re-skinned in the polytoken register on extended tokens — composer, message stream, tool-round activity rows, citation chips
- [x] **RSKN-02**: The thread inbox (three-pane, thread groups) and email detail view are re-skinned on extended tokens
- [x] **RSKN-03**: `/knowledge` canvas is re-skinned — tier badges on TOKN-04 tokens, node types on TOKN-05 palette — and the pre-existing /knowledge UI debt (glassmorphism-ban violations, raw ⊞ glyph) is cleared
- [ ] **RSKN-04**: `/studio`, `/settings/*`, and `/login` are re-skinned in the polytoken register
- [x] **RSKN-05**: The re-skin holds the token discipline: zero raw hex outside token sources; existing WCAG-AA contrast + token-family registration regression gates stay green and extend to the new aliases
- [x] **RSKN-06**: The off-token chip/badge stragglers consume the purpose-built tokens (backlog 999.16): inbox entity chips onto `color.graph.entity` + `radius.pill`, `/entities/[id]` StatusBadge onto the `color.tier.*` ladder — explicit scope extension to `/entities/[id]`
- [ ] **RSKN-07**: Knowledge-canvas cache invalidation is extended to chat-driven promotions and expandNode results (todo 2026-07-09; today it self-heals only via staleTime)

### Mobile-Responsive Answer (MOBL — Band 2, after RSKN)

- [ ] **MOBL-01**: On small screens, canvas surfaces (chat canvas, knowledge) collapse to a list/feed presentation (inline-first, market-validated pattern); desktop keeps the 2D canvas
- [ ] **MOBL-02**: Core flows (login → inbox → thread → email detail → chat) are usable on a mobile viewport — no horizontal overflow, ≥44px touch targets even on dense packs

### Editable Panels / Studio-on-Canvas (PANL — Band 2, parallelizable with RSKN)

- [ ] **PANL-01**: User can switch a genui panel's `style_pack_id` in place from per-panel controls; the choice persists across reloads
- [ ] **PANL-02**: User can tweak a panel's spec parameters in place through a bounded editing surface (schema-validated, same untrusted-input gate as FOUND-6)
- [ ] **PANL-03**: User can regenerate a panel variant in place, with provenance retained and prior version reachable
- [ ] **PANL-04**: A promptable design slice exists: a natural-language re-theme instruction on a panel resolves to pack/token choices (DSGN-03's cheap generation-side slice; no visual-compare repair loop)

### Email-Cluster Workflow (CLUS — Band 3, depth-first on the real inbox)

- [ ] **CLUS-01**: User can place an email-thread card on the `/chat` canvas as a first-class node type (versioned registry entry), showing the thread's real subject/participants/summary
- [ ] **CLUS-02**: User can attach a chat to an email thread — the conversation is linked to the thread and the agent's answers draw on that thread's content (thread → conversation linkage)
- [ ] **CLUS-03**: The agent can search the web mid-turn via a `web_search` ToolExecutor behind the same port, allowlist, envelope-quarantine, and adversarial-fixture discipline as the v1.6 tools (exposure code-gated on the suite passing)
- [ ] **CLUS-04**: Tool results (URLs/pages) can be captured as INFERRED knowledge nodes attached to the thread/chat cluster — suggest-only, provenance retained
- [ ] **CLUS-05**: Cluster knowledge is promotable to the global graph through the existing suggest-only promotion gate (confirm-action widgets; supersede-never-mutate)
- [ ] **CLUS-06**: Cluster context accumulates — artifacts from earlier chats in the cluster (genui panels, captured sources) are available as context to subsequent chats attached to the same thread
- [ ] **CLUS-07**: The end-to-end scenario is proven live by the user on their real inbox: real thread → attached chat → web research with thread in context → sources captured → promotion confirmed → a follow-up chat sees the cluster context (the milestone's acceptance bar)

## v2 Requirements

### Design Engine (deferred remainder of 999.4)

- **DSGN-02**: Rendered-visual-compare repair step (screenshot the render, judge, repair loop)
- **DSGN-04**: Screenshot/URL → design-token extraction

### Brand/Design

- **CNVP-01**: Canvas-first 7th style pack (spatial register) — dossier follow-up #7, low priority

## Out of Scope

| Feature | Reason |
|---------|--------|
| Desktop app / daemon / local-machine control (E4), browser-control panel (E5), tool registry + self-repository (E6) | v2.0 Local Agent Platform — ENDGAME-PLAN.md §3 |
| E7 distributed inference / compute pooling | Parked venture decision (ENDGAME-PLAN.md §4); only obligation is v2.0's job-shaped daemon protocol |
| Breadth beyond the ONE CLUS-07 scenario (multi-cluster mgmt, cluster UI polish, PDF/attachment capture pipelines) | Depth-first mandate — one scenario fully working beats five half-working |
| Native mobile apps | Web-first, mobile-responsive only (VISION E2) |
| Tailwind v4 / React 19 migration (999.12) | Orthogonal platform risk; stay on the stable stack |
| Marketing site | Post-launch work; brand applies in-app first |
| Domain purchase / trademark filing | User-only external actions (surfaced as LIVE-07 checkpoint context, not built here) |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LIVE-01 | Phase 49 — Live-Loop Gate: Deploy, OAuth & Real Email | Complete |
| LIVE-02 | Phase 49 — Live-Loop Gate: Deploy, OAuth & Real Email | Pending |
| LIVE-03 | Phase 49 — Live-Loop Gate: Deploy, OAuth & Real Email | Pending |
| LIVE-04 | Phase 49 — Live-Loop Gate: Deploy, OAuth & Real Email | Pending |
| LIVE-07 | Phase 49 — Live-Loop Gate: Deploy, OAuth & Real Email | Pending |
| LIVE-05 | Phase 50 — Live-Loop Gate: UAT Burn-down & Screenshot Coverage | Complete |
| LIVE-06 | Phase 50 — Live-Loop Gate: UAT Burn-down & Screenshot Coverage | Complete |
| RSKN-01 | Phase 51 — Total UI Re-skin | Complete |
| RSKN-02 | Phase 51 — Total UI Re-skin | Complete |
| RSKN-03 | Phase 51 — Total UI Re-skin | Complete |
| RSKN-04 | Phase 51 — Total UI Re-skin | Pending |
| RSKN-05 | Phase 51 — Total UI Re-skin | Complete |
| RSKN-06 | Phase 51 — Total UI Re-skin | Complete |
| RSKN-07 | Phase 51 — Total UI Re-skin | Pending |
| PANL-01 | Phase 52 — Editable Genui Panels / Studio-on-Canvas | Pending |
| PANL-02 | Phase 52 — Editable Genui Panels / Studio-on-Canvas | Pending |
| PANL-03 | Phase 52 — Editable Genui Panels / Studio-on-Canvas | Pending |
| PANL-04 | Phase 52 — Editable Genui Panels / Studio-on-Canvas | Pending |
| MOBL-01 | Phase 53 — Mobile-Responsive Answer | Pending |
| MOBL-02 | Phase 53 — Mobile-Responsive Answer | Pending |
| CLUS-01 | Phase 54 — Email-Cluster Workflow (E3) | Pending |
| CLUS-02 | Phase 54 — Email-Cluster Workflow (E3) | Pending |
| CLUS-03 | Phase 54 — Email-Cluster Workflow (E3) | Pending |
| CLUS-04 | Phase 54 — Email-Cluster Workflow (E3) | Pending |
| CLUS-05 | Phase 54 — Email-Cluster Workflow (E3) | Pending |
| CLUS-06 | Phase 54 — Email-Cluster Workflow (E3) | Pending |
| CLUS-07 | Phase 54 — Email-Cluster Workflow (E3) | Pending |

**Coverage:**
- v1 requirements: 27 total (LIVE 7 + RSKN 7 + MOBL 2 + PANL 4 + CLUS 7)
- Mapped to phases: 27/27 ✓
- Unmapped: 0

---
*Requirements defined: 2026-07-10*
*Last updated: 2026-07-10 — v1.9 ROADMAP.md created (Phases 49–54); 100% coverage, no orphans*
