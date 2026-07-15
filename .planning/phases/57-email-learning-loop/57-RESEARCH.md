# Phase 57: Email Learning Loop - Research

**Researched:** 2026-07-15
**Domain:** Extending an existing suggest-only entity-resolution / extraction pipeline with a
learn-from-corrections loop (Python/FastAPI Clean Architecture + Supabase Postgres + AWS Bedrock)
**Confidence:** HIGH — every claim below is grounded in a specific file:line read in this session,
not training-data recall. No new external packages, frameworks, or services are involved.

## Summary

This phase does **not** need a new subsystem. The repo already implements the full LEARN-01/LEARN-02
shape for exactly one axis — **field-value correction** — end to end: `ConfirmRegionUseCase`
captures a human's `corrected_fields` as a structured, addressable row on `extraction_records`
(`corrected_fields` jsonb, migration `0000_real_garia.sql:91`), embeds the corrected text
(`confirm_region.py:166-174`), and a hybrid vector+trigram RRF(k=60) retrieval RPC
(`match_components_by_embedding`/`match_components_by_trgm`, migration `0009_retrieval_rpcs.sql`)
already prefers `COALESCE(er.corrected_fields, er.extracted_fields)` when surfacing few-shot
examples back into the `AutofillUseCase`/`AutofillFieldsUseCase` prompt
(`autofill_adapter.py:127-141`). This is D-13/D-15, shipped since Phase 4/Phase 31 — read it before
building anything, because it is the exact pattern LEARN-02 should replicate, not reinvent.

What's actually missing are two narrower, well-bounded gaps on the **other two** correction axes the
phase requirements name ("what an email or extracted entity *is*"):

1. **Entity-TYPE reclassification has no capture at all.** `SetComponentEntityTypeUseCase`
   (`set_component_relationship.py:67-102`) silently overwrites `component.entity_type_id` with
   zero audit trail of what it was corrected *from* — unlike `confirm_region.py`'s
   `corrected_fields`, the prior value is simply lost. And `EntityTypeClassifierProtocol.classify()`
   (`entity_type_classifier_protocol.py:41-64`) has **no few-shot/examples parameter at all** — it
   is the one classification call site in the whole pipeline with zero learning mechanism, cold
   every time.
2. **Entity-resolution dedup correction is captured but dead.** `RejectMergeUseCase` already writes
   a durable `was_dismissed=true` flag on `component_entity_candidate_links`
   (`curate_entity_merge.py:107-165`, migration `0018_many_scarecrow.sql`) with a docstring that
   explicitly claims *"the resolver never re-surfaces a dismissed link"* — but grepping the entire
   Python tree confirms `was_dismissed` is **written and never read anywhere**. The BlendedRAG RPCs
   (`match_entities_by_embedding`/`match_entities_by_trgm`, migration `0017`) apply zero suppression
   for dismissed pairs. This is a proven, reproducible bug, not a hypothesis.

**Primary recommendation:** Do not build a new "correction service," a re-ranker, or any ML
training/fine-tuning surface. Extend the **existing retrieval-bias-driven few-shot mechanism**
(D-13/D-15 — vector+trgm RRF(k=60), `importer_id`-scoped, feeding a `<...examples>` block into a
Bedrock tool-call prompt) to the two currently-cold call sites: (a) add an `examples` parameter to
`EntityTypeClassifierProtocol.classify()` sourced from a new, small `entity_type_corrections` table
via the same retrieval shape, and (b) wire the already-captured `was_dismissed` flag into the
existing entity-resolution RPCs as an exclusion filter. Both changes are additive, code-gated,
suggest-only by construction (they only ever change what confidence/candidates a human is shown to
confirm — never what gets auto-applied), and require **zero new npm/pip packages**.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LEARN-01 | The user corrects what an email or extracted entity *is* (classification/extraction), and the correction is captured as structured, addressable signal | §"Correction-capture point" below identifies the exact two gaps (entity-type reclassification, negative-dedup signal-already-captured) and the exact existing pattern (`confirm_region.py` `corrected_fields`) already satisfying this for field values. New table `entity_type_corrections` (§Migration) closes gap 1; gap 2 needs no new capture, only reuse. |
| LEARN-02 | Accumulated corrections improve subsequent classification/extraction for the same or similar entities — extending the suggest-only entity-resolution stance, never auto-deciding | §"Reuse mechanism" identifies the exact existing D-13/D-15 retrieval-bias pattern (RRF k=60 hybrid vector+trgm → few-shot prompt block) and specifies its extension to `EntityTypeClassifierProtocol` + the dead `was_dismissed` filter in the BlendedRAG RPCs. §"Suggest-only invariant" proves both extensions preserve the existing never-auto-decide contract with file:line evidence for every consumer. |

</phase_requirements>

## Project Constraints (from CLAUDE.md / PROJECT.md)

No repo-root `CLAUDE.md` exists; constraints below are drawn from `.planning/PROJECT.md`
`## Constraints` (2026-07-14) and are binding on this phase:

- **Python/uv, not pip directly for new deps; npm workspaces, NOT pnpm** for `apps/web`/`packages/*`.
  This phase needs neither — zero new packages.
- **LLM transport is AWS Bedrock via IAM role** (`AsyncAnthropicBedrock`, `app/container.py`) — no
  `ANTHROPIC_API_KEY`. Any new Bedrock call (entity-type few-shot) must reuse the existing
  `AsyncAnthropicBedrock` client already injected into `AnthropicEntityTypeClassifier`
  (`container.py:266-274`).
- **Migrations-first, always** — the Deploy workflow's own test gate blocks a red-test deploy; ECS
  (email-listener) and Vercel (web) deploy independently and can race an unapplied migration. Any
  new column read by BOTH the Python FastAPI service and the Next.js/tRPC layer must go through
  `packages/api-client/src/router/_column-detect.ts`'s `tableColumnExists` gate (the pattern
  migration `0036` established) on the TS side — Python has no equivalent helper and has never
  needed one (see Landmines).
- **Suggest-only for all knowledge mutations — never auto-decide.** This is the load-bearing
  constraint for this specific phase; see the dedicated section below.
- **Tenancy**: app-boundary enforcement is PRIMARY (`importer_id` derived from the loaded row, never
  a caller argument — D-18/D-21, repeated in literally every use case read this session); Supabase
  RLS is defense-in-depth only. `importer_id` chains to `importers.user_id` (Phase 44). New tables
  must carry `importer_id`, not a direct `user_id` column, to match every existing table in this
  domain (`extraction_records`, `component_entity_candidate_links`, `entity_instances`).
- **Coverage gate**: `apps/email-listener` pytest ratcheted to 65% (step-up ladder 70/75/80 planned,
  never lowered). New use-case code needs `tests/test_<use_case_name>.py` (see naming convention
  confirmed at `apps/email-listener/tests/test_confirm_region.py`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Correction capture (entity-type reclassification) | API/Backend (FastAPI use case) | Database/Storage (new table) | Mirrors `ConfirmRegionUseCase`/`SetComponentEntityTypeUseCase` — a use case loads prior state, writes an audit row, then mutates (D-16 idiom) |
| Correction capture (dedup reject) | Database/Storage | — | Already fully implemented (`component_entity_candidate_links.was_dismissed`) — no new capture work |
| Few-shot retrieval bias | API/Backend | Database/Storage (Postgres RPC: vector HNSW + pg_trgm) | Existing pattern (`RetrievalPort`/`EntityResolutionRepository`) — this phase adds a parallel port, not a new tier |
| LLM prompt rendering (few-shot block) | API/Backend | — | `autofill_adapter.py`/`entity_type_classifier_adapter.py` — Bedrock call happens server-side only; region/example content never reaches the browser tier untrusted (D-14) |
| Suggest-only surfacing / human confirm | Browser/Client (existing UI) | API/Backend (tRPC → FastAPI) | The confirm/reclassify UI (`use-role-mutations.ts`) already exists and needs **zero changes** — corrections flow through it today; only the backend capture+reuse logic behind it changes |
| Tenancy / ownership | API/Backend (`importer_id` derivation) + Database (RLS) | — | Existing chokepoint pattern (D-18/D-21, `@polytoken/db/ownership` on the TS side) — new table follows the same shape, no new tier |

## Standard Stack

### Core

No new libraries. This phase is 100% internal architecture extension over already-vetted
infrastructure:

| Component | Version (verified this session) | Purpose | Why no substitute needed |
|-----------|-----|---------|--------------------------|
| `anthropic` SDK (`AsyncAnthropicBedrock`) | Already pinned in `apps/email-listener/pyproject.toml`; injected via `app/container.py:266` | Bedrock LLM calls for both autofill and entity-type classification | Same client instance reused — do not add a second SDK or a direct Anthropic API client (LLM transport constraint) |
| Postgres `pgvector` (halfvec) + `pg_trgm` | Already enabled (migrations `0009`, `0017`) | Vector cosine + trigram similarity, the existing "similarity" signal | This IS the "similar email/entity" resolution mechanism (see §4 below) — do not add a new embedding/similarity library |
| Supabase Python client (`postgrest-py` via `supabase-py`) | Already the sole DB access layer for `apps/email-listener` | RPC calls (`.rpc(...)`), table CRUD | No ORM change; Python side does NOT use Drizzle (that's `packages/db`/TS only) |

### Supporting

None. No embedding model change (stays Bedrock Titan V1, 1536-dim, `halfvec(1536)` column type —
confirmed in `match_entities_by_embedding`/`match_components_by_embedding` RPC signatures).

### Alternatives Considered

| Instead of | Could use | Tradeoff |
|------------|-----------|----------|
| Extending the existing RRF(k=60) hybrid retrieval to a new call site | A dedicated re-ranker model/service | Net-new infra, net-new latency, net-new failure mode, and violates "least new surface" — REJECTED, see §Reuse mechanism |
| Retrieval/few-shot correction loop | LoRA/fine-tuning on corrected examples | Explicitly out of scope per phase brief ("NOT model fine-tuning, keep it bounded") and structurally impossible today anyway — Bedrock IAM transport gives no fine-tuning surface for the models in use |
| New `entity_type_corrections` table | Overload `extraction_records.corrected_fields` to also carry entity-type corrections | `entity_type_id` lives on `email_components`, not `extraction_records` — a reclassification is not a field-value correction and has no natural home in the existing row shape; a dedicated table is 3 columns bigger but honest about what it records |

**Installation:** None required.

## Package Legitimacy Audit

**Not applicable.** This phase installs zero external packages (no `npm install`, no `uv add` / `pip
install`). It exclusively adds: one Postgres migration (new table + RPC parameter), Python domain
entities/ports/use-cases in the existing Clean Architecture layers, and (optionally) Drizzle schema
+ ownership-helper additions on the TS side if a "correction history" UI is ever surfaced. The
Package Legitimacy Gate protocol is skipped by design (nothing to slopcheck).

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────────────────┐
                    │  Browser (apps/web) — UNCHANGED for LEARN-01/02      │
                    │  /emails/[id] entity-type dropdown (existing)        │
                    │  /entities merge-suggestion accept/reject (existing) │
                    └───────────────┬───────────────────────────────────────┘
                                    │ tRPC (existing procedures:
                                    │  emails.setEntityType, entities.confirmMerge/rejectMerge)
                                    ▼
                    ┌─────────────────────────────────────────────────────┐
                    │  Next.js API layer (packages/api-client) — UNCHANGED │
                    │  PATCH /v1/components/{id}/entity-type (existing)    │
                    │  POST /v1/entities/{id}/merge/reject (existing)      │
                    └───────────────┬───────────────────────────────────────┘
                                    │ HTTP (X-API-Key)
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│  apps/email-listener (FastAPI, Clean Architecture)                                │
│                                                                                     │
│  ┌─────────────────────────────┐        ┌──────────────────────────────────┐      │
│  │ SetComponentEntityTypeUseCase│  NEW: │ RecordEntityTypeCorrection        │      │
│  │ (set_component_relationship  │──────▶│ (writes entity_type_corrections   │      │
│  │  .py) — EXTENDED             │ step  │  row BEFORE update_entity_type)   │      │
│  └─────────────────────────────┘        └──────────────────────────────────┘      │
│                                                                                     │
│  ┌─────────────────────────────┐        ┌──────────────────────────────────┐      │
│  │ RejectMergeUseCase           │ ALREADY│ component_entity_candidate_links │      │
│  │ (curate_entity_merge.py)     │ WRITES │ .was_dismissed = true            │      │
│  │ — UNCHANGED                  │───────▶│ (migration 0018, since Phase 10) │      │
│  └─────────────────────────────┘        └──────────────────────────────────┘      │
│                                                                                     │
│  ┌─────────────────────────────┐   NEW  ┌──────────────────────────────────┐      │
│  │ SuggestEntityTypesUseCase    │───────▶│ EntityTypeCorrectionRetrieval    │      │
│  │ (suggest_entity_types.py)    │ query  │ Port.find_similar(...)           │      │
│  │ — EXTENDED                   │        │ (NEW port, mirrors RetrievalPort)│      │
│  └──────────────┬────────────────┘       └──────────────┬───────────────────┘      │
│                 │ examples=(...)                          │ RRF(k=60) hybrid       │
│                 ▼                                          │ vector+trgm, importer_ │
│  ┌─────────────────────────────┐                          │ id-scoped ONLY (NOT    │
│  │ EntityTypeClassifierProtocol │                          │ entity_type_id-scoped  │
│  │ .classify(..., examples=)    │                          │ — see rationale below) │
│  │ — EXTENDED (was: no examples)│                          ▼                        │
│  └──────────────┬────────────────┘        ┌──────────────────────────────────┐     │
│                 │                          │ entity_type_corrections (NEW)   │     │
│                 ▼                          │ table — reads component.embedding│    │
│  ┌─────────────────────────────┐           │ + content_text via JOIN         │     │
│  │ Bedrock (AsyncAnthropicBedrock)│         └──────────────────────────────────┘     │
│  │ <entity_type_examples> block │  SUGGEST-ONLY: still sets extraction_status=      │
│  │ appended to user turn (D-14) │  'candidate' only, CONFIDENCE_THRESHOLD=0.5 gate  │
│  └─────────────────────────────┘  unchanged — never auto-confirms (see invariant)   │
│                                                                                     │
│  ┌─────────────────────────────┐   NEW  ┌──────────────────────────────────┐      │
│  │ ResolveEntityCandidatesUseCase│──────▶│ find_candidates(..., subject_    │      │
│  │ PromoteEntityOnConfirmUseCase │ param │  entity_instance_id=...)         │      │
│  │ — EXTENDED (thread through    │        │ EXTENDED RPC filters was_       │      │
│  │  entity_instance_id)          │        │ dismissed=true pairs (migration │      │
│  └─────────────────────────────┘         │ 0017 RPCs re-emitted, new param) │      │
│                                            └──────────────────────────────────┘      │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

No new top-level directories. New/changed files fit the existing Clean Architecture layout exactly:

```
apps/email-listener/app/
├── domain/
│   ├── entities/
│   │   └── entity_type_correction.py          # NEW — frozen dataclass, mirrors extraction_record.py
│   └── ports/
│       ├── entity_type_correction_repository.py  # NEW — save() + find_similar() protocol
│       └── entity_type_classifier_protocol.py     # EXTENDED — add `examples` param to classify()
├── application/use_cases/
│   ├── set_component_relationship.py           # EXTENDED — SetComponentEntityTypeUseCase captures correction
│   ├── suggest_entity_types.py                 # EXTENDED — retrieve + pass examples to classifier
│   └── resolve_entity_candidates.py            # EXTENDED — thread entity_instance_id to find_candidates
├── infrastructure/
│   ├── supabase/
│   │   ├── entity_type_correction_repository.py  # NEW — Supabase impl (mirrors retrieval_repository.py)
│   │   └── entity_resolution_repository.py        # EXTENDED — pass subject id, dismiss filter
│   └── llm/
│       └── entity_type_classifier_adapter.py       # EXTENDED — render <entity_type_examples> block
├── presentation/api/v1/
│   └── components.py                             # UNCHANGED (existing PATCH /entity-type route body untouched)
└── container.py                                   # EXTENDED — DI wiring for the new port

packages/db/migrations/
└── 00XX_entity_type_corrections.sql               # NEW table + RPC parameter additions (see §Migration)

packages/db/src/schema/
└── entity-type-corrections.ts                     # NEW — Drizzle mirror (only if TS ever reads this table)

apps/email-listener/tests/
├── test_set_component_relationship.py             # EXTENDED (or new file matching existing convention)
├── test_suggest_entity_types.py                   # EXTENDED
└── test_resolve_entity_candidates.py               # EXTENDED
```

### Pattern 1: Load-before-mutate correction capture (D-16 idiom)

**What:** Every existing correction-adjacent use case in this repo follows the same order: load the
CURRENT row, derive tenant from it, capture what's about to change, THEN write the mutation. Never
mutate first and infer the "before" state from a diff.

**When to use:** Any new correction-capture code in this phase (entity-type reclassification).

**Example (existing, from `confirm_region.py:117-134`):**
```python
# Source: apps/email-listener/app/application/use_cases/confirm_region.py:117-134
if candidate is not None:
    confirmed_record = ExtractionRecord(
        id=candidate.id,                      # same id — D-16 upsert-in-place
        ...
        status="confirmed",
        corrected_fields=corrected_fields,     # the NEW value
        # candidate.extracted_fields is preserved unchanged on the SAME row —
        # "before" is never lost, "after" is the overlay (D-16: never overwrite priors)
        ...
    )
    await self._extractions.save(confirmed_record)
```

**Recommended shape for LEARN-01 (entity-type correction), following the identical idiom:**
```python
# NEW: apps/email-listener/app/application/use_cases/set_component_relationship.py
class SetComponentEntityTypeUseCase:
    def __init__(
        self,
        *,
        components: ComponentRepository,
        corrections: EntityTypeCorrectionRepository | None = None,  # NEW, optional (best-effort)
    ) -> None:
        self._components = components
        self._corrections = corrections

    async def execute(
        self, *, component_id: str, entity_type_id: str | None, importer_id: str | None = None,
    ) -> Component:
        component = await self._components.find_by_id(component_id)
        if component is None:
            raise ValueError(f"Component not found: {component_id}")
        if importer_id is not None and component.importer_id != importer_id:
            raise ValueError(f"Component not found: {component_id}")

        # NEW: capture the correction BEFORE mutating, mirroring D-16.
        # Only a genuine correction (prior value existed AND differs) is recorded —
        # first-time classification from blank is not a "correction".
        previous = component.entity_type_id
        if (
            self._corrections is not None
            and previous is not None
            and entity_type_id is not None
            and previous != entity_type_id
        ):
            try:
                await self._corrections.save(
                    component_id=component_id,
                    importer_id=component.importer_id,
                    previous_entity_type_id=previous,
                    corrected_entity_type_id=entity_type_id,
                )
            except Exception:
                logger.warning("entity_type_correction_capture_failed", exc_info=True)
                # best-effort: never block the reclassification itself (mirrors
                # confirm_region.py's synthesis-hook posture — capture failure
                # must not prevent the human's correction from taking effect)

        updated = await self._components.update_entity_type(component_id, entity_type_id)
        return updated
```

### Pattern 2: Importer-scoped RRF(k=60) hybrid retrieval feeding a Bedrock few-shot block (D-13/D-15)

**What:** The existing, proven "reuse" mechanism: embed the query text (Bedrock Titan), run a vector
cosine RPC and a `pg_trgm` similarity RPC in parallel, merge with reciprocal rank fusion (`1/(60+rank)`),
render the top-N as a delimited XML-ish block in the Bedrock user turn (never the system prompt — D-14).

**When to use:** Both LEARN-02 extensions (entity-type few-shot, and — conceptually — any future
correction-reuse mechanism in this domain). This is the ONE retrieval-bias pattern to reuse, not
reinvent.

**Example — the existing field-value version (`retrieval_repository.py:81-149`, condensed):**
```python
# Source: apps/email-listener/app/infrastructure/supabase/retrieval_repository.py
vector_rows = self._vector_query(embedding=..., entity_type_id=..., importer_id=...)
trgm_rows = self._trgm_query(key_terms=..., entity_type_id=..., importer_id=...)
merged_ids = _merge_rrf([vector_ids, trgm_ids])[:top_n]   # 1/(60+rank) per arm, summed
# ... build RetrievedExample(component_id, content_text, extracted_fields, score) ...
```

**Key structural difference for the entity-type-correction retrieval (important — do not copy
verbatim):** the field-value retrieval filters by `entity_type_id` because it ALREADY knows the
type (autofill runs after classification). The entity-type-correction retrieval runs **before**
classification is known — it must be `importer_id`-scoped only, returning corrections across ALL
entity types, each tagged with its own `corrected_entity_type_id`, so the classifier LLM can pick
the right slug using nearest-neighbor examples as evidence. This is the one non-obvious adaptation
this phase requires — get the RPC filter scope wrong and the mechanism silently returns nothing
useful (over-filtered) or floods the classifier with irrelevant examples (under-filtered by
`top_n` alone). Recommend `top_n=3` (matches `find_similar_confirmed`'s existing default) and rely
on RRF ranking, not a type filter, to surface the closest matches.

### Anti-Patterns to Avoid

- **Building a second embedding pipeline for entity-type corrections.** The corrected component's
  `embedding` column is already populated by `ConfirmRegionUseCase.execute()`
  (`confirm_region.py:170-174`) on **every** confirm, regardless of entity type. The new retrieval
  should `JOIN email_components` on `entity_type_corrections.component_id` and reuse
  `email_components.embedding`/`content_text` directly (exactly like migration `0009`'s
  `JOIN email_components c ON ... JOIN extraction_records er`) — do not add a duplicate embedding
  column to the new table.
- **Filtering `find_candidates` results in Python after the fact instead of in the RPC.** The
  existing `SupabaseEntityResolutionRepository.find_candidates` (`entity_resolution_repository.py`)
  runs `_CANDIDATE_LIMIT = 20` per arm before RRF-merging to `top_n` (default 5). If `was_dismissed`
  filtering is applied in Python AFTER the RPC returns, a dismissed candidate can still consume one
  of the 20 pre-merge slots and starve out a legitimate candidate that would otherwise have ranked.
  Filter inside the SQL RPC (`NOT EXISTS (...)`), not in the Python merge step.
- **Auto-raising confidence past the existing `CONFIDENCE_THRESHOLD = 0.5` gate.** Few-shot examples
  from corrections should influence the LLM's own confidence output, never bypass or override the
  threshold check in `SuggestEntityTypesUseCase.execute()` (`suggest_entity_types.py:121`). Do not
  add a "confidence boost" constant that stacks on top of the model's returned score — let the
  model's own `field_completeness * mean_self_confidence`-style formula (mirrored for classification)
  do the work, keeping exactly one arbiter of confidence.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| "Similar email/entity" resolution | A new cosine-similarity or Jaccard/Levenshtein matcher | The existing Bedrock Titan V1 (1536-dim, `halfvec`) embedding + `pg_trgm` hybrid, RRF(k=60)-fused (migrations `0009`, `0017`) | This IS the production-validated signal (per `PROJECT.md` Key Decisions: "Reuse pgvector + Titan V1 (1536) + RRF for the flywheel"); a second similarity metric would fragment "similar" into two inconsistent definitions across the codebase |
| Logistics-identifier matching for the trigram arm | A new regex/NLP identifier extractor | `app/domain/services/key_terms.py`'s `extract_key_terms()` — already extracts container numbers (ISO 6346 check-digit validated), BL/booking/PO/invoice numbers, ReDoS-hardened | Pure domain function, zero I/O, already wired into both `AutofillUseCase` and `AutofillFieldsUseCase`; reuse verbatim for any new trigram query text |
| Correction audit trail primitives | A generic "audit log" table/service | The existing per-domain pattern: dedicated narrow tables (`extraction_records.corrected_fields`, `component_entity_candidate_links.was_dismissed`) each scoped to one correction type | A generic audit log would need its own retrieval/rendering logic anyway — the existing pattern is already "structured, addressable" per-domain, which is literally LEARN-01's requirement text |
| Confidence scoring for classification | A learned re-ranker or heuristic scoring model | The existing `_compute_confidence` formula shape (`autofill_adapter.py:297-325`: `field_completeness * mean_self_confidence`) — mirror it for the classifier's `confidence` field, which Bedrock already reports per `_CLASSIFY_REGIONS_TOOL_DICT` schema | One more model call output field, not a new scoring subsystem |
| ML training loop / fine-tuning | Any gradient-based learning on corrections | Retrieval + few-shot prompt injection (D-13/D-15) | Explicitly out of scope per phase brief; Bedrock IAM transport has no fine-tuning surface for the Claude models in use; the existing flywheel already IS "the learning loop" architecturally |

**Key insight:** Every piece this phase needs already has a proven analog shipped in Phase 4/10/17/31.
The work is disciplined *extension* — same shapes, same RRF constant (k=60), same D-14 prompt-injection
discipline, same D-18/D-21 tenancy derivation — applied to two under-covered call sites. Anything that
looks like "build a new X" should be treated as a signal to go re-read the existing analog first.

## Common Pitfalls

### Pitfall 1: Treating `component_entity_candidate_links.component_id` as always an `email_components.id`

**What goes wrong:** The column is polymorphic. `PromoteEntityOnConfirmUseCase` writes rows where
`component_id` is a real `email_components.id` (occurrence + duplicate-candidate links,
`promote_entity_on_confirm.py:241-280`). But `ConfirmMergeUseCase`/`RejectMergeUseCase`
(`curate_entity_merge.py`) write/update rows where `component_id` is actually an
**`entity_instances.id`** — confirmed by `select_candidate_link`'s own comment: *"Try
(entity_instance_id → target_id) direction ... .eq('component_id', entity_instance_id)"*
(`entity_instance_repository.py:326-333`). A migration or RPC change that assumes
`component_id` always FKs cleanly to `email_components` will break dedup-link queries silently.

**Why it happens:** The table was originally named/shaped for component→entity provenance
(Phase 10) and was reused for entity→entity dedup links (Phase 10's D-09/D-20 curation loop)
without renaming the column.

**How to avoid:** When wiring the `was_dismissed` filter into `match_entities_by_embedding`/
`match_entities_by_trgm`, treat the new `match_subject_entity_instance_id` RPC parameter as
matching against `component_entity_candidate_links.component_id` (the entity-to-entity direction),
and test both directions (the existing code writes/reads both `(subject→target)` and
`(target→subject)` symmetrically — the new filter must too, or a dismiss recorded in one direction
resurfaces from the other).

**Warning signs:** A dismiss-then-resolve test that passes when entity A resolves against B but
fails when B resolves against A (or vice versa) — direction asymmetry.

### Pitfall 2: `was_dismissed` is a proven-dead code path — don't assume any other "capture" in this domain is actually wired to a consumer

**What goes wrong:** The existing docstring on `dismiss_candidate_link`
(`entity_instance_repository.py:349`) states the suppression behavior as fact. It is false as
implemented (verified: zero read sites in the whole `apps/email-listener` tree). Anyone reading the
docstrings/comments in this codebase as ground truth for "what already works" will be wrong here.

**Why it happens:** The capture (write side) shipped in Phase 10 (migration `0018`); the reuse
(read side) was apparently scoped for later and never followed up — a documented example of the
exact "lockstep breaks after capture ships" failure mode this phase must not repeat.

**How to avoid:** For every correction-capture write this phase adds or touches, write (and land in
the SAME plan/wave) a passing test that proves the corresponding READ path changes behavior —
not just that the write succeeds. See §Suggest-only invariant for the exact assertion shape.

**Warning signs:** A plan step that says "record the correction" with no corresponding step that
says "and verify a later resolve/classify call is measurably different because of it."

### Pitfall 3: Migration number collision with Phase 56

**What goes wrong:** As of this research, HEAD migration is `0036_chat_conversation_thread_id.sql`
(confirmed via `packages/db/migrations/meta/_journal.json`, `idx: 36`). **Phase 56 (Research Canvas:
Backend & Semantic Context Model) precedes Phase 57 in the roadmap and has its own migration
dependency** but has not yet been planned (`.planning/phases/56-.../` is empty as of this research).
If Phase 56 runs first and claims `0037`, Phase 57's migration must be `0038`+.

**Why it happens:** Both phases were scoped in the same milestone-opening pass before either was
planned; migration numbers are allocated at plan/execute time, not at research time.

**How to avoid:** At plan time (not now), re-run `cat packages/db/migrations/meta/_journal.json |
tail -20` (or equivalent) to get the ACTUAL head before allocating a migration number. Do not
hardcode `0037` into the plan.

**Warning signs:** A `drizzle-kit` migration generation conflict, or a migration filename that
already exists when the plan executes.

### Pitfall 4: Adding entity-type-correction retrieval INSIDE the `entity_type_id` filter by copy-pasting the autofill retrieval

**What goes wrong:** Copying `find_similar_confirmed`'s signature verbatim (which takes
`entity_type_id` as a required filter parameter) into the new entity-type-correction retrieval
would make it structurally incapable of ever returning results — the whole point of this retrieval
is to run BEFORE `entity_type_id` is known.

**Why it happens:** Pattern-matching the "closest" existing example without checking whether its
preconditions still hold at the new call site.

**How to avoid:** The new `EntityTypeCorrectionRepository.find_similar()` signature must be
`importer_id`-scoped only (no `entity_type_id` parameter) — see Pattern 2 above for the exact
rationale.

**Warning signs:** A code review catching a retrieval call inside `SuggestEntityTypesUseCase` that
tries to pass an `entity_type_id` the use case doesn't have yet (it's determining it).

### Pitfall 5: Recurring-vs-one-off — no new "is this recurring" concept needed, but don't accidentally scope retrieval too narrowly

**What goes wrong:** It's tempting to add an explicit "is this a recurring sender/entity" flag or
classifier to satisfy the "get recurring same-entity right over time" framing from 999.19 step 1.

**Why this is unnecessary:** The existing `importer_id`-scoped (LEARN-01/02's entity-type axis) and
`importer_id` + `entity_type_id`-scoped (existing field-value axis) retrieval ALREADY implicitly
favors recurring patterns — a sender/entity/document shape seen multiple times within one importer's
history accumulates more confirmed/corrected rows to be retrieved as few-shot evidence, while a
genuine one-off has nothing to retrieve and correctly falls back to the existing cold-start path
(D-13, `examples=()`). No new "recurring" concept is needed; it emerges from the retrieval volume.

**How to avoid over-building:** Do not add a `is_recurring` column, a frequency counter, or a
separate "recurring entity" detector. If a measurement is wanted, reuse the
`packages/db/scripts/retrieval-miss-rate.ts` pattern (a read-only reporting script joining events to
corrections at query time, Phase 31-02 precedent) rather than a new stateful counter.

## Code Examples

### Extending `EntityTypeClassifierProtocol` with a few-shot `examples` parameter (mirrors `AutofillProtocol`)

```python
# Source: apps/email-listener/app/domain/ports/entity_type_classifier_protocol.py — EXTENDED
class EntityTypeClassifierProtocol(Protocol):
    async def classify(
        self,
        *,
        regions: tuple[RegionToClassify, ...],
        entity_types: tuple[object, ...],
        examples: tuple[dict[str, object], ...] = (),  # NEW — mirrors AutofillProtocol.autofill
    ) -> tuple[EntityTypeSuggestion, ...]: ...
```

```python
# Source: apps/email-listener/app/infrastructure/llm/entity_type_classifier_adapter.py — EXTENDED
def _render_correction_examples_block(examples: tuple[dict[str, object], ...]) -> str:
    """Mirrors autofill_adapter._render_examples_block exactly (D-14: user turn only)."""
    if not examples:
        return ""
    rendered = "\n".join(
        f"<example><content>{ex['content_text']}</content>"
        f"<corrected_entity_type_slug>{ex['entity_type_slug']}</corrected_entity_type_slug></example>"
        for ex in examples
    )
    return f"<entity_type_examples>\n{rendered}\n</entity_type_examples>"

# In AnthropicEntityTypeClassifier.classify(), append to user_content exactly like autofill does:
#   user_content = f"{user_content}\n\n{_render_correction_examples_block(examples)}"
```

### Wiring `was_dismissed` suppression into the BlendedRAG entity-resolution RPCs

```sql
-- Extension of migration 0017's match_entities_by_trgm (new migration, CREATE OR REPLACE):
CREATE OR REPLACE FUNCTION match_entities_by_trgm(
  query_text text,
  match_importer_id uuid,
  match_entity_type_id uuid,
  match_count int,
  match_subject_entity_instance_id uuid DEFAULT NULL  -- NEW, backward-compatible default
)
RETURNS TABLE (id uuid, display_name text, sim real, name_sim real, identifier_sim real, alias_sim real)
LANGUAGE sql STABLE
AS $$
  SELECT id, display_name, sim, name_sim, identifier_sim, alias_sim
  FROM ( /* ... existing sub-select unchanged ... */ ) sub
  WHERE sim > 0
    AND (
      match_subject_entity_instance_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM component_entity_candidate_links l
        WHERE l.was_dismissed = true
          AND (
            (l.component_id = match_subject_entity_instance_id AND l.entity_instance_id = sub.id)
            OR (l.component_id = sub.id AND l.entity_instance_id = match_subject_entity_instance_id)
          )
      )
    )
  ORDER BY sim DESC
  LIMIT match_count;
$$;
```

```python
# Source: entity_resolution_repository.py (domain port) — EXTENDED
class EntityResolutionRepository(Protocol):
    def find_candidates(
        self,
        *,
        display_name: str,
        identifiers: dict[str, object],
        entity_type_id: str,
        importer_id: str,
        embedding: list[float] | None,
        top_n: int = 5,
        subject_entity_instance_id: str | None = None,  # NEW, optional — backward compatible
    ) -> list[EntityCandidate]: ...
```

```python
# Source: resolve_entity_candidates.py — the ONE call site that already has entity_instance_id in
# scope and just needs to thread it through:
candidates = self._resolution_repo.find_candidates(
    display_name=instance.display_name,
    identifiers=instance.identifiers,
    entity_type_id=instance.entity_type_id,
    importer_id=importer_id,
    embedding=instance.embedding,
    top_n=top_n,
    subject_entity_instance_id=entity_instance_id,  # NEW line
)
```

### The assertion shape LEARN-02 needs ("measurably differing from pre-correction behavior")

```python
# tests/test_resolve_entity_candidates.py — NEW test proving the was_dismissed fix actually works
async def test_dismissed_candidate_is_not_resurfaced():
    # 1. Two entity instances resolve as candidates for each other (pre-correction baseline).
    candidates_before = await use_case.execute(entity_instance_id=subject_id)
    assert target_id in [c.entity_instance_id for c in candidates_before]

    # 2. Human rejects the merge suggestion (the correction).
    await reject_merge_use_case.execute(subject_id, target_id)

    # 3. Same resolution call, same inputs — the correction must measurably change the output.
    candidates_after = await use_case.execute(entity_instance_id=subject_id)
    assert target_id not in [c.entity_instance_id for c in candidates_after]
```

## State of the Art

Not applicable in the usual "library X moved to Y" sense — this is a closed internal system with no
external ecosystem to track. The one relevant "state of the art" fact is internal: the D-13/D-15
few-shot flywheel (Phase 4/31) is itself the most recent iteration of this repo's own learning-loop
architecture, superseding an earlier cold-start-only autofill. LEARN-01/02 is the next iteration of
the *same* lineage, not a new one.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A new `entity_type_corrections` table (rather than adding a column to `email_components` or reusing `extraction_records`) is the right shape for capturing entity-type reclassification | Correction-capture point / Migration | LOW — if wrong, the fix is a schema reshape before any consumer exists yet (no back-compat burden); reasoning is grounded in the existing schema's own separation of concerns (extraction_records ≠ component identity) |
| A2 | The entity-type-correction few-shot retrieval should be `importer_id`-scoped only (not `entity_type_id`-scoped) | Pattern 2 / Pitfall 4 | MEDIUM — if this scoping is too broad in practice (an importer with many unrelated entity types), results could be noisy; mitigated by RRF ranking + `top_n=3`, but this is a design judgment call, not a verified-in-repo fact, and should be confirmed against real correction volume once it exists (mirrors the Phase 31 "measurement-gated" precedent for stage-3 retrieval) |
| A3 | A correction should only be captured when `previous_entity_type_id is not None` (i.e., genuine reclassification, not first-time classification) | Pattern 1 code example | LOW — this is an explicit design choice this research recommends, not a repo-verified fact; the plan should confirm this threshold makes sense for the "learn from correction" framing (first-time human disagreement with a candidate AI suggestion could arguably also count as signal — worth a discuss-phase question if CONTEXT.md doesn't already answer it) |
| A4 | No Python-side equivalent of `tableColumnExists` is needed for the new table, relying on migrations-first deploy discipline instead | Landmines / Project Constraints | LOW-MEDIUM — true today because Python (ECS) and TS (Vercel) deploy on different triggers/paths and could race a migration; if the new table is read from BOTH sides in the same wave, `tableColumnExists` gating on the TS side is still required per existing precedent (migration 0036) — this assumption only concerns the Python side |

**No CONTEXT.md exists for this phase** (`has_context: false` at research time) — none of the above
were pre-answered by a `/gsd:discuss-phase` pass. A1/A2/A3 in particular are good candidates for a
discuss-phase pass before planning locks them, since they shape the new table's schema and the
retrieval scope.

## Open Questions

1. **Should a reclassification captured mid-review (before first confirm) count as a "correction," or only a reclassification of an already-confirmed entity?**
   - What we know: `SetComponentEntityTypeUseCase` is called from the same UI dropdown in both
     cases — there's no code-level distinction between "overriding the AI's pending suggestion" and
     "correcting a previously-confirmed classification."
   - What's unclear: Whether pre-confirm overrides are noisy (the human is still exploring/hasn't
     locked in an opinion) versus load-bearing signal.
   - Recommendation: Capture both (Pattern 1's code example already does — it only requires
     `previous != new`, not `extraction_status == 'confirmed'`), and let `content_text_snapshot` +
     `created_at` on the new table give a future filter the option to distinguish them later if the
     signal turns out to be noisy in practice. Don't gate on `extraction_status` at capture time —
     that's an easy filter to add at RETRIEVAL time later if needed, and premature filtering at
     capture time is unrecoverable (the data is just gone).

2. **Does the entity-type few-shot retrieval need its own `EmbeddingProtocol.embed()` call, or can it reuse the component's already-persisted embedding at retrieval time?**
   - What we know: `SuggestEntityTypesUseCase` currently does NOT embed anything — it sends raw
     region text straight to the classifier (`suggest_entity_types.py:97-104`). Adding retrieval
     means embedding the CANDIDATE region (the one being classified NOW, which has no
     `entity_type_id` yet and may not have gone through `ConfirmRegionUseCase` yet, so its
     `component.embedding` column could be `NULL`).
   - What's unclear: Whether it's worth an extra Bedrock embed call per classification batch (cost/
     latency) versus falling back to trigram-only retrieval (D-12's existing "vector arm skipped
     when embedding is None" graceful-degradation pattern, already proven in
     `entity_resolution_repository.py:144`).
   - Recommendation: Reuse the D-12 degrade-to-trgm-only pattern rather than forcing a new embed
     call into the classification hot path — `SuggestEntityTypesUseCase` runs once per ingested
     email across potentially many candidate regions in one batched Bedrock call
     (`RELIABILITY constraint`, `entity_type_classifier_protocol.py:1-5`); adding N embed calls
     ahead of it would work against that same reliability constraint. Confirm this tradeoff at plan
     time, not research time — it affects task sequencing (embed-then-classify vs. trgm-only).

## Environment Availability

No new external dependency. AWS Bedrock (IAM role, `AsyncAnthropicBedrock`) and Supabase Postgres
(`pgvector`/`pg_trgm` extensions) are both already live and exercised by every prior phase touched
in this research (Phase 4, 10, 17, 31) — no new environment verification needed for this phase.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| AWS Bedrock (`AsyncAnthropicBedrock`, IAM role) | Entity-type few-shot classification call | Yes — already live, `app/container.py` | Model `us.anthropic.claude-3-5-haiku-20241022-v1:0` (classifier), same client as autofill | N/A — this is the only sanctioned LLM transport per PROJECT.md constraints |
| Postgres `pgvector` (halfvec) | New retrieval RPC | Yes — enabled since migration `0009`/entity resolution since `0017` | halfvec(1536) | N/A |
| Postgres `pg_trgm` | New retrieval RPC + `was_dismissed` filter | Yes — enabled since migration `0009` | GIN trgm indexes already exist on relevant columns | N/A |

## Security Domain

`security_enforcement` is absent from `.planning/config.json` → treated as enabled per protocol.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V4 Access Control | Yes | Existing `importer_id`-derived-from-row pattern (D-18/D-21) — new use case/table MUST NOT accept `importer_id` as a caller argument; derive from the loaded `Component`/`EntityInstance` row exactly like every use case read this session |
| V5 Input Validation | Yes | Pydantic request models at the FastAPI boundary (existing `ConfirmRequest`/pattern in `components.py`) — any new request body (none anticipated; existing `PATCH /entity-type` route is reused unchanged) stays schema-validated |
| V6 Cryptography | No | No new secrets/crypto surface |
| V9 Communication | N/A | No new external network calls beyond existing Bedrock/Supabase, both already IAM/key-authenticated |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection via corrected-example content reaching the system prompt | Tampering/Elevation | Follow D-14 exactly: correction examples render ONLY in the Bedrock **user turn** inside delimited tags (`<entity_type_examples>`), never in `_build_system_prompt` — mirrors the existing `_render_examples_block`/`_render_entity_context_block` discipline in `autofill_adapter.py` verbatim |
| Cross-tenant correction leakage (importer A's corrections influencing importer B's classification) | Information Disclosure | Every retrieval RPC MUST filter `match_importer_id` on every row, matching T-04-28/T-10-10 precedent already enforced on every existing RPC read this session |
| Cross-tenant IDOR on the new `entity_type_corrections` table if ever exposed via tRPC | Information Disclosure/Tampering | If a "correction history" panel is ever added to `apps/web`, it MUST go through `@polytoken/db/ownership`'s chokepoint (add a new `assertEntityTypeCorrectionOwnership` following the exact shape of `assertComponentOwnership`, `ownership.ts:130-152`) — never a raw unscoped query |
| Silent auto-decision creeping into a suggest-only surface (the load-bearing risk for this specific phase) | Elevation of Privilege (of the automation, over the human) | See dedicated section below |

## Suggest-only invariant — where correction signal enters as suggestion vs. decision

This is the phase's load-bearing constraint (explicit in `PROJECT.md` Constraints: *"suggest-only
for all knowledge mutations — never auto-decide"*), so tracing every consumer explicitly, with
file:line evidence, rather than asserting it:

1. **Entity-type few-shot → `SuggestEntityTypesUseCase`.** Adding `examples` to the classifier call
   changes what confidence score and slug the LLM RETURNS. It does not change what the use case
   DOES with that return value: `extraction_status remains 'candidate' — never auto-confirmed`
   (`suggest_entity_types.py:11`, unchanged code path) and the `CONFIDENCE_THRESHOLD = 0.5` gate
   (`suggest_entity_types.py:33,121`) still applies unchanged. A human still must act via the
   existing `setEntityType`/confirm flow. **Verified: the write path this use case calls
   (`update_role`/`update_entity_type`, `suggest_entity_types.py:138-139`) is identical before and
   after this phase's change — only the INPUT to the LLM call changes, not what happens to its
   output.**

2. **`was_dismissed` retrieval-suppression → `ResolveEntityCandidatesUseCase`/
   `PromoteEntityOnConfirmUseCase`.** Filtering dismissed pairs out of `find_candidates` changes
   which candidates are RETURNED for a human to review. `ResolveEntityCandidatesUseCase` is
   explicitly documented as read-only: *"NEVER writes a merge, never auto-confirms, and never
   modifies any row. It is read-only."* (`resolve_entity_candidates.py:31-32`, unchanged).
   `PromoteEntityOnConfirmUseCase` already writes candidate-link provenance rows for surfaced
   candidates but explicitly never merges: *"Suggest-only (D-05): never writes a merge or flips
   `nauta_id` automatically"* (`promote_entity_on_confirm.py:15`, unchanged). The only user-visible
   effect of the fix is that a dismissed pair no longer appears in a list a human would otherwise
   see and could re-dismiss — strictly fewer redundant suggestions, zero new automation.

3. **Entity-type correction capture → `SetComponentEntityTypeUseCase`.** The new capture write
   (`entity_type_corrections` insert) happens ALONGSIDE the existing mutation, which was already a
   direct human action (the human explicitly picked a new `entity_type_id` via the dropdown). No new
   automated decision is introduced — this is pure audit-trail capture of a decision the human
   already made through the existing UI, not a new decision point.

**The one place a future implementer could accidentally violate this invariant:** raising
`CONFIDENCE_THRESHOLD` past 0.5 dynamically based on "how many corrections back this suggestion up,"
or worse, auto-setting `extraction_status='confirmed'` when correction-backed confidence is very
high. Neither exists today and neither should be added — the confidence score is model output data,
never a bypass for the human-confirm requirement. Any plan task that touches
`suggest_entity_types.py`'s threshold logic or `update_status`/`update_entity_type` write paths
warrants explicit scrutiny against this invariant during plan review.

## Sources

### Primary (HIGH confidence — direct file reads this session)

- `apps/email-listener/app/application/use_cases/confirm_region.py` — D-15/D-16 flywheel, existing corrected_fields capture
- `apps/email-listener/app/application/use_cases/set_component_relationship.py` — entity-type reclassification gap
- `apps/email-listener/app/application/use_cases/suggest_entity_types.py` — suggest-only classification, CONFIDENCE_THRESHOLD
- `apps/email-listener/app/application/use_cases/deny_field.py` — origin-aware negative-signal handling (D-18/D-19)
- `apps/email-listener/app/application/use_cases/autofill.py`, `autofill_fields.py` — few-shot retrieval consumption
- `apps/email-listener/app/application/use_cases/curate_entity_merge.py` — dedup confirm/reject/unmerge, D-20
- `apps/email-listener/app/application/use_cases/promote_entity_on_confirm.py` — D-05 suggest-only entity promotion
- `apps/email-listener/app/application/use_cases/resolve_entity_candidates.py` — read-only BlendedRAG resolution
- `apps/email-listener/app/application/use_cases/promote_edge.py` — knowledge-graph tier promotion, CAS discipline
- `apps/email-listener/app/application/use_cases/synthesize_knowledge.py` — tier ladder (EXTRACTED/INFERRED/AMBIGUOUS)
- `apps/email-listener/app/domain/ports/{retrieval_port,entity_resolution_repository,entity_type_classifier_protocol,knowledge_synthesizer}.py`
- `apps/email-listener/app/domain/entities/{entity_instance,extraction_record,component,entity_type}.py`
- `apps/email-listener/app/domain/services/key_terms.py` — logistics identifier extraction
- `apps/email-listener/app/infrastructure/supabase/{retrieval_repository,entity_resolution_repository,entity_instance_repository}.py`
- `apps/email-listener/app/infrastructure/llm/{autofill_adapter,entity_type_classifier_adapter}.py`
- `apps/email-listener/app/container.py` — DI wiring for both LLM adapters
- `apps/email-listener/app/presentation/api/v1/components.py` — REST surface, corrected_fields request body
- `apps/web/src/app/emails/[id]/_components/use-role-mutations.ts` — existing correction-trigger UI (setEntityType, denyField)
- `packages/db/migrations/{0000_real_garia,0009_retrieval_rpcs,0016_entity_identity,0017_entity_resolution_rpcs,0018_many_scarecrow,0036_chat_conversation_thread_id}.sql`
- `packages/db/migrations/meta/_journal.json` — confirmed HEAD = migration 0036
- `packages/db/src/schema/{extractions,component-links,importers}.ts`
- `packages/db/src/ownership.ts` — the central ownership chokepoint (Phase 44 TENA-03)
- `packages/api-client/src/router/_column-detect.ts`, `_ownership.ts` — TS-side feature-detection + ownership wrapper patterns
- `packages/api-client/src/router/emails/mutations.ts` — setEntityType tRPC procedure confirming zero new UI needed
- `packages/db/scripts/retrieval-miss-rate.ts` — Phase 31-02 measurement-script precedent
- `.planning/REQUIREMENTS.md`, `.planning/PROJECT.md` (Key Decisions, Constraints, Current State) — v1.10 scope, suggest-only stance, tier ladder history

### Secondary / Tertiary

None used — every claim in this document traces to a primary source read in this session. No
WebSearch/Context7 lookups were needed (zero external libraries/frameworks are new to this phase).

## Metadata

**Confidence breakdown:**
- Correction-capture gap analysis (LEARN-01): HIGH — verified by direct code read + whole-tree grep confirming absence of consumers
- Reuse-mechanism recommendation (LEARN-02): HIGH — the recommended pattern is a verified, already-shipped, already-tested mechanism in this same codebase (D-13/D-15), not a hypothesis
- Suggest-only invariant proof: HIGH — traced file:line for every touched consumer
- Schema/migration specifics (table shape, RPC parameter shape): MEDIUM — grounded in existing schema conventions but the exact shape is a research recommendation, not yet locked by a discuss-phase pass (see Assumptions Log A1-A3)
- Security domain: HIGH — no new attack surface introduced beyond existing, already-enforced patterns

**Research date:** 2026-07-15
**Valid until:** Effectively indefinite for the architectural findings (internal, stable code); re-verify migration HEAD (currently 0036) immediately before planning, since Phase 56 may advance it first.
