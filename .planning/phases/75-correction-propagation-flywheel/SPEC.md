---
phase: 75-correction-propagation-flywheel
milestone: vNEXT-living-canvas
status: proposed
size: L
depends_on: [73]
requirements: [CPF-01, CPF-02, CPF-03, CPF-04, CPF-05, CPF-06]
---
# Phase 75 — Correct-once, propagate-everywhere   ·   BANGER: fix the AI once on a node and watch the correction cascade across your whole graph, live

## Goal
The user corrects the AI a single time on a canvas node — "this entity IS that
one" (confirm a merge) — and the correction does not stop at that one row. It
**cascades**: the merged-away identity's past-email links re-point onto the
survivor, the sender→entity suggestion edges the ingest pass proposed get
promoted to trusted canon, the affected emails re-resolve against the corrected
identity, and **every downstream canvas node re-renders live** with the new
truth — the survivor's card gains the absorbed emails and aliases and sheds a
pending-merge, the merged-away card flips to "merged into another," the review
queue loses the pair — all without a reload. One correction, propagated
everywhere, made visible and satisfying.

## Why this is a banger (and why now)
This is the compounding moat you can *see move*. Every competitor's "fix the AI"
is a local edit — you correct a label and it stays corrected on that one item.
Polytoken's architecture is a **personal knowledge graph with a human-gated
trust ladder** (`INFERRED`/`AMBIGUOUS` suggestions → `EXTRACTED` canon, promoted
only through a human gate — `promote_edge.py:37-46`) sitting under a
**ref-only live canvas** where every node rehydrates from an owned-scoped query
(`entity-node.tsx:98`, `review-queue-node.tsx:77`). Those two facts together mean
a single correction has *leverage no local edit can have*: the merge write
(`curate_entity_merge.py:ConfirmMergeUseCase`) already knows the survivor, the
absorbed identity, and — via the deterministic per-sender knowledge node
(`resolve_ingest_entities.py:_sender_scope_ref_id`) — every suggestion edge and
candidate link that touched either side. Nothing else in the product can take
one human click and legitimately raise the trust tier of a dozen inferred edges,
re-label a month of past mail, and repaint five cards on the board in one motion.

Why *now*: the merge write path shipped (Phase 10/D-20), correction *capture*
shipped (Phase 57 — `entity_type_corrections`, `was_dismissed`), the durable
job runtime shipped (Track 3a — `JobEnqueuer`, `apps/worker/src/tasks.ts`), the
entity + review-queue canvas nodes just shipped, and Phase 73 gives the agent a
live node-materialization channel. Every load-bearing piece exists **except the
wire that makes a correction propagate** — and the propagation is invisible.
This phase is almost entirely *connective tissue over already-built spines*.

## What already exists — the plumbing (file:line evidence, be exhaustive)

### The correction write (merge-confirm) — the trigger
- `apps/email-listener/app/application/use_cases/curate_entity_merge.py`
  - `ConfirmMergeUseCase.execute()` (self-merge guard → load subject → active
    guard → load target → cross-importer guard (`T-10-20`) → active-target
    guard) then writes exactly three things: `select_candidate_link`
    (`was_selected=True`, D-09 audit), `append_alias` (target's `display_name`
    onto survivor, D-11 flywheel), `set_merge_state(target_id,
    merged_into=entity_instance_id, is_active=False)`. **importer_id is derived
    from the loaded subject row (D-21) — never a caller arg.** This is the
    single point a correction becomes durable.
  - `RejectMergeUseCase.execute()` → `dismiss_candidate_link` (writes
    `was_dismissed=True`); `UnmergeEntityUseCase.execute()` fans out to
    `find_merged_children` and reverses both the merge state and the D-11 alias
    write — the inverse operation this phase's cascade must also respect.
- REST surface: `apps/email-listener/app/presentation/api/v1/entity_instances.py:129`
  `POST /{entity_instance_id}/merge/{target_id}/confirm` (also `/reject`:158,
  `/unmerge`:186).
- tRPC proxy: `packages/api-client/src/router/entities/mutations.ts`
  `confirmMerge` / `rejectMerge` / `unmerge` — each `protectedProcedure`,
  asserts ownership of **both** referenced entities via
  `assertEntityInstanceOwned` (TENA-03, T-44-06-02) *before* the FastAPI fetch,
  then POSTs to the listener with `X-API-Key`. Returns `res.json()` — the seam
  where a cascade summary could ride back.

### The trust-ladder promotion (edge tier flip) — the canon-raise
- `apps/email-listener/app/application/use_cases/promote_edge.py`
  - `PromoteEdgeUseCase.execute(edge_id, importer_id, user_id=…)` — the **only**
    write in the system that flips a `knowledge_node_edges` row to `EXTRACTED`.
    Fixed fail-closed ordering (load → user-ownership guard → tenant guard →
    active guard → tier guard (`_SUGGESTION_TIERS = ("INFERRED","AMBIGUOUS")`)
    → CAS write). Records `promotion={promoted_at, from_tier, mechanism}`;
    `mechanism`/`extra` are additive so a cascade can stamp
    `mechanism="merge_cascade"` distinct from a plain `human_promote`.
- REST: `apps/email-listener/app/presentation/api/v1/knowledge_edges.py:60`
  `POST /v1/knowledge/edges/{edge_id}/promote` (require_api_key + require_user_id).
- Note: there is **no tRPC wrapper** for promote today — `knowledge/graph.ts`
  only exposes the read `graph` procedure (`graph.ts:303`); promotion is
  reachable only via the listener REST endpoint or the chat confirm-action
  dispatch path referenced in `promote_edge.py:16`.

### The suggestions a correction should sweep up — the ingest-time proposals
- `apps/email-listener/app/application/use_cases/resolve_ingest_entities.py`
  - Every ingest resolves the email's entity components and PROPOSES, at
    suggestion tier only: (1) `component_entity_candidate_links` rows
    (`was_selected=False`) — the same rows the review queue consumes; (2)
    `AMBIGUOUS` `possibly_about` edges from a **deterministic per-sender
    knowledge node** (`_ensure_sender_node`, keyed by
    `_sender_scope_ref_id(importer_id, address)` via `uuid5` — reprocess-stable)
    to each resolved candidate entity instance.
  - Idempotent-by-skip: pre-seeds `linked_instance_ids` from
    `find_active_edges_for_node` and **never deactivates** the sender node's
    edges — human-promoted `EXTRACTED` canon on that node survives every future
    ingest (the comment at `resolve_ingest_entities.py` explicitly calls out the
    prior tier-blind deactivate bug this fixed). This is why a promotion done by
    the cascade is *durable* across later mail from the same sender.
  - Call site / gating: `app/composition/ingestion_providers.py:100-194`
    (provided only when `resolution_enabled`); `app/settings.py:210`.

### The re-label mechanism — bulk pipeline re-run over chosen emails
- `apps/email-listener/app/presentation/api/v1/backfill_reprocess.py`
  `POST /v1/emails/backfill-reprocess` — owner-scoped, capability-authed,
  batched (`email_ids: max_length=25`) re-run of the FULL ingestion pipeline
  (which includes the `ResolveIngestEntitiesUseCase` stage) over a chosen set of
  the owner's emails. Returns per-email `{superseded, new_regions, error}`.
- `app/application/use_cases/reprocess_email.py` — `ReprocessEmailUseCase`
  (supersede-then-rederive; returns `{superseded_components, new_regions}`).
- Durable runtime (Track 3a): `app/domain/ports/job_enqueuer.py` `JobEnqueuer`
  (enqueue via `public.enqueue_job` SECURITY DEFINER wrapper; `job_key` for
  idempotency; `max_attempts` retry ceiling + dead-letter) and the worker task
  list `apps/worker/src/tasks.ts` (`taskList` maps a job identifier → a
  `callPython(path, body)` POST to the co-located listener). This is the correct
  home for a fan-out re-label so it never races the ALB idle timeout the
  batched `/backfill-reprocess` endpoint was built to dodge.

### The downstream surfaces that must re-render — the ref-only live nodes
- `apps/web/src/app/chat/_canvas/entity-node.tsx:98` — `EntityNode` carries only
  `data.entityId` and rehydrates via `api.entities.byId.useQuery({ id })`
  (`node-data-schemas.ts:383` `EntityNodeDataSchema`). Renders `displayName`,
  `aliases`, `identifiers`, `occurrenceCount` (`= query.data.occurrences.length`),
  `pendingCount` (`= query.data.pendingSuggestions.length`), and a `null` branch
  ("This entity is unavailable. It may have been merged into another…") when the
  owned-scoped query returns null.
- `apps/web/src/app/chat/_canvas/review-queue-node.tsx:77` — `ReviewQueueNode`
  rehydrates via `api.entities.reviewQueue.useQuery(QUEUE_INPUT)` and acts
  through the **existing** `useMergeReview(QUEUE_INPUT)` hook — the SAME
  `confirmMerge`/`rejectMerge` write paths, same optimistic cache.
- `apps/web/src/app/entities/review/_components/use-merge-review.ts` — on merge
  success, `settle()` invalidates `entities.reviewQueue` + `entities.list`. **It
  does NOT invalidate `entities.byId`** — so a placed `EntityNode` for the
  survivor or the absorbed target does not refetch on a merge today.
- The read model the nodes trust:
  - `packages/api-client/src/router/entities/detail.ts` — `entities.byId`
    returns `occurrences` (joined on `ComponentEntityCandidateLinks.entityInstanceId
    = input.id` — `detail.ts:297-323`), `pendingSuggestions`
    (`groupPendingSuggestions`, excludes `wasDismissed` and merged-away
    candidates — `detail.ts:161-190`), and `wasMerged` (raw sub-select over the
    live `merged_into` column — `detail.ts:495-504`).
  - `packages/api-client/src/router/entities/review.ts` — `entities.reviewQueue`
    (pending pairs across all owned entities; RES-1 filters).

### The live-reconcile channel the visible cascade rides on (Phase 73 foundation)
- `apps/web/src/app/chat/_canvas/use-canvas-persistence.ts` —
  `reconcileNodesFromHistory(savedNodes, historyRows)` is the pure pass that
  materializes new nodes into the board and preserves saved positions; the
  module doc names the **wiring seam** (`sourceNodeId`,
  `buildExpectedGenuiPanelSpecs`) for materializing rows as canvas nodes exactly
  once. Phase 73's `emit_canvas_node`/`canvas_add_node` reconcile pass extends
  this same channel — this phase reuses it to place/repaint the corrected-
  identity node rather than inventing a second materialization path.

### Correction capture already in place (Phase 57) — do not rebuild
- `packages/db/src/schema/entity-type-corrections.ts` +
  `packages/db/migrations/0038_entity_type_corrections.sql` — durable
  entity-type reclassification capture.
- Migration `0039` — the `was_dismissed` symmetric exclusion in both BlendedRAG
  RPCs (a rejected pair never re-surfaces, both directions). Verified code-level
  (`57-VERIFICATION.md`), **live-DB legs still deferred** (migrations authored
  but "applied nowhere" — see Risks).

## The gap (what's missing to make it real)
Corrections are *captured* and each write is individually correct, but a
correction **does not propagate** and the propagation is **invisible**. Concretely:

- **listener — no cascade orchestrator.** `ConfirmMergeUseCase` writes the merge
  and stops. Nothing (a) promotes the `AMBIGUOUS` sender→survivor suggestion
  edges that `resolve_ingest_entities.py` proposed into `EXTRACTED` canon; (b)
  re-points/re-resolves the absorbed target's past-email candidate links so the
  survivor's `entities.byId.occurrences` (joined strictly on
  `entityInstanceId = survivor.id`, `detail.ts:297`) actually gains the target's
  emails; (c) records what the correction touched. **Where it plugs in:** a new
  `CascadeCorrectionUseCase` invoked immediately after the three
  `ConfirmMergeUseCase` writes (same use case or a thin orchestrator over it),
  reusing `PromoteEdgeUseCase` for the edge flips and `JobEnqueuer.enqueue(…,
  job_key=f"cascade:{survivor}:{target}")` for the async re-label fan-out over
  the affected `email_ids` (durable, idempotent, dead-lettered).
- **listener — no "affected emails" query.** To re-label, the cascade needs the
  set of emails where the absorbed target appeared. **Where it plugs in:** a
  repository read over `component_entity_candidate_links` for
  `entity_instance_id = target_id` → distinct `email_id`s (the inverse of
  `detail.ts`'s occurrence join, on the Python side).
- **db — no propagation ledger.** Nothing records that correction X cascaded to
  edges [..], emails [..] at time T — needed for idempotency, audit, and the
  visible "here's what your one click changed" affordance. **Where it plugs in:**
  a new `correction_propagations` table (importer-scoped, D-21 shape — chains to
  `importers`, never a bare `user_id`) written by the cascade.
- **api-client — confirmMerge returns nothing actionable + no byId
  invalidation.** `mutations.ts:confirmMerge` discards the listener response;
  there is no cascade summary for the UI to react to, and `useMergeReview.settle`
  never invalidates `entities.byId`. **Where it plugs in:** thread the listener's
  cascade summary through `confirmMerge`'s return; add a `entities.byId`
  invalidation (both survivor + target ids) to the merge success path.
- **apps/web — the cascade is invisible.** No downstream `EntityNode` refetches
  on a merge; there is no motion tying "I clicked once here" to "these cards just
  changed there." **Where it plugs in:** a **propagation reconcile pass** that,
  on a merge/cascade success, invalidates `api.entities.byId` for the affected
  ids across the whole query cache so every placed `EntityNode` refetches
  (survivor repaints with +emails/+alias/−pending; absorbed flips to the null
  "merged into another" branch), and a brief cascade highlight on the touched
  cards — layered on the Phase-73 `use-canvas-persistence` reconcile channel.

## Vertical slice / MVP (the smallest demo that proves it)
On the canvas sit two `EntityNode`s — "Pedro Maschio" and "P. Shin" — plus a
`ReviewQueueNode` showing the pending pair. The user clicks **Merge** on the
pair once. Within one motion, **without a reload**: the "Pedro Maschio" card
repaints — "P. Shin" appears under *Also known as*, its email count jumps
(the absorbed emails re-labeled onto it), its "N pending" chip drops by one; the
"P. Shin" card fades to its "merged into another" empty state; the review-queue
card loses the pair; and a faint cascade highlight sweeps the touched cards. One
click on one node; the corrected identity is now everywhere it appears.

(Gate-ably, the MVP can stop at: merge-confirm → sender→survivor `AMBIGUOUS`
edges promoted to `EXTRACTED` + `entities.byId` invalidated for both ids +
survivor/absorbed nodes visibly re-render. The re-label fan-out over past emails
is the async second wave and is verified separately — see Success criteria.)

## Success criteria (testable / UAT)
Gate-able here (no live loop needed):
- [ ] **CPF-01** A new `CascadeCorrectionUseCase` unit test proves: given a
  confirmed merge (survivor S, absorbed T) and a set of `AMBIGUOUS` sender→T /
  sender→S `possibly_about` edges, the cascade calls `PromoteEdgeUseCase` for
  exactly those active suggestion-tier edges and for **no** already-`EXTRACTED`
  or inactive edge (reuses the existing promote guards — never a second flip
  path). importer_id is derived from the loaded survivor row (D-21), never a
  caller arg.
- [ ] **CPF-02** The cascade is **idempotent**: re-running it for the same
  (S,T) with the same `job_key` promotes nothing already promoted and writes no
  duplicate `correction_propagations` row (CAS/`job_key` proven in a test).
- [ ] **CPF-03** A `correction_propagations` migration + repository test: a
  cascade writes one importer-scoped ledger row recording the survivor, absorbed
  id, promoted edge ids, and enqueued affected `email_ids`; a cross-importer read
  returns nothing (TENA-03 / D-21 shape, mirrors `entity_type_corrections`).
- [ ] **CPF-04** `entities.confirmMerge` (tRPC) returns a cascade summary
  `{ promotedEdgeIds, affectedEmailIds, survivorId, absorbedId }`; a router test
  proves both-side ownership is still asserted *before* any listener call
  (unchanged TENA-03) and the summary is passed through unmodified.
- [ ] **CPF-05** A web test (vitest/jsdom, logic only): on a merge success the
  propagation reconcile invalidates `api.entities.byId` for **both** survivor and
  absorbed ids (in addition to the existing `reviewQueue` + `list`
  invalidations), so a placed `EntityNode` for either id is marked stale.
- [ ] **CPF-06** A **screenshot/geometry** gate (real browser — jsdom cannot see
  this, per CLAUDE.md): after a merge on a `ReviewQueueNode`, a co-placed
  survivor `EntityNode` visibly gains the absorbed alias + updated counts and the
  absorbed `EntityNode` shows its "merged into another" state — captured via
  `npm run screenshot:review` against an already-running server.

Needs a live loop (name it explicitly — deferred to the milestone runsheet):
- [ ] The re-label fan-out (`JobEnqueuer` → worker → `/backfill-reprocess` re-run)
  actually re-points the absorbed target's past-email links onto the survivor in
  a real Postgres, so `entities.byId.occurrences` for S grows — provable only
  with migrations 0038/0039 **and** the new `correction_propagations` migration
  applied to a live DB and the graphile-worker running (the same live-DB deferral
  posture Phase 57 recorded).

## Build sketch (waves → plans)

**Wave 1 (parallel-safe — disjoint files):**
- **Plan 75-01 — `correction_propagations` ledger (db).** New Drizzle schema
  (`packages/db/src/schema/correction-propagations.ts`) + migration, importer-
  scoped, mirroring `entity-type-corrections.ts`. Must-haves: (a) importer FK,
  no bare user_id; (b) RLS + indexes matching the 0038 template; (c)
  `drizzle-kit check` green. *(No consumer yet — capture shape only, exactly
  like 57-01's posture.)*
- **Plan 75-02 — affected-emails read + cascade unit shell (listener).** A
  repository method `find_email_ids_for_entity(target_id)` (inverse of the
  `detail.ts` occurrence join) + a `CascadeCorrectionUseCase` skeleton wired to
  `PromoteEdgeUseCase` and `JobEnqueuer`, domain-pure (ports only, lint-imports
  clean). Must-haves: (a) promotes only active `AMBIGUOUS`/`INFERRED`
  sender-node edges touching S or T; (b) importer from the loaded row (D-21);
  (c) idempotent via `job_key`.

**Wave 2 (depends on Wave 1):**
- **Plan 75-03 — wire cascade into the merge write + surface summary
  (listener + api-client).** Invoke `CascadeCorrectionUseCase` after
  `ConfirmMergeUseCase`'s three writes; write the ledger row; enqueue the
  re-label job; return the cascade summary from the confirm endpoint and thread
  it through `mutations.ts:confirmMerge`. Must-haves: (a) both-side ownership
  still asserted before any listener call; (b) a merge with no suggestion edges
  still succeeds (cascade is best-effort, never fails the merge — mirror the
  Phase-57 capture-failure-is-caught posture); (c) summary shape matches CPF-04.
- **Plan 75-04 — worker re-label task.** Add a `cascade_relabel` identifier to
  `apps/worker/src/tasks.ts` `taskList` that `callPython`s `/backfill-reprocess`
  with the affected `email_ids` (chunked ≤25). Must-haves: (a) idempotent under
  redelivery (`job_key`); (b) bounded batch size honored.

**Wave 3 (depends on Wave 2, web-only):**
- **Plan 75-05 — visible propagation on the canvas (apps/web).** Extend
  `useMergeReview.settle` / a new propagation reconcile to invalidate
  `entities.byId` for both ids; add a cascade-highlight to touched
  `EntityNode`s via the Phase-73 reconcile channel; screenshot gate. Must-haves:
  (a) both nodes re-render live on merge; (b) highlight is motion-safe-gated;
  (c) CPF-06 screenshot captured.

## Risks & landmines
- **Live-infra (CLAUDE.md):** do NOT `terraform apply` — no remote state backend
  (`main.tf`), an apply from a bare checkout can drop live SES rules → mail
  outage. `magnitudetech.com.br` / `nauta-*` are **live** names — this phase
  touches none of them; keep it that way. SES sandbox is irrelevant (no outbound
  mail here). **Listener redeploy caveat:** the new confirm-path behavior ships
  in `apps/email-listener` (ECS) which deploys independently of Vercel and can
  race an unapplied migration — the new `correction_propagations` migration MUST
  be applied before the cascade writes to it, or the confirm cascade errors;
  keep the cascade best-effort (catch + log, never fail the merge) so a
  migration lag degrades to "merge works, propagation deferred," never a broken
  merge.
- **Migration-race + `tableColumnExists` gate:** any new column/table read by
  BOTH Python and the TS/tRPC layer must go through
  `packages/api-client/src/router/_column-detect.ts`'s `tableColumnExists` gate
  (the 0036 pattern, per 57-RESEARCH). The cascade summary is computed listener-
  side and passed through, so the TS layer never reads the new table directly —
  but if any web read of `correction_propagations` is added later, gate it.
- **Phase-57 migrations still not applied anywhere** (0038/0039 authored but
  "applied nowhere" — `57-VERIFICATION.md`). The re-label's dependence on the
  `was_dismissed` exclusion and correction few-shot only bites live; the live
  leg of this phase inherits that same deferral and must be run on the milestone
  live-acceptance runsheet, not claimed as gated.
- **LWW canvas caveat:** `saveCanvasLayout` upserts the whole snapshot and two
  surfaces share one `chat_canvas_layouts` row (`use-canvas-persistence.ts`
  module doc) — a cascade repaint must NOT rewrite node *positions*; it only
  invalidates ref-only queries, so node.data stays a pure ref (`entityId`) and
  the LWW row is untouched by the repaint. Do not stuff cascade results into
  node.data.
- **Tenancy (TENA-03 / D-21):** every new read/write derives importer_id from a
  loaded row, never a caller arg; both merge sides already ownership-checked in
  `mutations.ts`. The affected-emails query and ledger read must be
  owned-importer scoped — a cross-tenant email must never enter the re-label
  batch (the `/backfill-reprocess` endpoint already fail-closed skips
  not-owned; keep that guarantee end-to-end).
- **Unmerge symmetry:** `UnmergeEntityUseCase` reverses the merge + the D-11
  alias — the cascade's edge promotions and ledger must have a defined
  reverse-or-tombstone story (at minimum: unmerge records a compensating ledger
  row; edge *demotion* is out of MVP scope and should be called out, not silently
  skipped). Flag as needs-live-verification.
- **Best-effort ordering:** promote-then-enqueue-then-ledger vs. ledger-first —
  pick ledger-last so a half-run cascade never claims completion; the `job_key`
  makes the enqueue safely re-runnable. This ordering choice needs a test
  (CPF-02) and a live-loop confirmation.

## Dependencies & sequencing
- **Depends on Phase 73 (living-canvas agent dataflow):** the visible-cascade
  wave (75-05) reuses Phase 73's live node-materialization / reconcile channel
  (`emit_canvas_node` + the `use-canvas-persistence` reconcile pass) rather than
  building a second one. The backend cascade waves (75-01…04) do **not** need 73
  and can start immediately.
- **Builds on already-shipped spines** (no new dependency, but load-bearing):
  Phase 10/D-20 merge write, Phase 30/TIER-03 `PromoteEdgeUseCase`, Phase 57
  correction capture, Track 3a durable job runtime, and the just-shipped entity +
  review-queue canvas nodes.
- **Unblocks:** a general "correction propagation" surface the other vNEXT
  bangers can reuse — any future human correction (entity-type reclassify via
  `entity_type_corrections`, field-value confirm) can ride the same cascade
  orchestrator + ledger + visible-reconcile channel this phase establishes, so
  the flywheel generalizes beyond merges.
