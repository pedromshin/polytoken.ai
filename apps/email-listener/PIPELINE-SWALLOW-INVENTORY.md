# Swallow-site inventory (ST-04 follow-up TODO)

ST-04 converted the highest-value silent `except Exception` sites in the
email-analysis pipeline into surfaced failures: stage-prefixed, human-readable
entries in `emails.parse_error` (capped at 2000 chars — it renders verbatim in
the web tooltip, never JSON), the `degraded` / `skipped` parse_status values,
and exact counts via `GET /v1/pipeline/health`. The repo still has ~100
`except Exception` sites (`grep -rn "except Exception" app` → 104 at the time
of writing). Deliberately NOT converted in one pass — this file is the working
inventory for future waves.

## Converted in ST-04 (surface, don't just log)

| Site | Now |
|------|-----|
| `app/application/use_cases/ingest_inbound_email.py` attachment loop | per-attachment isolation + `attachment[i]: ...` stage entry persisted |
| `ingest_inbound_email.py` parser-dispatch swallow | `attachment[i]: <filename>: ...` entry + attachment row `pending → failed` |
| `ingest_inbound_email.py` attachment skip paths (no extension / no parser) | attachment row `pending → skipped` (never eternally `pending`); skips do NOT degrade or fail the email |
| `ingest_inbound_email.py` propose_regions swallow | `propose_regions: ...` stage entry persisted |
| `ingest_inbound_email.py` suggest_entity_types swallow | `suggest_entity_types: ...` stage entry persisted |
| `infrastructure/llm/segmentation_adapter.py` retries-exhausted `[]` + malformed-response `[]` | `record_adapter_degradation("segmentation", ...)` → email `degraded`, entry `adapter_degraded[segmentation]: ...` |
| `infrastructure/llm/entity_type_classifier_adapter.py` never-raise `()` | `record_adapter_degradation("classifier", ...)` → `adapter_degraded[classifier]: ...` |
| `infrastructure/llm/embedding_adapter.py` zero-vector fallback | `record_adapter_degradation("embedding", ...)` → `adapter_degraded[embedding]: ...` |
| Email lifecycle finalization (ING-6/ST-04) | `received → parsed \| degraded \| failed`; `parsed_at` stamped on `parsed` and `degraded` |

## High-value sites still swallowing (next waves)

Ingest-adjacent (extend the stage vocabulary in
`app/domain/services/pipeline_health.py` — same failure-surfacing pattern):

- `ingest_inbound_email.py` `_resolve_thread` / `_resolve_forwarding_user`
  degrade to `None` with only a warning. Candidate stages:
  `thread_resolution`, `forwarding_resolution` (deliberately left non-terminal
  in ST-04 — they are best-effort by design contract T-45-03-02/T-45-05-03;
  decide whether they belong in adapter_degraded-style reporting instead).
- `presentation/api/v1/sns_inbound.py:57-64` (2 sites) — swallows ingest
  crashes that happen BEFORE the email row exists (parse_mime/NUL/importer
  failures, ING-1/ING-7); returns 200 so SNS never retries and nothing is
  persisted. Needs a stub email row or a dead-letter record; out of ST-04
  scope because there is no email row to attach status to.
- `application/use_cases/propose_regions.py` per-page swallow (segment()
  raising) — the page skip is isolated but not recorded; could call
  `record_adapter_degradation` (importable from application) so a raising —
  not just never-raise-degrading — segmenter also surfaces.
- `infrastructure/pdf/pdf_parser.py` (2 sites) — parse-error components exist
  but timeout/rasterize failures can wedge silently (PDF-2).
- `application/use_cases/suggest_entity_types.py` (3 sites) — classifier call,
  corrections retrieval, per-suggestion apply; the apply failures especially
  (partial application looks identical to full success).

Knowledge/curation lane (owned by other ST items — listed for completeness):

- `application/use_cases/confirm_region.py` (3) — embedding + synthesis + KG
  writes swallow (KG-9 family).
- `application/use_cases/promote_entity_on_confirm.py`,
  `resolve_entity_candidates.py`, `infrastructure/supabase/knowledge_graph_repository.py`.
- `application/use_cases/run_chat_turn.py` (6), `chat/cluster_context.py` (5),
  `generate_ui_spec.py` (4) — chat lane; failures degrade responses silently.
- `infrastructure/tools/*` executors (web_search, search_knowledge, lookup) —
  tool errors flatten to empty results.

## Rules for converting a site

1. Never let the conversion break the SNS-facing 200 contract or block ingest.
2. Persist machine-decodable evidence — a stage-prefixed `parse_error` entry
   (`failure_entry(...)`) or a degradation event
   (`record_adapter_degradation(...)`). A log line alone is NOT surfacing.
3. Keep `parse_error` HUMAN-READABLE and capped at `_PARSE_ERROR_MAX_LEN`
   (`ingest_inbound_email.py`) — the only machine affordance is the stage
   prefix (`app/domain/services/pipeline_health.py` is the single vocabulary;
   the health endpoint and web panel decode exactly this). No JSON blobs.
4. Add a behavioral test proving the failure is now visible (see the ST-04
   section of `tests/test_ingest_use_case.py` for the pattern).
