# Phase 56: Research Canvas — Backend & Semantic Context Model - Research

**Researched:** 2026-07-15
**Domain:** Postgres/Drizzle schema design, Python hexagonal chat tool-loop extension, tRPC linkage-store seam, promotion-gate reuse (this repo's own existing machinery — no external library research needed)
**Confidence:** HIGH — every claim below is grounded in the actual Phase 54 (CLUS-01..06) implementation this phase extends, read directly from the working tree, not from training-data assumptions about generic "AI research canvas" architecture.

## Summary

Phase 56 has almost no *new-technology* risk — the hard part is entirely architectural placement inside a codebase that already has three closely-related, deliberately-distinguished mechanisms: (1) the CLUS-04 confirm-ceremony source capture, which RCNV-01 explicitly must NOT resemble; (2) the CLUS-02 durable `chat_conversations.thread_id` linkage, which is D-54's own precedent for "canvas sharedState is not a linkage store" that RCNV-04 must repeat with a new table; and (3) the CLUS-06 thread/cluster context-injection pipeline in `run_chat_turn.py`, which RCNV-04 extends with a second, independent injection pipeline. Nothing in this phase requires a new package — it is two new Postgres tables (migrations 0037/0038), one new Python read/write seam wired into the existing `_run_server_tool_round` tool-loop hook and the existing `_execute_turn` system-prompt assembly, and one new tRPC router file mirroring `chat/thread-link.ts`.

RCNV-01's ledger is a zero-ceremony, zero-knowledge-graph-write table (`chat_source_ledger`) populated automatically the instant a `web_search` tool result passes the existing FOUND-6 envelope-quarantine gate inside `_run_server_tool_round` (`apps/email-listener/app/application/use_cases/run_chat_turn.py:1606-1625`) — contrast with today's `SourceCaptureHandler` (`confirm_action_dispatch.py`), which only fires after the model calls `emit_confirm_action` AND the user clicks confirm in a widget. RCNV-04's linkage store is a new table (`chat_context_edges`) that is structurally incompatible with `chat_canvas_layouts.edges` (that column is Zod-typed to `{sourcePath, targetKey}` declared-state bindings for panel-to-panel field wiring — a "connect this node's whole content into this chat's next-turn context" edge cannot be expressed in that shape, which is exactly why D-54 ruled it out). The read side extends `RunChatTurn._execute_turn`'s existing "assemble a bounded, quarantined DATA block, append to system prompt" pattern (`thread_cluster_context.py`) with a second, independent block that does not depend on thread linkage. The promotion-gate reuse seam is a ~20-line adapter (`PromoteSourceLedgerEntryUseCase` or equivalent) that builds the exact `source_payload` shape `SourceCaptureHandler.execute()` already accepts and calls it verbatim — zero changes to `SourceCaptureHandler`, `PromoteEdgeUseCase`, or the `/v1/knowledge/edges/{id}/promote` REST route.

**Primary recommendation:** Build in this order — (1) migration 0037 `chat_source_ledger` + Drizzle schema, (2) the Python auto-collect hook in `_run_server_tool_round` behind an additive-default `source_ledger` collaborator (mirrors `email_repository`'s pattern exactly), (3) migration 0038 `chat_context_edges` + Drizzle schema + `packages/api-client/src/router/chat/context-edges.ts` (mirrors `thread-link.ts`), (4) the Python read/inject extension as a SECOND, independent fail-open block alongside (not nested inside) the existing thread/cluster pipeline in `_execute_turn`, (5) the promotion-seam adapter proven by a reuse test exactly like `test_source_capture_promote_reuse.py`. Steps 1-2 and steps 3-4 are independently testable and could run as parallel plans; step 5 depends on step 1's table existing.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Auto-collect source ledger write (RCNV-01) | API/Backend (Python, `apps/email-listener`) | Database (Postgres, `chat_source_ledger`) | Must happen server-side, synchronously, inside the existing tool-round loop — the model/client never sees or triggers this write; it is not observable as a "call" at all, only as a row appearing |
| Source ledger read (for future canvas display, Phase 63) | API/Backend (tRPC procedure) | Database | Read-only projection; no visual work this phase, but the seam (`chat.listSourceLedger` or similar) belongs in `packages/api-client` alongside `thread-link.ts`/`cluster-summary.ts` |
| Semantic edge creation (RCNV-04, "draw an edge") | API/Backend (tRPC procedure, ownership-gated) | Database | The canvas UI (Phase 63) is a pure client of this seam; the seam itself must exist and be independently callable/testable this phase per the phase's own Success Criterion #2 wording ("verifiable... backed by a semantic linkage store") |
| Semantic edge read + context injection at turn time | API/Backend (Python, `run_chat_turn.py` + a new domain service) | Database | Mirrors `thread_cluster_context.py` exactly — must be read Python-side because injection happens inside `_execute_turn`, not from the web tier |
| Promotion-gate reuse adapter | API/Backend (Python use case, thin) | — | Wraps existing `SourceCaptureHandler`/`PromoteEdgeUseCase` — no new promotion logic, no new tier semantics |
| Canvas visual edge (sourcePath/targetKey state binding) | Browser/Client (React Flow) | — | Explicitly OUT of scope this phase and structurally distinct (D-54) — noted only to draw the boundary, not touched |

## User Constraints

No `56-CONTEXT.md` exists for this phase (no `/gsd:discuss-phase` pass has run) — this section is therefore assembled from `.planning/REQUIREMENTS.md` and `.planning/ROADMAP.md`'s Phase 56 entry, which function as the locked scope in its absence. The planner should treat every item below as a locked decision, not a discretionary area, unless a `56-CONTEXT.md` is added later.

### Locked (from REQUIREMENTS.md RCNV-01/RCNV-04 + ROADMAP.md Phase 56 entry, verbatim-distilled)
- RCNV-01: sources the agent uses in a conversation (starting with `web_search`, generalizing to other tool outputs later) are auto-collected into a per-conversation source ledger — **no per-turn capture-confirm ceremony**. Today's CLUS-04 `emit_confirm_action`/`source_capture` widget flow is the **explicit anti-goal**, not a pattern to extend for this requirement.
- RCNV-04: connecting a source/generated-table/panel node to a chat node on the canvas injects that node's content as context for that chat — **semantic edges, not visual-only**. Canvas `sharedState` was **explicitly ruled out** as the linkage store per D-54 (`packages/db/src/schema/chat-conversations.ts:17-25`, `.planning/phases/54-email-cluster-workflow-e3/54-CONTEXT.md:33-37`) — "this needs its own design."
- Promotion-gate reuse: the existing suggest-only promotion gate (INFERRED → EXTRACTED) must be reachable from the ledger's records with **zero new promotion code** — Phase 63's canon-curation UX depends on this seam existing.
- No new visual canvas chrome ships in this phase — backend + data model + server seams only. Verification of RCNV-04 must be possible via database/API calls (a direct tRPC call simulating "an edge was drawn"), not a live drag-and-drop UI test.
- RCNV-03 (canvas-level curation UX) is explicitly OUT of this phase's scope — REQUIREMENTS.md line 118-121 states Phase 56 "lays the palette-independent promotion-gate-reuse groundwork it depends on, but does not claim the requirement."

### Claude's Discretion (not explicitly locked — this research's own recommendations, flagged where noted below)
- Exact table/column names for `chat_source_ledger` / `chat_context_edges` (naming convention only is locked: this repo's `chat_*` prefix for chat-conversation-descendant tables).
- Whether migrations 0037/0038 ship as two separate migrations or one combined `drizzle-kit generate` pass covering both schema files (both are additive-only; no ordering dependency between the two tables themselves, only that both must exist before their respective read paths are wired).
- Whether the tier-gate question below (does an edge sourced from an INFERRED knowledge node bypass `list_injectable_edges`'s EXTRACTED-only rule) is resolved by "yes, bypass it, because drawing an edge is an explicit user action, not automatic injection" (this research's recommendation, see Landmines) or requires a stricter rule — **flagged as needing explicit confirmation**, see Assumptions Log A3.

### Deferred (OUT OF SCOPE this phase, from REQUIREMENTS.md)
- RCNV-02 (auto-collected sources appear as canvas nodes) — Phase 63.
- RCNV-03 (canvas-level canon-selection curation UX) — Phase 63.
- RCNV-05 (source-grounded presentation panels) — Phase 63.
- Any visual canvas chrome, node types, or React Flow wiring for either RCNV-01 or RCNV-04's server-side work.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RCNV-01 | Auto-collect every tool result (starting `web_search`) into a per-conversation source ledger, zero capture-confirm ceremony | §"Source Ledger Design" + §"Code Examples" — exact hook point in `_run_server_tool_round`, exact new table `chat_source_ledger`, contrast against CLUS-04's `SourceCaptureHandler` |
| RCNV-04 | Canvas edges from source/table/panel nodes to a chat node inject that node's content as real context, via a semantic linkage store that is NOT `sharedState` | §"Semantic Linkage Store Design" — new table `chat_context_edges`, new tRPC router, extension of `RunChatTurn._execute_turn`'s existing quarantined-injection pattern as an independent second pipeline |

## Standard Stack

No new external packages. This phase is 100% additive within the existing stack already proven by Phase 54:

### Core (already in the repo — verify version if touched, do not add anything new)
| Library | Version (as pinned in repo) | Purpose | Why Standard (for this repo) |
|---------|---------|---------|--------------|
| drizzle-orm / drizzle-kit | pinned in `packages/db/package.json` | Schema + migration authoring | Every existing table in this repo uses it; `drizzle-kit generate` works fully offline (proven live by 54-01 with Docker down) |
| `@trpc/server` + `zod` | pinned in `packages/api-client/package.json` | New router procedures + input validation | `thread-link.ts`/`cluster-summary.ts` are the direct precedent to mirror |
| FastAPI + `dishka` (DI) + `supabase-py` | pinned in `apps/email-listener/pyproject.toml` | Python hexagonal ports/adapters + DI wiring | `container.py`'s `_provide_run_chat_turn` factory is the exact wiring point; `SupabaseKnowledgeGraphRepository` is the adapter-shape precedent |
| `structlog` | pinned | Fail-open logging on every new read/write path | Every existing fail-open helper (`_resolve_thread_id`, `_list_captured_sources`, etc.) logs a warning and degrades — new code must match this convention exactly |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| A dedicated `chat_context_edges` table | Reusing/extending `knowledge_node_edges` (already polymorphic via `target_ref_id`/`target_ref_type`) | Rejected: `knowledge_node_edges.source_node_id` is a hard FK to `knowledge_nodes` — a source-ledger row, a genui panel, or an email thread are NOT `knowledge_nodes` rows, so the FK would have to be dropped or the ledger/panel/thread would have to be shoehorned into `knowledge_nodes` just to get an edge row, which conflates "this is confirmable knowledge" with "this is context I explicitly want injected right now" — exactly the distinction 999.19 itself draws ("a per-conversation source LEDGER... is not the knowledge graph"). A dedicated table keeps the tier ladder's meaning intact. |
| A jsonb `source_ref` column alone on `chat_context_edges` | Separate nullable typed columns per source kind (`source_ledger_id`, `knowledge_node_id`, `genui_message_id`+`genui_part_index`, `thread_id`) | Either works; this research recommends the jsonb approach (see Code Examples) because it mirrors `apps/web/.../node-data-schemas.ts`'s existing per-type discriminated-union convention (`KnowledgePreviewNodeDataSchema`/`GenuiPanelNodeDataSchema`/`EmailThreadNodeDataSchema`) and needs no schema migration when Phase 63 adds a 5th source kind — cost is a derived `source_ref_key text` column for the supersede-identity index (see below), which is cheap and has direct precedent (`knowledge_node_edges.idx_knowledge_node_edges_active_identity`). |

**Installation:** None — no new dependencies for either package.json or pyproject.toml.

**Version verification:** N/A — no new package versions to verify.

## Package Legitimacy Audit

Not applicable — this phase installs zero external packages. Skip the slopcheck/registry-verification protocol entirely; there is nothing to audit.

## Architecture Patterns

### System Architecture Diagram

```
RCNV-01 — Auto-collect source ledger
──────────────────────────────────────────────────────────────────────────
 model calls web_search tool
        │
        ▼
 _run_server_tool_round()  (run_chat_turn.py:1533)
        │  executor.execute(...) → ToolExecutionResult
        ▼
 validate_tool_envelope(result.content)   [FOUND-6 quarantine gate — UNCHANGED]
        │  gate.ok == True (never on gate failure / is_error / non-web_search tool)
        ▼
 ★ NEW HOOK ★  _write_source_ledger_entries(run.conversation_id, importer_id,
                tool_name, tool_use_id, result.content)
        │  parses the ALREADY-quarantined+bounded JSON envelope
        │  {mode:"web_search", results:[{title,url,snippet}, ...]}
        ▼
 chat_source_ledger  (Postgres, migration 0037)
        one row per {conversation_id, tool_use_id, result_index}
        NO write to knowledge_nodes / knowledge_node_edges — zero-ceremony,
        zero-knowledge-graph-write, purely a candidate pool (999.19's own framing)


RCNV-04 — Edges-as-context
──────────────────────────────────────────────────────────────────────────
 (Phase 63, future) canvas edge drawn: source-node → chat-node
        │
        ▼
 tRPC chat.createContextEdge({ targetConversationId, sourceRef })
   packages/api-client/src/router/chat/context-edges.ts  ★ NEW ★
        │  assertConversationOwnership(targetConversationId)
        │  + per-sourceRef.type ownership check (knowledge node → importer
        │    owned; source ledger row → its conversation owned; genui panel
        │    → its message's conversation owned; email thread → thread owned)
        ▼
 chat_context_edges  (Postgres, migration 0038)
        supersede-safe: is_active identity index on
        (target_conversation_id, source_ref_key) WHERE is_active


 ...next chat turn on the target conversation...
        │
        ▼
 RunChatTurn._execute_turn()  (run_chat_turn.py:755)
        │  EXISTING: _system_prompt_with_cluster_context(...)   [thread/cluster — untouched]
        │  ★ NEW, INDEPENDENT ★: _system_prompt_with_linked_context(...)
        │        ChatContextEdgeRepository.list_active_context_edges(conversation_id)
        │        per-type resolver:
        │          source_ledger  → chat_source_ledger row (title/url/snippet)
        │          knowledge_node → knowledge_nodes row (title/content) — ANY
        │                           active tier, see Landmines (bypasses
        │                           list_injectable_edges's EXTRACTED-only gate
        │                           by design — explicit user action, not
        │                           automatic injection)
        │          genui_panel    → chat_messages row → parts[partIndex] where
        │                           type == "genui_spec" → spec._plan / summary
        │          email_thread   → EmailRepository.list_by_thread_id (reuses
        │                           the CLUS-02 read, Phase 54-05)
        │        assembled via a NEW build_linked_context_block(), same
        │        truncate_field/budget discipline as thread_cluster_context.py
        ▼
 system_prompt += "--- BEGIN LINKED CONTEXT (untrusted data...) ---" block
        ▼
 model sees the injected content this turn — same "DATA, never instructions"
 quarantine framing as every other injected block in this codebase


Promotion-gate reuse seam
──────────────────────────────────────────────────────────────────────────
 (Phase 63, future) user selects a ledger row into their canon
        │
        ▼
 PromoteSourceLedgerEntryUseCase  ★ NEW, THIN ★  (~20 lines)
        │  reads chat_source_ledger row → builds source_payload
        │  {url, title, retrievedAt: capturedAt}
        ▼
 SourceCaptureHandler.execute(action="confirm", source_payload=..., 
                                conversation_id=..., importer_id=...)
        [UNCHANGED — confirm_action_dispatch.py]
        ▼
 knowledge_nodes (INFERRED) + knowledge_node_edges (INFERRED)
        ▼
 PromoteEdgeUseCase.execute(edge_id=...)   [UNCHANGED — promote_edge.py]
        ▼
 knowledge_node_edges.tier = 'EXTRACTED'
        │
        ▼
 UPDATE chat_source_ledger SET knowledge_node_id = <node_id>
        (so a future read can show "already captured" state — the ONE new
        write this seam performs beyond the reused promotion machinery)
```

### Recommended Project Structure

New files only — every directory below already exists and holds direct siblings to mirror:

```
packages/db/migrations/
├── 0037_chat_source_ledger.sql              # NEW — mirrors 0036's single-purpose, additive-only shape
├── meta/0037_snapshot.json                  # NEW — drizzle-kit generate output
├── 0038_chat_context_edges.sql              # NEW (or combined into 0037 — planner's call)
└── meta/0038_snapshot.json                  # NEW

packages/db/src/schema/
├── chat-source-ledger.ts                    # NEW — mirrors chat-cost-ledger.ts's shape/naming
├── chat-context-edges.ts                    # NEW — mirrors knowledge-node-edges.ts's polymorphic-edge shape
└── index.ts                                 # MODIFIED — append 2 export lines after chat-widget-interactions.ts

packages/api-client/src/router/chat/
├── context-edges.ts                         # NEW — mirrors thread-link.ts exactly (procedures + ownership)
├── source-ledger.ts                         # NEW (read-only projection for Phase 63; optional this phase
│                                             #   but cheap to land now since the table already exists)
├── __tests__/context-edges.test.ts          # NEW
└── index.ts                                 # MODIFIED — register the 1-2 new procedure groups

apps/email-listener/app/domain/ports/
├── source_ledger_repository.py              # NEW port — mirrors knowledge_graph_repository.py's Protocol shape
└── chat_context_edge_repository.py          # NEW port

apps/email-listener/app/domain/services/
├── linked_context.py                        # NEW — mirrors thread_cluster_context.py exactly (pure,
│                                             #   stdlib-only, local truncate_field reimplementation)
└── __tests__/test_linked_context.py         # NEW

apps/email-listener/app/infrastructure/supabase/
├── source_ledger_repository.py              # NEW adapter — mirrors knowledge_graph_repository.py's
│                                             #   _node_to_row/insert/select idiom
└── chat_context_edge_repository.py          # NEW adapter

apps/email-listener/app/application/use_cases/
├── run_chat_turn.py                          # MODIFIED — new hook in _run_server_tool_round (RCNV-01) +
│                                             #   new _system_prompt_with_linked_context (RCNV-04)
├── promote_source_ledger_entry.py            # NEW — the ~20-line reuse-seam adapter
└── tests / __tests__ additions mirroring 54-03/54-05's exact test file naming convention

apps/email-listener/app/container.py          # MODIFIED — 2 new provider.provide() registrations,
                                              # source_ledger threaded into _provide_run_chat_turn
                                              # (additive-default param, mirrors email_repository)

apps/email-listener/app/settings.py           # POSSIBLY MODIFIED — see Open Questions on whether a
                                              # SOURCE_LEDGER_ENABLED-style flag is warranted (this
                                              # research recommends NOT gating it — see Pitfall 4)
```

### Pattern 1: Auto-collect hook inside the existing tool-round loop (RCNV-01)

**What:** A fail-open write, triggered synchronously inside `_run_server_tool_round`, immediately after the FOUND-6 envelope-quarantine gate passes and before the result is fed back to the model. No model action, no widget, no user click.

**When to use:** Exactly once per real `ToolExecutorResult` whose `tool_name` is in a small allowlist (starting with just `web_search`) and whose `is_error` is `False` and whose envelope passed `validate_tool_envelope`.

**Why this hook point, not `_finalize_source_capture`:** `_finalize_source_capture` (line 1081) only runs when the model *chooses* to call `emit_confirm_action` with `suggestionRef.kind == "source_capture"` — that is CLUS-04's ceremony path, the requirement's own explicit anti-goal. `_run_server_tool_round` runs unconditionally for every real tool call, which is the only place in the codebase a "no ceremony, no confirm, just happens" write can live.

**Example (illustrative — not the literal diff, but matches the codebase's own style exactly):**
```python
# Source: apps/email-listener/app/application/use_cases/run_chat_turn.py:1600-1625
# (existing code, annotated with the recommended insertion point)

if result.is_error is False:
    gate = validate_tool_envelope(result.content)
    if gate.ok is False:
        ...
        result = ToolExecutionResult(tool_use_id=tool_id, content=_TOOL_ENVELOPE_INVALID_TEXT, is_error=True)

result = replace(result, tool_use_id=tool_id, content=cap_tool_output(result.content))
results.append(result)

# ★ NEW (RCNV-01): fail-open, never raises, never blocks the round.
if self._source_ledger is not None and result.is_error is False and tool_name in self._LEDGER_ELIGIBLE_TOOL_NAMES:
    await self._write_source_ledger_entries(
        conversation_id=run.conversation_id,
        importer_id=importer_id,
        tool_name=tool_name,
        tool_use_id=tool_id,
        content=result.content,
    )

result_part = build_tool_invocation_result_part(result, tool_name)
state = replace(state, parts=(*state.parts, result_part))
```

`_write_source_ledger_entries` itself must follow the SAME fail-open convention as `_list_captured_sources`/`_resolve_thread_id`: `try: ... json.loads(content) ... await self._source_ledger.insert_entries(...) except Exception: logger.warning(...); return` — a malformed envelope (should be structurally impossible post-gate, but defend anyway) must never raise past the tool round and must never block the model's turn.

`WebSearchExecutor`'s own `_ENVELOPE_BUDGET_CHARS=1900` cap (`web_search_executor.py:78`) already guarantees `cap_tool_output`'s later truncation is a documented no-op for this specific tool — so `json.loads(result.content)` at this point is safe by construction for `web_search`. A future second ledger-eligible tool must either honor the same envelope-budget discipline or the ledger-write helper must defensively `try/except json.JSONDecodeError` and skip (never crash the turn on an unparseable envelope from a not-yet-audited tool).

`self._source_ledger` should be an ADDITIVE-DEFAULT constructor param (`source_ledger: SourceLedgerRepository | None = None`) on `RunChatTurn.__init__`, mirroring `email_repository`'s exact posture (`run_chat_turn.py:344,381`) — every existing test/caller that doesn't pass it stays green, and the entire feature is structurally off when unwired.

### Pattern 2: Semantic linkage store as its own table, never `sharedState` (RCNV-04)

**What:** A new `chat_context_edges` table, durable Postgres rows, ownership-scoped via the SAME `assertConversationOwnership` chokepoint every other chat-descendant table already uses.

**When to use:** Any time the canvas (Phase 63, not this phase) draws an edge from a source/table/panel node to a chat node.

**Why not `chat_canvas_layouts.edges`:** That column's Zod shape (`packages/api-client/src/router/chat/canvas-schema.ts:113-135`) is `.strict()`-typed to exactly `{sourcePath: string, targetKey: string}` — a declared-state binding grammar for panel-to-panel field wiring (`apps/web/.../chat-canvas.tsx:634-698`'s `EdgeCreationPicker` flow), not a content-injection reference. A "chat" node has no declared-state fields to bind a `targetKey` into. This is the concrete, code-level reason D-54 ruled `sharedState` out, not just a policy statement — the shape genuinely cannot express the RCNV-04 relationship. `chat_canvas_layouts` is also purely a **visual restore snapshot** (its own docstring: "one row per conversation... the exact-restore snapshot"), single-row-per-conversation via a unique index — RCNV-04 needs potentially many source→chat edges, independently created/removed, addressable and readable server-side at turn time, matching D-54's own stated requirement ("linkage must survive canvas changes and be readable at turn time server-side").

**Example (recommended schema shape):**
```typescript
// Source: packages/db/src/schema/chat-context-edges.ts (NEW — mirrors
// knowledge-node-edges.ts's polymorphic-edge idiom + chat-conversations.ts's
// D-54 doc-comment precedent)
export const ChatContextEdges = pgTable(
  "chat_context_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    targetConversationId: uuid("target_conversation_id")
      .notNull()
      .references(() => ChatConversations.id, { onDelete: "cascade" }),

    // Discriminated union, mirrors apps/web's node-data-schemas.ts per-type
    // shapes verbatim: {type:"source_ledger", ledgerId} |
    // {type:"knowledge_node", nodeId} |
    // {type:"genui_panel", messageId, partIndex} |
    // {type:"email_thread", threadId}
    sourceRef: jsonb("source_ref").notNull(),

    // Derived, stable string form of sourceRef (e.g.
    // "knowledge_node:<uuid>", "genui_panel:<uuid>:<int>") — mirrors the
    // {toolUseId}:{index} composite-key precedent (54-03) and
    // knowledge_node_edges' own active-identity index shape exactly.
    sourceRefKey: text("source_ref_key").notNull(),

    // Supersede-never-delete (mirrors knowledge_node_edges.isActive) —
    // removing a canvas edge deactivates, preserving the injection audit
    // trail ("this chat WAS informed by X during turns N-M").
    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    chatContextEdgesTargetIdx: index("idx_chat_context_edges_target_conversation_id")
      .on(t.targetConversationId),
    // Mirrors knowledge_node_edges' idx_knowledge_node_edges_active_identity
    // (partial unique index, WHERE is_active) — at most one active edge per
    // (target conversation, exact source) pair.
    chatContextEdgesActiveIdentityIdx: uniqueIndex("idx_chat_context_edges_active_identity")
      .on(t.targetConversationId, t.sourceRefKey)
      .where(sql`is_active`),
  }),
);
```

**tRPC seam (mirrors `packages/api-client/src/router/chat/thread-link.ts` exactly):**
```typescript
// Source: packages/api-client/src/router/chat/context-edges.ts (NEW)
export const chatContextEdgeProcedures = {
  createContextEdge: protectedProcedure
    .input(createContextEdgeInputSchema) // { targetConversationId, sourceRef: discriminatedUnion }
    .mutation(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertConversationOwnership(ctx.db, input.targetConversationId, ctx.user.id),
      );
      await assertSourceRefOwnership(ctx.db, ctx.user.id, input.sourceRef); // NEW helper —
      // dispatches to assertComponentOwnership-style checks per sourceRef.type:
      //   knowledge_node -> join knowledge_nodes -> importers.user_id
      //   source_ledger  -> join chat_source_ledger -> chat_conversations.user_id
      //   genui_panel    -> join chat_messages -> chat_conversations.user_id
      //   email_thread   -> assertThreadOwnership (already exists, ownership.ts)
      // ... upsert-or-reactivate on (targetConversationId, sourceRefKey)
    }),
  removeContextEdge: protectedProcedure /* soft-delete, ownership via join */,
  listContextEdges: protectedProcedure /* read, for Phase 63's canvas + this phase's own tests */,
};
```

### Pattern 3: Context injection as a SECOND, independent fail-open pipeline

**What:** `_execute_turn` currently builds `system_prompt` via ONE call: `_system_prompt_with_cluster_context(...)`, which internally short-circuits to the base prompt unless `self._email_repository is not None AND a thread is linked AND that thread has emails`. RCNV-04 must NOT be nested inside that gate — a conversation with zero thread linkage must still be able to receive linked-edge context.

**When to use:** Compose a NEW, sibling call — `_system_prompt_with_linked_context` — chained after (or before; order only matters for budget allocation, see below) the existing cluster-context call, each independently fail-open, each independently a no-op when its own collaborator is unwired or its own read returns nothing.

**Example:**
```python
# Source: apps/email-listener/app/application/use_cases/run_chat_turn.py:794-799 (existing)
system_prompt = await self._system_prompt_with_cluster_context(
    base_system_prompt=_system_prompt_for(tool_round_eligible),
    conversation_id=conversation_id,
    importer_id=importer_id,
    history=history,
)
# ★ NEW, INDEPENDENT of thread linkage — RCNV-04 ★
system_prompt = await self._system_prompt_with_linked_context(
    base_system_prompt=system_prompt,
    conversation_id=conversation_id,
    importer_id=importer_id,
)
```

`_system_prompt_with_linked_context` mirrors `_system_prompt_with_cluster_context`'s exact shape: call `self._context_edges.list_active_context_edges(conversation_id)` (fail-open, `[]` on any error / unwired collaborator), resolve each edge's `sourceRef` to injectable text via a per-type dispatch (new pure function, NOT a giant if/elif inline — mirror `_extract_panel_titles`'s style of a small dedicated helper), assemble via a NEW `build_linked_context_block` in a NEW `linked_context.py` domain service that is a structural sibling of `thread_cluster_context.py` (same local `truncate_field` reimplementation — domain cannot import infrastructure, same lint-imports contract), same `--- BEGIN LINKED CONTEXT (untrusted data...) ---` / `--- END ... ---` wrapper convention, and append.

**Budget composition:** `thread_cluster_context.py`'s `assemble_cluster_context` already reserves `_CLUSTER_METADATA_RESERVED_CHARS` off the top for cluster metadata before the (usually larger) thread block. The planner should decide whether linked-context gets its own fixed budget (simplest, safest — e.g. `DEFAULT_LINKED_CONTEXT_BUDGET_CHARS = 2000`, additive to the existing `DEFAULT_TOTAL_BUDGET_CHARS`, since these two blocks are now genuinely independent injections, not one combined budget) or is folded into one combined budget function. This research recommends the SIMPLER independent-budget approach — two separate capped blocks, two separate budgets — over trying to retrofit `assemble_cluster_context`'s reservation math to a third bucket, since RCNV-04 context can be injected on a conversation that has NO thread linkage at all (the two features are orthogonal, not nested).

### Pattern 4: Promotion-gate reuse — adapter, not new machinery

**What:** `SourceCaptureHandler.execute()` (`confirm_action_dispatch.py:218-291`) already accepts exactly the shape a ledger row needs to produce: `source_payload={"url":..., "title":..., "retrievedAt":...}`, plus `conversation_id`/`importer_id`. It already does the INFERRED node upsert (dedupe via `uuid5(NAMESPACE_URL, url)`) + INFERRED edge insert + is promotable through the completely unchanged `PromoteEdgeUseCase`.

**When to use:** Whenever Phase 63's canon-curation UX (not this phase) needs to promote a `chat_source_ledger` row into the knowledge graph.

**Example:**
```python
# Source: apps/email-listener/app/application/use_cases/promote_source_ledger_entry.py (NEW, ~20 lines)
class PromoteSourceLedgerEntryUseCase:
    """Adapts a chat_source_ledger row onto the UNCHANGED SourceCaptureHandler.

    Zero new promotion machinery (RCNV-01's reuse-seam constraint) — this
    class only reshapes a ledger row into the exact source_payload shape
    SourceCaptureHandler already accepts, then calls it verbatim.
    """

    def __init__(self, *, source_ledger: SourceLedgerRepository, source_capture: SourceCaptureHandler) -> None:
        self._source_ledger = source_ledger
        self._source_capture = source_capture

    async def execute(self, *, ledger_entry_id: str, importer_id: str) -> ConfirmActionResult:
        entry = await self._source_ledger.get(ledger_entry_id)
        if entry is None:
            return {"status": "capture_failed"}
        result = await self._source_capture.execute(
            action="confirm",
            suggestion_id=ledger_entry_id,  # lookup key only, never trusted content
            importer_id=importer_id,
            widget_interaction_id="",       # no widget in this path — RCNV-01's anti-ceremony intent
            source_payload={"url": entry.url, "title": entry.title, "retrievedAt": entry.captured_at.isoformat()},
            conversation_id=entry.conversation_id,
        )
        if result.get("status") == "captured":
            await self._source_ledger.set_knowledge_node_id(ledger_entry_id, str(result["node_id"]))
        return result
```
`git diff --stat` on `confirm_action_dispatch.py`/`promote_edge.py` after this phase should show ZERO changes — exactly the proof pattern `test_source_capture_promote_reuse.py` already established for CLUS-05 (`54-03-SUMMARY.md:81`). This phase's own equivalent test should assert the identical thing for the ledger path.

### Anti-Patterns to Avoid

- **Writing to `knowledge_nodes`/`knowledge_node_edges` directly from the auto-collect hook.** 999.19's own framing is explicit: "a per-conversation source LEDGER visible on canvas is NOT the knowledge graph." The ledger table is a completely separate, zero-knowledge-graph-write candidate pool. Only the (Phase 63) promotion action writes to the knowledge graph, and only via the unchanged `SourceCaptureHandler`.
- **Reusing `emit_confirm_action`/`SUGGESTION_KIND_SOURCE_CAPTURE` for the auto-collect path.** That machinery's entire design point is "the model proposes, the user confirms" — RCNV-01 requires the opposite: no proposal, no confirmation, just happens.
- **Nesting the RCNV-04 injection inside `_build_cluster_context_block`'s existing thread-linkage gate.** A conversation must be able to receive linked-edge context with zero thread attached. Keep it a structurally separate call.
- **Storing `sharedState`-shaped data in `chat_context_edges.sourceRef`** (e.g., letting it carry arbitrary Object literals mirroring canvas node.data). Keep `sourceRef` a small, versioned, discriminated-union shape validated at the tRPC boundary — the same FOUND-6 "all untrusted input crosses a schema gate" discipline every other boundary in this codebase already follows.
- **Skipping `assertConversationOwnership` (or the equivalent per-`sourceRef.type` ownership check) on `createContextEdge`.** A caller must not be able to wire a foreign user's knowledge node or another tenant's ledger row into their own conversation's context — this is a concrete cross-tenant data-injection vector if unchecked (see Landmines).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Envelope quarantine / prompt-injection hardening for injected text | A new "wrap untrusted text safely" mechanism | The existing `--- BEGIN ... ---`/`--- END ... ---` labeled-block convention + `truncate_field` idiom (`thread_cluster_context.py`) — reimplement it locally in the new `linked_context.py` (domain cannot import infrastructure), do not invent a new framing | This codebase has ALREADY solved "how do we quarantine untrusted retrieved text inside a system prompt" three times (tool envelopes, thread/cluster context, and the original FOUND-6 gate) — a fourth bespoke mechanism is pure risk for zero benefit |
| Tenancy/ownership checks on the new tables | Ad-hoc per-procedure SQL joins | `packages/db/src/ownership.ts`'s existing `assertConversationOwnership`/`assertImporterOwnership`/`assertThreadOwnership` + a new `assertSourceRefOwnership` dispatcher that CALLS these, never reimplements them | `ownership.ts`'s own docstring states it is "the ONE central ownership helper" every tRPC procedure goes through — bypassing it for the two new tables would be the exact anti-pattern Phase 44 was built to eliminate |
| Feature-detecting whether migration 0037/0038 has been applied yet | A bespoke retry/probe mechanism | The exact `tableColumnExists` idiom (`packages/api-client/src/router/_column-detect.ts`) for TS reads, and the exact bare `except Exception: logger.warning(...); return []`/`None` fail-open idiom (used identically in `_resolve_thread_id`, `_list_captured_sources`, `_list_sibling_conversations`) for Python reads | A brand-new table has the identical "deployed before migrated" risk 0036 already solved twice (TS side + Python side) — reuse both proven mechanisms rather than inventing a third |
| Node-content resolution per source type (source ledger / knowledge node / genui panel / email thread) | A generic "resolve any ref to text" polymorphic resolver | Small, explicit per-type functions (mirrors `_extract_panel_titles`'s existing style: one focused helper per concern, not a generic dispatcher) | This codebase consistently prefers small named functions per concrete case over generic polymorphism (see `_list_sibling_conversations`/`_list_captured_sources`/`_list_thread_emails` as three separate methods rather than one generic "gather cluster data" function) — matching that convention keeps the new code reviewable by the same standard |

**Key insight:** Every hard problem this phase touches (quarantine, tenancy, feature-detection-of-unapplied-migrations, bounded/budgeted context assembly) has already been solved once in this exact codebase within the last 3 days (Phase 54). The research risk here is not "does a solution exist" — it is "did you find and mirror the existing solution instead of re-deriving a slightly different one." Every pattern above names the exact file to copy.

## Common Pitfalls

### Pitfall 1: `cap_tool_output`'s mid-JSON truncation silently breaking the ledger write
**What goes wrong:** `_run_server_tool_round` truncates `result.content` via `cap_tool_output(..., limit=MAX_TOOL_OUTPUT_CHARS=2000)` (`tool_executor.py:27`) BEFORE the ledger-write hook (per the recommended insertion point in Pattern 1) would parse it. If a future ledger-eligible tool's envelope is NOT bounded the way `WebSearchExecutor._execute_search` deliberately bounds itself to 1900 chars (`web_search_executor.py:67-78`), `cap_tool_output` can truncate mid-JSON-object, producing `...[truncated]` appended to invalid JSON.
**Why it happens:** `WebSearchExecutor` is the only executor today that pre-budgets its own envelope specifically so `cap_tool_output`'s later truncation is a documented no-op — this is a LOCAL guarantee of that one executor, not a structural guarantee of the `ToolExecutor` port.
**How to avoid:** The ledger-write helper must `try: json.loads(content) except (json.JSONDecodeError, TypeError): logger.warning(...); return` — never assume the envelope parses. For `web_search` specifically this will never trigger (by `WebSearchExecutor`'s own design), but the helper must not assume that holds for every future ledger-eligible tool name.
**Warning signs:** A ledger row silently never appears for a tool call that clearly returned data — check for the swallowed JSONDecodeError in logs before assuming the hook itself isn't wired.

### Pitfall 2: Tenancy column confusion — `chat_conversations` is direct-`user_id`, not importer-descendant
**What goes wrong:** Copying `knowledge_nodes`' importer-only scoping model onto `chat_source_ledger`/`chat_context_edges` and forgetting that `chat_conversations` (the tables' actual ownership ancestor) is scoped DIRECTLY by `user_id`, not transitively through `importers` (`packages/db/src/schema/chat-conversations.ts:13-15`: "chat_conversations is NOT an importer-descendant... it gets a DIRECT user_id").
**Why it happens:** Every OTHER new table this phase's nearest precedent (Phase 54) touched (`threads`, `knowledge_nodes`) IS importer-descendant, making importer-scoping the "default" pattern to reach for.
**How to avoid:** Both new tables should resolve tenancy via `conversationId` → `assertConversationOwnership` (exactly like `chat_messages`/`chat_runs`/`chat_canvas_layouts`/`chat_widget_interactions` already do per `ownership.ts`'s own docstring, line 10-14) — NOT via a direct or transitive `importer_id`/`user_id` column check. An `importer_id` column on `chat_source_ledger` is fine to keep as a denormalized query-convenience/audit field, but it must never be the authority for an ownership check.
**Warning signs:** A tRPC procedure that queries `chat_source_ledger`/`chat_context_edges` by `importer_id` alone without first asserting the caller owns the `conversation_id` on the row is a cross-tenant read bug.

### Pitfall 3: `list_injectable_edges`'s EXTRACTED-only gate does not automatically apply to RCNV-04
**What goes wrong:** Assuming the existing `KnowledgeGraphRepository.list_injectable_edges` (EXTRACTED-tier-only, `knowledge_graph_repository.py:92-103`, "no future prompt-injection consumer may bypass this gate") is the read path a `knowledge_node`-typed `chat_context_edges.sourceRef` must go through — it is architecturally the WRONG read for this case (see Landmine 3 below), but a naive implementation will reach for it because it is the only existing "read a node for injection" precedent in the codebase.
**Why it happens:** `list_injectable_edges`'s docstring is written in absolute language ("no future... consumer may bypass this gate") that reads as a hard global rule, but its actual purpose (stated in the same docstring) is gating AUTOMATIC/BLIND injection, not an explicit, addressed, user-drawn single edge.
**How to avoid:** Read the target node directly (a simple `find_active_node`/new "get by id" read, tier-agnostic), and rely on the SAME "DATA, never instructions" quarantine wrapper every other injected block uses to neutralize the trust question — the tier ladder governs whether content is AUTOMATICALLY trusted as background knowledge, not whether an explicitly-selected single item may be shown to the model as quarantined data this one turn. This is flagged in the Assumptions Log as needing explicit confirmation, since it is a genuine suggest-only-stance judgment call, not a settled fact.
**Warning signs:** If the planner instead decides only EXTRACTED-tier knowledge nodes may ever be edge-targets, RCNV-04 becomes far less useful (INFERRED-tier is the default tier for everything not yet promoted, including every freshly-captured source) — worth surfacing to the user explicitly rather than silently picking either interpretation.

### Pitfall 4: Should the auto-collect hook be behind its own kill-switch flag?
**What goes wrong:** Every existing tool that reaches untrusted external content (`search_knowledge`, `web_search`) ships behind a `SETTINGS.*_TOOL_ENABLED` flag gated on an adversarial fixture suite passing FIRST (`settings.py:149-172`). A naive read of that convention might suggest RCNV-01 needs its own new flag.
**Why it happens:** Pattern-matching "this touches web_search's output" to "this needs the same exposure-gate discipline as web_search itself."
**How to avoid:** The auto-collect hook does not introduce a NEW attack surface — it writes ALREADY-quarantined, ALREADY-gated content (post `validate_tool_envelope`) into a NEW table, structurally identical in risk profile to `SourceCaptureHandler`'s existing (ungated) write path, which has no exposure flag of its own (only the underlying `web_search`/`search_knowledge` tools do). This research recommends NOT adding a new settings flag for the ledger write itself — gating should be inherited transitively (the ledger only ever fires for `WEB_SEARCH_TOOL_ENABLED`-gated tool names). Flagged as a discretionary call, not a hard requirement — see Open Questions.
**Warning signs:** N/A — this is a design-time decision, not a runtime symptom.

### Pitfall 5: Migration numbering / journal `idx` drift
**What goes wrong:** Hand-typing the next migration's journal `idx`/`when` values instead of reading the live `packages/db/migrations/meta/_journal.json` at execution time — Phase 54-01 hit exactly this (`54-01-SUMMARY.md`'s Deviation #1: the plan assumed idx 35, the actual next-available was 36).
**Why it happens:** A plan authored ahead of execution can go stale if another migration lands in between planning and execution.
**How to avoid:** At execution time, run `drizzle-kit generate` (offline-capable per the 54-01 precedent: `npx dotenv -e ../../.env.local -- drizzle-kit generate`, no live DB connection required) and let it compute the next migration number/snapshot chain itself, rather than hand-authoring. As of this research (2026-07-15), the last applied/authored migration is **0036** (`packages/db/migrations/meta/_journal.json`, last entry `idx: 36, tag: "0036_chat_conversation_thread_id"`) — so 0037 is the next-available number, but the planner/executor should re-verify this at execution time rather than trust this research's snapshot, exactly as the pitfall describes.
**Warning signs:** `drizzle-kit generate` erroring on a journal/snapshot chain mismatch, or a duplicate `idx`.

## Migration Lockstep

This repo's migration discipline is strict — every file below must land together, in the same plan/commit, per the established (0031-0036) convention:

| Layer | File(s) | What changes |
|-------|---------|--------------|
| SQL migration | `packages/db/migrations/0037_*.sql` (+ `0038_*.sql` if split) | `ADD TABLE` statements, additive-only |
| Migration snapshot | `packages/db/migrations/meta/0037_snapshot.json` (+ `0038_...`) | Generated by `drizzle-kit generate`, never hand-authored |
| Migration journal | `packages/db/migrations/meta/_journal.json` | One appended entry per migration; verify `idx` against the LIVE file, not this document (Pitfall 5) |
| Drizzle schema | `packages/db/src/schema/chat-source-ledger.ts`, `chat-context-edges.ts` | New `pgTable` definitions |
| Schema barrel | `packages/db/src/schema/index.ts` | Two new `export * from "./chat-*"` lines, appended AFTER `chat-widget-interactions.ts` per the file's own stated dependency-order convention |
| Python domain port | `apps/email-listener/app/domain/ports/source_ledger_repository.py`, `chat_context_edge_repository.py` | New `Protocol` definitions mirroring `knowledge_graph_repository.py`'s shape |
| Python infra adapter | `apps/email-listener/app/infrastructure/supabase/source_ledger_repository.py`, `chat_context_edge_repository.py` | New Supabase-client adapters, `_x_to_row`/`table().insert()` idiom |
| Python DI wiring | `apps/email-listener/app/container.py` | 2 new `provider.provide(...)` registrations + threading `source_ledger`/`context_edges` into `_provide_run_chat_turn`'s `RunChatTurn(...)` call, additive-default params |
| Python domain service | `apps/email-listener/app/domain/services/linked_context.py` | Pure assembler, mirrors `thread_cluster_context.py` |
| Python use case | `apps/email-listener/app/application/use_cases/run_chat_turn.py` | The two hook points (Patterns 1 and 3) |
| Python use case (new) | `apps/email-listener/app/application/use_cases/promote_source_ledger_entry.py` | The reuse-seam adapter |
| TS tRPC router | `packages/api-client/src/router/chat/context-edges.ts`, `source-ledger.ts` | New procedures, mirror `thread-link.ts` |
| TS router registration | `packages/api-client/src/router/chat/index.ts` | Register the new procedure groups (mirrors how `chatThreadLinkProcedures` was registered in 54-01) |
| Tests (both languages) | Mirror the exact file-naming convention Phase 54 established: `tests/application/test_*.py`, `app/domain/services/__tests__/test_*.py`, `packages/api-client/src/router/chat/__tests__/*.test.ts` | TDD RED→GREEN per this repo's CLAUDE.md-inherited workflow discipline |
| `@polytoken/api-client` dist rebuild | `npm run build -w @polytoken/api-client` | Only needed once `apps/web` (Phase 63) becomes a consumer — NOT required this phase since no `apps/web` code is planned to change (54-04's exact gotcha, `54-04-SUMMARY.md` Issues Encountered) — but flag for whichever plan first imports these new procedures from `apps/web` |

**Docker/Supabase-down authoring pattern (if the execution environment repeats Phase 54's overnight conditions):** `drizzle-kit generate` needs no live DB connection (only diffs local schema files against the last snapshot) — migrations 0037/0038 can be authored, schema-typed, and unit-tested against fakes/mocks with Docker fully down, exactly as 0036 was. Applying them (local → staging → prod) is a separate, later step that DOES need connectivity — do not conflate "authored" with "applied" in the plan's success criteria, matching 54-01's own explicit distinction.

## Sequencing + Blast Radius

Recommended plan order (mirrors Phase 54's own successful wave structure):

1. **Migration 0037 + `chat_source_ledger` schema + Drizzle types.** Zero behavior change on its own — purely additive DDL. Independently testable (schema exists, table is queryable).
2. **Python auto-collect hook (RCNV-01 core).** New port + adapter + `RunChatTurn` hook, additive-default collaborator. Independently testable via `_run_server_tool_round`'s existing test harness (fake executor → assert a ledger-insert call happened) without touching migration 0038 at all. **This alone satisfies RCNV-01 and the phase's Success Criterion #1.**
3. **Migration 0038 + `chat_context_edges` schema + Drizzle types + tRPC router.** Independent of steps 1-2 (different table, different procedures) — could run IN PARALLEL with steps 1-2 as a separate plan/wave.
4. **Python linked-context read/inject extension (RCNV-04 core).** Depends on step 3's table existing (needs something to read) but is otherwise independent of step 2's write hook — a `chat_context_edges` row can point at a `knowledge_node`/`genui_panel`/`email_thread` today even before step 2 ships a `source_ledger`-typed edge target (that specific sourceRef.type just wouldn't resolve to anything until step 2 lands). **This alone satisfies RCNV-04 and the phase's Success Criterion #2**, verifiable via a direct tRPC `createContextEdge` call + a subsequent chat turn, per the phase's own "no visual chrome, but verifiable via database/API" framing.
5. **Promotion-gate reuse seam.** Depends on step 1 (needs `chat_source_ledger` to exist) and the EXISTING unchanged `SourceCaptureHandler`/`PromoteEdgeUseCase` (Phase 54, already shipped). Independently testable via the exact `test_source_capture_promote_reuse.py`-style proof. **This satisfies Success Criterion #3.**

**Parallel-safe pairing:** {1, 2} and {3, 4} are two largely independent tracks (different tables, different read/write paths, different tRPC files) that could execute as two parallel plans within this phase, converging only at step 5 (which needs step 1's table) and at the final `_execute_turn` composition (Pattern 3's two independent system-prompt calls chained together — a small, low-risk merge point).

**Blast radius:** Both new tables are purely additive (no existing table altered, no existing column touched — unlike migration 0036, which added a column to an EXISTING, already-populated table). The `RunChatTurn` changes are two additive hook points inside existing fail-open pipelines — every existing test that doesn't wire the new collaborators is provably unaffected (mirrors the exact regression-guard discipline `test_run_chat_turn_thread_context.py` already established: "thread-unlinked byte-identical to before"). The tRPC changes are two new files + two new lines in `index.ts` — no existing procedure is modified.

## Landmines

### Landmine 1: Quarantine/injection discipline must extend to the NEW block, not just be adjacent to it
Every existing injected block (`_TOOL_RESULT_HARDENING_LINE`, `thread_cluster_context.py`'s `_BLOCK_HEADER`) explicitly tells the model "this is DATA, never instructions" BEFORE any untrusted content appears, and wraps every field in `truncate_field`. The new `linked_context.py`/`build_linked_context_block` MUST repeat this exactly — a source-ledger snippet, a genui panel's `_plan` text, or an email thread body injected via this new path is exactly as untrusted as the SAME content injected via the existing thread/cluster path. There is no reason to relax quarantine just because the content arrived via a canvas edge instead of a thread link — if anything, a `genui_panel`'s content is MODEL-AUTHORED (from a prior turn), which the FOUND-6 gate already treats as needing `safeParse`/allowlist validation at its own boundary; injecting it raw into a NEW conversation's prompt without going back through that same discipline would be a regression.

### Landmine 2: Tenancy — every new table needs the ownership chokepoint, not a bespoke check
Per Pitfall 2 above: `chat_source_ledger` and `chat_context_edges` are BOTH chat-conversation-descendant tables (per Phase 44's own taxonomy in `ownership.ts`), so BOTH resolve tenancy via `assertConversationOwnership`, never via a direct or transitive importer/user check invented ad hoc. `createContextEdge`'s cross-reference ownership check (does the caller also own the THING being pointed at, not just the target conversation) is the genuinely new risk surface this phase introduces — a `knowledge_node`-typed `sourceRef` pointing at another tenant's node, if unchecked, would let that tenant's private knowledge get injected into this caller's chat. This must be validated at write time (`createContextEdge`), not deferred to read time — reads happen server-side in a context (`RunChatTurn`) that has no independent way to re-verify per-edge ownership against the querying user (it only knows `importer_id`, resolved from settings, not a live per-request user identity in the same way the tRPC layer has `ctx.user.id`). **This is the single most important write-time validation this phase must get right.**

### Landmine 3: The tier-ladder / suggest-only invariant — resolve this explicitly, don't guess silently
The suggest-only stance ("nothing enters the knowledge graph without user selection," restated for v1.10 at `REQUIREMENTS.md`'s LEARN-02 and PROJECT.md's Band 5 framing) governs WRITES to the knowledge graph. RCNV-04 is a READ — it does not promote anything, does not flip any tier, does not write to `knowledge_nodes`/`knowledge_node_edges` at all. The open design question (flagged in the Assumptions Log, not silently resolved by this research) is narrower: should a `knowledge_node`-typed edge target be readable/injectable regardless of its tier (INFERRED/AMBIGUOUS/EXTRACTED), or only if EXTRACTED? This research's recommendation — tier-agnostic, because the user's own explicit act of drawing the edge IS the equivalent of "selection" for this one-time, one-conversation injection, distinct from `list_injectable_edges`'s much more dangerous case of AUTOMATIC injection into every prompt regardless of user awareness — should be confirmed with the user before the planner locks it in as a decision, since it is a genuine judgment call about what "suggest-only" means for an explicit-action feature, not a settled fact from existing code.

## Code Examples

### Migration 0037 skeleton
```sql
-- Source: pattern mirrors packages/db/migrations/0036_chat_conversation_thread_id.sql
-- (verify the actual next-available idx/filename via `drizzle-kit generate`
-- at execution time — see Pitfall 5)
CREATE TABLE "chat_source_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversation_id" uuid NOT NULL REFERENCES "chat_conversations"("id") ON DELETE CASCADE,
  "importer_id" uuid,
  "tool_name" text NOT NULL,
  "tool_use_id" text NOT NULL,
  "result_index" integer NOT NULL,
  "url" text NOT NULL,
  "title" text NOT NULL,
  "snippet" text,
  "knowledge_node_id" uuid REFERENCES "knowledge_nodes"("id") ON DELETE SET NULL,
  "captured_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_chat_source_ledger_dedupe"
  ON "chat_source_ledger" ("conversation_id", "tool_use_id", "result_index");--> statement-breakpoint
CREATE INDEX "idx_chat_source_ledger_conversation_id" ON "chat_source_ledger" ("conversation_id");
```

### Python fail-open write helper (RCNV-01)
```python
# Source: pattern mirrors apps/email-listener/app/application/use_cases/
# run_chat_turn.py's existing _list_captured_sources / _resolve_thread_id
# fail-open style exactly.
_LEDGER_ELIGIBLE_TOOL_NAMES = frozenset({_WEB_SEARCH_TOOL_NAME})

async def _write_source_ledger_entries(
    self, *, conversation_id: str, importer_id: str, tool_name: str, tool_use_id: str, content: str
) -> None:
    if self._source_ledger is None:
        return
    try:
        envelope = json.loads(content)
        results = envelope.get("results", []) if isinstance(envelope, dict) else []
        entries = [
            SourceLedgerEntry(
                conversation_id=conversation_id,
                importer_id=importer_id,
                tool_name=tool_name,
                tool_use_id=tool_use_id,
                result_index=index,
                url=str(r["url"]),
                title=str(r.get("title") or r["url"]),
                snippet=str(r.get("snippet")) if r.get("snippet") else None,
            )
            for index, r in enumerate(results)
            if isinstance(r, dict) and r.get("url")
        ]
        if entries:
            await self._source_ledger.insert_entries(entries)
    except Exception:  # never raise past the tool round (port contract mirrors ToolExecutor's own)
        logger.warning("source_ledger_write_failed", tool_use_id=tool_use_id, tool_name=tool_name)
```

## State of the Art

| Old Approach (this codebase, CLUS-04, shipped 2026-07-12) | New Approach (RCNV-01, this phase) | When Changed | Impact |
|--------------------------------------------------------------|------------------------------------|---------------|--------|
| Model calls `emit_confirm_action` → user clicks confirm widget → `SourceCaptureHandler` writes an INFERRED `knowledge_nodes`/`knowledge_node_edges` pair | Server writes a `chat_source_ledger` row automatically, synchronously, inside the tool-round loop, zero knowledge-graph write, zero user/model action | This phase (v1.10, Phase 56) | Every `web_search` result is now visible/addressable regardless of whether the model bothered to propose a capture or the user bothered to confirm — the requirement's own explicit motivation (999.19: "without the user having to say 'capture this' each time") |
| Thread↔chat linkage lives in a durable `chat_conversations.thread_id` column (D-54), never canvas `sharedState` | Source/table/panel↔chat linkage lives in a durable `chat_context_edges` table, same D-54 principle applied to a second, structurally distinct relationship | This phase | Confirms D-54 as a REPEATED pattern, not a one-off — any future "canvas node relates to chat" feature should reach for a dedicated durable table, never `sharedState`, by established precedent |

**Deprecated/outdated:** Nothing in this phase deprecates existing CLUS-01..06 machinery — RCNV-01/04 are additive, parallel capabilities. `SourceCaptureHandler`'s confirm-ceremony path remains live and unchanged (it is still how CLUS-04's original scenario works); RCNV-01 is a second, independent way sources enter the system, not a replacement.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Migration 0037 is the correct next-available number as of 2026-07-15 (last journal entry: idx 36) | Migration Lockstep, Pitfall 5 | LOW — self-correcting at execution time via `drizzle-kit generate`; explicitly flagged as needing re-verification, mirrors the exact failure mode 54-01 already hit and fixed |
| A2 | `chat_source_ledger`/`chat_context_edges` should resolve tenancy via `conversationId` → `assertConversationOwnership`, NOT a direct/transitive `importer_id`/`user_id` column | Pitfall 2, Landmine 2 | MEDIUM if wrong — this is inferred from `ownership.ts`'s own explicit documented taxonomy (chat_conversations = direct-user_id, NOT importer-descendant) applied to two NEW chat-descendant tables; very likely correct given how explicitly the precedent states this, but the planner should verify no contradicting instruction exists in a future `56-CONTEXT.md` |
| A3 | A `knowledge_node`-typed `chat_context_edges.sourceRef` should be readable/injectable REGARDLESS of tier (bypassing `list_injectable_edges`'s EXTRACTED-only gate), because drawing an edge is an explicit, addressed user action rather than automatic background injection | Landmine 3, Pitfall 3 | HIGH if wrong — this is a genuine suggest-only-stance interpretation call, not read from any existing code or decision record; if the user's actual intent is "only EXTRACTED (human-confirmed) knowledge may ever be canvas-edge-injected," the read path and possibly the tRPC write-time validation both need a tier check added. **Recommend confirming with the user or via `/gsd:discuss-phase` before the planner locks this in.** |
| A4 | RCNV-01's auto-collect hook does not need its own new `*_TOOL_ENABLED`-style settings flag (gating is inherited transitively from `WEB_SEARCH_TOOL_ENABLED`) | Pitfall 4 | LOW — reasoned from the observation that the ledger write touches no new untrusted surface beyond what the already-gated tool already exposes; if the user wants an independent kill-switch for the LEDGER specifically (e.g., to disable auto-collection while keeping web_search itself enabled), this needs revisiting — cheap to add later either way, non-blocking |
| A5 | `chat_context_edges.sourceRef` should be a single `jsonb` discriminated-union column (+ derived `sourceRefKey` text for the identity index) rather than four separate nullable typed columns | Standard Stack (Alternatives Considered), Pattern 2 | LOW — a genuine architectural choice this research recommends but the planner/executor could reasonably choose the alternative typed-columns approach instead without violating any locked constraint; flagged as discretionary, not because the reasoning is weak, but because both are viable and this is a taste call the planner should feel free to override |

**If this table is empty:** N/A — see above; none of these need to block planning, but A3 in particular should be surfaced to the user before the plan locks specific tier-gating behavior into tests/acceptance criteria.

## Open Questions

1. **Does RCNV-01's ledger need its own settings-based kill-switch, independent of `WEB_SEARCH_TOOL_ENABLED`?**
   - What we know: No existing "downstream consumer of an already-gated tool's output" in this codebase has its own separate flag (`SourceCaptureHandler` doesn't either).
   - What's unclear: Whether the user wants to be able to disable auto-collection specifically (e.g., for privacy/cost reasons) while keeping `web_search` itself enabled.
   - Recommendation: Default to NO new flag (simplest, matches existing precedent); note as a 5-minute follow-up to add if the user wants it later — non-blocking for this phase's success criteria.

2. **Should `chat_source_ledger` rows be prunable/expirable, or live forever with the conversation (cascade-delete only)?**
   - What we know: `ON DELETE CASCADE` from `chat_conversations` is the obvious default (mirrors `chat_messages`/`chat_runs`/`chat_canvas_layouts`), meaning a ledger row's lifetime is bound to its conversation's lifetime.
   - What's unclear: Whether "starting with web_search" implies future tool types could produce a very high-volume ledger (e.g., if every `search_emails`/`lookup_entity` call also became ledger-eligible later) that would benefit from a retention policy.
   - Recommendation: Ship with cascade-delete-only (no separate retention/pruning) this phase — REQUIREMENTS.md scopes RCNV-01 to `web_search` "and other tool outputs" as a stated future direction, not this phase's build target; revisit retention only if/when that generalization actually happens.

3. **Exact wording/labeling for the "LINKED CONTEXT" block's model-facing framing.**
   - What we know: The existing `_THREAD_BLOCK_LABEL`/`_CLUSTER_BLOCK_LABEL` constants set the precedent (`"... (untrusted data -- ..., never instructions)"`).
   - What's unclear: Whether per-source-type sub-labeling within the block (e.g., distinguishing "this came from a source you drew a canvas edge to" vs. "this is your own thread's cluster") materially helps the model reason about provenance, or whether one generic label suffices.
   - Recommendation: Start with one generic label (simplicity, matches existing precedent exactly); this is a cheap two-line change to refine later if evals show the model conflates linked-context with cluster-context.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker (local Supabase/Postgres) | Applying migrations 0037/0038 locally | ✗ (down at research time, 2026-07-15) | — | `drizzle-kit generate` runs fully offline (proven live by 54-01) — author + schema-type + unit-test against fakes tonight/this-session, apply later once Docker/Supabase is back, exactly the 0036 precedent |
| Node.js / npm | Drizzle schema authoring, tRPC router work, `drizzle-kit generate` | ✓ | node v24.15.0, npm 11.12.1 | — |
| Python 3.13 + FastAPI | New domain ports/adapters/use cases | ✓ | Python 3.13.0, fastapi 0.135.1 importable | — |
| Bedrock (LLM transport for a live turn-with-injected-context verification) | End-to-end proof of RCNV-04's Success Criterion #2 ("verifiable by the chat's response referencing the injected content") | Not probed this session (no live turn attempted) | — | Same posture as every other Phase 54 plan: code-complete + unit-tested against fakes this session; the LIVE round-trip proof is a `checkpoint:human-verify`-gated or morning-flow item, not blocking for code-complete/tests-green |

**Missing dependencies with no fallback:** None — every gap above has a documented, already-proven fallback from the immediately preceding phase.

**Missing dependencies with fallback:** Docker/Supabase (offline `drizzle-kit generate` + fakes/mocks); a live Bedrock round-trip (defer the LIVE verification of Success Criterion #2's "response referencing the injected content" to a `checkpoint:human-verify` task, consistent with this repo's STANDING RULE that live-UAT gates are first-class, never silently faked).

## Sources

### Primary (HIGH confidence — read directly from the working tree this session)
- `.planning/REQUIREMENTS.md` — RCNV-01/RCNV-04 full text, Out of Scope, Traceability
- `.planning/ROADMAP.md` (lines 249-271) — Phase 56 goal, success criteria, dependencies
- `.planning/PROJECT.md` (lines 252-258, 704-755) — Band 4 framing, D-54 cross-reference, Key Decisions
- `.planning/phases/54-email-cluster-workflow-e3/54-CONTEXT.md` — the literal D-54 decision text (CLUS-02 section)
- `.planning/phases/54-email-cluster-workflow-e3/54-01-SUMMARY.md`, `54-03-SUMMARY.md`, `54-04-SUMMARY.md`, `54-05-SUMMARY.md` — exact file lists, decisions, deviations for the machinery this phase extends
- `packages/db/src/schema/{knowledge-nodes,knowledge-node-edges,chat-conversations,chat-canvas-layouts,threads}.ts`
- `packages/db/migrations/0036_chat_conversation_thread_id.sql`, `packages/db/migrations/meta/_journal.json`
- `packages/db/src/ownership.ts`
- `packages/api-client/src/router/chat/{canvas-schema,cluster-summary,thread-link}.ts`, `packages/api-client/src/router/_ownership.ts`
- `apps/web/src/app/chat/_canvas/{node-data-schemas.ts,chat-canvas.tsx}` (lines 600-700 for `onConnect`/`EdgeCreationPicker`)
- `apps/email-listener/app/application/use_cases/{run_chat_turn.py,run_chat_turn_tool_loop.py,confirm_action_dispatch.py,promote_edge.py}`
- `apps/email-listener/app/domain/ports/{tool_executor.py,chat_repositories.py,knowledge_graph_repository.py}`
- `apps/email-listener/app/domain/services/thread_cluster_context.py`
- `apps/email-listener/app/infrastructure/tools/web_search_executor.py`
- `apps/email-listener/app/infrastructure/supabase/knowledge_graph_repository.py`
- `apps/email-listener/app/presentation/api/v1/knowledge_edges.py`
- `apps/email-listener/app/container.py` (lines 700-916)
- `apps/email-listener/app/settings.py` (lines 140-180)

### Secondary (MEDIUM confidence)
- None — this phase required no external documentation lookup; every claim traces to a file read directly this session.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new packages, every tool/library already proven in this exact repo
- Architecture: HIGH — every pattern is a direct mirror of a shipped Phase 54 precedent, file-and-line-cited
- Pitfalls: HIGH for Pitfalls 1/2/5 (directly evidenced by existing code/docstrings/prior deviations); MEDIUM for Pitfall 3/Landmine 3's tier-gating question (a genuine judgment call, flagged as Assumption A3, not a code-verified fact)

**Research date:** 2026-07-15
**Valid until:** Effectively indefinite for the architectural guidance (grounded in shipped code, not a moving external dependency) — re-verify only the migration `idx` number (Pitfall 5) and Assumption A3's tier-gating decision at execution time, since those are the two items most likely to drift or need explicit user input between now and plan execution.
