# Track 3a Scout — Inbound-Email Ingest Pipeline + Durability Gap

Scope: map the inbound-email ingest pipeline and its durability gap so a downstream designer can build the graphile-worker "enqueue-then-200" seam (master plan §65) from this doc alone. Every claim carries a `file:line` cite. Analysis only — no code changed.

All paths are absolute under `/home/user/polytoken.ai/apps/email-listener/`.

---

## 0. Executive findings (sharpest first)

1. **The silent-loss handler is `sns_inbound.py:57-64`.** A bare `except Exception` wraps the *entire* S3→MIME→OCR→multi-Bedrock pipeline; any failure is logged (`email_ingest_error`) and the handler **returns HTTP 200 anyway**. SNS therefore never retries, there is no queue/DLQ/outbox, and the email is **permanently lost**. This is the single most damaging, least-visible failure in the system (master plan `00-MASTER-PLAN.md:22`).

2. **The whole heavy pipeline runs inline in the HTTP handler, on one event loop, one uvicorn worker, one ECS task.** `Dockerfile:52` runs `uvicorn` with **no `--workers`**; `variables.tf:36-40` sets `prod_desired_count = 1`. `IngestInboundEmailUseCase.execute` (`ingest_inbound_email.py:168-322`) does S3 fetch + MIME parse + per-page Textract OCR + one Bedrock segment call *per page* + one Bedrock classify call + entity resolution — all before the 200 is returned.

3. **Two ingest steps block the event loop with synchronous I/O/CPU that is NOT thread-offloaded:** the S3 fetch (`raw_email_store.py:27`, sync `boto3.get_object`) and `parse_mime(raw)` (`ingest_inbound_email.py:171`, sync CPU). Additionally **every `.execute()` in the ingest-path Supabase repos is a synchronous blocking HTTP call made directly on the loop** inside `async def` methods — this is the "93 unwrapped ingest-path `.execute()` calls" the master plan (`00-MASTER-PLAN.md:65`) says must be wrapped in `to_thread`. The newer chat/genui/cost repos already do this (WR-06); the ingest repos predate the pattern.

4. **The enqueue seam is trivially small.** The durable payload is just `{ses_message_id, recipients}` — NOT the raw bytes. SES already durably wrote the MIME to S3; the key is derivable (`raw_email_store.py:21-23`). Those two fields are exactly the args `execute(ses_message_id, recipients)` takes, and `ReprocessEmailUseCase`/`BackfillInboundEmailUseCase` already prove that re-calling `execute(ses_id)` resumes the pipeline cleanly. The worker handler is *the existing `execute()` call behind a queue.*

5. **`backfill_reprocess.py` is hard-capped at 25 emails/request (`backfill_reprocess.py:33`) purely to stay under the ALB idle timeout** — it runs 25 full pipelines inline, serially, inside one HTTP request (`backfill_reprocess.py:68-88`). Once 3a lands this becomes "enqueue N jobs and return an ack" and the cap dissolves.

6. **Wiring gotcha for the designer:** `ReceiveInboundEmailUseCase` is **NOT on the live path.** It is a no-op logger (`receive_inbound_email.py:15-32`) wired to the legacy `POST /v1/emails/inbound` webhook (`inbound_email.py:64`). The live SNS handler calls `IngestInboundEmailUseCase` **directly** (`sns_inbound.py:58-61`). Build the seam on `sns_inbound.py` + `IngestInboundEmailUseCase`, not on `ReceiveInboundEmailUseCase`.

7. **Durability boundary (master plan §65/§173):** event-source the **long money-burning loops — ingestion + `deep_research`** — into the worker. **Keep the sub-5-min interactive chat turn (`run_chat_turn.py`) in-process**; durability's serialization cost would hurt it. `deep_research` already emits `ChatRunEvent`s, the intended event source.

---

## 1. The bare-except-returns-200 handler (`presentation/api/v1/sns_inbound.py`)

Full handler is `sns_inbound.py:23-67`. The module docstring already states the design intent — *"Always returns HTTP 200 to prevent SNS retry storms on malformed payloads"* (`sns_inbound.py:4`).

### 1a. The critical try/except and the 200 return (verbatim, `sns_inbound.py:40-64`)

```python
if msg_type == "Notification":
    try:
        meta = parse_ses_notification(str(payload["Message"]))
    except Exception:
        logger.exception("sns_parse_error", payload_keys=list(payload.keys()))
        return Response(status_code=status.HTTP_200_OK)          # loss point #1: unparseable SES envelope

    logger.info("email_received", message_id=meta["message_id"], ...)

    # Resolve + ingest inside the guard: any failure (DI misconfiguration,
    # S3 fetch, DB write) must still return 200 to stop SNS retry storms.
    try:
        use_case: IngestInboundEmailUseCase = await request.app.state.dishka_container.get(
            IngestInboundEmailUseCase
        )
        await use_case.execute(meta["message_id"], recipients=meta["recipients"])
    except Exception:
        logger.exception("email_ingest_error", message_id=meta["message_id"])   # loss point #2: ANY pipeline failure
    return Response(status_code=status.HTTP_200_OK)               # <-- 200 regardless of success/failure
```

**Why this loses mail:** the `except Exception` at `sns_inbound.py:62` swallows *every* failure of the entire pipeline (S3 fetch, MIME parse, OCR, Bedrock, DB writes), logs `email_ingest_error`, and falls through to `return Response(status_code=status.HTTP_200_OK)` at `sns_inbound.py:64`. A 200 tells SNS "delivered" — so SNS **does not redeliver**, and because there is no queue, DLQ, retry marker, or outbox anywhere, the email is gone permanently. There is not even a persisted "received-but-failed" row: `IngestInboundEmailUseCase` only writes the `emails` row *after* the S3 fetch + MIME parse succeed (`ingest_inbound_email.py:221`), so a failure in steps 1-2 leaves **zero trace** beyond a log line.

### 1b. Other 200-on-failure exits in the same handler

- `sns_inbound.py:29-31` — bad JSON body → 200.
- `sns_inbound.py:43-45` — `parse_ses_notification` raises → 200 (loss point #1: valid SNS wrapper, malformed SES `Message`).
- `sns_inbound.py:66-67` — unknown `Type` → 200.
- `sns_inbound.py:35-38` — `SubscriptionConfirmation` → `await confirm_subscription(subscribe_url)`. (Note: this is the SSRF sink flagged as Security S1 in `00-MASTER-PLAN.md:74`; out of scope for 3a but co-located in this handler.)

### 1c. What the handler calls (immediate collaborators)

| Call | Site | Target |
|------|------|--------|
| `parse_ses_notification(...)` | `sns_inbound.py:42` | `infrastructure/sns/ses_parser.py` → returns `meta` dict `{message_id, sender, recipients, subject}` |
| `confirm_subscription(url)` | `sns_inbound.py:37` | `infrastructure/sns/confirmation.py` (SubscriptionConfirmation branch only) |
| `dishka_container.get(IngestInboundEmailUseCase)` | `sns_inbound.py:58-60` | DI resolve of the pipeline use case |
| `await use_case.execute(meta["message_id"], recipients=meta["recipients"])` | `sns_inbound.py:61` | **the whole ingest pipeline — §2** |

---

## 2. The full ingest pipeline: `IngestInboundEmailUseCase.execute` (`application/use_cases/ingest_inbound_email.py:168-322`)

Every `await`/call the SNS-driven pipeline makes, in order. **L** = long/money-burning, **B** = blocks the event loop (sync I/O or CPU not offloaded), **A** = already truly async (fine).

| # | Line | Call | Kind | Notes |
|---|------|------|------|-------|
| 1 | `171:170` `raw = await self._raw_store.fetch(ses_message_id)` | S3 GetObject | **B** | `S3RawEmailStore.fetch` (`s3/raw_email_store.py:25-29`) is `async def` but calls **synchronous** `self._client.get_object(...).read()` with **no thread offload** — network I/O blocks the loop. |
| 2 | `171` `parsed = parse_mime(raw)` | MIME decode | **B** | `parse_mime` is a plain sync function (`domain/services/mime_parser.py:185`), called **without `await`/`to_thread`** — CPU (base64 attachment decode, header parse) blocks the loop. |
| 3 | `177` `await self._resolve_forwarding_user(recipients)` | forwarding token → user | B | `_resolve_forwarding_user` (`:371-387`) → `forwarding_resolver.resolve_recipients` → Supabase sync `.execute()`. Best-effort (degrades to `None`). |
| 4 | `182` `await self._importer_resolver.resolve(...)` | importer resolution | B | Supabase sync `.execute()`. |
| 5 | `184` `await self._email_repo.find_by_message_id(...)` | idempotency lookup | B | Supabase sync `.execute()` (`email_repository.py`). |
| 6 | `193` `await self._resolve_thread(...)` | thread resolution | B | `_resolve_thread` (`:389-421`) → `thread_resolver.resolve` → Supabase sync `.execute()`(s). Best-effort (degrades to `None`). |
| 7 | `221` `saved = await self._email_repo.save(email)` | **first durable write** | B | Upsert on `(importer_id, message_id)` (`email_repository.py:84`). Nothing is persisted before this line — a failure in steps 1-6 leaves no row. |
| 8 | `238-250` per attachment `await self._ingest_attachment(...)` | attachment store+parse | **L/B** | See §2a — contains the OCR. Isolated per-attachment. |
| 9 | `257` `await self._ingest_body(saved, parsed)` | email-body component | B | `_ingest_body` (`:423-472`): `html_to_text` sync CPU (`domain/services/html_to_text.py:52`) + `save_many` Supabase `.execute()` (`:466`). |
| 10 | `265` `await self._propose_regions.execute(...)` | **Bedrock segmentation** | **L/B** | See §2b. One Bedrock call **per page**. |
| 11 | `277` `await self._suggest_entity_types.execute(...)` | **Bedrock classification** | **L/B** | See §2c. One Bedrock call for the email + N×2 Supabase writes. |
| 12 | `293` `await self._resolve_ingest_entities.execute(...)` | entity resolution (flag-gated) | **L/B** | See §2d. Optional (`INGEST_ENTITY_RESOLUTION_ENABLED`, injected `None` when off — `ingestion_providers.py:194`). |
| 13 | `309:361` `await self._finalize_parse_status(...)` → `update_parse_status` | terminal status write | B | Supabase sync `.execute()`. Stamps `parsed`/`degraded`/`failed`. |

All twelve post-persist steps 8-13 are **isolated** — each wrapped in its own try/except that records into a `failures` list (`ingest_inbound_email.py:230-304`) and never re-raises. That isolation is exactly why the SNS handler's own except rarely fires for *these* stages — but it does **nothing** for durability: a swallowed stage failure yields `parse_status='failed'` on a persisted row (recoverable via reprocess) only if steps 1-7 succeeded. A failure in steps 1-7 (before `email_repo.save`) still bubbles to `sns_inbound.py:62` and is lost.

### 2a. `_ingest_attachment` → OCR (the most expensive step) (`ingest_inbound_email.py:474-603`)

Per attachment:
- `:495` `await self._attachment_storage.store(storage_key, parsed.data, parsed.content_type)` — Supabase Storage upload (network I/O). **B**
- `:496` `await self._attachment_repo.save(...)` — Supabase `.execute()`. **B**
- `:515` `await self._parse_and_persist_pages(...)` (`:542-603`):
  - `:565` `parser = self._parser_registry(file_ext)` — sync registry lookup; `None` → `skipped`.
  - `:576` `await parser.parse(file_bytes=..., content_type=..., attachment_id=...)` — **the OCR step.** For PDFs this is `PdfParser.parse` (`infrastructure/pdf/pdf_parser.py:202-272`):
    - `pdf_parser.py:241` pdfminer text extraction — offloaded to a `ThreadPoolExecutor` with a **60s timeout** (`pdf_parser.py:239`). **A (thread-offloaded)** — CPU-heavy but off the loop.
    - `pdf_parser.py:346` per-page rasterization `pdf2image.convert_from_bytes` — offloaded to the executor (`_rasterize_page` `:367-385`, `RASTER_DPI=150`). **A**
    - `pdf_parser.py:352` `await self._ocr.ocr_page(image_bytes=...)` — **AWS Textract** (`TextractOcrAdapter.ocr_page`, `infrastructure/ocr/textract_adapter.py:60-68`): sync `detect_document_text` run via `run_in_executor` (`textract_adapter.py:64`). **A (thread-offloaded)** but **L** — one Textract call **per scanned page**, up to `MAX_PAGES=200` (`pdf_parser.py:44`), each a paid ML API round-trip. This is the dominant cost + latency driver for scanned PDFs.
  - `:588` `await self._components.save_many(stitched)` — Supabase `.execute()`. **B**
- `:527` `await self._attachment_repo.save(replace(...parse_status=outcome))` — Supabase `.execute()`. **B**

### 2b. `ProposeRegionsUseCase.execute` → Bedrock segmenter (`application/use_cases/propose_regions.py:163-232`)

- `:168` `await self._components.find_by_email_id(email_id)` — Supabase `.execute()`. **B**
- Per page (attachment_page + email_body): `:196` `await self._segmenter.segment(tokens=..., page_index=...)` — **`AnthropicSegmenter.segment`** (`infrastructure/llm/segmentation_adapter.py:139-205`): `await self._client.messages.create(...)` on `AsyncAnthropicBedrock` (`segmentation_adapter.py:175`). **A (truly async httpx)** but **L** — **one Bedrock call per page**, up to **3 retries** with **2s/5s/15s backoff** (`segmentation_adapter.py:37-38, 173-194`). On total failure returns `[]` (never raises) and records an adapter degradation.
- `:219` `await self._components.save_many(children)` — Supabase `.execute()`. **B**

### 2c. `SuggestEntityTypesUseCase.execute` → Bedrock classifier (`application/use_cases/suggest_entity_types.py:83-205`)

- `:92` / `:95` `await self._entity_types.list_active(...)` — Supabase `.execute()` (×1-2). **B**
- `:104` `await self._components.find_unclassified_candidate_regions(email_id)` — Supabase `.execute()`. **B**
- `:126` `await self._corrections.find_similar(...)` — Supabase trgm `.execute()` (best-effort few-shot, LEARN-02). **B**
- `:144` `await self._classifier.classify(regions=..., entity_types=..., examples=...)` — **`EntityTypeClassifierAdapter.classify`** (`infrastructure/llm/entity_type_classifier_adapter.py:168`, `await self._client.messages.create` on `AsyncAnthropicBedrock` `:207`). **A** but **L** — **ONE Bedrock call for ALL regions** (RELIABILITY constraint: one call per document).
- Per applied suggestion: `:182` `await update_role(...)` **and** `:183` `await update_entity_type(...)` — **2 Supabase `.execute()` writes per suggestion** (N+1 write amplification). **B**

### 2d. `ResolveIngestEntitiesUseCase.execute` (flag-gated) (`application/use_cases/resolve_ingest_entities.py:126-258`)

- `:141` `await self._components.find_by_email_id(email_id)` — Supabase `.execute()`. **B**
- `:158` `_ensure_sender_node` → `:282` `await self._knowledge.upsert_node(...)` — Supabase `.execute()`. **B**
- `:177` `await self._knowledge.find_active_edges_for_node(...)` — Supabase `.execute()`. **B**
- Per entity component: `:190` `candidates = self._resolution_repo.find_candidates(...)` — **⚠ synchronous, NOT awaited, NOT thread-offloaded.** `EntityResolutionRepository.find_candidates` is a plain `def` (`infrastructure/supabase/entity_resolution_repository.py:122`) issuing 2× `.execute()` (`:255`, `:284`) — a BlendedRAG lexical/vector query that **blocks the loop** once per entity component. **B (worst offender: not even wrapped in an awaitable)**
  - Per candidate: `:210` `await record_candidate_link(...)` + `:231` `await insert_edge(...)` — Supabase `.execute()` each (N×M write amplification). **B**

### 2e. Wall-clock shape of one email

`S3 fetch (net) + MIME parse (cpu) + [per attachment: Storage upload + OCR: Textract × pages] + body + [per page: Bedrock segment, 3 retries w/ ≤15s backoff] + Bedrock classify + resolution (find_candidates × entities + writes)`. A multi-page scanned PDF is **minutes** of Textract + per-page Bedrock, and every second of it holds the single event loop / single worker / single ECS task, all inside the SNS HTTP request before the 200. During that window every other request (chat, other inbound mail) contends for the same loop, and any `.execute()`/`get_object`/`parse_mime` in step 1-7 or 9-13 that isn't thread-offloaded stalls it outright.

---

## 3. Unwrapped ingest-path `.execute()` calls (the `to_thread` targets)

**The mechanism:** `supabase-py`'s `Client` is **synchronous** (`infrastructure/supabase/client.py:20-36`, `create_client`). The ingest-path repos declare methods `async def` but call the blocking query builder `.execute()` **directly on the loop** — e.g. `component_repository.py:75` `result = self._client.table("email_components").upsert(payload, on_conflict="id").execute()` inside `async def save_many` (`component_repository.py:72`). No `await`, no `asyncio.to_thread`. Each such call parks the single event loop for a full Supabase HTTP round-trip.

**Proof the pattern is split:** `grep "asyncio.to_thread"` shows the **newer** chat/genui/cost/audit repos already offload (WR-06) — `supabase_chat_message_repository.py:114`, `supabase_cost_ledger_repository.py:90`, `supabase_generation_audit_repository.py:73`, `supabase_ui_spec_template_repository.py:89`, `autofill_retrieval_event_repository.py:65`, `supabase_chat_run_repository.py:44`, etc. The **ingest-path repos do not** — they are the "93 unwrapped" set (`00-MASTER-PLAN.md:65`).

**Blocking `.execute()` counts by ingest-path repo** (`grep -c "\.execute()"`):

| Repo (`infrastructure/supabase/…`) | `.execute()` | On ingest path via |
|---|---:|---|
| `component_repository.py` | 17 | save_many, find_by_email_id, find_unclassified_candidate_regions, update_role/entity_type… |
| `email_repository.py` | 10 | find_by_message_id, save, update_parse_status |
| `attachment_repository.py` | 3 | save |
| `entity_instance_repository.py` | 22 | record_candidate_link |
| `entity_resolution_repository.py` | 2 | **find_candidates (sync, not awaited — §2d)** |
| `knowledge_graph_repository.py` | 19 | upsert_node, find_active_edges_for_node, insert_edge |
| `entity_type_repository.py` | 12 | list_active |
| `entity_type_correction_repository.py` | 3 | find_similar |
| `extraction_repository.py` | 3 | reprocess supersede support |
| `forwarding_address_repository.py` | 1 | resolve_recipients |
| `importer_repository.py` | 4 | resolve |
| `thread_repository.py` | 6 | resolve |
| **Ingest-path subtotal** | **~102** | (master plan's "93" is its own count of the strictly ingest-reachable subset) |

Totals for calibration: **139** `.execute()` across all `infrastructure/supabase/*.py`; only **9** are already `await`-ed (all in the newer to_thread repos, off the ingest path).

**Classification for the fix (master plan §65 "wrap … in `to_thread`"):**
- **Blocking sync I/O on the loop — must `to_thread` (or move to the worker thread, where blocking is fine):** every ingest-path repo `.execute()` above; `S3RawEmailStore.fetch`'s `get_object` (`raw_email_store.py:27`); `EntityResolutionRepository.find_candidates` (`entity_resolution_repository.py:122` — additionally needs an `await` wrapper since it's sync `def`).
- **Blocking CPU on the loop — should `to_thread`:** `parse_mime` (`ingest_inbound_email.py:171`), `html_to_text` (`ingest_inbound_email.py:437`).
- **Already thread-offloaded — leave as is:** pdfminer/pdf2image/Textract in `PdfParser`/`TextractOcrAdapter` (`ThreadPoolExecutor`/`run_in_executor`).
- **Already truly async — leave as is:** all `AsyncAnthropicBedrock` LLM calls (segmenter `segmentation_adapter.py:175`, classifier `entity_type_classifier_adapter.py:207`).

Note: if 3a moves the pipeline into a graphile-worker **thread/process** rather than the request loop, the blocking `.execute()` calls stop mattering for the *interactive* loop — but the `to_thread` wrapping is still the master-plan-mandated interim/defensive fix so one slow email cannot freeze the loop that also serves the in-process chat turn.

---

## 4. `backfill_reprocess.py` — the 25-batch ALB dodge, and what "enqueue-N-jobs" replaces

Endpoint `POST /v1/emails/backfill-reprocess` (`presentation/api/v1/backfill_reprocess.py:51-92`), owner-scoped (capability auth via forwarding token).

### 4a. Why 25

- **The cap is a hard schema limit:** `email_ids: list[str] = Field(min_length=1, max_length=25)` (`backfill_reprocess.py:33`).
- **The reason is the ALB idle timeout**, stated in the module docstring (`backfill_reprocess.py:10-13`): *"Batched by design: the client passes explicit email_ids so a caller can pace reprocessing (each email re-runs OCR/segmentation/entity resolution) and stay under the ALB idle timeout."* (Cross-ref `00-MASTER-PLAN.md:95`: *"backfill_reprocess.py … runs the full OCR+LLM pipeline inline, batched at 25 to dodge the ALB idle timeout."*)
- **The loop runs full pipelines inline, serially, inside one HTTP request** (`backfill_reprocess.py:68-88`): for each `email_id`, `ack = await reprocess.execute(email_id=email_id)` (`:75`). `ReprocessEmailUseCase.execute` (`reprocess_email.py:79-142`) re-runs the **entire** ingest pipeline — `await self._ingest.execute(ses_id)` at `reprocess_email.py:110` (the same `IngestInboundEmailUseCase.execute` from §2, including OCR + Bedrock) — then supersedes prior pending regions. All 25 must complete before the endpoint returns its `ReprocessAck`, or the ALB severs the idle connection (default 60s). 25 is a hand-tuned ceiling that keeps 25 × (OCR + segment + classify + resolve) under that timeout.

### 4b. What "enqueue-N-jobs" replaces (post-3a)

Instead of running N pipelines inline and holding the HTTP response, the endpoint **enqueues N durable jobs** (one per `email_id`, payload `{email_id}` or `{ses_message_id, recipients}`) to graphile-worker and returns an ack **immediately** — enqueue is O(N) cheap DB inserts, not O(N pipelines). Consequences:
- The `max_length=25` cap (`backfill_reprocess.py:33`) dissolves (or becomes a much larger enqueue cap) — it existed only because the *work* was inline.
- Ownership/authorization checks stay at enqueue time (`backfill_reprocess.py:60-73`: forwarding-token resolve + `importer_id in owned`), so a job is only ever enqueued for the token owner's own corpus.
- Workers drain the queue with **retries + dead-letter** (the durability the inline path lacks), and reprocess's existing idempotency (`reprocess_email.py` cutoff + supersede-only-on-fresh-regions, `:101-135`) makes at-least-once delivery safe.
- Per-item `ReprocessItem` results (`backfill_reprocess.py:36-48`) move from a synchronous response array to job outcomes queryable later (the same read model `pipeline_health` already exposes).

The identical treatment applies to the SNS handler (§5): both are "run the full pipeline inline" call sites that become "enqueue then ack."

---

## 5. Where the durable enqueue seam sits, and the worker resume payload

### 5a. The seam location

`sns_inbound.py:57-64`. Today: resolve `IngestInboundEmailUseCase` from DI and `await use_case.execute(...)` inline. **After 3a:** after `parse_ses_notification` yields `meta` (`sns_inbound.py:42`), **enqueue one durable job and return 200** — do not run the pipeline in the request. The same seam applies to `backfill_reprocess.py:75` and `backfill_email.py:87` (both call the same `execute()` inline).

### 5b. What to enqueue — a pointer, NOT the bytes

Enqueue **`{ses_message_id: meta["message_id"], recipients: meta["recipients"]}`**. Rationale:
- **Do not enqueue the raw MIME.** SES already durably persisted it to S3; the object key is fully derivable from the message id: `S3RawEmailStore.key_for(message_id)` = `f"{self._prefix}{message_id}"` (`raw_email_store.py:21-23`). The worker re-fetches with `raw_store.fetch(ses_message_id)` (`ingest_inbound_email.py:170` → `raw_email_store.py:25-29`). Enqueuing bytes would bloat the queue and duplicate the durable copy.
- `ses_message_id` and `recipients` are **exactly** the two parameters of `IngestInboundEmailUseCase.execute(self, ses_message_id, recipients=())` (`ingest_inbound_email.py:168`). The worker handler is literally `await ingest.execute(job.ses_message_id, recipients=job.recipients)`.

### 5c. What the worker needs to resume the pipeline

The full resume contract is just those two fields, because `execute()` re-derives everything else **deterministically**:
- `ses_message_id` → S3 fetch (`:170`), and → `raw_storage_key` via `raw_store.key_for` (`:215`); MIME parse recovers `message_id`, sender, attachments (`:171`, `:183`).
- `recipients` → forwarding-token → owning `user_id` (`:177`), which anchors importer resolution (`:182`). **This is why `recipients` must be in the payload** — without it, a newly-created importer loses its user attribution (mail from a never-seen sender would misattribute).
- `importer_id`, `thread_id`, attachment ids, page ids are all derived/deterministic inside `execute()` — nothing else needs to travel in the job.

### 5d. Precedent that this resume shape works

- **`ReprocessEmailUseCase`** already resumes the pipeline from a bare SES id: it derives `ses_id = email.raw_storage_key.rsplit("/", 1)[-1]` and calls `await self._ingest.execute(ses_id)` (`reprocess_email.py:108-110`). The key-derivation rationale (single vs double env-prefix) is documented at `reprocess_email.py:22-32` — **the worker must pass the BARE ses id, exactly as here.**
- **`BackfillInboundEmailUseCase`** calls the same `await self._ingest.execute(message_id, recipients=recipients)` (`backfill_inbound_email.py:61`) with a namespaced id — proving `execute()` is a clean resumable entry point independent of the SNS wrapper.
- **Idempotency for at-least-once delivery is already guaranteed:** the email row is keyed on `(importer_id, message_id)` and re-uses the existing id (`ingest_inbound_email.py:184, 200-201`, upsert `email_repository.py:84`); attachment ids are `uuid5` (`ingest_inbound_email.py:106-107`); page ids are deterministic (`attachment_page_component_id`, REG-1). A redelivered/retried job upserts in place instead of duplicating (module docstring `ingest_inbound_email.py:2-6`). So a queue that delivers twice is safe.

### 5e. Optional hardening (design choice for the seam)

Because steps 1-7 of `execute()` write **nothing** until `email_repo.save` (`ingest_inbound_email.py:221`), a "received" marker row written at **enqueue** time would make in-flight/failed ingests visible (feeds the existing `pipeline_health` read model) and give the DLQ something to reconcile against. Not required for the minimal seam, but it closes the "zero trace before save" gap noted in §1a.

---

## 6. Long/money-burning loops vs the in-process interactive turn (master plan §65 / §173)

| Loop | Location | Verdict | Why |
|------|----------|---------|-----|
| **Inbound ingestion** | `ingest_inbound_email.py:168-322` (this doc) | **→ DURABLE (worker)** | Minutes-long; Textract-per-page + Bedrock-per-page + Bedrock-classify; silently lost on failure today (§1). The primary 3a target. |
| **Backfill reprocess** | `backfill_reprocess.py` → `reprocess_email.py` → same `execute()` | **→ DURABLE (worker)** | Same pipeline inline, capped at 25 for the ALB timeout (§4). Becomes enqueue-N-jobs. |
| **`deep_research`** | `application/use_cases/research/deep_research.py` | **→ DURABLE (worker)** | *"the first capability that can burn real money on a single user action"* (`deep_research.py` module docstring); bounded multi-round agentic loop with a `ResearchBudget` token+round ceiling. **Already emits `ChatRunEvent`s** (progress-streaming section of its docstring) — the intended event source to event-source it from (`00-MASTER-PLAN.md:65,173`). |
| **Interactive chat turn** | `application/use_cases/run_chat_turn.py` | **STAY IN-PROCESS** | Sub-5-min, latency-sensitive. Master plan: *"apply durability to deep_research + ingestion, NOT the interactive chat turn … the sub-5-min interactive turn should stay in-process"* (`00-MASTER-PLAN.md:65`) and *"Durability has a serialization cost that would hurt the sub-5-min chat turn"* (`00-MASTER-PLAN.md:173`). Event-source the long loops from the `ChatRunEvent` stream the turn already emits — do **not** wrap the turn itself. |

**Deployment constraint the seam must honor (master plan §65, hard constraint (i)):** the worker must be **co-located** in the existing listener container / scheduled task — a *new* always-on Fargate service doubles the ~$34/mo fixed-compute problem and adds constant Supabase poll load. The convergence the plan calls out (`00-MASTER-PLAN.md:169`): enqueue-then-200 is simultaneously the reliability fix (no more silent loss), the cost lever (removes the always-on inline pipeline), and the durable-ingestion fix — **one change, three wins**, but only if co-located.

---

## Appendix — key file:line index

- Silent-loss handler + 200 returns: `presentation/api/v1/sns_inbound.py:29-31, 43-45, 57-64, 66-67`
- Pipeline entry: `application/use_cases/ingest_inbound_email.py:168` (`execute(ses_message_id, recipients)`)
- First durable write: `ingest_inbound_email.py:221`
- Sync S3 fetch: `infrastructure/s3/raw_email_store.py:25-29`; key derivation `:21-23`
- Sync MIME parse: `ingest_inbound_email.py:171`; `domain/services/mime_parser.py:185`
- Textract OCR (per page): `infrastructure/ocr/textract_adapter.py:60-68`; PDF driver `infrastructure/pdf/pdf_parser.py:202-272, 346, 352`; `MAX_PAGES=200` `:44`
- Bedrock segmenter (per page, 3 retries): `infrastructure/llm/segmentation_adapter.py:139-205`; retries `:37-38`; call `:175`
- Bedrock classifier (per email): `infrastructure/llm/entity_type_classifier_adapter.py:168, 207`
- Sync `find_candidates` (not awaited): `application/use_cases/resolve_ingest_entities.py:190`; repo `infrastructure/supabase/entity_resolution_repository.py:122`
- Blocking repo pattern example: `infrastructure/supabase/component_repository.py:72-76`
- to_thread precedent (off ingest path): `infrastructure/supabase/supabase_chat_message_repository.py:114`
- 25-batch cap + ALB reason: `presentation/api/v1/backfill_reprocess.py:33, 10-13, 68-88`
- Reprocess resume precedent: `application/use_cases/reprocess_email.py:108-110`; key rationale `:22-32`
- Backfill resume precedent: `application/use_cases/backfill_inbound_email.py:61`
- Legacy no-op receive (NOT live path): `application/use_cases/receive_inbound_email.py:15-32`; wired at `presentation/api/v1/inbound_email.py:64`
- Deployment shape: `infrastructure/aws/…/Dockerfile:52` (no `--workers`); `infrastructure/aws/variables.tf:36-40` (`prod_desired_count=1`)
- Master plan anchors: `.planning/assessment/2026-07-24/00-MASTER-PLAN.md:22, 65, 95, 169, 173`
