---
phase: 14-exact-cache-and-template-store
reviewed: 2026-06-27T00:00:00Z
depth: deep
files_reviewed: 10
files_reviewed_list:
  - packages/db/src/schema/ui-spec-templates.ts
  - packages/db/migrations/0022_right_firedrake.sql
  - apps/email-listener/app/application/use_cases/cache_key.py
  - apps/email-listener/app/domain/ports/ui_spec_template_repository.py
  - apps/email-listener/app/infrastructure/supabase/supabase_ui_spec_template_repository.py
  - apps/email-listener/app/application/use_cases/generate_ui_spec.py
  - apps/email-listener/app/container.py
  - apps/email-listener/app/presentation/api/v1/genui.py
  - apps/email-listener/tests/test_supabase_ui_spec_template_repository.py
  - apps/email-listener/tests/application/test_generate_ui_spec.py
findings:
  critical: 3
  warning: 4
  info: 2
  total: 9
status: fixed
---

# Phase 14: Exact Cache and Template Store — Code Review Report

**Reviewed:** 2026-06-27
**Depth:** deep
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Phase 14 delivers a deterministic SHA-256 exact-match cache layer over the `GenerateUiSpecUseCase` pipeline. The structural correctness of the zero-Bedrock-on-hit guarantee (D-02) is solid: the cache check genuinely precedes quarantine, generator, and audit. Cross-tenant isolation via `importer_id` is correct in the key formula. The DB schema, CHECK constraint, RLS deny-all, and ON CONFLICT upsert are all properly specified.

Three critical defects were found:

1. **`increment_use_count` does not increment `use_count`** — the DB column is never updated (wrong field); the docstring falsely describes an RPC call that does not exist and no RPC function was created in migration 0022.
2. **The fallback-detection heuristic can misclassify real specs as fallback**, causing them to be silently dropped from cache, breaking CACHE-01 for any spec whose root happens to be `type:"alert"` with a title starting with "Unable to generate".
3. **`canonicalize_intent` uses `str.lower()` instead of `str.casefold()`**, producing different cache keys for the same human-readable intent when it contains non-ASCII uppercase letters (e.g. German "ß", Turkish dotted-I). This breaks CACHE-02's same-intent-same-key guarantee across locales.

Four warnings were also identified, including a stale docstring that references a non-existent RPC function, silent non-atomicity of use_count increments, an unchecked assumption in the adapter that `spec_json` from the DB is already a `dict`, and a double computation of the data_shape_hash on the persist path.

---

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: `increment_use_count` Never Increments `use_count` — Wrong Column Updated

**File:** `apps/email-listener/app/infrastructure/supabase/supabase_ui_spec_template_repository.py:144-153`

**Issue:** The implementation updates only `{"updated_at": now_iso}`. The `use_count` column is never touched. The module-level docstring (line 8) says "UPDATE use_count + 1 + updated_at" but neither happens: `use_count` is unchanged, and the intent of the counter — tracking hit frequency for v1.2 promotion — is silently broken. Every hit leaves `use_count` at 0. The test (`test_increment_use_count_calls_update`) only asserts that `.update` is called, not what it updates, so the defect passes the test suite undetected.

Additionally, the method-level docstring (lines 134-136) falsely states it "Uses a Supabase RPC call" and names a function `increment_ui_spec_template_use_count` that was never created in migration 0022 or anywhere in the migration history. This is dead documentation describing a design that was abandoned but not cleaned up.

**Fix:**
```python
async def increment_use_count(self, template_id: str) -> None:
    """Increment use_count for the given template row (D-03/D-12, best-effort)."""
    now_iso = datetime.now(UTC).isoformat()
    try:
        # supabase-py does not support column arithmetic in .update(); use rpc or
        # do a read-modify-write. For a soft metric, the simplest safe approach is
        # a raw SQL increment via rpc("increment_use_count", {"row_id": template_id})
        # backed by a DB function, OR accept non-atomicity and do:
        await asyncio.to_thread(
            lambda: (
                self._client.rpc(
                    "increment_ui_spec_template_use_count",
                    {"row_id": template_id},
                ).execute()
            )
        )
    except Exception:
        logger.exception(
            "genui_use_count_increment_failed",
            table=_TABLE,
            template_id=template_id,
        )
```
The migration must add the DB function:
```sql
CREATE OR REPLACE FUNCTION increment_ui_spec_template_use_count(row_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE ui_spec_templates
     SET use_count = use_count + 1,
         updated_at = now()
   WHERE id = row_id;
$$;
```
If non-atomic increment is acceptable (best-effort per D-17), an alternative is to SELECT the current count first, then UPDATE — but the RPC approach is cleaner.

---

### CR-02: Fragile Fallback Detection May Silently Drop Validated Specs from Cache (D-11)

**File:** `apps/email-listener/app/application/use_cases/generate_ui_spec.py:223-251`

**Issue:** `_determine_outcome` identifies fallback specs by pattern-matching the spec content:
```python
is_fallback = (
    isinstance(root, dict)
    and root.get("type") == _FALLBACK_ROOT_TYPE          # "alert"
    and isinstance(root.get("title"), str)
    and root["title"].startswith(_FALLBACK_TITLE_FRAGMENT)  # "Unable to generate"
)
```
This is a heuristic against data, not a structural flag. It breaks in two ways:

**A (false positive — correctness BLOCKER):** If a legitimate business spec has `root.type = "alert"` and a title starting with "Unable to generate" (e.g., a notification widget for failed document processing), `_determine_outcome` returns `"fallback"`, `persist()` is never called (D-11 gate), and the spec is silently dropped from cache. Every subsequent identical request re-generates — wasting Bedrock calls and violating CACHE-01.

**B (false negative — security concern):** If the LLM returns a corrupted spec that has `root` as a non-dict (e.g., a string or null), `isinstance(root, dict)` is False, `is_fallback` is False, and the corrupted spec is persisted to cache and served to all future callers. The DB CHECK on `validation_status` does not protect against a structurally wrong `spec_json` — it only verifies the status string.

The root cause is that `GeneratorResult` (from the LLM adapter) does not carry a first-class `is_fallback: bool` flag; the use case infers fallback by reverse-engineering the payload.

**Fix:** Add an explicit `is_fallback: bool` flag to `GeneratorResult` in `genui_generator_adapter.py`, set it to `True` only when the generator itself uses `SAFE_FALLBACK_SPEC`, and pass it through:
```python
# In genui_generator_adapter.py
@dataclass(frozen=True)
class GeneratorResult:
    spec: dict[str, Any]
    attempts: int
    escalated: bool
    is_fallback: bool = False   # <-- explicit flag

# In generate_ui_spec.py
outcome = _determine_outcome(gen_result.spec, escalated=gen_result.escalated, is_fallback=gen_result.is_fallback)

def _determine_outcome(spec, *, escalated, is_fallback):
    if is_fallback:
        return "fallback"
    if escalated:
        return "escalated"
    return "ok"
```
This removes the content-sniffing heuristic entirely.

---

### CR-03: `canonicalize_intent` Uses `str.lower()` Instead of `str.casefold()` — Breaks Cache Keys for Non-ASCII Intents

**File:** `apps/email-listener/app/application/use_cases/cache_key.py:67`

**Issue:**
```python
stripped = normalized.strip().lower()
```
`str.lower()` is not locale-invariant for non-ASCII characters. `str.casefold()` is the Python-recommended method for case-insensitive comparison/normalization (PEP 3131, Python docs). Concrete example: German "ß" does not round-trip through `lower()` — `"ß".lower() == "ß"` but `"SS".lower() == "ss"` while `"ß".casefold() == "ss"`, so "SS invoice" and "ß invoice" produce different `canonicalize_intent` results with `lower()` but the same with `casefold()`. Turkish dotted-I is another classic case.

The consequence is that two users who type the same intent in different Unicode case forms get different cache keys, causing redundant Bedrock calls for what should be a cache hit (CACHE-02 broken for multilingual tenants). This is a correctness defect in the core key derivation function.

**Fix:**
```python
def canonicalize_intent(intent: str) -> str:
    normalized = unicodedata.normalize("NFC", intent)
    stripped = normalized.strip().casefold()   # casefold, not lower
    return re.sub(r"\s+", " ", stripped)
```
Note: changing this will invalidate all existing cache keys in the DB (keys are SHA-256 of the old lowercase form). A migration that deletes or re-keys all existing `ui_spec_templates` rows is required when this fix is deployed.

---

## Warnings

### WR-01: `increment_use_count` Docstring References Non-Existent RPC Function

**File:** `apps/email-listener/app/infrastructure/supabase/supabase_ui_spec_template_repository.py:134-136`

**Issue:** The docstring says: _"Uses a Supabase RPC call to atomically increment use_count … The RPC function 'increment_ui_spec_template_use_count' must exist in the Supabase project (see 14-01 migration)."_ No such function exists in migration 0022 or any other migration. The actual implementation calls `.update({"updated_at": now_iso})` — no RPC, no use_count. This is dead/misleading documentation that will confuse maintainers debugging unexpected zero use_counts. (This overlaps with CR-01 but warrants a separate warning since the docstring alone is a maintenance hazard.)

**Fix:** After CR-01 is resolved (adding the real RPC function), update the docstring to accurately describe the implementation. Until then, remove the RPC reference and update the docstring to state what actually happens.

---

### WR-02: `find_by_cache_key` Unsafely Assumes `spec_json` from DB Is Already a `dict`

**File:** `apps/email-listener/app/infrastructure/supabase/supabase_ui_spec_template_repository.py:93`

**Issue:**
```python
return CachedTemplate(
    id=str(row["id"]),
    spec_json=dict(row["spec_json"]),   # <-- assumes row["spec_json"] is dict-like
)
```
`dict(x)` only works if `x` is a mapping (dict). `spec_json` is a JSONB column — supabase-py's PostgREST client returns JSONB columns as Python `dict` in practice, but this is not guaranteed by the library contract. If the PostgREST response for any reason returns the JSONB as a JSON string (which can happen with some client versions or Supabase proxy configurations), `dict("...")` raises `ValueError: dictionary update sequence element #0 has length 1; 2 is required`, which is caught by the outer `except Exception` block and treated as a miss — silently serving stale content rather than surfacing the data corruption.

**Fix:**
```python
raw_spec = row["spec_json"]
if not isinstance(raw_spec, dict):
    import json as _json
    raw_spec = _json.loads(raw_spec)
spec_json: dict[str, Any] = raw_spec
return CachedTemplate(id=str(row["id"]), spec_json=spec_json)
```
Or at minimum add an `isinstance` assertion so the error is visible:
```python
spec_json = row["spec_json"]
assert isinstance(spec_json, dict), f"spec_json is not a dict: {type(spec_json)}"
return CachedTemplate(id=str(row["id"]), spec_json=spec_json)
```
The assert form will be caught as an `AssertionError` by the outer `except`, still degrading to a miss but making the root cause obvious in the log.

---

### WR-03: `data_shape_hash` Recomputed on Persist Path — Redundant SHA-256 Call

**File:** `apps/email-listener/app/application/use_cases/generate_ui_spec.py:188`

**Issue:**
```python
template = TemplateToPersist(
    cache_key=cache_key,                                      # already computed at line 126
    intent_text=canonicalize_intent(intent),                  # already computed inside compute_cache_key
    data_shape_hash=compute_data_shape_hash(raw_content),    # RECOMPUTED HERE — raw_content may be large
    ...
)
```
`compute_cache_key` internally calls `compute_data_shape_hash(raw_content)` at line 139, but the result is not retained. On the persist path (every cache miss that produces a valid spec), `compute_data_shape_hash` is called a second time, repeating JSON parsing and SHA-256 hashing of `raw_content`. Similarly, `canonicalize_intent(intent)` is called again redundantly (it was already done inside `compute_cache_key`).

This is not a correctness defect (both calls produce identical results), but for large `raw_content` (e.g. multi-page document text), the redundant parse+hash is avoidable overhead. More importantly it is a quality concern: the implementation makes it appear that `data_shape_hash` on the `TemplateToPersist` could be different from the one embedded in the `cache_key`, which would be a correctness bug if a developer modifies one path but not the other.

**Fix:** Refactor `compute_cache_key` to return (or make separately available) the intermediate `data_shape_hash` and `canonical_intent`, or cache them as local variables before `compute_cache_key`:
```python
canonical = canonicalize_intent(intent)
shape_hash = compute_data_shape_hash(raw_content)
cache_key = compute_cache_key(
    intent=intent,
    raw_content=raw_content,
    registry_version=registry_version,
    importer_id=importer_id,
    catalog_id=catalog_id,
)
# ...later on persist path...
template = TemplateToPersist(
    cache_key=cache_key,
    intent_text=canonical,        # reuse
    data_shape_hash=shape_hash,   # reuse
    ...
)
```

---

### WR-04: `persist` Includes Both `spec_node_count=None` and `spec_depth=None` — Metadata Is Never Populated

**File:** `apps/email-listener/app/application/use_cases/generate_ui_spec.py:184-194`

**Issue:** `TemplateToPersist` has `spec_node_count: int | None = None` and `spec_depth: int | None = None` fields. The construct at lines 185-194 omits both, so they default to `None`. The schema/column comments reference "the generator's `_count_nodes` walker" as the source of these values, but the use case never calls any node-counting function. Both metadata columns will be `NULL` for every row indefinitely, making them worthless for the observability and v1.2 promotion use cases they are documented to support.

This is not a correctness defect (nulls are allowed), but it renders two purpose-built columns permanently empty, which constitutes incomplete implementation of D-10.

**Fix:** After generation, compute metadata using the generator's `_count_nodes` utility (if exposed) or implement a simple recursive walker in the use case:
```python
spec_node_count, spec_depth = _count_spec_nodes(gen_result.spec)
template = TemplateToPersist(
    ...,
    spec_node_count=spec_node_count,
    spec_depth=spec_depth,
)
```

---

## Info

### IN-01: `_determine_outcome` Fallback-Title Check Has a Subtle Substring Match Risk

**File:** `apps/email-listener/app/application/use_cases/generate_ui_spec.py:241-246`

**Issue:** `root["title"].startswith(_FALLBACK_TITLE_FRAGMENT)` where `_FALLBACK_TITLE_FRAGMENT = "Unable to generate"` matches any title beginning with that phrase, not just the exact fallback title. This is a less severe form of the false-positive concern in CR-02. A real spec with title "Unable to generate invoice — contact support" (a plausible business error widget) would be misidentified as fallback. Superseded by CR-02's fix; flagged here for completeness.

**Fix:** Addressed by CR-02 (using an explicit `is_fallback` flag). Until then, consider using an exact equality check: `root.get("title") == "Unable to generate a UI specification."` rather than `startswith`.

---

### IN-02: `increment_use_count` Test Only Checks That `.update` Is Called, Not What It Updates

**File:** `apps/email-listener/tests/test_supabase_ui_spec_template_repository.py:242-250`

**Issue:** `test_increment_use_count_calls_update` asserts `table_mock.update.called` but does not inspect what payload was passed to `.update(...)`. This allowed CR-01 (wrong column updated) to pass the test suite undetected. The test provides false confidence about the correctness of the counter increment.

**Fix:**
```python
def test_increment_use_count_calls_update() -> None:
    client = _make_client()
    table_mock = client.table.return_value
    repo = SupabaseUiSpecTemplateRepository(client=client)

    asyncio.run(repo.increment_use_count(_SAMPLE_TEMPLATE_ID))

    table_mock.update.assert_called_once()
    call_args = table_mock.update.call_args
    payload = call_args[0][0] if call_args[0] else call_args.kwargs.get("json", {})
    assert "use_count" in payload, "update must include use_count increment"
```
Note: when CR-01 switches to RPC, the test must be updated accordingly to assert the RPC call rather than `.update`.

---

_Reviewed: 2026-06-27_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
