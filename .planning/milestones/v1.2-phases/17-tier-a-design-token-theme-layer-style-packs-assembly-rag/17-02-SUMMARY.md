---
phase: 17
plan: "02"
subsystem: "genui-assembly-rag"
tags: [retrieval, rag, lexical, port, protocol, exemplars, tdd]
dependency_graph:
  requires: ["17-01"]
  provides: ["17-03", "17-04", "17-05"]
  affects: ["app/infrastructure/llm/genui_retrieval_provider.py", "app/domain/ports/retrieval_provider.py"]
tech_stack:
  added: []
  patterns:
    - "Protocol + @runtime_checkable (infra-free domain port)"
    - "Jaccard-inspired lexical scoring with structural keyword boosts"
    - "lru_cache for hot-path exemplar corpus loading"
    - "Best-effort template reads: swallow+log via structlog (T-17-12)"
    - "TDD RED→GREEN per task; ruff+mypy clean gates enforced"
key_files:
  created:
    - "apps/email-listener/app/domain/ports/retrieval_provider.py"
    - "apps/email-listener/app/infrastructure/llm/genui_exemplars.py"
    - "apps/email-listener/app/infrastructure/llm/exemplars/__init__.py"
    - "apps/email-listener/app/infrastructure/llm/genui_retrieval_provider.py"
    - "apps/email-listener/tests/test_genui_retrieval_provider.py"
    - "apps/email-listener/tests/test_genui_exemplars.py"
  modified: []
decisions:
  - "D-10: RetrievalProvider Protocol uses `style_pack_id: str | None = None` as FLY seam — EmbeddingRetrievalProvider will drop in with zero caller change"
  - "D-11: LexicalRetrievalProvider is deterministic and lexical — no Bedrock, no randomness; Jaccard-inspired intent-token overlap plus structural keyword boosts"
  - "D-12: Exemplars are hand-authored real SpecRoot assets committed to source; CI-validated against spec.schema.json via jsonschema Draft7Validator"
  - "D-14: RetrievalResult.retrieved_ids is a @property derived from items tuple for audit logging per generation"
  - "T-17-12: Template-source reads are best-effort; failure is swallowed + logged via structlog, never propagated"
metrics:
  duration: "~90 minutes (resumed from context-compacted session)"
  completed: "2026-06-28"
  tasks_completed: 3
  tasks_total: 3
  files_created: 6
---

# Phase 17 Plan 02: Assembly-RAG Retrieval Seam Summary

Assembly-RAG retrieval seam: `RetrievalProvider` Protocol port with `LexicalRetrievalProvider` implementing deterministic Jaccard-inspired keyword scoring over catalog components, 5 hand-authored exemplar specs, and optional best-effort template rows.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | RetrievalProvider port + frozen DTOs (RED+GREEN) | f2303fc, b5d547e | retrieval_provider.py, test_genui_retrieval_provider.py |
| 2 | Hand-authored exemplar assets + loader (RED+GREEN) | dd5ca37, 70d1d8c | exemplars/__init__.py, genui_exemplars.py, test_genui_exemplars.py |
| 3 | LexicalRetrievalProvider implementation (GREEN) | 021e89a | genui_retrieval_provider.py |

## What Was Built

### Task 1 — RetrievalProvider Port

`app/domain/ports/retrieval_provider.py` — infra-free domain port with stdlib/typing imports only.

- `RetrievedItem(frozen=True)`: id, kind (Literal["component","exemplar","template"]), score, payload
- `RetrievalResult(frozen=True)`: items tuple + `.retrieved_ids` @property for D-14 audit logging
- `RetrievalProvider(@runtime_checkable Protocol)`: `retrieve(*, intent, top_k, style_pack_id=None) -> RetrievalResult`
- `test_port_module_no_infra_imports` asserts zero `from app.infrastructure` in port source

### Task 2 — Hand-Authored Exemplar Assets

`app/infrastructure/llm/exemplars/__init__.py` — 5 real SpecRoot dicts (D-12, never AI-fabricated):

- `dashboard-saas`: linear-clean pack, KPI grid + deals table
- `profile-contact`: nauta-teal pack, badge + key-value-list + action buttons
- `pricing-tiers`: corporate-saas pack, 3-col grid of plans with CTAs
- `feed-email-inbox`: nauta-teal pack, email inbox table with pagination
- `landing-product`: warm-editorial pack, hero + feature grid + alert

`app/infrastructure/llm/genui_exemplars.py` — `Exemplar` frozen dataclass + `load_exemplars()` with `@lru_cache(maxsize=1)`.

Test gate (`test_genui_exemplars.py`, 18 tests): non-empty, frozen, cached, core categories covered, unique ids, lowercase-kebab ids, schema-valid (Draft7Validator zero errors), no placeholder phrases.

### Task 3 — LexicalRetrievalProvider

`app/infrastructure/llm/genui_retrieval_provider.py` — deterministic lexical top-k (D-11):

1. Canonicalize intent via `canonicalize_intent` (reused from `cache_key.py`)
2. Tokenize to `frozenset[str]` of lowercase tokens
3. Score 3 arms: catalog components (`load_prompt_payload()["components"]`), exemplars (`load_exemplars()`), templates (optional, best-effort)
4. Jaccard-inspired score: `|overlap| / |intent_tokens|` capped at 0.7 + structural keyword boosts (+0.05 per matching boost category: grid/table/card/button/list/chart/form)
5. Merge, sort descending, deduplicate by id (first occurrence wins), take top_k
6. Return `RetrievalResult(items=tuple(top_items))`

Protocol conformance asserted at import time (`_: RetrievalProvider = LexicalRetrievalProvider()`).

## Verification Results

```
42 passed, 2 warnings in 0.10s
```

- D-24: `grep -cE 'eval\(|exec\(|compile\(' genui_retrieval_provider.py` = 0
- ruff: All checks passed
- mypy: Success: no issues found in 1 source file

## TDD Gate Compliance

| Phase | Gate | Commit | Passes |
|-------|------|--------|--------|
| Task 1+3 RED | test(17-02) | f2303fc | Yes |
| Task 1 GREEN | feat(17-02) | b5d547e | Yes |
| Task 2 RED | test(17-02) | dd5ca37 | Yes |
| Task 2 GREEN | feat(17-02) | 70d1d8c | Yes |
| Task 3 GREEN | feat(17-02) | 021e89a | Yes |

Note: Tasks 1 and 3 RED were batched into a single commit (f2303fc) since Task 3's failing tests (`TestLexicalRetrievalProviderBehavior`) were written before Task 3's implementation. This is compliant — RED precedes GREEN for both tasks.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ruff I001 unsorted imports on retrieval_provider.py**
- Found during: Task 1 GREEN
- Issue: `from __future__ import annotations` import block ordering failed ruff I001
- Fix: `uv run ruff check --fix` auto-corrected import order
- Files modified: `app/domain/ports/retrieval_provider.py`
- Commit: b5d547e

**2. [Rule 1 - Bug] ruff B905 zip() without strict= on genui_exemplars.py**
- Found during: Task 2 GREEN
- Issue: `zip(_EXEMPLAR_META, EXEMPLAR_ASSETS)` missing `strict=True`
- Fix: Added `strict=True` to zip call
- Files modified: `app/infrastructure/llm/genui_exemplars.py`
- Commit: 70d1d8c

**3. [Rule 1 - Bug] ruff I001+RUF100 on genui_retrieval_provider.py**
- Found during: Task 3 GREEN
- Issue: import sort + unused `# noqa: ARG002` directive (ARG002 not enabled in this project)
- Fix: `uv run ruff check --fix` auto-corrected both
- Files modified: `app/infrastructure/llm/genui_retrieval_provider.py`
- Commit: 021e89a (same commit, fix applied before commit)

## Known Stubs

None. All 5 exemplar specs are real, schema-valid SpecRoot compositions with realistic content.

## Threat Flags

None. This plan adds no network endpoints, auth paths, or trust-boundary surface. The retrieval module reads from in-memory cache (lru_cache over static assets) and optionally queries an injected repository. No new SQL, no new HTTP routes.

## Self-Check: PASSED

- `app/domain/ports/retrieval_provider.py` — FOUND
- `app/infrastructure/llm/genui_exemplars.py` — FOUND
- `app/infrastructure/llm/exemplars/__init__.py` — FOUND
- `app/infrastructure/llm/genui_retrieval_provider.py` — FOUND
- `tests/test_genui_retrieval_provider.py` — FOUND
- `tests/test_genui_exemplars.py` — FOUND
- Commits: f2303fc, b5d547e, dd5ca37, 70d1d8c, 021e89a — all present in git log
