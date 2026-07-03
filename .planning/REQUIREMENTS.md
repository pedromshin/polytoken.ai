# Requirements: nauta.services.email-listener — Milestone v1.3

**Defined:** 2026-07-02
**Milestone:** v1.3 Conversational GenUI: Chat, Canvas & Dual-Channel
**Core Value:** Reliably receive every inbound email and make it observable. (v1.3 extends the genui engine with a conversational/spatial delivery surface — local/sandbox only.)

## v1.3 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Chat Spine

- [x] **CHAT-01**: User can open `/chat`, send a message, and get an agent response; conversations + messages persist across reload
- [x] **CHAT-02**: User can see a conversation list, switch between chats, rename and delete them
- [x] **CHAT-03**: User can stop an in-flight generation
- [x] **CHAT-04**: User can regenerate the last response without retyping
- [ ] **CHAT-05**: A failed turn shows an inline, retryable error without losing the user's in-flight input
- [x] **CHAT-06**: Composer supports multi-line input, send-on-enter, disabled-while-streaming, and optimistic render of the user's message
- [x] **CHAT-07**: Agent responses render markdown + code blocks; auto-scroll with a jump-to-bottom affordance

### Streaming

- [x] **STREAM-01**: Agent text responses stream live (FastAPI SSE → web) with a visible generating indicator
- [x] **STREAM-02**: Declarative genui specs render progressively as partial trees during generation — render-what's-valid, placeholder the rest (closes GEN-04)
- [x] **STREAM-03**: An application-level cost circuit breaker (per-turn/per-session caps) guards streaming chat, independent of the AWS budget alert

### Canvas

- [ ] **CANVAS-01**: User can view a chat's genui outputs as draggable/pannable panels-as-nodes on a 2D infinite canvas
- [ ] **CANVAS-02**: Canvas layout persists per conversation and restores on reload
- [ ] **CANVAS-03**: Canvas node model admits new node types via a versioned node-type registry (genui-panel + chat now; agent/run later)
- [ ] **CANVAS-04**: Canvas stays responsive while panels stream live content (volatile state outside the `nodes` array, memoized node types)

### Shared State

- [ ] **STATE-01**: Panels on the same canvas read/write a per-chat shared state store
- [ ] **STATE-02**: Data-carrying edges let one panel's output feed another panel's input

### Dual-Channel GenUI

- [ ] **DCUI-01**: Agent can emit proposal cards; clicking one sends a structured result that resumes the run
- [ ] **DCUI-02**: Agent can emit clarify-widgets (forms/pickers from the declarative catalog + v1.2 form engine); submit returns a structured result to the agent
- [ ] **DCUI-03**: Every widget round-trip is server-side re-validated, double-submit-locked, staleness-signaled, and requires explicit user action (never auto-fired)
- [ ] **DCUI-04**: GenUI turns and widget interactions persist in the conversation history and canvas

### Anticipatory Prompting (SPIKE)

- [ ] **ANTIC-01**: SPIKE — a trigger/heuristic layer over chat+canvas state proposes proactive prompts
- [ ] **ANTIC-02**: Proactive prompts are gated by an appropriateness eval + a hard frequency cap, and always require explicit user acceptance

### Seams (v1.5+ readiness)

- [x] **SEAM-03**: Chat turns are modeled as events on a run (run/event schema stub) so future orchestration run-trees reuse the schema
- [x] **SEAM-04**: The chat orchestration loop sits behind an agent/run abstraction (one agent, one run today)

## Future Requirements

Deferred to later milestones. Tracked but not in the current roadmap.

### Design Engine (v1.4)

- **DSGN-01**: Unify-vs-hybrid design-engine lock (code-island primary for appearance; declarative for dual-channel — confirm with continued R1 research)
- **DSGN-02**: Rendered-visual-compare step in the code-island repair loop (highest-leverage R1 finding)
- **DSGN-03**: Promptable design system (shadcn-registry / Design-Systems-2.0-style adapter) as shared conditioning layer
- **DSGN-04**: Screenshot/URL → design-token extraction (URL/DOM path preferred over raster)

### Orchestration Visualizer (v1.5)

- **ORCH-01**: Live orchestration run-tree visualization on the canvas (agent/task-level nodes)

### Carried v1.2 deferrals

- **EVAL-LIFT**: Run the Phase-16 eval harness vs baseline on live Bedrock to measure v1.2 quality lift (DEF-17-05-01/18-03-01/19-01/20-01)
- **ISO-RUN**: Playwright cross-browser code-island isolation run (connected env)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Collaborative rich-text/code document editing (ChatGPT-Canvas-style) | Different product category — OT/diff co-editing is a large separate investment; v1.3 is composed interactive widgets |
| Freeform whiteboard/drawing (tldraw pen/ink/shapes) | Need a structured node/edge graph, not ink; tldraw also requires a commercial license + watermark; duplicates `@xyflow/react` |
| Multiplayer / CRDT (Yjs) | v1.3 is local/sandbox, single-user; snapshot-on-save persistence suffices |
| Auto-executing agent actions from widgets or proactive prompts | Trust-destroying failure mode; MCP Apps mandates explicit user approval — every round-trip is an explicit action |
| Voice / multi-modal input | Not in milestone scope (chat text + widgets + canvas) |
| Orchestration visualizer (run trees, agent nodes) | Deferred to v1.5; v1.3 only leaves the seams open (SEAM-03/04, CANVAS-03) |
| Unbounded chat-history context management | Known gap, flagged not solved; not v1.3-blocking (local, single-user) |
| Deploy / product convergence | v1.3 is explicitly local + sandbox only |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CHAT-01 | Phase 22 | Complete |
| CHAT-02 | Phase 22 | Complete |
| CHAT-03 | Phase 22 | Complete |
| CHAT-04 | Phase 22 | Complete |
| CHAT-05 | Phase 22 | Pending |
| CHAT-06 | Phase 22 | Complete |
| CHAT-07 | Phase 22 | Complete |
| STREAM-01 | Phase 22 | Complete |
| STREAM-02 | Phase 22 | Complete |
| STREAM-03 | Phase 22 | Complete |
| SEAM-03 | Phase 22 | Complete |
| SEAM-04 | Phase 22 | Complete |
| CANVAS-01 | Phase 23 | Pending |
| CANVAS-02 | Phase 23 | Pending |
| CANVAS-03 | Phase 23 | Pending |
| CANVAS-04 | Phase 23 | Pending |
| STATE-01 | Phase 23 | Pending |
| STATE-02 | Phase 23 | Pending |
| DCUI-01 | Phase 24 | Pending |
| DCUI-02 | Phase 24 | Pending |
| DCUI-03 | Phase 24 | Pending |
| DCUI-04 | Phase 24 | Pending |
| ANTIC-01 | Phase 25 | Pending |
| ANTIC-02 | Phase 25 | Pending |

**Coverage:**
- v1.3 requirements: 24 total
- Mapped to phases: 24
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-02*
*Last updated: 2026-07-02 after roadmap creation (Phases 22–25, 100% coverage)*
