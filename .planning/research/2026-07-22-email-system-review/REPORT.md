# Email AI-Analysis System Review — Bug Report

Date: 2026-07-22 · Scope: apps/email-listener (ingest → MIME → PDF → regions → entity types → resolution → knowledge), packages/api-client, apps/web email/entity/knowledge surfaces.
Method: multi-lens review (ingest, mime, regions, types, resolution, reprocess, knowledge, ui) → every finding independently verified by two adversarial skeptics. **CONFIRMED** = both skeptics upheld; **PLAUSIBLE** = split; **UNVERIFIED** = no skeptic pass. Near-identical findings surfaced by multiple lenses are deduplicated (noted per finding, full map in the appendix).

## Executive summary

1. **53 unique findings, all CONFIRMED by both skeptics** (56 raw, 3 duplicates merged): 1 critical, 16 high, 21 medium, 15 low.
2. **Entity curation is functionally broken end-to-end**: reject/confirm-merge writes match zero rows (RES-1, critical), unmerge is a silent no-op (RES-2), mutual merges can make both entities vanish (RES-3), and the backfill endpoint resurrects merged entities and wipes learned aliases (RES-4).
3. **Silent email loss is easy to trigger**: real-world MIME (odd charsets, nested multiparts, NUL-bearing bodies, filename-less or hostile-named attachments) crashes ingest after the SNS handler has already committed to returning 200, leaving no DB trace and no retry (ING-1..ING-5).
4. **Cross-tenant misroute**: two users forwarding mail from the same sender domain collide on one global importer — the second user's mail lands in the first user's inbox (ING-2).
5. **Reprocess is unusable from the UI** (missing X-User-Id header → 401 every time, RPR-1) and dangerous from the API: supersede-before-ingest is non-atomic, duplicates pages/regions on every run, and a Bedrock outage silently destroys all pending regions (REG-1, REG-3, RPR-2, RPR-3).
6. **The parse_status lifecycle is dead code**: no failure anywhere in the pipeline is ever persisted or shown to the user — failed parses are indistinguishable from healthy ones (ING-6).
7. **The learning loops actively degrade**: AI re-overrides explicit human "clear role" decisions (TYP-1), correction few-shots serve deactivated slugs that silently drop suggestions (TYP-2), the alias flywheel writes false aliases onto unconfirmed candidates (RES-5), and zero-vectors from failed embeddings poison BlendedRAG ranking (RES-6).
8. **The knowledge graph never links regions to entities in the normal flow** (synthesis runs before candidate links exist, KG-3), human-promoted edges are silently demoted on re-confirm (KG-2), and knowledge-node embeddings are never written so semantic search is permanently dead while still paying per-query Bedrock costs (KG-8).
9. **The review UI lies in three places**: the deny-field Undo toast performs no server restore (UI-1), edited candidate values are silently discarded on Confirm Field (UI-2), and Unconfirm Field visibly reverts itself (UI-3).
10. Recommended priority: fix RES-1/RES-2/RES-3 + ING-2 (data integrity/tenancy), then RPR-1 + the ingest crash family, then the UI honesty bugs — most fixes are small and localized; fix sketches are per-finding below.

Severity ordering inside each subsystem: critical → high → medium → low.

---

## 1. Ingestion & tenancy (SNS → MIME → DB)

### ING-1 (HIGH, CONFIRMED) — parse_mime raises on real-world MIME; email silently dropped with zero DB trace
- **Where:** `apps/email-listener/app/domain/services/mime_parser.py:70` (also `:75`)
- **What:** `parse_mime` calls `part.get_content()` with no error handling in `_body` and `_attachment_bytes`. Python's content manager raises `LookupError` for charsets not in the codec registry (`binary`, `x-user-defined`, `unicode-1-1-utf-7` — all seen in real mail) and `KeyError('multipart/mixed')` for nested multipart container parts yielded by `iter_attachments()`. The exception fires at `ingest_inbound_email.py:103`, **before** the email row is saved; the SNS handler (`sns_inbound.py:57-64`) swallows it and returns 200, so SNS never retries.
- **Failure scenario:** A sender's client emits `Content-Type: text/plain; charset="binary"` (or nests multipart/mixed). The user forwards the email to polytoken and it never appears anywhere in the product — no emails row, no parse_error, only a log line. There is no record to reprocess (reprocess requires an existing email row).
- **Verification:** CONFIRMED. Both skeptics empirically reproduced all three exceptions using the repo's own code via `uv run python` (`LookupError('unknown encoding: binary')`, `LookupError` for x-user-defined, `KeyError('multipart/mixed')`), and traced that no recovery path exists — the raw MIME survives in S3 but there is no in-product handle to reprocess it.
- **Fix sketch:** Wrap `get_content()`: bodies fall back to `get_payload(decode=True).decode(charset, errors='replace')` with latin-1/utf-8 fallback on LookupError; attachments prefer `get_payload(decode=True)` raw bytes. Persist a stub email row with `parse_status='error'` when parse_mime fails so failures are visible and reprocessable.

### ING-2 (HIGH, CONFIRMED) — Importer resolution keyed on global domain slug ignores user_id: cross-tenant misroute and data exposure
- **Where:** `apps/email-listener/app/infrastructure/supabase/importer_repository.py:81`
- **What:** `resolve` looks up an existing importer by `.eq("slug", slug)` alone and returns it without comparing the `user_id` argument. `importers.slug` is globally NOT NULL UNIQUE and derived purely from the sender's domain (`acme-com`). The `user_id` is honored only on the brand-new-slug branch (lines 96-102). All read paths scope emails via `importers.user_id`.
- **Failure scenario:** User A forwards mail from maria@acme.com → importer `acme-com` anchored to A. User B later forwards mail from jose@acme.com to their own u-token address → resolve returns A's importer. B's email is persisted under A's tenant: **invisible to B, visible to A** — a cross-tenant misroute and exposure of B's private correspondence.
- **Verification:** CONFIRMED. Both skeptics traced the full chain (forwarding token → user_id → ignored on existing-slug branch; ownership scoping in `ownership.ts` and RLS); one noted even the create branch's `on_conflict="slug"` hands a concurrent second user the first creator's row. Contradicts the repo's own TENA-03 cross-tenant invariants; the Phase-45 threat model never considered this collision.
- **Fix sketch:** Key importer identity on `(user_id, slug)`: filter the existence lookup by user_id and make uniqueness/on_conflict target the pair, so each user gets their own importer per upstream domain.

### ING-3 (HIGH, CONFIRMED) — Attachment with no filename violates NOT NULL, aborting the rest of the ingest after the email row is saved
- **Where:** `apps/email-listener/app/application/use_cases/ingest_inbound_email.py:251` (constructor actually starts at :250; fallback computed at :244)
- **What:** `_ingest_attachment` computes `filename = parsed.filename or f"attachment-{index}"` but uses the fallback only for the storage key; the persisted `Attachment` gets the raw `parsed.filename`, which is `None` for filename-less MIME parts (inline CID signature/logo images, bare octet-stream parts — very common). `email_attachments.filename` is `text NOT NULL`; the upsert fails, the unguarded attachment loop aborts, the SNS handler swallows and returns 200. The email row was already saved, so it survives with `parse_status='received'`, zero attachments, no regions. SNS redelivery re-fails deterministically.
- **Failure scenario:** A business email with an inline company-logo image (Content-ID, no filename) plus a real PDF at a later loop index: the email appears in the inbox with no attachments, no page components, no proposed regions — and nothing tells the user anything failed. The PDF is also lost.
- **Verification:** CONFIRMED. Both skeptics verified the schema (`attachments.ts:38`, migration 0000, still NOT NULL in snapshot 0042), the unfiltered `part.get_filename()` passthrough, the unguarded save, and the SNS swallow. The local fallback variable is strong evidence of a wiring mistake (off-by-3 line citation noted, immaterial).
- **Fix sketch:** Pass `filename=filename` (the fallback) into the Attachment; also wrap the per-attachment save in isolate-and-log like the parser dispatch so one bad part can't abort the whole email.

### ING-4 (HIGH, CONFIRMED) — Forward-as-attachment (message/rfc822) stored as a ZERO-byte attachment; forwarded email and inner documents lost
- **Where:** `apps/email-listener/app/domain/services/mime_parser.py:80` (`_attachment_bytes`, :74-81)
- **What:** For a `message/rfc822` part (Gmail/Outlook "Forward as attachment" — a core flow for an email-forwarding product), `get_content()` returns an `EmailMessage` (neither str nor bytes) and `get_payload(decode=True)` returns `None`, so the data becomes `b""`. `iter_attachments()` does not descend into the inner message, so PDFs inside are never seen. No error is raised or logged.
- **Failure scenario:** User forwards an invoice email as attachment. The UI shows `original.eml` whose download is a 0-byte file; the invoice PDF inside is never stored, parsed, or proposed as regions. Fully silent.
- **Verification:** CONFIRMED. Both skeptics empirically reproduced `[('original.eml', 'message/rfc822', 0)]` with `uv run python` and verified ingest uploads the empty payload with `size_bytes=0` and no guard anywhere.
- **Fix sketch:** Special-case EmailMessage content: `bytes(content)` re-serializes the inner message; optionally recurse into rfc822 parts to extract inner attachments as first-class rows (`parent_attachment_id` already exists in the schema).

### ING-5 (HIGH, CONFIRMED) — One failing attachment aborts all remaining attachments and region proposal; sender-controlled filenames make failure easy (Supabase Storage key rejection)
- **Where:** `apps/email-listener/app/application/use_cases/ingest_inbound_email.py:156` (loop at :155-156, storage key at :245)
- **What:** The attachment loop has no per-attachment try/except (contradicting the docstring at :264-266 which claims failures are isolated). `storage_key` embeds the raw sender-supplied filename; Supabase Storage rejects keys with non-ASCII letters (é, ã, 中), `#`, `%`, `[` etc. with 400 "Invalid key", and storage3 raises `StorageApiError`. The exception aborts every later attachment, `propose_regions`, and `suggest_entity_types`; the SNS handler swallows it; the email stays `parse_status='received'` with no parse_error.
- **Failure scenario:** Email with attachments `['relatório #1.pdf', 'contract.pdf']` (that MIME order): the first upload raises, contract.pdf never gets a row or bytes, zero regions exist for the whole email, no failure recorded. Any transient storage/DB error on one attachment has the same blast radius.
- **Verification:** CONFIRMED. Both skeptics verified the RFC2231 filename decoding to raw Unicode, the storage3 raise-on-non-2xx (`.venv storage3/_sync/file_api.py:80-89`), the unguarded loop, and that deterministic attachment ids make re-ingest fail identically.
- **Fix sketch:** (a) per-attachment try/except with logging; (b) sanitize the filename segment of storage_key (or key on attachment_id only, keep display filename in the DB row); (c) record a parse_error on the email when any attachment fails.

### ING-6 (MEDIUM, CONFIRMED) — parse_status lifecycle is dead; every post-persist failure is invisible to the user
- **Where:** `apps/email-listener/app/application/use_cases/ingest_inbound_email.py:148` (email `received`), `:260` (attachment `pending`)
- **What:** Nothing ever transitions parse_status after ingest. `EmailRepository.update_parse_status` exists but has **zero production callers**; there is no attachment status writer at all. Every post-persist stage (attachment parse, propose_regions, suggest_entity_types, thread/forwarding resolution) is try/except-log-only with no durable marker. The web UI renders the frozen value, has a dedicated 'failed' tone branch and a Reprocess-CTA design note — both unreachable because 'failed' is never written.
- **Failure scenario:** The PDF parser raises on a corrupt PDF → logged as `attachment_parse_failed` and swallowed. On /emails/[id] the user sees 'received' + 'pending', pixel-identical to a healthy email. Same invisibility for propose_regions or suggest_entity_types crashes.
- **Verification:** CONFIRMED. Both skeptics grepped: update_parse_status only appears in a test fake; Reprocess re-runs ingest which resets status to 'received', so it never signals either. Vocabulary mismatch between doc-comments ('succeeded'/'failed') and UI checks ('parsed'/'failed') is itself evidence the lifecycle was never wired.
- **Fix sketch:** Drive the lifecycle: set 'parsed'/'succeeded' + parsed_at on success; in each swallow branch persist `update_parse_status('failed', repr(exc))` on the email and/or attachment so the UI's existing 'failed' tone + Reprocess affordance can fire.

### ING-7 (MEDIUM, CONFIRMED) — emails upsert does not strip NUL characters; NUL-bearing bodies kill the whole ingest after parse
- **Where:** `apps/email-listener/app/infrastructure/supabase/email_repository.py:82` (`_to_row` at :23-44)
- **What:** `sanitize.strip_nul` exists precisely because Postgres rejects U+0000 (22P05) and every sibling repo applies it — but the email repo does not, so body_text/body_html/subject/sender_name go to PostgREST raw. A UTF-16LE body mislabeled `charset=iso-8859-1` decodes to text full of `\x00` (valid latin-1). The upsert fails, ingest aborts before attachments, SNS gets 200 — the email is silently lost with no DB trace.
- **Failure scenario:** A Windows client/gateway sends a UTF-16 body labeled iso-8859-1 (or any body/subject with a stray NUL). The email never appears in the product; reprocess cannot recover it (no emails row exists to key off).
- **Verification:** CONFIRMED. Both skeptics empirically reproduced `\x00`-riddled body_text via parse_mime, verified strip_nul usage in five sibling repos but not this one, and confirmed the unguarded save at ingest line 153.
- **Fix sketch:** Apply `strip_nul` in `SupabaseEmailRepository._to_row` exactly like the component repo; consider thread/attachment repos too (filenames are sender-controlled).

---

## 2. PDF parsing & OCR

### PDF-1 (MEDIUM, CONFIRMED) — PDFs sent as application/octet-stream are never parsed: registry dispatches by extension, PdfParser rejects by content-type
- **Where:** `apps/email-listener/app/infrastructure/pdf/pdf_parser.py:212` (allowed set at :59)
- **What:** Dispatch keys on the `.pdf` extension, but `PdfParser.parse` immediately raises `UnsupportedFileTypeError` unless content_type ∈ {application/pdf, application/x-pdf}. Many real senders (scanners, ERPs, scripts) attach PDFs as `application/octet-stream`. The exception is swallowed and logged; the attachment stores fine but produces zero page components, zero regions, zero suggestions, and stays `parse_status='pending'` forever.
- **Failure scenario:** A supplier's ERP emails `invoice_0231.pdf` as octet-stream. It downloads fine; the canvas shows no pages/regions; autofill has nothing to work with; no visible error.
- **Verification:** CONFIRMED. Both skeptics traced content_type flowing verbatim from `part.get_content_type()` with no sniffing anywhere, the extension-only registry, and the swallow at ingest :307-313. The check also contradicts the module's own "parse() never raises" docstring.
- **Fix sketch:** Accept octet-stream/unknown types and validate by sniffing `%PDF-` magic bytes; degrade to a parse-error Component (existing mechanism) instead of raising.

### PDF-2 (MEDIUM, CONFIRMED) — pdfminer timeout leaves the single-worker executor permanently occupied; all future PDF parsing wedges until restart
- **Where:** `apps/email-listener/app/infrastructure/pdf/pdf_parser.py:249` (executor at :194, wait_for at :237-249, rasterize at :344-349)
- **What:** `asyncio.wait_for(60s)` cannot cancel a running executor thread. After timeout, pdfminer keeps occupying the sole worker of the `ThreadPoolExecutor(max_workers=1)`. The fallback then (a) runs `_count_pages_pypdf` synchronously on the event loop (blocking the whole FastAPI process) and (b) queues per-page rasterization on the SAME wedged executor with no timeout — so the fallback never completes if pdfminer never finishes (the docstring itself cites Adobe-Identity-UCS hangs). PdfParser is a module-level singleton: every future PDF in every future email queues behind the hung thread.
- **Failure scenario:** One pathological PDF arrives Monday; every email with a PDF afterwards silently produces no components; SNS requests pile up. Recovery requires restarting the listener.
- **Verification:** CONFIRMED. Both skeptics verified the shared singleton executor, the uncancellable thread, the synchronous pypdf call on the loop, the untimed rasterize awaits queueing behind the hung thread, and that neither ingest nor the SNS handler has a hang guard (exception handling only).
- **Fix sketch:** Run pdfminer in a disposable short-lived executor/process; wrap each rasterize/OCR executor call in wait_for; never run pypdf directly on the event loop.

### PDF-3 (LOW, CONFIRMED) — Whitespace-only PDF text layer defeats the OCR fallback; scanned page yields an empty component
- **Where:** `apps/email-listener/app/infrastructure/pdf/text_layer.py:44` (:44-46)
- **What:** `detect_text_layer` counts `\t \n \r` and space as printable, so a page whose text layer is 20+ whitespace chars passes MIN_CHARS_PER_PAGE and is treated as usable. The stored component gets `content_text=''`; propose_regions skips empty pages; OCR — built for exactly this case — never runs. Some scanner pipelines emit exactly this shape (newline-only text objects over a page image).
- **Failure scenario:** A scanned invoice with whitespace-only text layers produces empty page components, no OCR, no regions — the document looks blank to the whole analysis pipeline with no error anywhere.
- **Verification:** CONFIRMED. Both skeptics empirically ran `detect_text_layer('\n'*25) → True` and traced the bypassed OCR branch plus the silent empty-page skips downstream (propose_regions :126, classify :68, suggest :105). No path retries OCR for empty pages.
- **Fix sketch:** Count only non-whitespace printable chars toward the threshold (or check `len(page_text.strip()) >= threshold`).

---

## 3. Region proposal, segmentation & region state

### REG-1 (HIGH, CONFIRMED) — Re-ingest never dedupes attachment_page components: every reprocess/SNS-redelivery multiplies pages and stacks duplicate region proposals
- **Where:** `apps/email-listener/app/infrastructure/pdf/pdf_parser.py:403` (and :436, :159); loop at `ingest_inbound_email.py:155-156, 320-321`
- *Deduplicated: reported independently by the mime, regions, and reprocess lenses (3 findings merged).*
- **What:** Ingest is idempotent for the email row (upsert on importer_id+message_id) and attachments (uuid5 ids) — but PdfParser mints a fresh `uuid.uuid4()` per page Component on every parse, so `save_many` (upsert on_conflict='id') always inserts new rows. `supersede_pending_regions` touches only `source_type='region'` + status='pending' rows, deliberately leaving pages. `propose_regions` then segments **all** attachment_page rows for the email. So the k-th reprocess leaves (k+1) copies of every page and (k+1) fresh pending-region sets — every proposal box duplicated on the canvas after the FIRST reprocess. Plain SNS redelivery (at-least-once) does the same **with no supersede at all**, so pending boxes stack (old set + doubled new set) with zero user action — despite the module docstring's idempotency claim. Each page copy also re-bills Textract and multiplies segmenter + suggest_entity_types LLM calls.
- **Failure scenario:** 5-page PDF, 20 proposed regions. One reprocess: 10 page rows, 40 pending regions, every box drawn twice. Reprocess again: 15 pages, 60 regions. An SNS redelivery triples pending boxes without anyone touching anything.
- **Verification:** CONFIRMED (all six skeptic votes across the three lens variants upheld). No unique constraint on (attachment_id, page_index); no code anywhere deletes/supersedes attachment_page rows; the web overlay hides only rejected/superseded so duplicated pending proposals render stacked. Minor nuance: classify_document dedupes pages by page_index downstream, a band-aid that does not stop duplicate regions or costs.
- **Fix sketch:** Deterministic page ids (uuid5 of attachment_id+page_index, mirroring `_attachment_id`) so upsert genuinely replaces in place; and/or supersede prior attachment_page rows before persisting a new parse; have propose_regions segment only the freshly persisted page set.

### REG-2 (HIGH, CONFIRMED) — Region page_index comes from the LLM, which is never told the page index: multi-page documents render regions on the wrong page
- **Where:** `apps/email-listener/app/application/use_cases/propose_regions.py:226`; adapter `app/infrastructure/llm/segmentation_adapter.py:56, 164-166`
- **What:** The segmenter's user turn contains only the numbered token list; neither it nor the system prompt carries the actual page index (the page_index arg is used only for logging). Yet the tool schema marks `page_index` REQUIRED per region, so the model must invent one — with one page of context it emits 0. `_build_children` persists the model's value verbatim even though the true index is available on the parent page component right there. The overlay filters regions by `location.page_index === currentPage - 1`.
- **Failure scenario:** 3-page PDF with entities on every page: all regions persist with page_index 0. Page 1 shows a pile of misplaced boxes (page-2/3 geometry over page-1); pages 2-3 show no proposals at all.
- **Verification:** CONFIRMED. Both skeptics verified the prompt contains no page info, the schema forces fabrication (making the absent-key fallback dead), and no downstream code corrects the value. Unit tests fake the segmenter with correct indices, masking the gap.
- **Fix sketch:** In `_build_children`, write the parent page's real index into the child location; drop page_index from the tool schema (or keep it only as a logged sanity check).

### REG-3 (HIGH, CONFIRMED) — Reprocess during a Bedrock outage silently destroys all pending regions; segmenter's never-raise [] degradation is undetectable
- **Where:** `apps/email-listener/app/application/use_cases/reprocess_email.py:76`; adapter `segmentation_adapter.py:168-196`
- **What:** Reprocess supersedes every pending region BEFORE re-ingest. The replacement proposals depend on `AnthropicSegmenter`, whose contract is "never raises — returns [] on total failure" (3 retries → []). ProposeRegions cannot distinguish this from a genuinely empty page; nothing marks anything analysis-failed; the endpoint returns 200 with the superseded count. Two more silent-zero paths: tool_choice='auto' lets a prose-only reply yield [] with only a DEBUG log; one malformed region drops the ENTIRE page's region list with no retry.
- **Failure scenario:** 40 pending regions; Bedrock creds expire; user clicks Reprocess → 200 `{superseded_components: 40}`, zero replacements, empty overlay, no error — indistinguishable from "this document has nothing in it".
- **Verification:** CONFIRMED. Both skeptics verified the order of operations, the no-transaction supersede, all three silent-zero paths, that superseded is terminal in the UI (hidden by default, no restore path), and that no 'analysis_failed' concept exists anywhere. Only quibble: proposals are regenerable by reprocessing again after Bedrock recovers, so "destroys" slightly overstates permanence — but the silent loss + success response is real.
- **Fix sketch:** Let the segmenter surface failure distinctly from "no regions" (raise or return an error-flagged result); supersede only after the new propose pass succeeds (or restore on error); persist an analysis-failed status pages/UI can show.

### REG-4 (HIGH, CONFIRMED) — propose_regions loads pages via find_by_email_id, silently capped at 1000 rows: pages stop being segmented once components accumulate
- **Where:** `apps/email-listener/app/application/use_cases/propose_regions.py:114`; `component_repository.py:83-85`; `supabase/config.toml:18`
- *Deduplicated: reported independently by the regions and reprocess lenses (2 findings merged; higher severity retained).*
- **What:** `find_by_email_id` is an unpaginated, unordered PostgREST SELECT subject to `max_rows = 1000`. The codebase explicitly documents this trap (the `find_unclassified_candidate_regions` port docstring warns of the cap; `find_pages_by_attachment` exists specifically to dodge it) — yet the region-proposal path still uses the capped query and filters attachment_page client-side. Superseded rows are never deleted, so repeated reprocessing (accelerated by REG-1) pushes an email past 1000 rows; the truncated window can then omit attachment_page rows and those pages are silently never segmented. Logs report success with an understated page_count.
- **Failure scenario:** An email with ~3,000 accumulated components: reprocess supersedes everything (good), then find_by_email_id returns an arbitrary 1000-row window possibly containing zero pages → zero proposals, success ack, permanently empty overlays. Repeated reprocessing can never recover because superseded rows keep crowding the window.
- **Verification:** CONFIRMED (4/4 skeptic votes). Verified: no .limit/.range/.order; no delete path for email_components anywhere; failure swallowed by ingest's try/except. Nuance: whether *zero* pages land in the window depends on unspecified heap order — the failure is probabilistic per email, but silent truncation past a hard cap is the defect.
- **Fix sketch:** Server-side filtered query (eq source_type='attachment_page', paginated) or reuse `find_pages_by_attachment` per attachment; best: have ingest pass the just-persisted page ids directly to propose_regions.

### REG-5 (MEDIUM, CONFIRMED) — ConfirmRegionUseCase has no status guard: confirming resurrects superseded/rejected regions, defeating the WR-02 state machine
- **Where:** `apps/email-listener/app/application/use_cases/confirm_region.py:148`
- **What:** Accept and Reject enforce WR-02 status guards precisely because "superseded components are effectively gone and should not be silently re-marked" — Confirm has no such check and never checks source_type either; `update_status` is a blind UPDATE. Redraw/split/merge create live replacements before superseding originals, so a stale-tab confirm resurrects the original alongside its replacement: two live regions for the same content, both rendered, double embedding/entity-promotion.
- **Failure scenario:** Tab A redraws region R (replacement R' candidate, R superseded). Tab B, still showing R, clicks Confirm → R becomes 'confirmed' while its lineage still points at R'. Overlay shows both stacked; PromoteEntityOnConfirm and the D-15 embedding run on stale geometry.
- **Verification:** CONFIRMED. Both skeptics verified the missing guard at every layer (use case, blind repo UPDATE, pass-through route, no DB trigger/CHECK), the reachable stale-tab scenario, and that the frontend's button-disable relies on fresh client state.
- **Fix sketch:** Mirror the WR-02 guard (reject confirm unless status ∈ {pending, candidate, confirmed} and source_type='region'); better, compare-and-swap (`UPDATE ... WHERE extraction_status IN (...)`) to close the race window.

### REG-6 (LOW, CONFIRMED) — Segmentation truncation warning logs the post-truncation length as original_len
- **Where:** `apps/email-listener/app/infrastructure/llm/segmentation_adapter.py:151` (reassignment at :148)
- **What:** `numbered` is reassigned to the truncated string BEFORE the warning, so `original_len` reports ~32k regardless of true size and `truncated_len` logs the constant cap. The T-04-17 diagnostic for "why did this huge page get few regions" always claims almost nothing was cut.
- **Failure scenario:** A 90,000-char page loses its bottom two-thirds; the operator reads original_len=31,9xx/truncated_len=32000, concludes truncation was negligible, and mis-attributes the missing regions to the model.
- **Verification:** CONFIRMED. Both skeptics verified by direct read; the true pre-truncation length is captured nowhere; log-only defect.
- **Fix sketch:** Capture `original_len` before the reassignment; log the actual kept length as truncated_len.

---

## 4. Reprocess flow

### RPR-1 (HIGH, CONFIRMED) — Reprocess is broken end-to-end from the UI: tRPC proxy never sends X-User-Id, FastAPI requires it → 401 every time
- **Where:** `packages/api-client/src/router/emails/mutations.ts:458` (headers at :454-463); endpoint `apps/email-listener/app/presentation/api/v1/emails.py:216-234`
- **What:** The reprocessEmail mutation sends only X-API-Key and Content-Type; the Phase-44-hardened emails router requires `X-User-Id` via `require_user_id` (401 when absent). Grep confirms nothing in packages/api-client sends X-User-Id (only /api/chat/* Next routes do). FastAPI tests send the header; the tRPC test mocks fetch — neither catches the break. The UI swallows it as a generic "Couldn't reprocess this email. Try again." toast.
- **Failure scenario:** Every click of Reprocess Email fails with the generic toast, forever. No supersede and no re-ingest ever happen via the product.
- **Verification:** CONFIRMED. Both skeptics traced the full path (headers → dependency → 401 → toast), verified no middleware/rewrite injects the header, and noted server tests even assert the 401-without-header behavior.
- **Fix sketch:** Add `"X-User-Id": ctx.user.id` to the fetch headers (pattern from `apps/web/src/app/api/chat/stream/route.ts:95`); add a test asserting the header.

### RPR-2 (MEDIUM, CONFIRMED) — Supersede-then-ingest is non-atomic: any ingest failure (raw S3 object gone, NULL raw_storage_key, env-prefix mismatch) leaves the email stripped of all auto-proposed regions
- **Where:** `apps/email-listener/app/application/use_cases/reprocess_email.py:76` (deref at :87, ingest at :90)
- **What:** Supersede commits (separate PostgREST call, no transaction) before anything fallible runs: `email.raw_storage_key` is nullable and dereferenced with a `# type: ignore` (AttributeError on NULL); `raw_store.fetch` raises NoSuchKey if the SES object was lifecycle-deleted or the row was ingested under a different ENVIRONMENT prefix. The endpoint has no try/except → unhandled 500, supersede already durable, no compensation. The UI hides superseded regions; the only regeneration path is another reprocess, which fails identically.
- **Failure scenario:** Email ingested 100 days ago, bucket has a 90-day lifecycle: reprocess flips 45 pending regions to superseded, then NoSuchKey → 500 → generic toast. All un-reviewed detection boxes vanish permanently.
- **Verification:** CONFIRMED. Both skeptics verified the commit ordering, nullable column, bare boto3 get_object, absent exception handling and absent restore path anywhere.
- **Fix sketch:** Validate raw_storage_key (409/422 with a clear message) and fetch the raw object BEFORE superseding — or supersede only after ingest succeeds.

### RPR-3 (MEDIUM, CONFIRMED) — Reprocessing a curated email re-proposes everything: confirmed regions get duplicate pending twins; rejected regions come back
- **Where:** `apps/email-listener/app/application/use_cases/reprocess_email.py:90`; propose at `propose_regions.py:114-160, 208-237`
- **What:** Supersede deliberately preserves human-touched regions (candidate/confirmed/rejected), but re-ingest's propose step knows nothing about them: the segmenter sees only tokens+page_index, and `_build_children` persists every proposal as a new pending region with no overlap/dedup check. Confirmed regions each get a near-identical pending twin stacked on top (both render); regions the user explicitly rejected are re-proposed as pending — rejections never stick across reprocess. Confirming a twin runs promote-entity again → a second entity for the same content.
- **Failure scenario:** User confirms 8 regions, rejects 5, reprocesses after a segmenter improvement: 8 stacked twins + 5 resurrected rejects = 13 boxes to re-reject; a mis-click on a twin creates a duplicate entity.
- **Verification:** CONFIRMED. Both skeptics verified no IoU/text dedup exists anywhere in the listener, the overlay filters only rejected/superseded, and uuid5-keyed entity promotion makes the twin a distinct entity instance.
- **Fix sketch:** Feed surviving human-touched polygons/text into the propose step and drop proposals with high IoU/text match; at minimum suppress proposals matching rejected regions.

### RPR-4 (LOW, CONFIRMED) — Reprocess never supersedes extraction records despite injected ExtractionRepository and explicit docstring/API/dialog claims
- **Where:** `apps/email-listener/app/application/use_cases/reprocess_email.py:57`
- **What:** Three surfaces claim extraction records are superseded on reprocess (module docstring, route docstring, UI dialog copy) — but `execute()` never calls anything on `self._extractions`; the dependency is dead. `supersede_active`'s only caller is deny_field. Extraction records attached to now-superseded components stay non-superseded. Impact is latent today (UI filters by component), but any consumer treating "active extraction records" as the live set over-counts, and the D-16 contract is false in code. The unit test injects an AsyncMock and asserts nothing.
- **Verification:** CONFIRMED. Both skeptics verified the dead dependency, the sole deny_field caller, reachability via autofill-on-pending, and no DB trigger linking record status to component status.
- **Fix sketch:** Either implement it (bulk-supersede records joined on the superseded component ids before re-ingest) or delete the dead dependency and fix the three copy locations.

---

## 5. Entity-type suggestion, corrections & admin

### TYP-1 (MEDIUM, CONFIRMED) — Re-running suggestion (reprocess / SES redelivery) re-applies AI role+type over a human's explicit 'Clear role' decision
- **Where:** `apps/email-listener/app/application/use_cases/suggest_entity_types.py:104` (apply at :182-183); selection filter `component_repository.py:96-104`
- **What:** Targets are selected by `role IS NULL` + status ∈ {pending, candidate}. 'Clear role' PATCHes only role to null (entity_type_id stays, so the stale type label keeps rendering), leaving the row indistinguishable from never-classified. Reprocess (or a duplicate SES delivery — no user action) re-runs suggest_entity_types, which re-stamps role='entity' + entity_type_id on the human-cleared region, bypassing the corrections audit trail.
- **Failure scenario:** User decides a box is not an entity, clicks Clear role; later hits Reprocess (or SES redelivers): the AI's guess silently undoes the human's explicit unclassification.
- **Verification:** CONFIRMED. Both skeptics traced the full clear-role path (UI → PATCH → update_role only), verified supersede preserves candidate rows, and noted the use case's own docstring misstates that accepted regions are skipped.
- **Fix sketch:** Distinguish human-cleared from never-classified (clear entity_type_id with role and/or a human_touched marker, or exclude regions with a corrections/clear audit trail); alternatively role=None also nulls entity_type_id and marks the region reviewed.

### TYP-2 (MEDIUM, CONFIRMED) — Correction few-shots can carry slugs outside the active catalog; matching suggestions are silently dropped as unknown_slug
- **Where:** `packages/db/migrations/0038_entity_type_corrections.sql:58` (:55-65); apply-side `suggest_entity_types.py:169-177`
- **What:** The trgm-match RPC joins entity_types with NO is_active filter, so corrections pointing at a deactivated type are served forever as few-shot examples and steer the model toward that slug — while the catalog and slug→id map are built from ACTIVE types only. The model obliges, the slug misses the map, the suggestion is dropped at DEBUG level, the region stays unclassified. The learning loop actively degrades classification for exactly the texts the user corrected. Compounding: `list_active(importer_id)` queries only `.eq('importer_id', ...)` despite its "system + importer-specific" docstring — if importer-scoped types ever ship, the system taxonomy vanishes from the catalog.
- **Failure scenario:** User corrects several regions to 'receipt', later deactivates 'receipt' (an admin UI Switch exists). Next receipt email: examples say 'receipt', model says 'receipt', map misses → region unclassified, only a skipped_unknown_slug counter.
- **Verification:** CONFIRMED. Both skeptics verified the RPC is the sole definition with no is_active predicate, no cleanup of corrections on deactivation, the free-string tool schema, and the latent list_active scope bug. (One noted deactivation is even easier than claimed — via the admin UI, not just SQL.)
- **Fix sketch:** Add `AND t.is_active = true` (+ scope filter) to the RPC, or filter retrieved examples against the active slug set before injecting; fix list_active to OR system defaults with importer-scoped types.

### TYP-3 (LOW, CONFIRMED) — Flip-flop corrections produce contradictory few-shot examples; no dedupe or recency in capture or retrieval
- **Where:** `apps/email-listener/app/infrastructure/supabase/entity_type_correction_repository.py:61`; RPC ordering migration 0038:55-65
- **What:** Every genuine reclassification inserts a new row; retrieval orders solely by trigram similarity with no per-component dedupe or recency tiebreak. X→Y then Y→X on the same component yields two rows with identical content_text (identical sim) that can jointly occupy the top-3 example slots with contradictory slugs. The user's final decision has no precedence.
- **Failure scenario:** invoice→receipt then receipt→invoice: every future classification of similar text burns 2 of 3 example slots on contradictory noise — coin-flip guidance for exactly the texts the user cared enough to correct.
- **Verification:** CONFIRMED. Both skeptics verified no unique constraint, no DISTINCT ON/created_at in the RPC, no downstream dedupe, verbatim prompt rendering.
- **Fix sketch:** `DISTINCT ON (component_id) ORDER BY created_at DESC` before ranking by sim, or dedupe by content_text keeping the newest.

### TYP-4 (LOW, CONFIRMED) — Clearing an entity-type (or field) description in the admin UI silently fails to persist; null conflated with omitted down the whole PATCH chain
- **Where:** `apps/email-listener/app/infrastructure/supabase/entity_type_repository.py:197` (fields variant at :94-102)
- **What:** UI sends `description: null`; tRPC forwards it; FastAPI's `description: str | None = None` can't distinguish explicit null from omitted; the repo skips None values → the DB keeps the old text. Optimistic cache shows cleared, then the refetch resurrects the old description with no error. Matters beyond cosmetics: the description feeds the classifier system prompt and the autofill cold-start knowledge.
- **Failure scenario:** User empties a type description and blurs; it reappears after refetch/reload; the classifier keeps using the deleted text on every subsequent email.
- **Verification:** CONFIRMED. Both skeptics traced every hop (UI null → hook `!== undefined` spread → z.nullable → Pydantic default → `if description is not None` skip) and the identical field-level defect. (Minor citation-path inaccuracy in the original claim; content matched.)
- **Fix sketch:** Explicit UNSET sentinel (Pydantic `model_fields_set`/exclude_unset at the route; distinct UNSET vs None through use case and repo) so null means "set NULL".

### TYP-5 (LOW, CONFIRMED) — Non-atomic suggestion apply: role write succeeding while type write fails strands the region as role='entity' with no type, excluded from re-suggestion
- **Where:** `apps/email-listener/app/application/use_cases/suggest_entity_types.py:182` (:182-183)
- **What:** Two sequential PostgREST updates (role then type) in one log-and-continue try/except. A failure/crash between them leaves role='entity', entity_type_id NULL. Re-suggestion requires `role IS NULL`, so the half-applied region is never revisited; autofill is gated off (requires entityTypeId).
- **Verification:** CONFIRMED with scope caveats both skeptics flagged: pending regions DO self-heal via reprocess (supersede filters on status only), and the user can set the type manually in the inspector — permanent stranding applies to user-accepted candidate regions, and "only manual role-clear + reprocess recovers" is overstated. Core two-write race is real; the single-UPDATE fix pattern already exists in-repo (`update_field_relationship`).
- **Fix sketch:** Write both columns in ONE update (new repo method mirroring update_field_relationship), or reverse the order (type first, then role).

### TYP-6 (LOW, CONFIRMED) — Delete-field guard counts only CONFIRMED references: hard delete silently strips property mappings from all candidate field boxes awaiting review
- **Where:** `apps/email-listener/app/infrastructure/supabase/entity_type_repository.py:319` (:313-322)
- **What:** Soft-deactivate only fires when confirmed refs > 0. Candidate field components — the entire autofill review queue, which carries entity_type_field_id before any human confirms — are not counted. The FK is ON DELETE SET NULL, so a hard delete silently nulls the mapping on every candidate box; the UI toasts a plain "Field deleted"; affected boxes lose their property label and candidate value with no explanation.
- **Failure scenario:** Autofill produces 8 candidate boxes mapped to 'total_amount'; admin deletes the field (zero confirmed refs → hard delete); all 8 mappings silently vanish from the review queue.
- **Verification:** CONFIRMED. Both skeptics verified the confirmed-only filter, that autofill stamps the FK on candidate-status rows, the SET NULL FK in schema+migration, and that no dialog warns about in-review mappings. (Confirmed-only scope is a documented D-27 decision, but nothing handles the side effect.)
- **Fix sketch:** Count candidate + confirmed refs in the guard (downgrade to soft-deactivate when any live ref exists) and/or surface "N in-review mappings will be unlinked" in the confirmation dialog.

### TYP-7 (MEDIUM, CONFIRMED) — Retheme resolver failure is reported to the user as success (silent no-op "Panel re-themed")
- **Where:** `packages/api-client/src/router/genui/retheme.ts:216` (schema at :101-133); Python degrade `resolve_retheme.py:105-118`
- **What:** On Bedrock failure or unknown pack, Python degrades to outcome='fallback' carrying the caller's CURRENT pack + empty overrides and returns 200 (by design). The tRPC boundary validates only style_pack_id/token_overrides and — per its own comment — intentionally ignores `outcome`. The fallback pack is the panel's own current pack, so validation always passes → `{ok: true}` → success toast "Panel re-themed", a junk duplicate version appended, zero visual change. This contradicts the control's own contract ("a failed/invalid resolution shows the inline error banner … never a partial or silent apply").
- **Failure scenario:** Bedrock unreachable; user types "make it brutalist", clicks Apply look; sees success, panel identical, duplicate version in the picker.
- **Verification:** CONFIRMED. Both skeptics traced the full path; noted appendVersion also drops existing tokenOverrides on the active version and does no dedupe; no consumer anywhere reads `outcome`.
- **Fix sketch:** Pass `outcome` through the schemas (or map outcome==='fallback' to `{ok:false, reason}`) so the control shows its inline error banner instead of appending a no-op version.

### TYP-8 (LOW, CONFIRMED) — Python retheme belt validates override KEYS but not VALUES: one malformed value makes the web boundary reject the entire otherwise-valid resolution
- **Where:** `apps/email-listener/app/application/use_cases/resolve_retheme.py:120` (:120-122); tool schema `genui_retheme_adapter.py:71`
- **What:** Overrides are filtered to allowed keys but values pass through untouched; the Bedrock tool schema types values as bare strings (HSL/rem/px formats enforced only by prompt prose). The web's strict value regexes fail the WHOLE safeParse on one bad value (e.g. a hex color), discarding an independently valid style_pack_id → generic "Couldn't apply that look" when a pack-only apply was available.
- **Verification:** CONFIRMED. Both skeptics verified the key-only filter, the string-typed schema, the strict web gate, the one-shot no-repair pipeline, and that the whole-envelope rejection is web-side intended behavior — the Python belt's asymmetry is the gap.
- **Fix sketch:** Mirror the web's value-format guards in ResolveRethemeUseCase (drop bad-valued overrides, keep the pack).

---

## 6. Entity resolution & curation

### RES-1 (CRITICAL, CONFIRMED) — Reject/confirm merge write candidate-link updates that can never match a row: reject is a permanent no-op; rejected and merged suggestions re-surface forever
- **Where:** `apps/email-listener/app/infrastructure/supabase/entity_instance_repository.py:313` (select at :313-341, dismiss at :343-367)
- **What:** Both updates filter `component_entity_candidate_links` with `.eq("component_id", <entity_instance_id>)`. But component_id is a NOT NULL FK to `email_components.id`, and the only writer of link rows always writes an email-component id; an entity_instance id (uuid5 derived FROM the component id) can never equal one. Both updates match zero rows, silently, every time. Consequences: (1) `was_dismissed` is never persisted, so migration 0039's dismissal filter is dead SQL (its own "polymorphic" comment is factually wrong — the FK forbids it); (2) `was_selected` is never set, breaking the D-09 audit trail; and the pendingSuggestions query filters only on wasSelected=false (no wasDismissed, no isActive on the joined candidate) — so **rejected suggestions and already-merged targets keep re-appearing as pending duplicates** after every refetch.
- **Failure scenario:** Pedro clicks X on a wrong duplicate suggestion → success response, optimistic removal → the refetch brings the exact same suggestion back, forever. After confirming a merge, the now-inactive target still shows in Merge Suggestions on the survivor's page; clicking Confirm again re-runs the merge on an already-merged row.
- **Verification:** CONFIRMED. Both skeptics verified the FK (migration 0006, schema, snapshot 0042 — never dropped), the sole writer, zero-row-match silence (PostgREST raises nothing), the dead 0039 SQL, and the missing filters in detail.ts. The one test that "proves" dismiss works seeds an FK-violating row and is env-gated/skipped.
- **Fix sketch:** Pick one keying scheme: (a) dedicated entity-pair rows (or genuinely polymorphic component_id with the FK dropped) + aligned 0039 filter; or (b) key dismiss/select on the promote-written rows (resolve subject entity → source component ids, update (component_id=subject_component, entity_instance_id=target)). Also add wasDismissed=false and isActive=true filters to pendingSuggestions.

### RES-2 (HIGH, CONFIRMED) — Unmerge is wired to the survivor entity, so it never reactivates the merged row: undo silently does nothing
- **Where:** `apps/email-listener/app/application/use_cases/curate_entity_merge.py:201` (:201-205)
- **What:** `UnmergeEntityUseCase.execute(id)` expects the MERGED child's id, but the UI only ever shows Unmerge on the SURVIVOR (wasMerged = EXISTS(rows merged_into=this id)) and sends the survivor's id. The survivor already has merged_into=NULL/is_active=true, so the update is a no-op; the child stays inactive and merged. Endpoint returns 200; UI navigates away as if it worked.
- **Failure scenario:** Merge 'ACME Corp' into 'Acme Corporation', regret it, click Unmerge, confirm → navigated to the gallery, but ACME Corp is still inactive/merged; reopening the survivor still shows the Unmerge button.
- **Verification:** CONFIRMED. Both skeptics traced UI → hook → tRPC → FastAPI → plain `UPDATE WHERE id=<survivor>` with no fanout; unit tests encode the same wrong-target assumption.
- **Fix sketch:** Given a survivor id, reactivate all rows WHERE merged_into=survivor_id; or surface merged children in the detail response and pass the child id. Also remove the confirm-time alias on unmerge.

### RES-3 (HIGH, CONFIRMED) — ConfirmMerge has no self-merge, cycle, or chain guards: mutual merges make both entities inactive and unreachable
- **Where:** `apps/email-listener/app/application/use_cases/curate_entity_merge.py:44` (:60-101)
- **What:** Only existence + same-importer are validated. Missing: (a) self-merge (`/merge/{id}/{id}/confirm` sets merged_into=own id); (b) target already merged elsewhere (silently overwritten); (c) inactive/merged subject (find_by_id doesn't filter is_active); (d) cycles — after confirm(A,B), inactive B is still reachable via the gallery's 'candidate' filter and still lists A as pending (RES-1 keeps the suggestion alive), so confirm(B,A) yields A↔B mutually merged, both inactive, both gone from the confirmed gallery, with merged_into chain-walks looping.
- **Failure scenario:** Pedro merges B into A; later opens B from the candidate tab and confirms the still-listed suggestion for A → the supplier disappears from the confirmed gallery entirely.
- **Verification:** CONFIRMED. Both skeptics verified there is no guard at any layer (use case, endpoint, tRPC, DB — plain self-FK satisfied by self-reference, no CHECK/trigger) and traced the mutual-merge UI path end-to-end. Nuance: after a mutual merge both detail pages do show an Unmerge button, so recovery isn't strictly impossible — but unmerge is itself broken (RES-2).
- **Fix sketch:** Reject id==target; reject inactive/merged subjects; reject (or re-point) already-merged targets; walk merged_into to reject ancestor cycles. Defense in depth: DB CHECK (merged_into <> id) + trigger cycle guard.

### RES-4 (HIGH, CONFIRMED) — Re-running promote (backfill endpoint) wipes accumulated aliases and half-resurrects merged entities via full-row upsert
- **Where:** `apps/email-listener/app/application/use_cases/promote_entity_on_confirm.py:217` (:217-232); repo upsert `entity_instance_repository.py:16-34,116-122`
- **What:** Promote builds a fresh EntityInstance with `aliases=[]`, `is_active=True` and upserts on the deterministic uuid5 id — the payload includes aliases and is_active but NOT merged_into. `POST /v1/entity-instances/backfill` (documented "idempotent, safe to run multiple times") re-promotes EVERY confirmed entity component. Re-running therefore (1) resets aliases to [] on every promoted entity (destroying the D-11 alias flywheel) and (2) sets is_active=True on human-merged-away entities while merged_into stays set — the merged duplicate reappears in the confirmed gallery next to its survivor (gallery status is purely isActive).
- **Failure scenario:** Merge B into A (B inactive, A gains alias 'B'); run backfill → B is back in the gallery as a duplicate, still marked merged_into=A, and A's learned aliases are wiped.
- **Verification:** CONFIRMED. Both skeptics verified the upsert payload, that merges never change the source component's status (so backfill re-promotes merged children), and that no gallery filter checks merged_into. Nit: some aliases may be partially re-added by the flywheel during the same backfill; human-merge aliases and the unconditional resurrection are as claimed.
- **Fix sketch:** Merge-aware upsert: exclude aliases/is_active from the update side (or read-modify-write preserving them); skip promotion entirely when the existing row has merged_into set.

### RES-5 (MEDIUM, CONFIRMED) — Alias flywheel writes the subject's display_name onto every unconfirmed candidate: a self-reinforcing false-match loop
- **Where:** `apps/email-listener/app/application/use_cases/promote_entity_on_confirm.py:292` (loop at :267-301)
- **What:** The header comment says the alias is appended "if a surviving identity matches", but the loop appends the freshly-promoted entity's display_name as an alias onto EVERY BlendedRAG candidate (any trgm sim > 0 qualifies) before any human confirms the pair — an identity-linking write during a suggest-only (D-05) operation. Aliases feed the lexical arm and boost future rankings, so one weak suggestion permanently pollutes unrelated entities' alias lists and inflates their mutual similarity; false suggestions self-amplify. Reject does not remove the alias (and is a no-op anyway per RES-1).
- **Failure scenario:** Confirming 'Maersk Peru' while unrelated 'Marsk Logistics' is a weak candidate writes 'Maersk Peru' into Marsk's aliases immediately; from then on they keep suggesting each other.
- **Verification:** CONFIRMED. Both skeptics verified no threshold/gate, the alias_sim feedback loop, no alias-removal API, and that ConfirmMerge already does the correct post-confirmation append. Caveats: a unit test intentionally asserts the promote-time append (deliberate but contradicting the module's own suggest-only contract); aliases are API-visible but no entities page component currently renders them.
- **Fix sketch:** Move append_alias out of the candidate loop; write aliases only in ConfirmMergeUseCase after human confirmation.

### RES-6 (MEDIUM, CONFIRMED) — Bedrock embedding failure stores a 1536-zero vector treated as real: dense arm returns arbitrary rows instead of degrading to lexical-only
- **Where:** `apps/email-listener/app/infrastructure/llm/embedding_adapter.py:61` (:66-73)
- **What:** The adapter returns a zero-vector on any failure; the docstring says callers should treat it as a signal, but no caller checks (grep-verified). It is persisted onto the component and the entity instance (a zero tuple is truthy), passes the `is not None` D-12 gate, and reaches the vector RPC — cosine distance against a zero-norm query is NaN for every row, so ORDER BY is arbitrary and ~20 random same-type entities come back labeled 'semantic', entering RRF at ranks 0-19 with full weight. Combined with RES-5, the subject's name is then aliased onto random entities. The zero vector persists after Bedrock recovers (nothing re-embeds).
- **Failure scenario:** Bedrock briefly unreachable during a confirm (e.g. local stack without AWS creds): confirm succeeds, garbage 'semantic' merge suggestions appear, several random entities get polluted aliases — only a log line hints anything failed.
- **Verification:** CONFIRMED. Both skeptics verified every hop (adapter → confirm persist → truthy check → RPC with no distance threshold, unlike the trgm arm's `sim > 0`). Nits: the adapter docstring's "distance = 1.0" claim is actually NaN; promote fans out to top-5 fused, not all 20.
- **Fix sketch:** Return None/raise on failure and skip persisting; at minimum guard `any(v != 0.0 ...)` before storing and before the dense arm so D-12 lexical-only degradation actually happens.

### RES-7 (LOW, CONFIRMED) — Candidate provenance rows store the RRF score in similarity_score, corrupting the D-09 audit trail
- **Where:** `apps/email-listener/app/application/use_cases/promote_entity_on_confirm.py:280`
- **What:** `record_candidate_link` is called with `similarity_score=candidate.rrf_score` (~0.016-0.033 rank-fusion values) instead of the genuine 0-1 per-arm similarity the repo computes. Occurrence-link rows write 1.0 into the same column, so the column mixes incomparable scales; a 0.95 near-certain duplicate and a 0.31 marginal one store identically.
- **Verification:** CONFIRMED. Both skeptics verified the port explicitly distinguishes the two fields, the infra computes sim_score "for clean D-09 audit trail", and the only current reader drops the value before output — corruption is latent, consistent with low severity.
- **Fix sketch:** Pass `candidate.similarity_score`; add a separate rrf_score column if the fused score is wanted.

### RES-8 (LOW, CONFIRMED) — match_type 'identifier_exact' is unreachable: trgm similarity against identifiers::text JSON can never equal 1.0
- **Where:** `apps/email-listener/app/infrastructure/supabase/entity_resolution_repository.py:84`; RPC in migrations 0017/0039
- **What:** The label requires `identifier_sim == 1.0`, but identifier_sim is `similarity(identifiers::text, query_text)` — the JSON rendering (braces, quotes, key names) contributes trigrams absent from the value-only query, so 1.0 is unattainable for any realistic key. Exact identifier matches (same PO number) are always labeled 'identifier_fuzzy'; the D-09 "exact identifier wins over all" rule and its tie-break priority never fire; alias hits can outrank true exact-identifier hits.
- **Verification:** CONFIRMED. Both skeptics verified the SQL and attribution rule; unit tests inject identifier_sim=1.0 synthetically and never exercise the SQL. ("Never" is technically overstated for degenerate key names that don't occur in practice.)
- **Fix sketch:** Compute an explicit exact-match flag in the RPC (EXISTS over jsonb value equality) or compare normalized values in Python.

---

## 7. Knowledge graph & synthesis

### KG-1 (HIGH, CONFIRMED) — Knowledge-graph Promote button hardcodes DEFAULT_IMPORTER_ID: promotion 409s for every edge owned by a real importer
- **Where:** `apps/web/src/app/knowledge/_components/knowledge-graph.tsx:570` (constant at :134)
- **What:** handlePromote sends the hardcoded single-tenant fallback importer id, but ingest creates a per-sender-domain importer, and PromoteEdgeUseCase rejects with tenant_mismatch whenever edge_importer_id != body importer_id — even though the user-ownership guard already passed. The graph deliberately surfaces edges across ALL owned importers, so the UI renders suggestion edges it can never promote. The only human trust-raising affordance is broken for essentially every edge derived from a real forwarded email.
- **Failure scenario:** User clicks Promote on a dashed INFERRED edge → 409 → toast "This suggestion can no longer be promoted." Every retry fails identically.
- **Verification:** CONFIRMED. Both skeptics traced UI → Next proxy (forwards importerId verbatim, maps 409 to that exact toast) → FastAPI equality guard after the ownership guard → node-derived edge importer ids. Only fallback-importer edges could ever succeed.
- **Fix sketch:** Carry the owning importerId on each edge in the graph payload and pass it from the popover; or drop the redundant body-importer equality check when user ownership is already verified.

### KG-2 (MEDIUM, CONFIRMED) — Re-confirming a region deactivates human-promoted EXTRACTED edges and silently reverts them to fresh suggestions
- **Where:** `apps/email-listener/app/application/use_cases/synthesize_knowledge.py:131` (:131-132); repo `knowledge_graph_repository.py:261-273`
- **What:** On re-confirm, `deactivate_edges_for_node` flips is_active=False on ALL active edges of the node — no tier/mechanism filter — including edges a human explicitly promoted (mechanism='human_promote', "the only place trust is ever raised"). The re-derivation loop then re-inserts the same relation as a fresh INFERRED suggestion. Promotion guards reject inactive edges, so the old row can't even be re-promoted; the user must find and promote the new suggestion again.
- **Failure scenario:** Promote an INFERRED A→B edge to EXTRACTED, later re-confirm A to fix a field: the promoted edge dies, a new dashed suggestion replaces it, and every EXTRACTED-only consumer (injectable edges, search/expand) loses the relation.
- **Verification:** CONFIRMED. Both skeptics verified re-confirm always re-runs synthesis, promotion mutates the same row in place, the unfiltered deactivation, and no compensating trigger/code anywhere.
- **Fix sketch:** Scope deactivation to synthesis-owned edges (exclude non-null promotion / eq source='synthesis'); skip re-inserting a suggestion when an active promoted edge exists for the same (target_ref_id, relation_type).

### KG-3 (MEDIUM, CONFIRMED) — 'about'/'possibly_about' edges are never created on the normal confirm flow: synthesis runs before candidate links exist
- **Where:** `apps/email-listener/app/presentation/api/v1/components.py:240` (:240-251)
- **What:** confirm_component runs ConfirmRegion (which synthesizes internally) BEFORE PromoteEntityOnConfirm, which is what writes component_entity_candidate_links. The synthesizer's selected/unselected-candidate reads therefore always return nothing on first confirm (the repo docstring admits it). The EXTRACTED 'about' edge and AMBIGUOUS 'possibly_about' suggestions are silently never materialized in the standard flow — the knowledge graph never links region knowledge to entity instances.
- **Failure scenario:** Confirm an entity region once: only evidenced_by + co_occurs_with edges exist; the region's knowledge node never connects to the entity it is about; expand_neighbours never reaches the instance.
- **Verification:** CONFIRMED. Both skeptics verified the ordering, the single synthesis call site, and that no later path re-runs it. Nuance (worsens it): promote writes was_selected=True only for field children, keyed on the child id — so even a re-confirm may not produce the 'about' edge.
- **Fix sketch:** Run the synthesizer after PromoteEntityOnConfirm in the endpoint (move the best-effort hook), or have PromoteEntityOnConfirm emit the about-edge itself.

### KG-4 (MEDIUM, CONFIRMED) — INFERRED co_occurs_with suggestions are generated toward rejected and superseded components
- **Where:** `apps/email-listener/app/infrastructure/supabase/entity_instance_repository.py:284` (:279-286)
- **What:** `find_unconfirmed_entity_components_for_email` uses `.neq('extraction_status','confirmed')`, which matches 'rejected' AND 'superseded' — not just unreviewed rows. Every returned row becomes an active INFERRED suggestion edge. Confirming any region thus produces promotable edges pointing at regions the human explicitly rejected, and at superseded originals (duplicating the suggestion to their replacements). Promote has no target-status guard, so "co-occurs with a rejected region" can become durable EXTRACTED knowledge.
- **Verification:** CONFIRMED. Both skeptics verified the enum, that rejected/superseded rows keep role='entity', the no-recheck edge insert, no target-status filter anywhere in graph read or promote, and a unit test that locks in the wrong filter. (Fix-sketch status names need adjusting to the real enum: candidate/auto_confirmed/review_pending.)
- **Fix sketch:** Filter to genuinely-unreviewed statuses instead of `.neq(..., 'confirmed')`.

### KG-5 (MEDIUM, CONFIRMED) — Redraw/split/merge of a confirmed region leaves its knowledge node and EXTRACTED edges active and pointing at the superseded component forever
- **Where:** `apps/email-listener/app/application/use_cases/edit_region.py:162` (redraw :104-169, split :172-247, merge :250-366)
- **What:** Unlike Accept/Reject, the geometry edits have no extraction_status guard, so a CONFIRMED region can be superseded — and nothing deactivates its knowledge node or edges (`deactivate_edges_for_node`'s only caller is same-component re-confirm). Confirming the replacement creates a SECOND active node for the same real-world region. The stale node keeps ranking in knowledge search, keeps rendering in the graph, and stays eligible for auto-injection — with provenance polygons for a region that no longer exists in the review UI.
- **Failure scenario:** Confirm invoice region R (node N), merge R with a neighbor to fix bounds (allowed — UI enables Redraw/Split/Merge on confirmed regions), confirm R' → two active EXTRACTED nodes for the same invoice; search returns both as duplicate facts.
- **Verification:** CONFIRMED. Both skeptics verified missing guards at use case/route/UI layers, the single deactivation call site, and that the extracted-only view/RPCs never join component status.
- **Fix sketch:** On redraw/split/merge (and reject), deactivate the original's active knowledge node + edges; or block geometry edits on confirmed regions.

### KG-6 (MEDIUM, CONFIRMED) — Entity merge orphans EXTRACTED 'about' edges: never repointed to the survivor, silently dropped from every read surface
- **Where:** `apps/email-listener/app/application/use_cases/curate_entity_merge.py:97` (:97-101)
- **What:** ConfirmMerge deactivates the target instance but edges with target_ref_type='entity_instance' pointing at it are neither repointed nor deactivated. Every reader silently drops them (graph emits only active instance nodes; the frontend filters edges to visible nodes; expand_neighbours can't resolve the target) — so a human-confirmed EXTRACTED fact vanishes from the graph the moment its entity is merged, while remaining an active injectable row pointing at a dead instance. Unmerge makes it reappear: state whiplash on a dangling reference.
- **Verification:** CONFIRMED. Both skeptics verified no repoint/deactivate code or trigger exists and traced the three read surfaces. Caveat: the expand_neighbours/BFS drop is pre-existing (entity_instance targets never resolve through the extracted-only view), not merge-induced.
- **Fix sketch:** In ConfirmMerge, repoint active edges (target_ref_type='entity_instance', target_ref_id=target) to the survivor (or deactivate with a supersede marker); reverse on unmerge.

### KG-7 (MEDIUM, CONFIRMED) — Re-confirming without corrections overwrites the knowledge node's title/content with degraded field-less values
- **Where:** `apps/email-listener/app/application/use_cases/confirm_region.py:115`; compose at `synthesize_knowledge.py:211-232`
- **What:** On a second confirm there is no candidate extraction record (the first confirm promoted it in place), so confirmed_record=None and effective_fields={}. The composer then produces a title without the primary field value and content without the 'k: v' lines, and upsert_node UPDATES the existing node in place, clobbering the richer first-confirm values. The D-15 embedding is likewise recomputed from content_text only. A plain idempotent re-confirm — explicitly supported per D-16 — degrades durable knowledge data.
- **Failure scenario:** First confirm writes 'invoice: INV-123' + field lines; a double-click or re-confirm reduces it to bare 'invoice'; knowledge search stops matching 'INV-123' (unless it also appears in the raw region text).
- **Verification:** CONFIRMED. Both skeptics traced the full path and noted the existing idempotency test omits the synthesizer, so the clobber is untested.
- **Fix sketch:** Fall back to the latest CONFIRMED record's fields when no candidate exists; or skip the node update when effective_fields is empty and the node already exists.

### KG-8 (LOW, CONFIRMED) — knowledge_nodes.embedding is never written by any code path: the vector arm of knowledge search is permanently dead while still paying a Bedrock embed per query
- **Where:** `apps/email-listener/app/infrastructure/supabase/knowledge_graph_repository.py:161` (upsert_node :161-200)
- **What:** Both upsert_node call sites omit the embedding param (defaults None); no TS writer exists. Every knowledge_nodes.embedding is NULL, and the vector RPC filters `embedding IS NOT NULL` — zero matches forever. Yet SearchKnowledgeExecutor embeds every query via Bedrock before searching: cost + latency for an arm empty by construction; "BlendedRAG" knowledge search is silently trgm-only. Latent extra: strip_nul preserves None keys, so the update path sends embedding:null and would wipe any future backfilled embedding on the next re-confirm.
- **Verification:** CONFIRMED. Both skeptics grep-verified no writer anywhere (including e2e fixtures), the IS NOT NULL filter, the unconditional per-query embed, and the None-wipe hazard.
- **Fix sketch:** Compute and pass an embedding in synthesize_from_confirmation (an embedder already runs in the same confirm flow) and in SourceCaptureHandler; make the update path drop None-valued keys.

### KG-9 (LOW, CONFIRMED) — Synthesis crashes (silently swallowed) for regions with no text and no fields: knowledge_nodes.content is NOT NULL but the composer returns None
- **Where:** `apps/email-listener/app/application/use_cases/synthesize_knowledge.py:230`
- **What:** With empty effective_fields AND empty content_text, the composer returns content=None; strip_nul keeps the None; the NOT NULL insert fails with 23502; confirm_region's best-effort wrapper logs a warning. The confirm succeeds but NO knowledge node and NO edges are ever produced for that region — a silent permanent gap (re-confirm hits the same path).
- **Failure scenario:** User draws + confirms a region over a purely graphical area (logo/stamp) with no OCR tokens and no autofill candidate: every confirm logs confirm_region_synthesis_failed; the region never enters the knowledge graph.
- **Verification:** CONFIRMED. Both skeptics verified reachability (token-less capture yields ""), the None-preserving sanitize, the NOT NULL column in schema + applied migration, and the pre-edge abort.
- **Fix sketch:** Non-null fallback (content = title or component_id when content_lines is empty), matching the title fallback two lines up.

---

## 8. Web UI (inbox, email detail, review controls)

### UI-1 (HIGH, CONFIRMED) — "Undo" toast after denying an auto-detected field is fake: no server restore exists, and the denial memo persists
- **Where:** `apps/web/src/app/emails/[id]/_components/use-role-mutations.ts:263` (:263-276); deny `deny_field.py:119-141`
- **What:** The deny toast offers Undo, but restoreField only patches the react-query cache to 'candidate' and immediately invalidates — its own comment admits no server un-reject endpoint exists. The refetch returns 'rejected' and the box vanishes again. Worse, deny atomically appended the polygon to the parent's denied_field_polygons memo (D-19), so a re-run of Autofill Fields will never re-propose that box. The Undo affordance is a lie with a permanent side effect.
- **Failure scenario:** User fat-fingers the ✗ on a CORRECT auto-detected field, clicks Undo within 3s: box flickers back, then disappears; the correct extraction is permanently lost and the user was told they undid it.
- **Verification:** CONFIRMED. Both skeptics verified no restore/unreject route exists anywhere, the memo append happens before the status write, nothing ever removes memo entries, and autofill excludes denied polygons.
- **Fix sketch:** Add POST /v1/components/{id}/restore (un-reject + remove the matching polygon from the memo), expose as a tRPC mutation, call it from restoreField. Until then, remove the Undo action — an honest "Field removed" beats a fake undo.

### UI-2 (HIGH, CONFIRMED) — Editing the candidate value in the Inspector then clicking "Confirm Field" silently discards the user's correction
- **Where:** `apps/web/src/app/emails/[id]/_components/inspector-panel.tsx:306` (:306-311, button :321-329)
- **What:** The "Candidate value" section renders an EDITABLE uncontrolled `<Input defaultValue={...}>` with no onChange/state (contrast the Confirmed-value input, which is explicitly readOnly), and Confirm Field calls `onConfirmField(selected.id)` — the prop type literally cannot carry a value. correctedFields defaults to null all the way down; the backend fully supports corrections, the UI just never sends them. The machine's original value is confirmed, stamped human-verified everywhere, and fed into the embedding/flywheel as if the human vouched for it.
- **Failure scenario:** AI extracts "R$ 4.820,00", document says "R$ 4.320,00"; user types the fix into the input and clicks Confirm Field → the wrong value becomes the confirmed record with the 'Confirmed' badge; the correction is silently thrown away.
- **Verification:** CONFIRMED. Both skeptics verified every hop (uncontrolled input → value-less prop type → null correctedFields → corrected_fields:null POST → backend confirms machine fields verbatim, embeds and synthesizes them) and that no alternative UI path captures the edit (the separate autofill surface's edit flow does not touch the Inspector path).
- **Fix sketch:** Make the input controlled; when edited != candidateValue, call `onConfirmField(selected.id, {[fieldKey]: editedValue})` — the signature and the whole server path already work.

### UI-3 (MEDIUM, CONFIRMED) — "Unconfirm Field" is a no-op: optimistic flip immediately reverted by its own invalidate; no server endpoint exists
- **Where:** `apps/web/src/app/emails/[id]/_components/use-role-mutations.ts:282` (:282-295)
- **What:** unconfirmField only sets the cached status to 'candidate' then invalidates emails.detail; the code's own comment admits no /unconfirm endpoint exists (/accept only handles pending→candidate). The refetch restores 'confirmed' within one round-trip — no error, no toast. Confirm side effects (gallery promotion, embeddings) could never be reversed by a cache write anyway.
- **Failure scenario:** User confirms a wrong value, clicks Unconfirm Field to re-review: the badge flashes 'candidate' then snaps back to 'confirmed'. There is no working path to demote a wrongly confirmed value.
- **Verification:** CONFIRMED. Both skeptics grep-verified no confirmed→candidate transition exists server-side and that the invalidate guarantees the self-revert.
- **Fix sketch:** Implement a real unconfirm endpoint (supersede the confirmed record, revert status) or remove the button — a control that visibly reverts itself is worse than none.

### UI-4 (MEDIUM, CONFIRMED) — Inbox "Load more" dead-ends after one click: hasMore reads an unfetched query key and becomes false
- **Where:** `apps/web/src/app/_components/inbox-three-pane.tsx:422` (:416-431)
- **What:** After the first Load more, `nextOffset` becomes non-null (the server always returns a number), which changes the disabled useQuery's key; data for the new key is undefined; `hasMore` collapses to `undefined ?? false` and the button disappears (desktop and mobile) even though the just-fetched page said hasMore:true. Pages 3+ are unreachable.
- **Failure scenario:** Mailbox with >100 threads: one click appends 50, then the button vanishes; remaining threads can never be listed.
- **Verification:** CONFIRMED. Both skeptics verified the key drift, no keepPreviousData/placeholderData anywhere, both render guards, and that the server proves further pages exist.
- **Fix sketch:** Store the last page's hasMore in state alongside nextOffset (`setHasMoreState(page.hasMore)` inside handleLoadMore).

### UI-5 (MEDIUM, CONFIRMED) — Attachment signed-URL failure leaves the PDF canvas as an infinite skeleton: error swallowed, no retry
- **Where:** `apps/web/src/app/emails/[id]/_components/email-detail.tsx:303` (:303-329; skeleton :638-642)
- **What:** The signed-URL effect silently returns on !res.ok and its catch is an explicit swallow; no error state, effect re-runs only when the attachment id changes (re-clicking the same one does nothing). canvasZone renders a Skeleton whenever there is an active id but no cached URL — so any failure (expired session 401, stale storage key 404, storage down 500) shows a permanent shimmer on the page's core surface, with no message and no retry short of reload. The first PDF auto-opens on load, so every visit hits this path when the attachment route fails.
- **Verification:** CONFIRMED. Both skeptics verified all realistic failure statuses on the server route, the swallow comment's justification pointing at a different surface, and that the skeleton branch has no close/retry affordance.
- **Fix sketch:** Track per-attachment error state; render an inline framed error with Retry instead of the skeleton; clear the error before refetching.

### UI-6 (LOW, CONFIRMED) — "Unread" inbox filter is a silent no-op: shows all mail while appearing active
- **Where:** `apps/web/src/app/_components/inbox-three-pane.tsx:403`
- **What:** All/Unread/With-entities are offered and highlight on select, but visibleItems only special-cases 'with-entities' — 'unread' falls through to allItems. No read/unread state exists anywhere in the schema or routers, so the filter cannot ever work; the docs even confirm "there is no read-state model" in v1, yet the selectable filter shipped.
- **Verification:** CONFIRMED. Both skeptics grep-verified no email read-state anywhere and byte-identical list/count between All and Unread.
- **Fix sketch:** Remove the Unread option until read-state exists, or disable it with a 'coming soon' tooltip. A selectable filter must filter.

### UI-7 (LOW, CONFIRMED) — emails.entitySummary failure is invisible: no chips, empty rail, and 'With entities' shows a false "nothing extracted" message
- **Where:** `apps/web/src/app/_components/inbox-three-pane.tsx:302` (:302-305; empty copy :530-535)
- **What:** The query driving entity chips, the "What I found" rail, and the With-entities filter never has isError read. On failure the inbox renders chip-less and the With-entities view affirmatively claims 'Nothing extracted yet — entities will show up as mail arrives.' showError covers only the thread-list queries; the rule-suggestions query on the same page DOES surface its error, so this is an inconsistency, not house style.
- **Failure scenario:** Transient 500 in entitySummary: user reads that their invoices produced no entities and concludes extraction is broken; nothing prompts a refresh.
- **Verification:** CONFIRMED. Both skeptics verified isError is read nowhere, no global error handling compensates, and the contrast with MailRuleReviewPanel.
- **Fix sketch:** Read isError; show "Couldn't load extracted facts — refresh to retry" and never the affirmative empty copy when the query errored.

### UI-8 (LOW, CONFIRMED) — Every autofill-fields failure is reported as "model access is pending", masking the real error
- **Where:** `apps/web/src/app/emails/[id]/_components/use-autofill-fields.ts:63` (:61-66)
- **What:** onError shows one hardcoded toast for ANY failure of emails.autofillFields — listener down, bad EMAIL_LISTENER_API_KEY, 404, 500 — discarding the error entirely, even though the tRPC layer propagates the listener's actual detail. Users debugging a down listener are told to wait for model access: false and unactionable.
- **Verification:** CONFIRMED. Both skeptics verified the discarded `_err`, the real error variety from the listener, that the copy was deliberately spec'd (intentional-but-stale blanket message), and the sibling hook repeats the pattern.
- **Fix sketch:** Branch: keep the model-access copy only for the specific model-unavailable error; otherwise "Autofill failed — {reason} / try again".

---

## Appendix: dedup map

| Report ID | Merged raw findings (lens) |
|---|---|
| REG-1 | "SNS redelivery and reprocess duplicate attachment_page components" (mime) + "Re-ingest never dedupes attachment_page components" (regions) + "Re-ingest duplicates attachment_page components every run" (reprocess) |
| REG-4 | "find_by_email_id silently capped at 1000 rows" (regions) + same (reprocess) |

All other findings were unique to a single lens. Every finding in this report is **CONFIRMED** (both skeptics upheld); no PLAUSIBLE or UNVERIFIED findings survived the pipeline.
