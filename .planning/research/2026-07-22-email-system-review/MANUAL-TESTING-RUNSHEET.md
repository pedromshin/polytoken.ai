# Manual Testing Runsheet — Email AI-Analysis System

For: Pedro, testing by hand on the local stack. Goal: LEARN the tool by walking the whole pipeline, then reproduce each confirmed bug from `REPORT.md` yourself. Every probe says exactly what to click or run, what to watch, and what PASS vs BUG looks like.

**Companion doc:** `.planning/research/2026-07-22-email-system-review/REPORT.md` (finding IDs like ING-3, RES-1 refer to it).

---

## Glossary (plain language, read once)

- **Listener** — the Python (FastAPI) server on port 8000 that receives incoming email notifications and runs all the AI analysis.
- **SNS / SES** — AWS services. SES receives the actual email and saves the raw bytes to an S3 bucket; SNS then POSTs a small JSON notification to the listener saying "an email arrived, its id is X". Locally we fake the SNS POST with curl.
- **Raw MIME / .eml** — the email file itself, headers + body + attachments in one text blob.
- **Ingest** — the listener pipeline: fetch raw email from S3 → parse it → save email + attachments to the DB → parse PDFs into **pages** → ask the AI to propose **regions**.
- **Region** — a box drawn over part of a document page that the AI thinks contains something meaningful (an invoice number, a company block, etc.). Regions have a status: `pending` (AI proposed), `candidate` (you accepted), `confirmed` (you verified), `rejected`, `superseded` (replaced/obsolete).
- **Entity / entity type** — a region can be classified as an entity of some type ("invoice", "receipt", "supplier"). Confirming an entity region creates an **entity instance** (a durable record, e.g. "Supplier · Acme").
- **Importer** — the per-sender-domain bucket emails are grouped under. Also the tenancy anchor (who owns what).
- **Knowledge graph** — nodes + edges built when you confirm regions; visible at `/knowledge`.
- **Reprocess** — re-running ingest for an email, meant to refresh AI proposals.
- **Studio** — Supabase's DB web UI at http://127.0.0.1:54323 — use its SQL editor for every "check the DB" step below. (House rule: trust the DB, not the terminal.)

---

## 0. Bring the stack up (once per session)

Follows `docs/RUN-LOCAL.md` — read it if anything below fails.

1. Start Docker Desktop.
2. In PowerShell at the repo root: `./scripts/preflight-local.ps1` — wait for PASS. (This starts Supabase, seeds your one auth user, migrates, grants DB permissions.)
3. Terminal 2 — the listener (NO `--reload`, ever — zombie-process rule):
   ```
   cd apps/email-listener
   uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```
4. Terminal 3 — the web app:
   ```
   cd apps/web
   npm run dev
   ```
   (Equivalent from repo root: `npm run web:dev`.)
5. Open http://localhost:3000 and sign in (Google, with the seeded email).
6. Collect three values you'll reuse all day:
   - **API key**: the `API_KEY=` value in `apps/email-listener/.env`. Used as header `X-API-Key`.
   - **Your user id**: in Studio SQL editor run `select id from auth.users;` — copy the uuid. Used as header `X-User-Id`.
   - **DB shell** (alternative to Studio): `docker exec -i supabase_db_polytoken psql -U postgres -d postgres -c "<sql>"`.

### 0.1 How to inject a test email (used everywhere below)

The listener fetches raw email bytes from the SES S3 bucket (`SES_S3_BUCKET` in `apps/email-listener/.env`, key prefix `inbound/local/` in development), then you poke it with a fake SNS notification. Recipe:

1. Build an `.eml` file (Save a real email as .eml from Gmail via "Show original → Download", or build one with Python — probes below include snippets).
2. Upload it to S3 under the local prefix with a test id you invent (AWS creds come from your shell / `apps/email-listener/.env`):
   ```
   aws s3 cp test1.eml s3://<SES_S3_BUCKET value>/inbound/local/test-001
   ```
3. Notify the listener (this is what SNS would do). Save this as `notify.json`, editing messageId/source/destination each time:
   ```json
   {"Type":"Notification","Message":"{\"mail\":{\"messageId\":\"test-001\",\"source\":\"sender@acme.com\",\"destination\":[\"u-<your-token>@yourdomain\"],\"commonHeaders\":{\"subject\":\"Test 1\"}}}"}
   ```
   Then:
   ```
   curl -X POST http://127.0.0.1:8000/v1/emails/inbound-sns -H "Content-Type: application/json" --data @notify.json
   ```
   It ALWAYS returns 200 (by design — even when ingest fails). Truth lives in the DB.
4. Your forwarding token: `select token from forwarding_addresses;` in Studio. The destination `u-<token>@anything` is how the email gets attributed to you.
5. Verify: `select id, subject, parse_status, importer_id from emails order by created_at desc limit 3;`

**No AWS access?** You can still exercise everything after ingest by using seeded/e2e fixture emails, and you can unit-drive the parser with `uv run python` snippets (several probes below need no email at all).

---

## A. End-to-end happy path (learn the tool)

Do this once, slowly. Everything else references it.

**A1. Send yourself a real-ish email.** Build an email with a small text body and a 1-3 page PDF invoice attached (any PDF with visible text). Inject it per §0.1 with messageId `happy-001`, sender `billing@acme.com`, destination `u-<your-token>@x`.

**A2. Watch ingest land.** In the listener terminal you should see `email_received` then structured log lines. Then in Studio:
```sql
select id, subject, sender_address, parse_status from emails order by created_at desc limit 1;
select filename, content_type, size_bytes, parse_status from email_attachments where email_id = '<id>';
select source_type, extraction_status, count(*) from email_components where email_id = '<id>' group by 1,2;
```
Expect: 1 email (`parse_status='received'`), your PDF attachment (size > 0), N `attachment_page` rows (one per PDF page), and some `region` rows with `extraction_status='pending'`. Also check an importer was created for you: `select slug, user_id from importers;` → `acme-com` with YOUR user id.

**A3. See it in the inbox.** http://localhost:3000 — the email should appear in the thread list, possibly with entity chips. Click it → email detail page. The PDF should render on the canvas with dashed/pending boxes overlaid — those are the AI's proposed regions.

**A4. Review regions.** Click a proposed box → the Inspector panel (right side) shows its text, role and type. Accept it (pending → candidate). Watch the DB if curious: `select extraction_status, role, entity_type_id from email_components where id='<region id>';`

**A5. Type suggestions.** Regions classified as entities get a `role='entity'` and an `entity_type_id` (set automatically during ingest by the suggest step). In the Inspector you can change the type via the picker — changing it records a row in `entity_type_corrections` (that's the learning loop).

**A6. Confirm an entity region.** Click Confirm on an accepted entity region. This: marks it confirmed, creates an **entity instance** (`select display_name, entity_type_id, is_active from entity_instances;`), computes an embedding, and synthesizes **knowledge nodes/edges** (`select title, content from knowledge_nodes;`).

**A7. Entities gallery.** Visit /entities — your confirmed entity should appear. Open it: occurrences, merge suggestions (if a similar entity exists), aliases.

**A8. Knowledge canvas.** Visit /knowledge — nodes for confirmed regions, solid edges = EXTRACTED (trusted), dashed = INFERRED (suggestions).

**A9. Autofill.** Back on the email, select a confirmed/candidate entity region with a type and click Autofill Fields — the AI proposes field boxes (invoice number, total, …) as small candidate boxes with ✓/✗ controls.

If all of A1-A9 worked, you know the tool. Now break it.

---

## B. Targeted probes (one per confirmed finding)

Each probe: **Setup → Do → PASS looks like / BUG looks like.** All findings are CONFIRMED, so expect to see the BUG outcome; PASS is what you should see *after a fix*.

### B-ING: Ingestion & tenancy

**B/ING-1 — weird charset kills the email silently.**
Setup: build a bad .eml:
```
cd apps/email-listener
uv run python -c "
from email.message import EmailMessage
m = EmailMessage()
m['From']='a@b.com'; m['To']='u-x@y'; m['Subject']='charset bomb'
m.set_content('hello'); m.set_param('charset','binary')
open('bad-charset.eml','wb').write(bytes(m))"
```
Quick unit check first: `uv run python -c "from app.domain.services.mime_parser import parse_mime; parse_mime(open('bad-charset.eml','rb').read())"`.
BUG: `LookupError: unknown encoding: binary` crash. Then inject it end-to-end (id `bad-charset-001`, §0.1): curl returns 200, listener logs `email_ingest_error`, and `select count(*) from emails where subject='charset bomb';` → **0**. The email vanished with no trace.
PASS (after fix): parse_mime returns text (with replacement chars) OR at minimum an emails row exists with an error status.

**B/ING-2 — cross-tenant importer collision.** (Needs a second user — or simulate.)
Setup: in Studio, add a second forwarding token: insert a row into `forwarding_addresses` with a made-up token `tokB` and a second user id (insert a second `auth.users` row via the GoTrue admin API, or reuse a spare uuid in a users table copy — easiest: run this probe as SQL-level verification).
Do: inject email #1 from `maria@acme.com` to `u-<your token>@x`, then email #2 from `jose@acme.com` to `u-tokB@x`.
Check: `select user_id from importers where slug='acme-com';` and `select importer_id from emails where sender_address='jose@acme.com';`
BUG: both emails hang off ONE importer owned by user A — user B's email is in A's tenant (visible to A in the web inbox, invisible to B).
PASS: two importers (one per user) or the email attributed to B.

**B/ING-3 — filename-less inline image aborts attachments.**
Setup: build an .eml with an inline image without a filename plus a real PDF:
```
uv run python -c "
from email.message import EmailMessage
m = EmailMessage()
m['From']='a@acme.com'; m['To']='u-x@y'; m['Subject']='logo test'
m.set_content('body')
m.add_related(b'\x89PNG fake', maintype='image', subtype='png', cid='<logo>')  # no filename
m.add_attachment(open('any.pdf','rb').read(), maintype='application', subtype='pdf', filename='real.pdf')
open('nofilename.eml','wb').write(bytes(m))"
```
Do: inject as `nofn-001`.
BUG: listener log shows a NOT NULL violation on `filename`; email row exists but `select count(*) from email_attachments where email_id='<id>';` → 0 (even real.pdf is gone); no regions.
PASS: 2 attachment rows, the nameless one saved as `attachment-0` (or similar), regions proposed for the PDF.

**B/ING-4 — "Forward as attachment" becomes a 0-byte file.**
Setup: in Gmail, open any email with a PDF attached, choose ⋮ → "Forward as attachment", send to yourself, download the result as .eml. (Or nest one EmailMessage in another with `m.add_attachment(inner, filename='original.eml')`.)
Quick unit check: `uv run python -c "from app.domain.services.mime_parser import parse_mime; p=parse_mime(open('fwd.eml','rb').read()); print([(a.filename,a.content_type,len(a.data)) for a in p.attachments])"`.
BUG: `('original.eml','message/rfc822', 0)` — zero bytes. End-to-end: attachment row with `size_bytes=0`, download is empty, inner PDF nowhere.
PASS: non-zero bytes; ideally the inner PDF surfaced too.

**B/ING-5 — accented/`#` filename aborts the whole email's attachments.**
Setup: .eml whose FIRST attachment is named `relatório #1.pdf` and second `contract.pdf`.
Do: inject.
BUG: listener log shows `StorageApiError` / Invalid key; only the email row exists, `email_attachments` has at most the first failed one missing AND contract.pdf missing too; zero `email_components`.
PASS: both attachments stored (key sanitized), regions proposed.

**B/ING-6 — failures never change parse_status.**
Setup: inject an email with a corrupt "PDF" (rename a .txt to bill.pdf).
Do: after ingest, run `select parse_status from emails order by created_at desc limit 1;` and `select parse_status from email_attachments where email_id='<id>';`
BUG: `received` / `pending` — identical to a healthy email; the detail page chip looks normal; the parse failure only exists in the listener log (`attachment_parse_failed`).
PASS: something reads 'failed' in DB and UI.

**B/ING-7 — hidden NUL characters kill the email.**
Setup:
```
uv run python -c "
from email.message import EmailMessage
m = EmailMessage()
m['From']='win@corp.com'; m['To']='u-x@y'; m['Subject']='utf16 body'
m.set_content('placeholder')
m.set_payload(__import__('base64').b64encode('Invoice total: 500 EUR'.encode('utf-16-le')).decode())
m['Content-Transfer-Encoding']='base64'; m.set_param('charset','iso-8859-1')
open('nul.eml','wb').write(bytes(m))"
```
Do: inject as `nul-001`.
BUG: listener logs a PostgREST 22P05 error; no emails row created despite the 200.
PASS: email lands with readable (or at least sanitized) body text.

### B-PDF: PDF parsing

**B/PDF-1 — PDF labeled application/octet-stream is never analyzed.**
Setup: .eml attaching a real PDF but with `maintype='application', subtype='octet-stream', filename='invoice.pdf'`.
Do: inject; open the email in the web app.
BUG: attachment downloads fine, but zero `attachment_page` components (`select count(*) from email_components where attachment_id='<att id>';` → 0), no boxes on canvas, log shows `attachment_parse_failed` UnsupportedFileTypeError.
PASS: pages + regions appear as for a normal PDF.

**B/PDF-2 — one hanging PDF wedges all future PDF parsing.** (Simulation — don't hunt for a pathological PDF.)
Setup: temporary scratch script that monkeypatches the parser:
```
uv run python - <<'EOF'
import asyncio, time
from app.infrastructure.pdf.pdf_parser import PdfParser
p = PdfParser(ocr=None)
p._extract_text_layers = lambda b: (time.sleep(3600), [])[1]
async def main():
    t1 = asyncio.create_task(p.parse(file_bytes=b'%PDF-1.4 fake', content_type='application/pdf', filename='a.pdf', attachment_id='x', email_id='y'))
    await asyncio.sleep(65)
    print('first parse still running after timeout:', not t1.done())
asyncio.run(main())
EOF
```
BUG: after the 60s timeout fires, the call never completes (rasterize jobs queue behind the sleeping thread); a second parse would also hang.
PASS: parse returns (degraded) and a second parse of a normal PDF completes.

**B/PDF-3 — whitespace-only text layer skips OCR.**
Do (pure unit, 5 seconds): `cd apps/email-listener && uv run python -c "from app.infrastructure.pdf.text_layer import detect_text_layer; print(detect_text_layer('\n'*25))"`
BUG: prints `True` (whitespace counts as text, so OCR is skipped and the page contributes nothing).
PASS: `False`.

### B-REG: Regions & reprocess

Because RPR-1 breaks the UI Reprocess button, use curl for reprocess in these probes:
```
curl -X POST http://127.0.0.1:8000/v1/emails/<email-id>/reprocess -H "X-API-Key: <key>" -H "X-User-Id: <your uuid>"
```

**B/RPR-1 — UI Reprocess always fails with 401.**
Do: open the happy-path email, click Reprocess Email, confirm the dialog.
BUG: toast "Couldn't reprocess this email. Try again." every single time. Confirm the cause: the same curl WITHOUT `-H "X-User-Id: ..."` → 401; with it → 200.
PASS: UI reprocess succeeds.

**B/REG-1 — every reprocess duplicates pages and doubles proposal boxes.**
Setup: happy-path email with a PDF. Baseline: `select source_type, extraction_status, count(*) from email_components where email_id='<id>' group by 1,2;`
Do: run the curl reprocess ONCE. Re-run the query and reload the email page.
BUG: `attachment_page` count doubled; pending region count doubled; the canvas shows two stacked copies of every proposal box. Bonus: POST the same `notify.json` from §0.1 a second time (simulated SNS redelivery) — pages duplicate again and pending boxes pile up with NO user action.
PASS: page count constant, one clean proposal set.

**B/REG-2 — multi-page PDFs put all regions on page 1.**
Setup: inject an email with a 3-page PDF that has real content on every page.
Do: `select location->>'page_index', count(*) from email_components where email_id='<id>' and source_type='region' group by 1;` and page through the PDF in the UI.
BUG: (nearly) every region has page_index 0; page 1 is a pile of misplaced boxes, pages 2-3 empty.
PASS: counts spread across 0,1,2 and boxes sit on the right pages.

**B/REG-3 — reprocess during an AI outage silently deletes all proposals.**
Setup: happy-path email with pending regions. Break Bedrock: edit `apps/email-listener/.env`, corrupt the AWS creds, restart the listener.
Do: curl reprocess. Check response and `select extraction_status, count(*) from email_components where email_id='<id>' and source_type='region' group by 1;`
BUG: HTTP 200 with a superseded count; all previously-pending regions now 'superseded', zero new pending rows; UI shows an empty overlay with no error. Restore your creds afterwards!
PASS: an error is surfaced and/or the old proposals survive.

**B/REG-4 — emails with >1000 component rows stop getting proposals.**
Setup: bloat a test email:
```sql
insert into email_components (id, email_id, importer_id, source_type, extraction_status, content_text)
select gen_random_uuid(), '<email id>', '<importer id>', 'region', 'superseded', 'junk ' || g
from generate_series(1,1100) g;
```
(Adjust columns if the insert complains — copy an existing row's shape.)
Do: curl reprocess; watch the listener log line `propose_regions_start`.
BUG: logged page_count is lower than the real page count (possibly 0) and few/no new pending regions appear.
PASS: page_count matches reality regardless of junk rows.

**B/REG-5 — confirming a stale region resurrects it.**
Setup: accept a region; note its id. Redraw it (drag its handles / redraw control) — this supersedes the original and creates a replacement.
Do: confirm the ORIGINAL id via API (simulates a stale second tab):
`curl -X POST http://127.0.0.1:8000/v1/components/<original-id>/confirm -H "X-API-Key: <key>" -H "Content-Type: application/json" -d '{}'`
BUG: 200; `select extraction_status from email_components where id='<original>';` → 'confirmed'; both old and new boxes render stacked in the UI.
PASS: the confirm is rejected (409/422) because the region is superseded.

**B/REG-6 — truncation log lies (log-only).**
Do: skim listener logs after ingesting a very dense page, or unit-test: feed the segmenter >32k chars of tokens with a stub client and look at the `segmentation_page_text_truncated` event.
BUG: `original_len` ≈ 31,9xx even though the input was e.g. 90,000 chars.
PASS: original_len shows the true pre-cut size.

**B/RPR-2 — reprocess with missing raw email destroys proposals.**
Setup: pick an email with pending regions. In Studio: `update emails set raw_storage_key = null where id='<id>';`
Do: curl reprocess.
BUG: HTTP 500, and `select count(*) from email_components where email_id='<id>' and extraction_status='pending' and source_type='region';` → 0 — the boxes were superseded BEFORE the failure and are gone from the canvas.
PASS: 4xx with a clear message and pending regions untouched.

**B/RPR-3 — reprocess resurrects rejects and twins confirms.**
Setup: on a curated email, confirm 1 region and reject 1 region.
Do: curl reprocess; reload the page.
BUG: the confirmed box has an identical pending twin stacked on it; the rejected content is back as a fresh pending box.
PASS: confirmed regions have no twins; rejections stick.

**B/RPR-4 — extraction records not superseded (DB-only check).**
Setup: run Autofill on an entity so extraction_records exist, then curl reprocess.
Do: `select er.status, ec.extraction_status from extraction_records er join email_components ec on ec.id=er.component_id where ec.email_id='<id>';`
BUG: records stay non-superseded while their components are 'superseded' — despite the dialog copy claiming otherwise.
PASS: records superseded together with their components.

### B-TYP: Entity types & corrections

**B/TYP-1 — AI overrides your "Clear role".**
Setup: on a classified, accepted region, open the Inspector and click Clear role. Verify: `select role, entity_type_id from email_components where id='<region>';` → role NULL (note the type id weirdly remains).
Do: curl reprocess the email.
BUG: role is back to 'entity' with an AI-chosen type — your explicit decision was overwritten.
PASS: the cleared region stays cleared.

**B/TYP-2 — corrections pointing at deactivated types poison classification.**
Setup: correct a region's type to 'receipt' via the Inspector picker (creates an entity_type_corrections row). Then deactivate the type: in /entity-types flip the Switch (importer-scoped) or in SQL: `update entity_types set is_active=false where slug='receipt';`
Do: inject a new receipt-like email; watch listener log `suggest_entity_types_done`.
BUG: `skipped_unknown_slug > 0` and the new region has `entity_type_id IS NULL` — the model was steered to a slug that no longer exists.
PASS: examples for inactive types aren't served; region gets a live type.

**B/TYP-3 — flip-flop corrections give the AI contradictory examples.**
Setup: on one region change type A→B, then B→A.
Do: `select corrected_entity_type_slug from entity_type_corrections where component_id='<id>';` then `select * from match_entity_type_corrections_by_trgm('<the region text>','<importer id>',3);`
BUG: both contradictory rows returned with equal similarity — both get fed to the model.
PASS: only the latest correction per component is served.

**B/TYP-4 — clearing a description doesn't stick.**
Do: in /entity-types select an importer-scoped type, delete its description text, click away, reload the page.
BUG: the old description reappears; `select description from entity_types where id='...';` still holds the old text. (Same for field descriptions.)
PASS: stays empty after reload; DB NULL.

**B/TYP-5 — half-applied suggestion is never healed (simulate).**
Setup: `update email_components set role='entity', entity_type_id=null where id='<an accepted region>';`
Do: curl reprocess; check the row again.
BUG: still role='entity' with NULL type — the suggest run skips it forever (it only looks at role IS NULL); autofill button won't appear for it. (You CAN fix it by picking a type manually — that's the workaround.)
PASS: suggestion revisits or flags it.

**B/TYP-6 — deleting a field silently unlinks in-review boxes.**
Setup: run Autofill so candidate field boxes exist; verify `select id from email_components where entity_type_field_id='<field id>' and extraction_status='candidate';`
Do: delete that field in the /entity-types admin (it will hard-delete because nothing is CONFIRMED yet).
BUG: toast just says "Field deleted"; those candidate rows now have `entity_type_field_id NULL`; on the email their property label/value vanished with no warning.
PASS: soft-deactivate or an explicit "N in-review mappings will be unlinked" warning.

**B/TYP-7 — Re-theme failure shows a success toast.**
Setup: break Bedrock creds (like B/REG-3), restart listener. Open the chat canvas, generate/open a panel.
Do: click the wand (Re-theme), type anything, Apply look.
BUG: toast "Panel re-themed", popover closes, panel looks identical, a duplicate version appears in the version picker. Listener log: `retheme_resolve_failed`. Restore creds after.
PASS: inline error banner, no version appended.

**B/TYP-8 — one bad override value kills a valid retheme.**
Do: `curl -X POST http://127.0.0.1:8000/v1/genui/retheme -H "X-API-Key: <key>" -H "Content-Type: application/json" -d '{"instruction":"use exactly hex #0f172a as the primary color","current_style_pack_id":"linear-clean"}'` (adjust body fields to the endpoint's schema if it 422s).
BUG: if the model emits a hex value, the listener returns it 200; the web boundary then rejects the WHOLE result → user sees "Couldn't apply that look" though the pack choice alone was valid.
PASS: bad values stripped server-side; pack-only apply succeeds.

### B-RES: Entity resolution & curation

Seed for this section: confirm two similarly-named entity regions (e.g. "Acme Corporation" and "ACME Corp") so /entities shows a duplicate **merge suggestion**.

**B/RES-1 (CRITICAL) — rejecting a merge suggestion never sticks.**
Do: on an entity detail page, click the ✗ on a merge suggestion. Wait a beat or reload.
BUG: the suggestion comes back, forever. DB proof: `select was_dismissed, was_selected, component_id from component_entity_candidate_links;` — no row ever has was_dismissed=true, and every component_id is an email_components id (the dismiss UPDATE targets entity ids that can't match).
PASS: dismissed suggestion stays gone across reloads.

**B/RES-2 — Unmerge does nothing.**
Setup: confirm a merge (B into A).
Do: on A's page click Unmerge, confirm.
BUG: you're navigated away, but `select id, is_active, merged_into from entity_instances;` shows B still inactive with merged_into=A; reopening A still shows the Unmerge button.
PASS: B is reactivated (is_active=true, merged_into NULL).

**B/RES-3 — mutual merge makes both entities disappear.**
Setup: after merging B into A, switch the /entities gallery status filter to 'candidate' — inactive B is still browsable and still lists A as a pending suggestion (thanks to RES-1).
Do: open B, confirm the suggestion toward A.
BUG: `select id, is_active, merged_into from entity_instances where id in ('<A>','<B>');` → both inactive, pointing at each other; neither appears in the default confirmed gallery. Also try self-merge by API: `curl -X POST http://127.0.0.1:8000/v1/entity-instances/<A>/merge/<A>/confirm -H "X-API-Key: <key>"` → 200 and A.merged_into=A.
PASS: self/cycle/inactive merges rejected with 4xx.

**B/RES-4 — backfill resurrects merged entities and wipes aliases.**
Setup: a confirmed merge exists (B inactive, A has alias).
Do: `curl -X POST http://127.0.0.1:8000/v1/entity-instances/backfill -H "X-API-Key: <key>" -H "Content-Type: application/json" -d '{"importer_id":"<importer id>"}'`
BUG: B has `is_active=true` again (with merged_into STILL set — contradictory state) and appears in the gallery next to A; aliases arrays reset to `[]` / `{}`.
PASS: backfill preserves merge state and aliases.

**B/RES-5 — confirming one entity writes its name as an alias on unrelated candidates.**
Do: confirm two similar-but-distinct entities in sequence, then `select display_name, aliases from entity_instances;`
BUG: the earlier entity now carries the later entity's display_name in its aliases — no merge was ever confirmed; from now on they'll keep suggesting each other.
PASS: aliases only appear after a human confirms a merge.

**B/RES-6 — AI outage stores zero-vector embeddings and garbage 'semantic' matches.**
Setup: break Bedrock creds; restart listener; confirm a region.
Do: `select embedding from email_components where id='<region>';` (all zeros?) and `curl http://127.0.0.1:8000/v1/entity-instances/<entity>/candidates -H "X-API-Key: <key>"`.
BUG: embedding is 1536 zeros; candidates include unrelated same-type entities labeled 'semantic'. Restore creds — note the zero vector STAYS until re-confirm.
PASS: no embedding stored on failure; candidates degrade to lexical-only.

**B/RES-7 — audit column stores the wrong score (DB-only).**
Do: after a promote with a near-identical duplicate around: `select similarity_score, match_type, was_selected from component_entity_candidate_links where was_selected=false;`
BUG: values ~0.016-0.033 regardless of how similar the pair is (that's the RRF rank score, not similarity).
PASS: values look like real 0-1 similarities.

**B/RES-8 — exact identifier matches never labeled 'identifier_exact'.**
Setup: two entities sharing an identical identifier value (e.g. same invoice_number in their identifiers).
Do: `curl http://127.0.0.1:8000/v1/entity-instances/<id>/candidates -H "X-API-Key: <key>"` and in SQL: `select similarity('{"po_number": "PO-1234"}', 'PO-1234');`
BUG: match_type is 'identifier_fuzzy' (or 'alias'); the SQL similarity is well below 1.0 — the ==1.0 branch is unreachable.
PASS: exact identifier hits labeled identifier_exact.

### B-KG: Knowledge graph

**B/KG-1 — Promote button always 409s.**
Setup: confirm a region in an email whose sender domain is NOT the default importer (any real ingest qualifies); open /knowledge.
Do: click a dashed INFERRED edge → Promote to confirmed.
BUG: toast "Couldn't promote — This suggestion can no longer be promoted." every time (tenant_mismatch 409 because the UI hardcodes the default importer id).
PASS: edge turns solid EXTRACTED.

**B/KG-2 — re-confirm kills a human-promoted edge.**
Setup: promote an INFERRED edge via API (works where the UI can't): `curl -X POST http://127.0.0.1:8000/v1/knowledge/edges/<edge-id>/promote -H "X-API-Key: <key>" -H "X-User-Id: <uuid>" -H "Content-Type: application/json" -d '{"importer_id":"<the edge's importer>"}'`. Verify tier: `select tier, is_active from knowledge_node_edges where id='<edge>';`
Do: re-confirm the source region (`curl .../v1/components/<A>/confirm ... -d '{}'`).
BUG: the promoted row is now `is_active=false` and a NEW INFERRED row exists for the same relation — your trust decision silently reverted.
PASS: promoted edges survive re-confirmation.

**B/KG-3 — the 'about' edge never exists after a normal confirm.**
Do: confirm a fresh entity region once, then: `select relation_type from knowledge_node_edges e join knowledge_nodes n on e.source_node_id=n.id where n.scope_ref_id='<component id>';`
BUG: only evidenced_by / co_occurs_with — no 'about' row even though the entity instance exists and candidate links were written milliseconds later.
PASS: an 'about' edge to the entity instance appears.

**B/KG-4 — suggestions point at regions you rejected.**
Setup: an email with entity regions A and B. Reject B in the UI, then confirm A.
Do: `select target_ref_id, tier, is_active from knowledge_node_edges where tier='INFERRED' and is_active;`
BUG: B's component id appears as a live suggestion target — "co-occurs with the thing you threw away".
PASS: rejected/superseded components are never suggestion targets.

**B/KG-5 — editing a confirmed region leaves a ghost knowledge node.**
Setup: confirm region R (verify `select id from knowledge_nodes where scope_ref_id='<R>';`).
Do: merge R with a neighboring region (allowed! no guard), confirm the replacement R'.
BUG: `select scope_ref_id, is_active from knowledge_nodes;` shows TWO active nodes for the same real-world region; /knowledge renders both; old EXTRACTED edges still target superseded R.
PASS: geometry edits deactivate (or are blocked for) confirmed regions' nodes.

**B/KG-6 — merging an entity makes its 'about' fact vanish from the graph.**
Setup: get an about-edge (per KG-3 this needs the workaround: confirm the region twice, then check). With the edge visible on /knowledge, confirm a merge of the linked entity into another.
Do: reload /knowledge; check DB: `select is_active, target_ref_id from knowledge_node_edges where target_ref_type='entity_instance';`
BUG: the edge row is still active but its target instance is inactive — it silently disappears from the graph (and reappears if you unmerge: whiplash).
PASS: edge repointed to the survivor.

**B/KG-7 — double-confirm degrades the knowledge node.**
Setup: confirm a region that has autofilled fields; note `select title, content from knowledge_nodes where scope_ref_id='<id>';` (title like 'invoice: INV-123').
Do: POST the same confirm again with empty body.
BUG: title collapses to bare 'invoice'; content loses the field lines; knowledge search stops matching 'INV-123'.
PASS: re-confirm preserves or enriches the node.

**B/KG-8 — knowledge vector search is dead (DB-only).**
Do: after confirming several regions: `select count(*) from knowledge_nodes where embedding is not null;`
BUG: 0. Then ask chat's search_knowledge with a paraphrase of a node title (semantically close, lexically different) — zero hits, while a near-verbatim query hits. Every search still pays a Bedrock embed call.
PASS: embeddings populated; paraphrases match.

**B/KG-9 — confirming a picture-only region silently produces no knowledge.**
Do: draw a region over a logo/stamp area (no text), confirm it before autofill runs. Watch listener log; check `select count(*) from knowledge_nodes where scope_ref_id='<id>';`
BUG: log shows `confirm_region_synthesis_failed` (NOT NULL violation on content); count 0; confirm itself reported success.
PASS: a node with fallback content is created.

### B-UI: Web UI honesty

**B/UI-1 — the deny-Undo toast is fake.**
Do: run Autofill; click ✗ on a field box; click **Undo** in the toast within 3 seconds. Watch the box and the Network tab.
BUG: box flickers back then vanishes after the refetch; NO restore request was ever sent; DB status stays 'rejected'; and running Autofill again never re-proposes that box (`content_raw->'denied_field_polygons'` on the parent now contains its polygon).
PASS: Undo actually restores the box server-side.

**B/UI-2 — your typed correction is thrown away on Confirm Field.**
Do: select an autofilled field box; in the Inspector edit the "Candidate value" text (change a digit); click Confirm Field. Watch the Network tab.
BUG: the confirm POST carries `corrected_fields: null`; after refetch the OLD machine value shows with the Confirmed badge; `select corrected_fields, extracted_fields from extraction_records where component_id='<id>';` → corrected NULL.
PASS: your edited value is what gets confirmed.

**B/UI-3 — Unconfirm Field visibly reverts itself.**
Do: confirm a field, then click Unconfirm Field, watching the status badge and Network tab.
BUG: badge flips to 'candidate' then snaps back to 'confirmed' after the automatic refetch; no mutation request was sent at all.
PASS: a real server call demotes the field.

**B/UI-4 — inbox Load More dies after one click.**
Setup: you need >100 threads (bulk-insert dummy emails with distinct thread ids via SQL if needed).
Do: click Load more once.
BUG: 50 more rows appear, then the button disappears even though more exist (verify server-side: the listThreads call at offset 100 still returns items).
PASS: button persists until the list is truly exhausted.

**B/UI-5 — broken attachment = infinite skeleton.**
Setup: `update email_attachments set storage_key='nonexistent/key' where id='<pdf id>';`
Do: reload /emails/[id].
BUG: canvas area shimmers forever; Network tab shows the failed /api/attachments/{id}; no message, no retry.
PASS: inline error with a Retry button.

**B/UI-6 — Unread filter filters nothing.**
Do: in the inbox click a few emails, then toggle All ↔ Unread.
BUG: list and count are byte-identical in both; Unread is highlighted but does nothing (no read-state exists).
PASS: option removed/disabled, or actually filtering.

**B/UI-7 — entity-summary failure shows a false "Nothing extracted yet".**
Setup: simulate the failure — temporarily add `throw new Error('boom')` at the top of the entitySummary procedure (`packages/api-client/src/router/emails/entity-summary.ts`), let the dev server reload.
Do: open the inbox; switch to With entities.
BUG: inbox renders fine but chip-less; With entities says "Nothing extracted yet — entities will show up as mail arrives." — an affirmative lie; the failed request is visible in the Network tab. Revert the throw.
PASS: an inline "couldn't load — refresh" note.

**B/UI-8 — every autofill error claims "model access is pending".**
Setup: stop the listener process (Ctrl-C in its terminal).
Do: on /emails/[id] click Autofill Fields.
BUG: toast "Autofill isn't available yet — model access is pending." while the Network tab shows a connection error/500 — wrong and unactionable. Restart the listener after.
PASS: error message reflects the real cause.

---

## C. Recurring 10-minute smoke checklist

Run after any pipeline change. Assumes stack is up (§0) and you have a saved 2-page-PDF `.eml` + `notify.json` from earlier sessions.

1. **[1 min] Inject the standard test email** (§0.1, fresh messageId). Listener logs `email_received` with no `email_ingest_error`.
2. **[1 min] DB triple-check** (Studio, one query each): emails row exists; attachment `size_bytes > 0`; components: pages = PDF page count, pending regions > 0. *(Guards ING-1/3/5/7, PDF-1, REG-1.)*
3. **[1 min] Inbox**: new email visible at http://localhost:3000; entity chips render; All vs With-entities behave differently. *(UI-6/7.)*
4. **[2 min] Email detail**: PDF renders (no eternal skeleton — UI-5); boxes on the correct pages (REG-2); accept one region; confirm one entity region; no error toasts.
5. **[1 min] Correction honesty**: edit a candidate value → Confirm Field → check the Network payload contains your value (UI-2, post-fix); deny one field → if the toast offers Undo, click it and verify it truly restores (UI-1, post-fix).
6. **[1 min] Entities**: /entities shows the confirmed entity; reject a merge suggestion, reload — it must STAY gone (RES-1); if you merged anything, Unmerge and verify in DB (RES-2).
7. **[1 min] Knowledge**: /knowledge renders nodes; `select count(*) from knowledge_nodes where content is null;` → 0; promote one INFERRED edge — must succeed (KG-1, post-fix).
8. **[1 min] Reprocess round-trip**: click UI Reprocess (RPR-1, post-fix) or curl it; page/region counts in the DB must NOT double (REG-1, post-fix); rejected regions must not resurrect (RPR-3, post-fix).
9. **[<1 min] Redelivery**: POST the same notify.json a second time; component counts unchanged (REG-1, post-fix).
10. **[<1 min] Log sweep**: skim listener output for `email_ingest_error`, `attachment_parse_failed`, `propose_regions_failed`, `suggest_entity_types_failed`, `retheme_resolve_failed`, `segmentation_all_retries_exhausted` — any hit means a silent failure just happened; chase it in the DB, not the terminal.

Until the fixes land, expect steps 5-9 to show the documented BUG outcomes — the checklist doubles as the regression gate for the fix work.
