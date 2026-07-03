# Phase 14: Exact Cache and Template Store - Context

**Gathered:** 2026-06-27
**Status:** Ready for planning
**Source:** Autonomous synthesis from research + roadmap + Phase 13 shipped code (overnight run — user to review flagged decisions)

<domain>
## Phase Boundary

Persist **every successfully-validated generated spec** to a Drizzle/Postgres template store
(`ui_spec_templates`), and short-circuit repeat intents with an identical context through a
**SHA-256 exact-match cache** that returns a stored spec **re-bound to live data with zero Bedrock
calls** — and make a **registry-version bump automatically invalidate** affected cache entries.

This is **Tier 1 only** of the research's three-tier flywheel (`TEMPLATE-FLYWHEEL.md` §2, §9):
deterministic exact-match hash lookup + the persisted template store that v1.2 semantic retrieval
(Tier 2) and promotion (the flywheel) will later build on. It seeds the flywheel foundation; it does
**not** build the flywheel.

This phase hooks into the Phase 13 generation path **inside `GenerateUiSpecUseCase.execute()`**
(`apps/email-listener`), which today runs `quarantine → generate → audit`. Phase 14 inserts a
**cache CHECK before quarantine** (a hit returns immediately, skipping both Bedrock calls and the
generation audit row) and a **template PERSIST after a successful, validated generation**. The web
`genui.generate` tRPC procedure and `SpecRenderer` are **unchanged** — they already proxy/validate;
the cache is invisible to them except that a hit returns faster.

**In scope (mapped reqs):** CACHE-01, CACHE-02, CACHE-03, CACHE-04.

The 3 binding ROADMAP success criteria (Phase 14 section):
  1. A generated spec is persisted to `ui_spec_templates` (Drizzle/Postgres) with its intent, registry
     version, validation status, and metadata immediately after a successful generation — the flywheel
     foundation for v1.2 semantic retrieval.
  2. A second identical intent (same canonical intent + data shape + registry version + context) returns
     the cached spec with **live data re-bound** and triggers **zero Bedrock calls** — observable via the
     audit log showing **no new generation entry**.
  3. When the registry version increments (e.g. on deploy), cache keys derived from the old version are
     **automatically invalidated** so stale specs are never served without re-generation.

**Out of scope (later phases / v1.2 — explicit scope fence):**
- **Semantic / vector retrieval (Tier 2)** — `embedding halfvec`, HNSW, `pg_trgm`, `match_templates_by_*`
  RPCs, RRF(k=60), cosine-distance thresholds — **v1.2 FLY-01**. This phase is **EXACT-match only**. The
  `embedding` column is **NOT added** this phase (it depends on the unresolved OD-1 dimension decision;
  `TEMPLATE-FLYWHEEL.md` §11 / CURRENCY-2026 correction #9). A documented seam is left so it slots in.
- **Template promotion / ranking / `status='promoted'` / promotion-score signals** (`confirm_count`,
  `regenerate_count`, `feedback_score`, the promotion engine) — **v1.2 FLY-02**.
- **Binding-slot parameterization / `{{slot}}` token extraction + JSON-Pointer re-injection**
  (`TEMPLATE-FLYWHEEL.md` §4) — **v1.2 FLY-03**. v1.1 "re-bind" is the existing render-time data scope
  (see D-09), not stored binding slots.
- **Full `/studio` surface** (catalog browser, generation sandbox, cache-hit-vs-cold state indicator) —
  **Phase 15** (STDO-01..04). Phase 14 returns a machine-readable `cacheHit` signal the studio later renders.
- **LLM-judge offline eval, axe-core, eval/adversarial regression harness** — **v1.2 EVAL**.
</domain>

<decisions>
## Implementation Decisions

### Cache placement & topology (CACHE-02, CACHE-03, success criterion 2) — KEY DECISION

- **D-01: The cache lives in the FastAPI Python service** (`apps/email-listener`), wired into
  `GenerateUiSpecUseCase` as a new domain port (`UiSpecTemplateRepository`) + Supabase adapter — exactly
  mirroring Phase 13's `GenerationAuditRepository` port/adapter shape (13-02). The web `genui.generate`
  tRPC procedure and `SpecRenderer` are **unchanged**: the web already proxies to
  `POST /v1/genui/generate` and re-validates with `SpecRootSchema.safeParse`. This honors Phase 13 D-01
  (all Bedrock + LLM-pipeline logic is server-side on ECS; Vercel carries no AWS creds and proxies). The
  cache must sit where the Bedrock calls are, so a hit can skip them.

- **D-02: Cache CHECK is the FIRST step of `GenerateUiSpecUseCase.execute()` — strictly BEFORE the
  quarantine call (Call A), the generator call (Call B), AND the generation audit write.** On a hit the
  use case returns the stored spec immediately. This is the only placement that satisfies success
  criterion 2 literally: **zero Bedrock calls** (both quarantine and generator are skipped) and **no new
  generation audit entry** (the `genui_generation_events` row is written only on the cold path, after
  generation). The current `execute()` order becomes: `compute cache_key → cache lookup → [HIT: return]
  → quarantine → generate → [persist template] → audit`.

- **D-03: A cache hit writes NO `genui_generation_events` (generation audit) row** — success criterion 2
  requires "no new generation entry," and that table's `outcome` CHECK is `ok|fallback|escalated` (a
  generation vocabulary). Instead, a hit is observable via **(a)** a structured `genui_cache_hit` log line
  (importer, registry_version, cache_key prefix — never raw intent) and **(b)** an in-band
  `cache_hit: true` flag on the use-case result + a `use_count` increment on the matched
  `ui_spec_templates` row (D-12). The audit table stays a pure record of *generations*; the template store
  is the record of *reuse*. [JUDGMENT CALL — review: a hit could instead append a row to the audit table
  with a new `cache_hit` outcome; rejected because success criterion 2 says "no new generation entry" and
  the existing CHECK constraint would have to be widened. A distinct cache-hit *signal* (log + use_count),
  not a generation row, is the faithful reading.]

### Cache-key composition (CACHE-02, success criterion 2) — KEY DECISION

- **D-04: `cache_key = SHA-256(canonical_intent || "\x1f" || data_shape_hash || "\x1f" || registry_version
  || "\x1f" || context_descriptor)`**, hashed over a `0x1f` (unit-separator) delimited, fixed-field-order
  byte string, lowercase hex digest. Delimiting prevents field-boundary collisions (e.g. intent "ab" +
  shape "c" vs "a" + "bc"). The key is computed **entirely from the request payload** — it requires **no
  Bedrock call** — which is what lets D-02 short-circuit before quarantine. (`TEMPLATE-FLYWHEEL.md` §2,
  SUMMARY §3 "Tier-1 exact cache".)

- **D-05: `canonical_intent` normalization = `intent.strip().lower()` then collapse internal whitespace
  runs to a single space** (Unicode `\s+` → `" "`), NFC Unicode normalization first. This defeats the
  cache-fragmentation pitfall ("Show invoice" vs "show  Invoice" must hit the same entry —
  `TEMPLATE-FLYWHEEL.md` §10 Pitfall 4). The **trusted `intent` string from the request** is the only
  intent input — NOT the quarantine `intent_summary` (which is LLM-derived and unavailable pre-Bedrock,
  and would be non-deterministic). Normalization is a single pure function reused by both the cache-check
  path and (mirrored in TS) any future web-side pre-hashing.

- **D-06: `data_shape_hash` = SHA-256 over the **sorted structural shape** of the bound data — keys + JSON
  value *types*, never values.** For v1.1 the bound data is the request's `raw_content`: if `raw_content`
  parses as JSON, derive a recursive shape descriptor (`{ "field": "string", "lines": ["number"] }` —
  sorted object keys, array element types collapsed/deduped, scalar→type-name); if it is opaque text,
  the shape descriptor is the constant `"text"`. **Live values are excluded by construction**, so two
  invoices with different amounts but identical fields produce the same `data_shape_hash` and hit the same
  cached spec, which then re-binds the fresh values at render (CACHE-03, success criterion 2;
  `TEMPLATE-FLYWHEEL.md` §2 "captures the *schema* … not the actual values"). An empty/absent `raw_content`
  hashes a stable `"∅"` sentinel. [JUDGMENT CALL — review: deriving shape from `raw_content` structure is
  the only data available pre-Bedrock; the alternative (hashing the quarantine extraction) is rejected
  because it would require the Bedrock quarantine call before the key exists, defeating the zero-call
  guarantee. If the studio later sends an explicit `data_shape` descriptor, prefer it over deriving from
  `raw_content`.]

- **D-07: `registry_version` in the key = `REGISTRY_VERSION.version`** — the 64-hex SHA-256 content hash
  from `packages/genui/src/registry/registry-version.ts` (Phase 12 D-07), which the request already
  carries as the `registry_version` field (validated, `min_length=1`). Because it is a **content hash of
  the catalog surface**, ANY catalog change flips it, which is the entire invalidation mechanism (D-13).
  Stored on each row AND embedded in the key — both, deliberately (the key for matching, the column for
  the deploy-hook query and observability).

- **D-08: `context_descriptor` = the `importer_id` (tenant scope) joined with the `catalogId`** from
  `REGISTRY_VERSION.catalogId` (`"global"` in v1.1). This is the per-catalog-id / per-tenant isolation
  seam (D-21 from Phase 12 / SEAM-03): it prevents cross-tenant and cross-catalog cache collisions and
  lets tenant-scoped catalogs slot in with **no key-shape change** later (`TEMPLATE-FLYWHEEL.md` §2
  `entity_type_slug` + `importer_id`; SUMMARY §3). `importer_id` absent (system-level generation) hashes a
  stable `"__system__"` sentinel so null and "system" never alias. [JUDGMENT CALL — review:
  `TEMPLATE-FLYWHEEL.md` §2 also folds `entity_type_slug` into the key; v1.1 has no per-spec entity-type on
  the request (the quarantine `entity_type` is post-Bedrock and unavailable pre-key), so context is scoped
  to importer + catalogId only. Entity-type scoping is a documented v1.2 widening that does not change the
  key construction — it appends one more delimited field.]

### `ui_spec_templates` table (CACHE-01, success criterion 1) — KEY DECISION

- **D-09: Drizzle owns the schema; the new table is `packages/db/src/schema/ui-spec-templates.ts` +
  migration `0022_ui_spec_templates.sql`** — exactly the pattern of `genui-generation-events.ts` +
  `0021_genui_generation_events.sql` (the analog from 13-02). `packages/db` is the single schema owner
  (per project memory: Drizzle owns schema, `/supabase` is config only). Migrations-first deploy
  discipline applies (the migration lands on staging+prod before the code that writes it).

- **D-10: v1.1 column set (exact-cache slice only — the semantic/promotion columns are deferred, D-14):**
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `cache_key text NOT NULL` — the D-04 SHA-256 hex; **`UNIQUE`** (the exact-match index + the
    `ON CONFLICT` target, D-15)
  - `intent_text text NOT NULL` — the **canonical** (normalized, D-05) intent. [JUDGMENT CALL — review:
    `genui_generation_events` stores only an intent *hash* for privacy (D-19); the template store needs
    the canonical intent text for v1.2 semantic retrieval + studio inspection, so it is stored in plaintext
    here. This is a deliberate divergence — the template store is operational template data, the audit log
    is a privacy-minimized event log. If intent prose is sensitive per-tenant, revisit before enabling the
    studio template browser.]
  - `data_shape_hash text NOT NULL` — the D-06 hash (stored for observability + future shape-drift checks)
  - `registry_version text NOT NULL` — D-07 (the invalidation lever + deploy-hook predicate, D-13)
  - `catalog_id text NOT NULL DEFAULT 'global'` — the per-catalog-id seam (D-08 / SEAM-03 / D-21)
  - `spec_json jsonb NOT NULL` — the full validated `SpecRoot` (`v:1`), exactly as it will re-render
  - `validation_status text NOT NULL DEFAULT 'validated'` — CHECK `in ('validated')` for v1.1 (only
    validated specs are ever persisted, D-11); the column + CHECK leave room for `'candidate'`/`'promoted'`
    /`'invalidated'` in v1.2 without a type change (`TEMPLATE-FLYWHEEL.md` §4 `status`)
  - `spec_node_count integer`, `spec_depth integer` — metadata (reuse the generator's `_count_nodes`
    walker), nullable, for observability + the success-criterion-1 "metadata" clause
  - `use_count integer NOT NULL DEFAULT 0` — incremented on each cache hit (D-03/D-12); the only
    promotion-adjacent signal kept in v1.1 because it is free on the hit path and feeds v1.2 promotion
  - `importer_id uuid` — tenant scope, nullable (system generations), mirrors `genui_generation_events`
  - `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`
  - Indexes: **`UNIQUE` on `cache_key`** (Tier-1 O(1) lookup), btree on `(importer_id, catalog_id)`
    (scope), btree on `registry_version` (the deploy-hook invalidation query, D-13).

- **D-11: PERSIST only SUCCESSFULLY-VALIDATED generations — never the `SAFE_FALLBACK_SPEC`, never a raw/
  invalid spec.** The use case persists after Call B **only when the generation outcome is `ok` or
  `escalated`** (i.e. `_determine_outcome(...) != "fallback"` — the existing fallback-detection logic in
  `generate_ui_spec.py`). A fallback spec is never cached (caching it would poison every future identical
  intent into permanent failure — `TEMPLATE-FLYWHEEL.md` §10 Pitfall 5 generalized; SUMMARY GR-06). This
  makes the store a clean foundation for v1.2 promotion. Serves CACHE-01 + success criterion 1.

- **D-12: PERSIST is an upsert: `INSERT … ON CONFLICT (cache_key) DO UPDATE SET use_count =
  use_count + 1, updated_at = now()` (or `DO NOTHING` + a separate increment on the read path).** This is
  the concurrency-safe write the research mandates for the two-simultaneous-miss race
  (`TEMPLATE-FLYWHEEL.md` §11 gap 1): two requests that both miss and both cold-generate must not error or
  duplicate — the second insert no-ops on the unique `cache_key` and the spec already cached wins. The
  hit-path `use_count` increment (D-03) and the conflict-path increment converge on the same column.

### Cache-check / write integration in the use case (CACHE-01, CACHE-02, CACHE-03)

- **D-13: Registry-version invalidation is LAZY — old keys simply stop matching; nothing is purged on the
  hot path.** Because `registry_version` is part of the `cache_key` (D-04/D-07), an incremented
  `REGISTRY_VERSION.version` makes every pre-existing key **unreachable** automatically: a request with the
  new version computes a new key → cache miss → cold generation → new row keyed by the new version. No
  manual flush, no hot-path version comparison. This is the "versioned cache key" mechanism the research
  calls primary (`TEMPLATE-FLYWHEEL.md` §6, SUMMARY differentiators, CURRENCY-2026 §5; directly serves
  CACHE-04 + success criterion 3). Confirmed: lazy is correct and sufficient for v1.1.

- **D-14: An OPTIONAL deploy-side hard-invalidation hook is provided but is NOT the primary mechanism.**
  Because lazy invalidation leaves old-version rows resident (harmless — they are simply never matched), a
  **idempotent maintenance step** marks them dead so the store does not grow unbounded and so the future
  v1.2 semantic tier never retrieves a stale-version template:
  `UPDATE ui_spec_templates SET validation_status='invalidated', updated_at=now() WHERE registry_version <>
  $current AND validation_status='validated'`. v1.1 ships this as a **documented, idempotent SQL the deploy
  hook MAY run** (matching the redrive/maintenance-script precedent), gated so it never blocks the request
  path. The CACHE-04 guarantee is met by D-13 alone; D-14 is hygiene + the v1.2 seam
  (`TEMPLATE-FLYWHEEL.md` §6 "deploy hook"). [JUDGMENT CALL — review: lazy (D-13) fully satisfies CACHE-04;
  the deploy hook is optional hardening, not a blocker. Recommend shipping the SQL + wiring it into the
  existing deploy/migration step but treating its absence as non-fatal.]

- **D-15: The lookup is exact, scoped, and validity-filtered:** `SELECT spec_json, id FROM
  ui_spec_templates WHERE cache_key = $1 AND validation_status = 'validated' LIMIT 1`. The unique index on
  `cache_key` makes this O(1). The `validation_status='validated'` predicate means a row hard-invalidated
  by D-14 is treated as a miss (regenerate), which is the correct behavior. On hit: return `spec_json`
  (already a valid `SpecRoot`), increment `use_count`, log `genui_cache_hit`. Serves CACHE-02/CACHE-03.

- **D-16: "Live data re-bound" (CACHE-03) = the existing Phase 12/13 render-time data scope, NOT stored
  binding slots.** The cached `spec_json` contains `dataRef` dotted-path strings + declared-state
  primitives (Phase 12 D-11/D-12), resolved by `resolveDataRef` against the live scope at render time
  every time. So returning the stored spec and rendering it with the **current** request's data already
  re-binds fresh values — no value is baked into `spec_json` (the generator system prompt already forbids
  embedding raw content, 13-03). v1.1 needs **no** `{{slot}}` extraction; binding-slot parameterization
  (`TEMPLATE-FLYWHEEL.md` §4) is the v1.2 FLY-03 seam. This is why D-06's value-free `data_shape_hash` is
  safe: identical shape ⇒ identical `dataRef` structure ⇒ correct re-bind. Serves CACHE-03 + success
  criterion 2 ("live data re-bound").

### Where the cache logic lives (CACHE-01..04, project transport)

- **D-17: New domain port `UiSpecTemplateRepository` (Protocol) + Supabase adapter, mirroring 13-02.**
  Port (`app/domain/ports/ui_spec_template_repository.py`): `async find_by_cache_key(cache_key) ->
  CachedTemplate | None`, `async persist(template: TemplateToPersist) -> None`,
  `async increment_use_count(id) -> None` (best-effort). Frozen dataclasses for `CachedTemplate` /
  `TemplateToPersist` (immutability, CLAUDE.md). Adapter
  (`app/infrastructure/supabase/supabase_ui_spec_template_repository.py`) uses the sync supabase client via
  `asyncio.to_thread` (the WR-06 pattern from `SupabaseGenerationAuditRepository`). **`persist` and
  `increment_use_count` are best-effort (swallow+log, never raise)** — a store-write failure must never
  fail the generation response (the spec is already valid; caching is an optimization). `find_by_cache_key`
  may surface errors as a miss (treat any lookup error as "no hit" → cold generate). Serves CACHE-01.

- **D-18: The cache-key computation is a pure Python helper** (`app/application/.../cache_key.py` or a
  domain service) — `compute_cache_key(*, intent, raw_content, registry_version, importer_id, catalog_id)
  -> str` — with `canonicalize_intent` (D-05) and `compute_data_shape_hash` (D-06) as separately-tested
  pure functions. Kept in the application/domain layer (no infra import) so the use case stays
  lint-imports-clean (the 13-03 contract). Deterministic + side-effect-free so it is trivially unit-tested
  against the success-criterion-2 "second identical intent → same key" assertion.

- **D-19: DI wiring mirrors 13-03 exactly:** a `_provide_ui_spec_template_repository(client: Client)`
  factory in `app/container.py` providing the Protocol port → Supabase adapter, and the
  `_provide_generate_ui_spec_use_case` factory gains the new `templates` dependency. `GenerateUiSpecUseCase`
  takes `templates: UiSpecTemplateRepository` as a new keyword constructor arg (typed via the Protocol —
  the audit repo is already typed this way; the two LLM adapters stay `Any`). Serves CACHE-01..03 wiring.

### Security / data-handling (carried from Phase 13, reaffirmed)

- **D-20: `ui_spec_templates` carries the RLS deny-all baseline** (`AS RESTRICTIVE FOR ALL TO anon /
  authenticated USING(false) WITH CHECK(false)`) in migration 0022, matching every sibling app table
  (`0001_rls_deny_all.sql`, `0020_knowledge_node_edges_rls.sql`). The FastAPI service connects as
  `postgres`/service-role (bypasses RLS by design); the policy closes direct anon/authenticated access so a
  Supabase client cannot read/write cached specs cross-tenant. `importer_id` + `catalog_id` in the key
  (D-08) are the data-isolation filter. Threat: cross-tenant cache read/poison.

- **D-21: No eval / Function / dynamic execution on the cache→render path** (GR-01, D-24 from Phase 13,
  reaffirmed). A cached `spec_json` is **data**: it is returned and re-validated at the web boundary by the
  existing `SpecRootSchema.safeParse` (13-04) before reaching `SpecRenderer`, exactly as a freshly-generated
  spec is. The cache adds a DB read, not a new execution surface. [JUDGMENT CALL — review: whether the
  Python cache path should also `jsonschema`-re-validate the stored `spec_json` on read. Recommended:
  trust-on-write (only validated specs are stored, D-11) + the authoritative web-boundary Zod re-validation
  is sufficient; re-validating on every hit would re-introduce cost the cache exists to remove. The
  registry-version key (D-07) already guarantees a stored spec was valid against the *current* catalog.]

### Claude's Discretion

- **Exact `data_shape_hash` descriptor algorithm** within D-06's value-free constraint: recursion depth cap,
  how array element-type unions are collapsed (e.g. `["string","number"]` vs first-element), how to treat
  `null`/missing fields. Pick a deterministic, well-tested rule; the only hard requirement is *values never
  enter the hash* and *identical shapes produce identical hashes*.
- **Whether the cache-key helper is also mirrored in TypeScript** (`packages/genui` or `packages/api-client`)
  for a future web-side pre-check, or stays Python-only for v1.1. Python-only is sufficient (the cache lives
  in FastAPI, D-01); a TS mirror is a v1.2 convenience, not required.
- **`CachedTemplate` / `TemplateToPersist` exact field sets** within D-10's column set, and whether
  `persist` computes `spec_node_count`/`spec_depth` (reuse the generator's `_count_nodes`) or leaves them
  null in v1.1.
- **Exact `validation_status` enum/CHECK wording** and whether the v1.2 statuses (`candidate`/`promoted`/
  `invalidated`) are pre-declared in the CHECK now or added later — within D-10's "leave room" intent.
- **Whether D-14's deploy hook is wired into the existing deploy/migration workflow this phase or shipped as
  a documented idempotent script** — within D-13's "lazy is primary, hook is hygiene" framing.
- **New settings** (if any — e.g. a `GENUI_CACHE_ENABLED` kill-switch) following the `settings.py` property
  pattern; a kill-switch is recommended so the cache can be disabled without redeploy if a poisoning bug
  surfaces, but is not required by the success criteria.
</decisions>

<specifics>
## Specific Ideas

`TEMPLATE-FLYWHEEL.md` + SUMMARY patterns to follow (Tier-1 slice only, semantic/promotion deferred):

- **Tier-1 exact cache is the whole phase** (`TEMPLATE-FLYWHEEL.md` §2, §9 top box; SUMMARY §3
  differentiators): deterministic `SHA-256(canonical intent + data_shape_hash + registry_version +
  context)`, O(1) unique-index lookup, zero embedding/LLM cost. The research's §3/§7 Tier-2 (embeddings,
  HNSW, `pg_trgm`, RRF, `match_templates_by_*` RPCs) and §5 promotion engine are **explicitly NOT built**.
- **Versioned cache key = automatic invalidation** (`TEMPLATE-FLYWHEEL.md` §6 "Versioned cache keys
  (primary mechanism)", CURRENCY-2026 §5): "include a version identifier as part of your cache key so old
  keys stop matching on deploy — no manual flush needed." `REGISTRY_VERSION.version` is a content hash
  (Phase 12 D-07), so it flips on any catalog change → CACHE-04 for free (D-13).
- **Normalize intent before hashing** (`TEMPLATE-FLYWHEEL.md` §2, §10 Pitfall 4): `trim().lower()` +
  whitespace-collapse so rephrasing whitespace/case does not fragment the cache.
- **Data SHAPE not values** (`TEMPLATE-FLYWHEEL.md` §2): "captures the *schema* of the data … not the
  actual values. Two invoices with different amounts but the same fields should hit the same cache entry —
  the template re-binds the data at render time." This is the success-criterion-2 "live data re-bound"
  contract (D-06/D-16).
- **`INSERT … ON CONFLICT (cache_key) DO NOTHING/UPDATE`** (`TEMPLATE-FLYWHEEL.md` §11 gap 1): concurrency-
  safe against two simultaneous misses both cold-generating (D-12).
- **Only validated specs persist** (`TEMPLATE-FLYWHEEL.md` §5 promotion gate generalized, SUMMARY GR-06,
  §10 Pitfall 5): never cache the `SAFE_FALLBACK_SPEC` — caching a failure poisons every identical future
  request (D-11).
- **Drizzle-kit cannot emit halfvec/HNSW** (`TEMPLATE-FLYWHEEL.md` §10 Pitfall 7): irrelevant this phase
  because the `embedding` column + HNSW index are DEFERRED — but the precedent (`0002_hnsw_halfvec_indexes.sql`,
  `0009_retrieval_rpcs.sql`) is the v1.2 seam. v1.1's `0022` is a plain table + btree/unique indexes +
  RLS, fully drizzle-kit-emittable except the RLS policy (hand-written SQL like `0020`).
- **Cache lives where Bedrock lives** (Phase 13 D-01, 13-03): the cache check/persist is in the Python
  `GenerateUiSpecUseCase`, port+adapter style, because the hit must skip the Bedrock calls that are server-
  side. Web tRPC is unchanged — it already proxies + re-validates.
- **Use case order** (`generate_ui_spec.py` today): `quarantine → generate → audit`. Phase 14:
  `compute_cache_key → templates.find_by_cache_key → [HIT: increment use_count, log, return] → quarantine
  → generate → [if outcome != fallback: templates.persist] → audit`.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Template / cache design (primary for this phase)
- `.planning/research/TEMPLATE-FLYWHEEL.md` — **THE primary doc.** §2 cache-key composition + normalization
  + data-shape-not-values, §4 `ui_spec_templates` schema (v1.1 takes the exact-cache columns, defers the
  semantic/promotion columns), §6 versioned-key invalidation + deploy hook, §10 pitfalls (4 intent
  canonicalization, 5 don't-cache-failures, 7 drizzle-kit/HNSW = v1.2), §11 gap 1 `ON CONFLICT`. NOTE the
  scope fence: §3 (semantic retrieval), §5 (promotion), §7 (RPCs), and the `embedding`/`binding_slots`/
  promotion-signal columns are **v1.2, NOT this phase**.
- `.planning/research/SUMMARY.md` — §3 "Tier-1 exact cache" differentiator, §4 Phase 5 build order
  ("Exact Cache + Template Store"), §5 GR-06 (safeParse-before-store), §6 OD-1 (embedding dimension —
  the reason `embedding` is deferred this phase).
- `.planning/research/CURRENCY-2026.md` — §5 "versioned cache keys … 0.15 threshold is for Tier-2 (not
  this phase)"; correction #9 (halfvec(1536) vs Titan-1024 is the unresolved OD-1 blocking the embedding
  column — confirms deferring it). Drizzle/Postgres conventions.
- `.planning/REQUIREMENTS.md` — CACHE-01..04 (exact text of the 4 mapped reqs); the v1.2 FLY-01..03
  deferrals.
- `.planning/ROADMAP.md` (Phase 14 section) — the 3 binding success criteria.

### Phase 13 generation path this phase hooks into (MUST read)
- `.planning/phases/13-generation-layer-and-guardrails/13-CONTEXT.md` — D-01 (FastAPI placement, the
  load-bearing topology fact), D-19 (audit table — the analog for `ui_spec_templates` + the "no new
  generation entry" seam), D-07/D-18 (temperature:0 determinism makes caching meaningful).
- `.planning/phases/13-generation-layer-and-guardrails/13-03-SUMMARY.md` — `GenerateUiSpecUseCase` shape,
  the quarantine→generate→audit order, the port/adapter + Dishka DI pattern, "Phase 14 CACHE-02 seam: cache
  check will short-circuit the use case" (explicit handoff).
- `.planning/phases/13-generation-layer-and-guardrails/13-04-SUMMARY.md` — the web `genui.generate` tRPC
  procedure + `SpecRootSchema.safeParse` web-boundary re-validation (unchanged this phase; the cached spec
  re-validates the same way).
- `apps/email-listener/app/application/use_cases/generate_ui_spec.py` — **the integration point.** Where
  the cache CHECK goes (before `quarantine.extract`) and the PERSIST goes (after `generator.generate`, when
  `_determine_outcome(...) != "fallback"`). Reuse `_determine_outcome`, the `intent_hash`, the `log` bind.
- `apps/email-listener/app/domain/ports/generation_audit_repository.py` +
  `apps/email-listener/app/infrastructure/supabase/supabase_generation_audit_repository.py` — **the closest
  analog** for the new `UiSpecTemplateRepository` port + Supabase adapter (frozen DTO, Protocol, best-effort
  swallow+log, `asyncio.to_thread` WR-06).
- `apps/email-listener/app/infrastructure/llm/genui_generator_adapter.py` — `GeneratorResult`
  (`spec`/`attempts`/`escalated`), `SAFE_FALLBACK_SPEC` shape (the D-11 don't-persist target),
  `_count_nodes` walker (reuse for `spec_node_count`/`spec_depth`).
- `apps/email-listener/app/container.py` — the `_provide_*` factory + `provider.provide(...)` registration
  pattern (lines ~371–515) to extend for the template repo + the use-case factory's new dependency.
- `apps/email-listener/app/presentation/api/v1/genui.py` — the endpoint is **unchanged** (still returns the
  spec); confirm the request already carries `registry_version` + `importer_id` (it does — both fields).

### Registry-version seam (the invalidation lever)
- `packages/genui/src/registry/registry-version.ts` — `REGISTRY_VERSION { catalogId, version }`; `version`
  is the 64-hex content hash that goes into the cache key (D-04/D-07) and whose change is the automatic
  invalidation (D-13/CACHE-04). `catalogId` ("global") is the per-tenant seam (D-08/SEAM-03). The header
  comment explicitly names this as "the CACHE-04 seam."

### Drizzle table + migration pattern (the analog to copy)
- `packages/db/src/schema/genui-generation-events.ts` — the Drizzle `pgTable` shape + `$inferSelect`/
  `$inferInsert` exports + index definitions to mirror for `ui-spec-templates.ts`.
- `packages/db/migrations/0021_genui_generation_events.sql` — the migration shape (CREATE TABLE + indexes)
  for `0022_ui_spec_templates.sql`.
- `packages/db/migrations/0020_knowledge_node_edges_rls.sql` — the RLS deny-all baseline SQL to replicate
  for the new table (D-20).
- `packages/db/migrations/0019_cold_energizer.sql` — the FK-constraint emission style if
  `importer_id` references `importers(id)` (mirror the existing pattern).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`GenerateUiSpecUseCase`** (`generate_ui_spec.py`, 13-03): the orchestration seam. Today
  `quarantine → generate → audit`. Phase 14 adds a cache CHECK as step 0 and a template PERSIST between
  generate and audit. `_determine_outcome` already distinguishes `fallback` from `ok`/`escalated` (the
  D-11 don't-persist gate). `intent_hash`, the `start_ms` latency, and the structured `log` are reusable.
- **`GenerationAuditRepository` port + `SupabaseGenerationAuditRepository`** (13-02): the **exact template**
  for `UiSpecTemplateRepository` + `SupabaseUiSpecTemplateRepository` — frozen DTO, `Protocol`,
  structural (no explicit inheritance), best-effort swallow+log, `asyncio.to_thread` around the sync
  supabase client (WR-06). Copy this shape.
- **`GeneratorResult`** (`genui_generator_adapter.py`): `spec`/`attempts`/`escalated`; `SAFE_FALLBACK_SPEC`
  (the constant to detect-and-skip in D-11); `_count_nodes(root) -> (count, depth)` (reuse for
  `spec_node_count`/`spec_depth` metadata).
- **`REGISTRY_VERSION`** (`registry-version.ts`): `version` content hash = the cache-key invalidation lever;
  already on every request (`registry_version` field, validated `min_length=1`).
- **`packages/db` Drizzle** (`genui-generation-events.ts` + `0021`): the schema-owner + migration pattern;
  `0022_ui_spec_templates.sql` lands here. RLS baseline from `0020`.
- **Request already carries the key inputs:** `GenerateUiSpecRequest` has `intent`, `raw_content`,
  `registry_version`, `importer_id` — every cache-key input (D-04) is present **before** any Bedrock call,
  which is what makes the pre-quarantine short-circuit (D-02) possible.

### Established Patterns
- **Cache/store = Python FastAPI on ECS, port+adapter, Supabase via `asyncio.to_thread`** (mirrors the
  audit repo). Web is credential-free on Vercel and unchanged — it proxies + re-validates (Phase 13 D-01).
- **Best-effort persistence** (T-13-10 generalized): a template write/increment failure is swallowed+logged,
  never fails the generation response (the spec is already valid; caching is an optimization).
- **`safeParse` at boundaries, immutable/frozen DTOs, named exports, no `console.log`/`print`** (CLAUDE.md);
  **lint-imports**: the use case imports only domain ports (the new repo is a `Protocol`).
- **Migrations-first deploy** (MEMORY/deploy-playbook): `0022` applies to staging+prod before the writing
  code deploys.
- **Content-hash invalidation** (Phase 12 D-07): catalog change ⇒ `REGISTRY_VERSION.version` flips ⇒ old
  keys unreachable ⇒ CACHE-04 with no manual flush.

### Integration Points
- **New domain port:** `apps/email-listener/app/domain/ports/ui_spec_template_repository.py`
  (`UiSpecTemplateRepository` Protocol + `CachedTemplate`/`TemplateToPersist` frozen DTOs).
- **New adapter:** `apps/email-listener/app/infrastructure/supabase/supabase_ui_spec_template_repository.py`.
- **New cache-key helper:** `apps/email-listener/app/application/.../cache_key.py` (pure:
  `canonicalize_intent`, `compute_data_shape_hash`, `compute_cache_key`) — infra-free, unit-tested.
- **Modified use case:** `generate_ui_spec.py` — cache CHECK (step 0, before quarantine) + PERSIST (after
  generate, validated-only) + new `templates` constructor dependency + `cache_hit` flag on the result.
- **Modified DI:** `app/container.py` — `_provide_ui_spec_template_repository` factory + the use-case
  factory gains `templates`.
- **New Drizzle table + migration:** `packages/db/src/schema/ui-spec-templates.ts` +
  `0022_ui_spec_templates.sql` (table + unique/btree indexes + RLS deny-all).
- **Endpoint unchanged:** `genui.py` still returns the spec; the result MAY gain a `cache_hit` field for the
  Phase 15 studio's cache-hit-vs-cold indicator (STDO-04) — a thin additive field, not a contract change.
</code_context>

<deferred>
## Deferred Ideas

- **Tier-2 semantic template retrieval** — `embedding halfvec`, HNSW (`halfvec_cosine_ops`), `pg_trgm` GIN,
  `match_templates_by_embedding` / `match_templates_by_trgm` RPCs, RRF(k=60) reuse of
  `SupabaseRetrievalRepository._merge_rrf`, cosine-distance `< 0.15` threshold — **v1.2 FLY-01**
  (`TEMPLATE-FLYWHEEL.md` §3, §7). The `embedding` column is deferred specifically because **OD-1**
  (1024-dim Titan V2 vs the existing `halfvec(1536)` columns — SUMMARY §6, CURRENCY-2026 correction #9) is
  an unresolved architecture decision that must be settled before that migration.
- **Template promotion / flywheel** — `status='promoted'`, the promotion engine (`confirm_count`,
  `regenerate_count`, `feedback_score`, `promotion_score >= 0.7 AND confirm_count >= 2`), the LLM-Haiku
  offline-eval judge — **v1.2 FLY-02** (`TEMPLATE-FLYWHEEL.md` §5). v1.1 keeps only `use_count` (free on the
  hit path) as the forward-compatible signal.
- **Binding-slot parameterization** — `{{slot}}` token extraction, `binding_slots` JSON-Pointer map,
  re-injection at retrieval — **v1.2 FLY-03** (`TEMPLATE-FLYWHEEL.md` §4 "binding slots"). v1.1 "re-bind" is
  the existing render-time `dataRef`/declared-state scope (D-16), which needs no stored slots.
- **Entity-type scoping in the cache key** — `TEMPLATE-FLYWHEEL.md` §2 folds `entity_type_slug` into the
  key; v1.1 scopes to `importer_id` + `catalog_id` only (the per-request entity type is post-Bedrock,
  unavailable pre-key). A documented v1.2 widening that appends one delimited field (D-08).
- **Data-shape drift check on retrieval** — comparing stored `data_shape_hash` against current entity-type
  fields to force a miss when the shape changed (`TEMPLATE-FLYWHEEL.md` §6 "data shape drift") — relevant
  only once Tier-2 / binding slots exist; v1.1's shape-in-key (D-06) already prevents shape-mismatched hits.
- **30-day TTL sweep** (`TEMPLATE-FLYWHEEL.md` §6 "TTL as safety net") — a v1.2 hygiene cron; v1.1 relies on
  the versioned key (D-13) + optional deploy hook (D-14).
- **Semantic-cache-poisoning defense** (CURRENCY-2026 §5, arXiv:2601.23088) — binding-slot coverage check;
  relevant only when Tier-2 embedding-similarity matching exists. v1.1 exact-match + value-free shape hash +
  per-tenant context (D-06/D-08/D-20) has no fuzzy-match surface to poison.
- **Full `/studio` cache-hit-vs-cold indicator** — Phase 15 (STDO-04). Phase 14 emits the `cache_hit` signal
  (D-03) the studio later renders.
- **TS-side cache-key mirror / web pre-check** — Python-only is sufficient for v1.1 (cache lives in FastAPI);
  a TS mirror is a v1.2 convenience.

### Reviewed Todos (not folded)
- `.planning/.pending-auth-captures.jsonl` is an unrelated runtime artifact (auth captures), not a phase-14
  todo. No pending phase-14 todos found.
</deferred>

---

*Phase: 14-exact-cache-and-template-store*
*Context gathered: 2026-06-27 (autonomous overnight synthesis — user to review flagged decisions)*
