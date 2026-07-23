# Polytoken — Specified-but-Not-Built Handoff (gap analysis)

_Generated 2026-07-23. Merges 5 dimension scans (session requests, feature-catalog, roadmap/milestones, security audit, in-code TODOs) into one de-duplicated, complexity-graded list. BUILT items from this session (body extraction, de-maritime seed/data, email-thread chat context, CirclePack mobile fix, Unread-tab removal, RLS 0048, W0-W6 prod deploy) are excluded. Spot-verified: attachment signed-URL has no `download` option; `_find_entity_page` returns `None` when `attachment_id is None`; maritime tooltip at pdf-preview-pane.tsx:624; `entity_merge_confirm` stub live; DEPLOY.md is design-only; `vault_file` unresolved in listener._

## Counts by complexity
| Bucket | Count |
|---|---|
| trivial | 4 |
| small | 13 |
| medium | 23 |
| large | 8 |
| epic | 3 |
| **total** | **51** |

## Top 5 highest-leverage
1. **Attachment signed-URL forced-download** — one-line fix closes a stored-XSS / session-theft vector on every html/svg email attachment.
2. **Three listener IDOR endpoints** (genui history, entity candidates, component autofill) — one `require_user_id` + ownership sweep closes all three cross-tenant reads.
3. **Recover attachment extraction for the 26 backfilled emails** — the ~13 invoice/receipt PDFs (highest-value docs) yield ZERO entities today; pipeline already supports it, needs a real-MIME source + re-POST.
4. **Body-entity field autofill** — `_find_entity_page` returns `None` for every body entity, so body extraction produces bare regions the user must fill by hand.
5. **Harden the listener trust boundary** — public plaintext-HTTP ALB + spoofable `X-User-Id` gated only by one shared static key = full cross-tenant mail disclosure.

---

## Trivial

### 1. Stored-XSS: attachment signed URLs omit forced-download disposition · security · not-built
`apps/web/src/app/api/attachments/[id]/route.ts:132` — `createSignedUrl(storageKey, 3600)` has no options; Supabase serves attachments with their stored content-type, so `text/html`/`image/svg+xml` render inline and execute script in the signed-URL origin. **Next:** change to `createSignedUrl(storageKey, 3600, { download: true })` (or a sanitized filename) + regression test.

### 2. Residual maritime copy in user-facing UI · design-system · partial
`pdf-preview-pane.tsx:624` ("4-page bill of lading"), `documents/_lib/report-document.ts:131,148` ("invoiced freight"/"shipments cleared"), `forwarding-address-card.tsx:109` (link to `nauta.services.email-listener`). **Next:** swap the three example strings + update the runbook link.

### 3. I3 — Extend SES forwarding to agent@ addresses · deploy-infra · not-built
`COVERAGE-MATRIX.md:24` — optional extra SES receipt rules (one Terraform rule + Lambda env). **Next:** add the rule if agent addressing is wanted; optional.

### 4. GenUI eval runner skips token-driven contrast check · code-limitation · partial
`apps/email-listener/scripts/genui_eval/run_eval.py:160` skips the contrast rubric. **Next:** feed token context in and enable the check.

---

## Small

### 5. IDOR: three listener GET endpoints lack user identity + ownership checks · security · not-built
`genui.py:256`, `entity_instances.py:80`, `components.py:189,516` apply only `require_api_key`. Any valid key + guessed uuid returns another tenant's `spec_json`, resolution candidates, or extracted field values (autofill also burns their LLM spend). **Next:** add `Depends(require_user_id)` + owner-of-resource assertion (reuse merge_regions' T-06-03 guard) to all four handlers + fail-closed tests.

### 6. Listener backfill/reprocess write endpoints authed only by forwarding-token · security · partial
`backfill_reprocess.py:60-64`, `backfill_email.py:75` — gated only on recipient→forwarding-token resolution; anyone who learns the forwarding address can POST arbitrary MIME as the owner or trigger reprocess (pending task #13). **Next:** add a required shared-secret/HMAC header on both write endpoints.

### 7. 'With entities' inbox tab — verify body entities are typed · feature-catalog · built-verify
`entity-summary.ts:279-323` requires non-null `entity_type_id`; untyped body regions silently drop an email. **Next:** SQL count `role='entity' AND entity_type_id NOT NULL` grouped by email over the 26 emails.

### 8. KN-01 — Unified promotion inbox · feature-catalog · built-verify
`FEATURE-CATALOG.md:434` — promote endpoints exist but no consolidated queue component found. **Next:** confirm absence, then build one queue view over the two promote endpoints.

### 9. Spreadsheet chat-loop `table.create` invocation not wired · code-limitation · partial
`GRAND-COMPLETION-REPORT.md:40` — capability defined, chat loop never invokes it. **Next:** register `table.create` as a chat-tool executor.

### 10. Canvas bulk connect / align — wiring deferred · code-limitation · partial
`GRAND-COMPLETION-REPORT.md:40` — no `bulkConnect`/`alignSelected`. **Next:** add multi-select bulk ops on the existing per-node verbs.

### 11. `genui_retrieval_provider` `style_pack_id` accepted but unused · code-limitation · partial
`genui_retrieval_provider.py:275` — reserved for FLY adapter (D-10). **Next:** wire it through to the FLY render path.

### 12. REG-01/02 verify: registry as single tool source · roadmap-wave · built-verify
`REQUIREMENTS.md:32` — Phase 68 has no PLAN/VERIFICATION. **Next:** run REG-02 grep-proof for a residual parallel tool list, record verification, tick.

### 13. REG-04 verify: genui spec binds a registry capability · roadmap-wave · built-verify
`REQUIREMENTS.md:35` — Phase 71 unverified. **Next:** run the bound-panel query+mutation demo + unregistered-fails-closed test, record, tick.

### 14. RSRCH-05 verify: research fixed-question rubric re-runnable · roadmap-wave · built-verify
`REQUIREMENTS.md:43` — Phase 72 has no PLAN/VERIFICATION. **Next:** confirm the rubric runs and gates in CI, record, tick.

### 15. LIVE-03: Google OAuth on the deployed app (user-only) · deploy-infra · deferred-by-user
`v1.9-REQUIREMENTS.md:36` — console config + one live sign-in remain. **Next:** user completes MORNING-CHECKLIST §A; no dev work.

### 16. LIVE-04: real email via the SES forwarding path (user-only) · deploy-infra · deferred-by-user
`v1.9-REQUIREMENTS.md:37` — backfill (26 emails) proved ingestion but not the SES transport; blocked also by AWS SES prod-access. **Next:** user runs §B.3-6 once prod-access granted.

### 17. CLUS-07: six-leg cluster scenario proven live (user-only) · session-request · deferred-by-user
`v1.9-REQUIREMENTS.md:72` — blocked on LIVE-03/04. **Next:** after OAuth + forwarding, run §A→§B.3-6→§H.4.

---

## Medium

### 18. Attachment extraction never ran for the 26 backfilled emails (~13 PDFs dropped) · data-recovery · partial
`backfill_inbound_email.py:61`, `ingest_inbound_email.py:238` — the Gmail-MCP MIME carried no attachment bytes, so `parsed.attachments` was empty; invoice/receipt PDFs contribute nothing. Store is upsert + idempotent re-key. **Next:** source full raw MIME (Gmail API `format=raw`) for the ~13 emails, re-POST `/v1/emails/backfill` with the same id, verify attachment entities.

### 19. Body-derived entities never get field-level autofill · code-limitation · partial
`autofill_fields.py:498-509,415-418` — `_find_entity_page()` returns `None` when `attachment_id is None` (every body entity; ingest sets it at `ingest_inbound_email.py:455`), so `_detect_field_boxes` returns `[]`. Body tokens live in the `email_body` component's `content_raw.tokens`. **Next:** add an email-body page-analog branch reading those tokens as the interior-token source + test.

### 20. ST-01 — Settings shell + panes (models & cost, storage, capabilities) · feature-catalog · partial
`FEATURE-CATALOG.md:402` — only forwarding + desktops pages; no shell, no models/cost/storage/permissions panes. **Next:** build one settings shell + three panes over existing data.

### 21. ST-02 — BYOK provider keys · feature-catalog · not-built
`FEATURE-CATALOG.md:412` — no key UI, no encrypted schema; blocks multi-user. **Next:** encrypted key storage + settings pane (needs ST-01) + provider plumbing.

### 22. DX-01 — `inference.run` capability + daemon-local locus · feature-catalog · not-built
`FEATURE-CATALOG.md:447` — no inference capability; execution_locus seam unwired. **Next:** define `inference.run` mirroring desktop.ts's provider port + daemon-local locus.

### 23. DX-04 — Desktop as an agent tool · feature-catalog · not-built
`FEATURE-CATALOG.md:473` — blocked on DX-03. **Next:** capability composition once DX-03 lands.

### 24. CV-05 — Cross-conversation canvas ghost nodes · feature-catalog · not-built
`FEATURE-CATALOG.md:136` — no cross-canvas read-only reference node. **Next:** new node kind + cross-layout reference resolution (Tier-3).

### 25. CH-04 — Voice input / dictation on composer · feature-catalog · not-built
`FEATURE-CATALOG.md:299` — no SpeechRecognition/Whisper. **Next:** composer dictation via browser API or daemon Whisper (Tier-3).

### 26. W2 — Agentic per-subfolder leaf visualization · feature-catalog · partial
`COVERAGE-MATRIX.md:80` — leaf slot is a static hook, not content-profile-driven. **Next:** agent capability that profiles folder content and picks/generates a leaf viz.

### 27. REG-03 verify: daemon permission model resolves by registry id (one store) · roadmap-wave · partial
`REQUIREMENTS.md:34` — daemon tools 'declared' not chat-loop-'live'; INV-2/INV-4 unproven. **Next:** reconcile daemon registry to `@polytoken/capabilities` + adversarial fail-closed test.

### 28. DOCS-01/02/03 verify: PDF export, first-class documents, regenerable-from-spec · roadmap-wave · built-verify
`REQUIREMENTS.md:47` — Phase 70 has no PLAN/VERIFICATION. **Next:** verify export fidelity + object lifecycle + regeneration provenance.

### 29. MAIL-01/02 verify: in-inbox suggest-only matcher as registry capabilities · roadmap-wave · built-verify
`REQUIREMENTS.md:53` — STATE.md lists 'mail-rule actions into the email path' still-to-wire. **Next:** wire into the email path, verify in-inbox suggest-only placement + registry execution.

### 30. SURF-03: /knowledge canvas redesign on locked identity · design-system · not-built
`REQUIREMENTS.md:99` — Phase 62 never executed; pixel-gated on Pedro. **Next:** full surface-redesign phase + human pixel gate.

### 31. SURF-06: production-grade empty/loading/error states · design-system · partial
`REQUIREMENTS.md:102` — states pass never ran across surfaces. **Next:** per-surface state matrix after SURF-03/05 land.

### 32. RCNV-02 verify: auto-collected sources as canvas nodes · roadmap-wave · partial
`REQUIREMENTS.md:108` — W3 source node may satisfy it but Phase 63 unbuilt/unverified. **Next:** reconcile against RCNV-02's user-observable bar + pixel review.

### 33. RCNV-05: presentation-grade panels grounded in selected canon · roadmap-wave · partial
`REQUIREMENTS.md:111` — depends on unbuilt RCNV-03. **Next:** source-grounded generation path + identity styling after RCNV-03.

### 34. `entity_merge_confirm` chat action is a registered-but-unsupported stub · code-limitation · partial
`confirm_action_dispatch.py:188` — always returns `{status: unsupported}`; pair-keyed candidates can't be addressed by a single `suggestionRef.id` (40-CONTEXT forbade a surrogate). **Next:** design a surrogate addressing scheme, then a real handler calling ConfirmMergeUseCase.

### 35. W5 sharing coded but never activated for conversation/entity/file · security · partial
`GRAND-COMPLETION-REPORT.md:41`, `access-control.ts:282` — only documents use `assertCanAccess`; others owner-only; `file` share type fails closed. **Next:** swap owner-only asserts to `assertCanAccess` + implement file owner-resolution.

### 36. TM-04 entity-scoped table/landscape filtering — wiring deferred · code-limitation · partial
`GRAND-COMPLETION-REPORT.md:40` — scope ref accepted, nothing filters on it. **Next:** wire the scope ref to the query/filter layer.

### 37. HM-01 home board agentic rearrange — storage seam only · code-limitation · partial
`home-board.tsx:27` — `home.panels` sharedState persists but no agent-driven rearrange. **Next:** build rearrange writes (needs CH-03 for scheduled refresh).

### 38. Citation-faithfulness LLM-judge rubric is a stub · code-limitation · partial
`citation-scorer.ts:65` — semantic half not wired to a live-model runner; only structural check gated. **Next:** build the live-model judge runner + CI gate.

### 39. GenUI eval LLM-judge half is a stub · code-limitation · partial
`EVAL-DIMENSIONS.README.md:89` — semantic judgment not wired to a model. **Next:** wire a live LLM-judge runner into the harness.

### 40. Terraform naming drift (nauta-services-*) + SES prod-access unresolved · deploy-infra · partial
`GRAND-COMPLETION-REPORT.md:44` — legacy resource names + SES sandbox pending. **Next:** rename with careful state migration + request SES production access.

---

## Large

### 41. CRITICAL: listener behind public plaintext-HTTP ALB, trusts spoofable X-User-Id · security · not-built
`alb.tf:36-47`, `user_context.py:33` — internet-facing ALB, port 80 HTTP only (no ACM/443/redirect); one static `api_key`; `require_user_id` reads an unverified header. Anyone with/sniffing the key impersonates any uuid → full cross-tenant mail disclosure. **Next:** ACM cert + 443 listener + 80→443 redirect + BFF-only ingress SG (small terraform), then replace static-key+X-User-Id with BFF-minted per-user signed tokens verified at every call site + key rotation.

### 42. DR-05 — Content extraction + embedding for vault files · feature-catalog · not-built
`FEATURE-CATALOG.md:331`, `GRAND-COMPLETION-REPORT.md:39` — write seam complete but `rg -c vault_file` in the listener returns zero; attaching a vault file reads nothing; omnibox can't search file contents. **Next:** vault extraction path (bytes→text→quarantined block) + halfvec store + `linked_context` vault_file builder + `run_chat_turn` wiring + omnibox search.

### 43. CH-03 — Scheduled/recurring agent runs ('routines') · feature-catalog · not-built
`FEATURE-CATALOG.md:293` — no cron/scheduler/runs table; daily triage/morning brief can't fire on a schedule. Gates HM-01 and DR-06. **Next:** durable job runner + runs schedule table + result delivery as chat turns/canvas mutations.

### 44. SURF-05: /studio, /settings/*, /login redesigned on locked identity · design-system · not-built
`REQUIREMENTS.md:101` — Phase 62 unbuilt; login is still first-draft. **Next:** redesign the three+ surfaces via plan→design→human-pixel-gate.

### 45. RSRCH-01/02/03/04 verify: deep research loop, 3-tier citations, auto-ledger, refine · roadmap-wave · built-verify
`REQUIREMENTS.md:39` — Phase 69 has no PLAN/VERIFICATION; RSRCH-03 canvas half blocked on Phase 63. **Next:** multi-criterion GSD verification; sequence RSRCH-03 after RCNV-02.

### 46. RCNV-03: canvas-level canon curation UX · roadmap-wave · not-built
`REQUIREMENTS.md:109` — Phase 63 unbuilt; no multi-select 'add to canon'. **Next:** build the canvas curation interaction on the Phase-56 seam + pixel gate.

### 47. DR-06 — Daemon-synced folders ↔ vault backup · feature-catalog · not-built
`FEATURE-CATALOG.md:336` — no scheduled backup chain; depends on CH-03. **Next:** scheduled daemon fs.read→requestUpload with dedupe/integrity/versioned import.

### 48. S1 — OneDrive ~500GB migration mechanics · feature-catalog · not-built
`COVERAGE-MATRIX.md:81` — no bulk-import/dedupe/resume mechanics or design doc. **Next:** write the migration design doc, then a resumable content-addressed importer.

---

## Epic

### 49. Production-grade deploy pipeline documented but not implemented · deploy-infra · deferred-by-user
`docs/DEPLOY.md:1-7,55-57` (confirmed DESIGN/NOT-IMPLEMENTED). Missing: CI migration-marker guardrail + DB-first release orchestration across Vercel/ECS/Supabase. **Next:** only when launch-ready, build the guardrail + orchestration and retire the manual runbook.

### 50. DX-03 — Live remote-desktop node: provider binding + sandboxed iframe · feature-catalog · deferred-by-user
`FEATURE-CATALOG.md:464`, `GRAND-COMPLETION-REPORT.md:43` — built fail-closed to the provider; "no iframe mounted yet"; ticker reads agent-writable `node.data.status`. **Next (billing-gated):** Hetzner binding, stream tokens, §4.2-sandboxed iframe, concurrency, swap ticker to server `session.status`.

### 51. DX-02 — Distributed inference: peer pooling + credits · roadmap-wave · deferred-by-user
`FEATURE-CATALOG.md:455`, `GRAND-COMPLETION-REPORT.md:42` — only Phase 0 device-recommendation badge shipped; Phases 1-3 unbuilt (Phase 3 DO-NOT-BUILD/venture-gated). **Next:** do not schedule before the venture gate; then DX-01 first, then pooled-locus + credits/accounting.

---

## Supplement — in-code stub sweep (the 6th scanner errored; this replaces it)

A ripgrep sweep for `TODO|FIXME|not implemented|stub|NotImplementedError|"once … lands"` across `apps/` + `packages/` (excluding tests) found **349 markers**, almost all benign — test fixtures, tailwind-config stubs, redo-stack fields, and cross-phase "once X lands" notes already tracked elsewhere. The materially **specified-but-unbuilt** stubs not already listed above:

- **`entity_merge_confirm` confirm-action handler is an unsupported stub** — `apps/email-listener/app/application/use_cases/confirm_action_dispatch.py:158` (`UnsupportedConfirmActionHandler`, the 40-CONTEXT.md pair-keyed blocker). Confirming an entity merge from a chat/confirm action is registered but no-ops. *(medium)*
- **Daemon rejects unimplemented frame types** — `apps/daemon/src/server/router.ts:77` (`"<type>" is not implemented by this daemon yet`). Parts of the daemon wire protocol are stubbed. *(medium — scope depends on which frames)*
- **Cross-phase "once it lands" seams** — `home-board.tsx:27` (CH-03 rearrange half), `use-conversation-controller.ts:557` (version retirement), `composer-attachments.tsx:22` (listener resolver — now landed). These are tracked by their FEATURE-CATALOG ids above.

The other ~345 markers are not product gaps.
