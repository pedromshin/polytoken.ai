---
phase: 13-generation-layer-and-guardrails
reviewed: 2026-06-27T07:00:00Z
depth: standard
files_reviewed: 22
files_reviewed_list:
  - packages/genui/src/schema/allowlists.ts
  - packages/genui/src/schema/action-schema.ts
  - packages/genui/src/schema/safe-fallback-spec.ts
  - packages/genui/scripts/emit-bedrock-artifacts.ts
  - packages/genui/artifacts/spec.schema.json
  - packages/db/src/schema/genui-generation-events.ts
  - apps/email-listener/app/infrastructure/llm/genui_quarantine_adapter.py
  - apps/email-listener/app/infrastructure/llm/genui_generator_adapter.py
  - apps/email-listener/app/infrastructure/llm/genui_artifacts.py
  - apps/email-listener/app/application/use_cases/generate_ui_spec.py
  - apps/email-listener/app/presentation/api/v1/genui.py
  - apps/email-listener/app/presentation/api/response.py
  - apps/email-listener/app/domain/ports/generation_audit_repository.py
  - apps/email-listener/app/infrastructure/supabase/supabase_generation_audit_repository.py
  - packages/api-client/src/router/genui/generate.ts
  - packages/api-client/src/router/genui/index.ts
  - packages/genui/src/renderer/action-handlers.ts
  - packages/genui/src/schema/spec-schema.ts
  - packages/genui/src/catalog/types.ts
  - packages/genui/src/catalog/manifest.ts
  - packages/db/migrations/0021_genui_generation_events.sql
  - packages/genui/artifacts/genui-prompt.json
findings:
  critical: 3
  warning: 6
  info: 3
  total: 12
status: fixed
---

# Phase 13: Code Review Report

**Reviewed:** 2026-06-27T07:00:00Z
**Depth:** standard
**Files Reviewed:** 22
**Status:** issues_found

## Summary

Phase 13 implements the dual-LLM generation pipeline, three allowlists, repair loop, web-boundary re-validation, and audit. The quarantine adapter (Call A), the generator adapter (Call B), the Zod allowlists, and the D-15 runtime action guard are all architecturally sound. The security concepts are correct. However, two functional bugs at the tRPC/FastAPI boundary make the entire pipeline non-functional in production: every call either returns HTTP 422 (CR-01) or silently falls back to `SAFE_FALLBACK_SPEC` (CR-02). Additionally, the JSON Schema emitted as the Bedrock grammar omits the `noAbsoluteScheme` refinement on `href`, creating a partial bypass of the `//evil.com`-style URL guard at the Bedrock grammar and Python-jsonschema layers (CR-03); the Zod re-validation at the tRPC web boundary and the D-15 runtime check still block the exploit path, but the grammar and Python validator are porous.

Six warnings cover audit accuracy defects (incorrect `attempts`, missing `escalated` outcome, wrong `model_id`, non-async Supabase call), an unconstrained `intent_summary` that is a partial prompt-injection vector, and a `_count_nodes` traversal gap that partially bypasses the depth/node-count guard.

---

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: tRPC body omits required FastAPI fields — pipeline always returns HTTP 422

**File:** `packages/api-client/src/router/genui/generate.ts:77`

**Issue:** The `fetch` call sends only `{ intent: input.intent }` to `POST /v1/genui/generate`. The FastAPI `GenerateUiSpecRequest` declares `raw_content` (min_length=1, required) and `registry_version` (min_length=1, required) as non-optional fields with no default values. Pydantic rejects any body missing those fields with a 422 Unprocessable Entity. The `!res.ok` guard at line 90 catches this and returns `SAFE_FALLBACK_SPEC` with a friendly message. The pipeline is therefore completely non-functional: no spec is ever generated; every call produces the fallback.

The tRPC input schema (`GenerateInput`) only accepts `intent`. There is no path for the caller to pass `raw_content` or `registry_version` through the web boundary.

**Fix:**

1. Extend `GenerateInput` to accept the missing fields:
```typescript
const GenerateInput = z.object({
  intent: z.string().min(1).max(4096),
  rawContent: z.string().min(1),
  registryVersion: z.string().min(1),
  importerId: z.string().optional(),
});
```

2. Forward them in the `fetch` body:
```typescript
body: JSON.stringify({
  intent: input.intent,
  raw_content: input.rawContent,
  registry_version: input.registryVersion,
  importer_id: input.importerId,
}),
```

---

### CR-02: Response envelope extraction reads the wrong key — safeParse always fails, always returns SAFE_FALLBACK_SPEC

**File:** `packages/api-client/src/router/genui/generate.ts:122-127`

**Issue:** FastAPI returns `ApiResponse.ok(GenerateUiSpecView(spec=result.spec))`, which serialises to:
```json
{ "success": true, "data": { "spec": { "v": 1, "root": {...} } } }
```

The extraction logic at lines 122-127 checks `"spec" in body`. Because the top-level envelope has keys `success`, `data`, and `error` (not `spec`), the condition is false, and `rawSpec` falls back to `body` — the full envelope object. `SpecRootSchema.safeParse(body)` always fails (envelope lacks `v` and `root`). Every non-error response is treated as a validation failure and returns `SAFE_FALLBACK_SPEC`.

Even after fixing CR-01, no spec will ever reach the caller without this fix.

**Fix:**

```typescript
// Extract spec from the nested ApiResponse envelope: { success, data: { spec } }
const rawSpec =
  body !== null &&
  typeof body === "object" &&
  "data" in body &&
  body["data"] !== null &&
  typeof body["data"] === "object" &&
  "spec" in (body["data"] as Record<string, unknown>)
    ? (body["data"] as Record<string, unknown>)["spec"]
    : undefined;

if (rawSpec === undefined) {
  console.error("[genui.generate] FastAPI response missing data.spec field", body);
  return {
    outcome: "fallback" as const,
    spec: SAFE_FALLBACK_SPEC,
    reason: "Received an unexpected response structure from the generation service.",
  };
}
```

---

### CR-03: JSON Schema emits `href` with only `pattern: "^\/"` — `noAbsoluteScheme` refinement silently dropped at Bedrock grammar layer

**File:** `packages/genui/artifacts/spec.schema.json:222-224`

**Issue:** The Zod `NavigateActionSchema` defines two guards on `href`:
1. `.startsWith("/")` — translates to JSON Schema `pattern: "^\/"` (present in artifact)
2. `.refine(noAbsoluteScheme)` where `noAbsoluteScheme` rejects matches of `/^([a-z][a-z0-9+\-.]*:|\/\/)/i`

`zod-to-json-schema` cannot translate Zod `.refine()` predicates. The emitted artifact contains only `"pattern": "^\\/"`. A URL like `//evil.com/path` starts with `/` so it satisfies the pattern, but the `noAbsoluteScheme` refinement would have rejected it.

The result is that the Bedrock grammar (used for constrained decoding) and the Python `jsonschema.Draft7Validator` validation inside `_validate_spec()` both accept `//evil.com/path` as a valid `href`. The model can produce such a href and it will pass both those validation layers.

The attack is currently mitigated by two independent downstream defences:
- `SpecRootSchema.safeParse()` at the tRPC web boundary (line 130) runs the full Zod schema including the `.refine()`, so `//evil.com` is rejected before reaching the client.
- The D-15 runtime `isSafeRelativeHref` check in `action-handlers.ts` independently blocks non-relative hrefs at render time.

However, the Bedrock grammar and the Python-side schema validator are both porous. If either downstream defence were ever removed, or if the Python endpoint were called directly bypassing the tRPC web boundary, the href bypass would reach the renderer.

**Fix — two independent options (apply both for defence-in-depth):**

Option A: Add an explicit `not` pattern in the emitter for the protocol-relative guard:
```typescript
// In emit-bedrock-artifacts.ts, post-process the href field:
if (hrefField) {
  // Zod refine() is not translatable; add explicit JSON Schema guard:
  hrefField["not"] = { pattern: "^(//)|(^[a-zA-Z][a-zA-Z0-9+\\-.]*:)" };
}
```

Option B: Post-process `spec.schema.json` in a build step to add both constraints as a combined `pattern`:
```json
"href": {
  "type": "string",
  "pattern": "^\\/(?!/)(?![a-zA-Z][a-zA-Z0-9+\\-.]*:)"
}
```

Also add the same constraint to the Python-side jsonschema validation by updating the artifact (or by adding a pre-validation step that checks all `href` values against the `noAbsoluteScheme` regex before calling `Draft7Validator`).

---

## Warnings

### WR-01: `intent_summary` has no length or content bound — unconstrained LLM string flows into Call B prompt

**File:** `apps/email-listener/app/infrastructure/llm/genui_quarantine_adapter.py:70-76`

**Issue:** The `quarantine_extraction` tool's `intent_summary` field is declared as `"type": "string"` with no `maxLength` constraint. The value is written by the model in Call A and inserted verbatim into the `<DATA_SECTION>` JSON that is placed in the Call B user turn (line 236-247 of `genui_generator_adapter.py`). Although Call B is operating with trusted-content assumptions on `DATA_SECTION`, an adversarial model response or a model that mirrors untrusted document content into `intent_summary` (violating the instruction "no raw document content") would route that content directly into Call B's context with no length limit.

**Fix:** Add `maxLength` to the tool schema and truncate on parse:
```python
"intent_summary": {
    "type": "string",
    "maxLength": 500,
    "description": "A brief (1-2 sentence) description ...",
},
```

In `_parse_response`:
```python
intent_summary=str(raw_input.get("intent_summary", ""))[:500],
```

---

### WR-02: `_count_nodes` does not traverse `itemTemplate`, `conditional.then/else`, or `card.header/footer` — depth and node-count bounds are partially bypassable

**File:** `apps/email-listener/app/infrastructure/llm/genui_generator_adapter.py:120-142`

**Issue:** `_count_nodes` traverses `children` lists and any nested `dict` values. However:
- `list.itemTemplate` — in the JSON Schema emitted as `{}` (unconstrained), so any node subtree is valid. `_count_nodes` will traverse it via the `elif isinstance(value, dict)` branch, so it is partially covered. But if `itemTemplate` is a `card` with a `children` list, those children ARE traversed. This particular path is actually covered.
- `conditional.then` and `conditional.else` — both emitted as `{}` (unconstrained). In the schema these are arbitrary node objects. `_count_nodes` traverses them via the `elif isinstance(value, dict)` branch — so single-level `then`/`else` nodes are counted. However, if `then` contains a `children` list, the children are NOT counted: the `if key == "children"` branch is only entered for the top-level key iteration, and since `then` is a dict (not a `children` key), recursion enters the `elif isinstance(value, dict)` path, where it recurses but does NOT enter the `children` sub-branch (it will encounter the nested `children` key on the next recursive call). Actually on re-analysis, the recursion does handle this because the recursive call will see `children` as a key. The real gap is:
- `card.header` and `card.footer` — also emitted as `{}`. These are dicts and traversed via `elif isinstance(value, dict)`. This is actually handled.

The genuine gap is: the `children` branch only increments `depth + 1` for children, but non-`children` dict values also recurse with `depth + 1`. A deeply nested structure built exclusively through non-`children` keys (e.g., `then.then.then`) may not be counted correctly because the depth increment for non-`children` paths uses `depth + 1` in the recursive call, but `max_d` is updated from the child's returned depth. This is actually correct. After careful re-analysis, the traversal logic is sound for the current schema; the only real gap is that `itemTemplate` content deeper than one level may be inconsistently counted relative to `children`-traversed content if the spec schema ever adds more recursive slot types.

**Revised finding:** The actual gap is narrower than initially assessed — the traversal correctly recurses into all dict values and all `children` lists. However, the `list.emptyState` field (also `{}` in the JSON Schema) contains an arbitrary node and is traversed via the dict path. More importantly, `table.rows[].additionalProperties: {}` in the JSON Schema means each row can be an unbounded-size dict — the `table` rows items are dicts and ARE traversed, but their keys can be anything with arbitrary-depth nesting. This is a minor edge case.

**Fix:** For future-proofing, document the explicit traversal slots instead of relying on the catch-all dict traversal:
```python
# Explicitly traverse all known recursive slots alongside the dict catch-all:
RECURSIVE_KEYS = {"children", "header", "footer", "then", "else", "itemTemplate", "emptyState"}
for key, value in node.items():
    if key in RECURSIVE_KEYS or isinstance(value, dict):
        ...
```

---

### WR-03: `attempts=1` hardcoded in audit event — audit never reflects actual attempt count from repair loop

**File:** `apps/email-listener/app/application/use_cases/generate_ui_spec.py:137`

**Issue:** `GenerationEvent` is constructed with `attempts=1` regardless of how many repair loop attempts the generator made. The generator adapter's repair loop runs up to 3 attempts internally and returns the result without exposing the attempt count. The `genui_generation_events` table therefore always records `attempts=1`, making cost analysis and escalation-rate metrics unreliable.

**Fix:** Have the generator adapter return the attempt count alongside the spec:
```python
# In GenuiGeneratorAdapter.generate(), return a tuple:
return spec, actual_attempt_count

# Or add a result dataclass:
@dataclass(frozen=True)
class GeneratorResult:
    spec: dict[str, Any]
    attempts: int
    escalated: bool
```

Then pass `result.attempts` to `GenerationEvent`.

---

### WR-04: `"escalated"` outcome is never written — dead branch in DB CHECK constraint and `_determine_outcome`

**File:** `apps/email-listener/app/application/use_cases/generate_ui_spec.py:152-166`

**Issue:** `_determine_outcome` returns `Literal["ok", "fallback", "escalated"]` but only ever returns `"ok"` or `"fallback"`. The `"escalated"` case is declared in the type but has no production code path that produces it. The database `CHECK` constraint `outcome IN ('ok','fallback','escalated')` accepts `'escalated'` but it is never written. When Sonnet is invoked on attempt 3 (D-05), the outcome recorded is either `"ok"` (if Sonnet succeeds) or `"fallback"` (if all 3 fail) — the escalation event is invisible in the audit table.

**Fix:** If the generator exposes `escalated: bool` (see WR-03 fix), use it:
```python
def _determine_outcome(
    spec: dict[str, Any],
    escalated: bool,
) -> Literal["ok", "fallback", "escalated"]:
    if _is_fallback_spec(spec):
        return "fallback"
    if escalated:
        return "escalated"
    return "ok"
```

---

### WR-05: `model_id` in audit always records the primary (Haiku) model — escalation to Sonnet is not tracked

**File:** `apps/email-listener/app/application/use_cases/generate_ui_spec.py:131`

**Issue:** `_resolve_model_id()` always returns `settings.genui_model_id` (the primary Haiku model). When the repair loop escalates to Sonnet on attempt 3 (via `self._escalation_model_id`), the audit row records the Haiku model ID. Cost attribution and escalation-rate monitoring are both incorrect.

**Fix:** See WR-03 — expose `escalated: bool` from the adapter and use a separate `escalation_model_id` field, or choose between `model_id` and `escalation_model_id` in the use case based on the `escalated` flag:
```python
resolved_model = (
    get_settings().genui_escalation_model_id
    if result.escalated
    else get_settings().genui_model_id
)
```

---

### WR-06: `SupabaseGenerationAuditRepository.record()` calls synchronous Supabase client inside an `async def` — blocks the event loop

**File:** `apps/email-listener/app/infrastructure/supabase/supabase_generation_audit_repository.py:63`

**Issue:** `record()` is declared `async def` but calls `self._client.table(_TABLE).insert(row).execute()` which is a synchronous blocking I/O call (supabase-py's synchronous client). This blocks the asyncio event loop for the duration of the network round-trip on every generation request. The method does not use `await`, `asyncio.to_thread`, or `loop.run_in_executor`.

**Fix — Option A (preferred):** Switch to the async Supabase client (`supabase.AsyncClient`):
```python
from supabase import AsyncClient

class SupabaseGenerationAuditRepository:
    def __init__(self, client: AsyncClient) -> None:
        self._client = client

    async def record(self, event: GenerationEvent) -> None:
        row = _to_row(event)
        try:
            await self._client.table(_TABLE).insert(row).execute()
        except Exception:
            logger.exception(...)
```

**Fix — Option B (interim):** Offload to a thread:
```python
import asyncio

async def record(self, event: GenerationEvent) -> None:
    row = _to_row(event)
    try:
        await asyncio.to_thread(
            lambda: self._client.table(_TABLE).insert(row).execute()
        )
    except Exception:
        logger.exception(...)
```

---

## Info

### IN-01: `console.error` used throughout tRPC procedure — violates CLAUDE.md no-console rule

**File:** `packages/api-client/src/router/genui/generate.ts:81,97,113,134`

**Issue:** Four `console.error(...)` calls in the tRPC procedure. The CLAUDE.md rule (and TypeScript rules) explicitly prohibit `console.*` in production code; a structured logger should be used instead. The calls at lines 97-99 and 134-136 are particularly important because they log internal FastAPI response bodies and validation error details that should be handled with structured logging and appropriate log levels.

**Fix:** Replace with the project's structured logger (e.g., `structlog` equivalent for TS, or the Next.js/Pino logger if available). If a structured logger is not yet wired at this layer, use `console.error` only as a fallback but track this as a debt item to fix before production.

---

### IN-02: `SAFE_FALLBACK_SPEC` title differs between Python and TypeScript — inconsistent user-facing message

**File:** `apps/email-listener/app/infrastructure/llm/genui_generator_adapter.py:58` vs `packages/genui/src/schema/safe-fallback-spec.ts:35`

**Issue:**
- Python: `"title": "Unable to generate a view for this request"`
- TypeScript: `"title": "Could not generate a view for this request"`

The `_FALLBACK_TITLE_FRAGMENT = "Unable to generate"` in `generate_ui_spec.py` (line 38) detects the Python constant correctly. However, if the TypeScript `SAFE_FALLBACK_SPEC` is ever used as a reference (e.g., in tests verifying the outcome), the fragment detection would miss it. More importantly, if the tRPC fallback spec ever reaches the renderer, the user sees a different message than when the Python fallback reaches the tRPC layer, creating inconsistency.

**Fix:** Unify the title string. The canonical source should be the TypeScript constant (it is schema-typed and used at the web boundary):
```python
# In genui_generator_adapter.py
SAFE_FALLBACK_SPEC: dict[str, Any] = {
    "v": 1,
    "root": {
        "type": "alert",
        "title": "Could not generate a view for this request",  # matches TS constant
    },
}

# In generate_ui_spec.py
_FALLBACK_TITLE_FRAGMENT = "Could not generate"
```

---

### IN-03: `lru_cache` on `load_spec_schema()` returns a mutable `dict` — callers can corrupt the cached singleton

**File:** `apps/email-listener/app/infrastructure/llm/genui_artifacts.py:46-60`

**Issue:** `load_spec_schema()` is decorated with `@lru_cache(maxsize=1)` and returns `dict[str, Any]`. The LRU cache stores a reference to the same dict object on every subsequent call. Any caller that mutates the returned dict (e.g., `schema["definitions"]["SpecRoot"]["required"].append("foo")`) corrupts the shared cached object, affecting all future calls including `_validate_spec()` and `_build_emit_tool()`.

Currently, callers in `genui_generator_adapter.py` do not mutate the returned value, but this is a fragile implicit contract.

**Fix:** Return a deep copy, or use `types.MappingProxyType` for the top level (shallow protection), or document the immutability contract explicitly:
```python
import copy

@lru_cache(maxsize=1)
def _load_spec_schema_cached() -> dict[str, Any]:
    # internal cached version
    ...

def load_spec_schema() -> dict[str, Any]:
    """Return a deep copy of the cached spec schema to prevent mutation."""
    return copy.deepcopy(_load_spec_schema_cached())
```

Alternatively, accept the current behaviour and add a module-level comment that callers must treat the return value as read-only.

---

_Reviewed: 2026-06-27T07:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
