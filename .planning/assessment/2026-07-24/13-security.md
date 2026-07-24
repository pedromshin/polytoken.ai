# Security Assessment — auth, authz, tenancy, secrets, boundaries, deps

Branch `claude/polytoken-email-infra-cont-qi9q5g` · 2026-07-24 · read-only recon.
Every claim cites `file:line`. Ranked by exploitability × blast radius.

## Bottom line

The **application-layer tenancy model is genuinely strong** — one central ownership
chokepoint, fail-closed, exhaustively tested, and mirrored on both the tRPC and
FastAPI sides. The exposure is almost entirely at the **network/infra trust
boundary**, where the code's stated assumptions are contradicted by the committed
Terraform. Two issues are live-production exploitable today: an **unauthenticated,
signature-unverified SNS ingress that is an SSRF primitive**, and a **plaintext,
internet-open ALB in front of a service whose entire cross-tenant safety rests on a
single shared API key + a spoofable `X-User-Id` header**. Fix those two and the
system is in good shape.

---

## What is solid (so the plan doesn't regress it)

- **One ownership chokepoint, fail-closed.** `packages/db/src/ownership.ts` is the
  single `assert*Ownership` module; every function returns the same `OwnershipError`
  for "missing" and "not yours" — no existence oracle (`ownership.ts:59-69`,
  `:104`, `:126`). All queries are parameterized Drizzle `eq(...)` builders, zero
  string interpolation.
- **Identity is never client-derived.** `protectedProcedure` throws `UNAUTHORIZED`
  when `ctx.user` is null and narrows it for every resolver
  (`packages/api-client/src/trpc.ts:93-103`); the acting id comes only from
  `supabase.auth.getUser()` in the route handler
  (`apps/web/src/app/api/trpc/[trpc]/route.ts:8-17`) — verified server-side, never
  `getSession()` (an unverified cookie parse).
- **The IDOR that existed was closed.** The attachment download proxy validates the
  UUID, requires `getUser()`, and gates on `assertImporterOwnership` before minting
  a signed URL, mapping `OwnershipError`→404
  (`apps/web/src/app/api/attachments/[id]/route.ts:35-130`). It also forces
  `download:true` on the signed URL (`:146`) to kill stored-XSS-via-attachment.
- **Cross-tenant coverage is real, not aspirational.** An adversarial suite drives
  the *whole* `appRouter` with two users
  (`packages/api-client/src/router/__tests__/cross-tenant-adversarial.test.ts`) and
  the FastAPI side has its own (`tests/adversarial/test_cross_tenant.py`, referenced
  at `cross-tenant-adversarial.test.ts:27`).
- **Defense-in-depth on the DB.** RLS is enabled RESTRICTIVE deny-all on the
  phase-4 tables (`packages/db/migrations/0001_rls_deny_all.sql:8-63`) and re-applied
  in later migrations — the app connects as a role the policies don't exempt, so a
  logic bug in app-scoping does not automatically become a data leak.
- **Untrusted HTML is sanitized.** Email bodies render through
  `DOMPurify.sanitize` after hydration
  (`apps/web/src/components/email-preview/body-view.tsx:86,143-144`); the GenUI
  spec-renderer forbids `eval`/`Function`/`dangerouslySetInnerHTML`
  (`packages/genui/src/renderer/spec-renderer.tsx:13`); generated code-islands run in
  an opaque-origin `sandbox="allow-scripts"` iframe with an inline CSP and **no**
  `allow-same-origin` (`packages/genui/src/sandbox/build-island-srcdoc.ts:5-17`,
  `validate-island-code.ts:5-8`).
- **Secrets are injected correctly at the infra layer.** ECS pulls `API_KEY` and
  `SUPABASE_SECRET_KEY` via Secrets Manager `valueFrom` (`infrastructure/aws/ecs.tf:61-66`),
  AWS access is via a **task role** not static keys (`ecs.tf:35`, `iam.tf:52,82`),
  and `EMAIL_LISTENER_API_KEY` is read only server-side, never `NEXT_PUBLIC_`
  (`packages/api-client/src/router/_listener-config.ts:22-30`). No live `AKIA…`
  key is committed — the one match in `.planning/prompts/2026-07-22-vision-and-handoff.md`
  is a `[REDACTED]` placeholder.

---

## Findings (ranked)

### S1 — SNS ingress is unauthenticated AND signature-unverified → blind SSRF + notification forgery `[HIGH]`
`apps/email-listener/app/presentation/api/v1/sns_inbound.py:23-67`,
`app/infrastructure/sns/confirmation.py:11-16`

`POST /v1/emails/inbound-sns` has **no auth by design** (SNS can't send headers,
`sns_inbound.py:4,25`) and **performs zero SNS signature verification** — no
`SigningCertURL`/`Signature`/x509 check anywhere in the tree (grep for
`SigningCert|x509|verify.*sns` returns nothing but comments). Two consequences:

1. **SSRF (the clean, exploitable one).** A `SubscriptionConfirmation` message is
   trusted blindly: the handler reads `payload["SubscribeURL"]` and
   `confirm_subscription` issues an unvalidated `httpx.GET` to it
   (`sns_inbound.py:35-38`, `confirmation.py:13-15`). There is **no host allowlist**
   (no `sns.*.amazonaws.com` check). Any internet caller can POST
   `{"Type":"SubscriptionConfirmation","SubscribeURL":"http://169.254.169.254/…"}`
   and the ECS task will GET it — blind SSRF against instance metadata / internal
   VPC services from a host holding a Bedrock task role.
2. **Notification forgery.** A forged `Type:"Notification"` is parsed and ingested
   (`sns_inbound.py:40-64`). `recipients` is taken straight from the attacker
   payload (`ses_parser.py:25-26`) and drives forwarding-token→user resolution
   (`ingest_inbound_email.py:177-182`). Content still comes from an S3 fetch keyed
   by `messageId` (`ingest_inbound_email.py:170`), so injecting *arbitrary* content
   needs a known S3 key (messageIds are opaque/unguessable — mitigates worst case),
   but the ingress trusts an unauthenticated party to name whose importer an
   existing raw object lands in.

**Fix:** verify the SNS message signature (cert host pinned to `sns.<region>.amazonaws.com`,
signature over the documented canonical string) before acting on *any* type; and
allowlist `SubscribeURL` host to the SNS domain before the GET. This is the single
highest-value change.

### S2 — Public plaintext ALB makes the "server-to-server only" trust model false `[HIGH]`
`infrastructure/aws/network.tf:55-68`, `infrastructure/aws/alb.tf:36-43`,
`app/presentation/middleware/user_context.py:3-13`

The `X-User-Id` design is explicitly documented as safe *because* "FastAPI is
reachable only server-to-server through the authenticated BFF"
(`user_context.py:3-6`). The committed infra contradicts this:
- The ALB security group allows `0.0.0.0/0` on ports 80 and 443
  (`network.tf:55-68`) — no restriction to the web app's egress.
- The **production** listener is **plaintext HTTP:80** forwarding to the service
  target group (`alb.tf:36-43`); there is no `aws_lb_listener` on 443 for production
  (only the SG *permits* 443). So `X-API-Key` and `X-User-Id` transit unencrypted if
  `EMAIL_LISTENER_URL` is `http://…`.

Because `require_user_id` only checks header *presence* and trusts the value
verbatim (`user_context.py:34-46`), **anyone who holds `API_KEY` can set any
`X-User-Id` and act as any user** across `/v1/chat/*`, `/v1/knowledge/edges/*`,
`/v1/emails/*`. `API_KEY` is thus a god-key with full cross-tenant impersonation,
and it rides plaintext on a public listener. Ownership guards downstream
(`chat_stream.py:85-86`, `promote_edge` guard) protect against a *wrong* user id,
not against a caller who simply asserts the *right* one.

**Fix (any of, ideally all):** put the ALB in front only of the BFF's egress
(SG source = NAT/Vercel range or a VPC link / private ALB), terminate TLS with an
ACM cert and drop the :80 forward, and add a second shared secret or mTLS so
`API_KEY` alone isn't sufficient. At minimum, get production off plaintext :80.

### S3 — `API_KEY` empty-in-dev bypass is a fail-open footgun if `ENVIRONMENT` is mis-set `[MEDIUM]`
`apps/email-listener/app/presentation/middleware/auth.py:16-27`,
`app/settings.py` (Environment enum)

`require_api_key` returns (auth OFF) when `expected` is empty **and**
`ENVIRONMENT is DEVELOPMENT` (`auth.py:20-22`). Non-dev with empty key fails closed
(503, `:23`) — good. But the *entire* API-key gate collapses to a single env-var
comparison: an ECS task that boots with `ENVIRONMENT=development` (misconfig,
copy-pasted task def, or a staging box mislabeled) plus an unset `API_KEY` serves
every authenticated endpoint with **no auth at all**. Combined with S2's public
ALB this is a full open door. The comparison itself is correct
(`secrets.compare_digest`, `:26`). Risk is the fail-open *mode existing at all* on a
publicly reachable service.

**Fix:** make "empty API_KEY" fail closed in *all* environments; gate the dev
bypass on an explicit separate flag (e.g. `AUTH_DISABLED=true`) that can never be
the production default.

### S4 — Rotate the IAM/access credentials that were pasted into session prompts `[MEDIUM — process]`
Landmine 3 (task brief); repo itself is clean (`ecs.tf:35`, `iam.tf:52` use task roles).

No live secret is committed (only a `[REDACTED]` placeholder in
`.planning/prompts/2026-07-22-vision-and-handoff.md:81`). But the brief states IAM
access keys have been pasted into prompts across sessions. Those are out of band
and must be **rotated regardless of the clean repo** — assume compromised. The
correct end-state is already visible in Terraform (task role for Bedrock/S3, no
static keys), so the action is: rotate/disable any long-lived IAM user access keys,
confirm no human-user keys are still active, and move any remaining
developer-machine flows to short-lived STS.

### S5 — SNS/SES ingest swallows every error into HTTP 200 — a monitoring blind spot, not a leak `[LOW]`
`sns_inbound.py:29-64`, `ingest_inbound_email.py:230-309`

Returning 200 on malformed JSON, parse failure, and ingest failure is correct for
SNS retry-storm avoidance, but it means a systematic ingestion outage (bad DI, S3
perms, DB down) is invisible at the transport layer and surfaces only in structlog
`logger.exception` lines. There is no dead-letter/alert path in the committed code.
Security-adjacent because it also masks a probing attacker generating parse errors.
**Fix:** emit a metric / DLQ on the swallowed-exception branches so silent failure
is observable.

### S6 — Terraform SES drift: a broad `apply` can drop Pedro's mail-forward rule `[MEDIUM — operational hazard]`
`infrastructure/aws/ses-forwarder.tf:8-14`, `ses.tf:186-201`

`ses-forwarder.tf` carries the personal-forward Lambda + receipt rule but with the
banner "ALL resources below already exist. Import them (IMPORT-RUNBOOK.md) before"
(`ses-forwarder.tf:14`) — i.e. created out of band, **not yet reconciled into
state**. The receipt-rule chain ordering
(`personal_forward` slotted between `agent-prod` and the catch-all,
`ses.tf:186-201`) is fragile: a `terraform apply` run before the import
re-orders/recreates the rule set and can **drop the rule that forwards Pedro's
mail** → silent mail outage. This is the drift landmine, not tidiness.
**Fix:** `terraform import` the out-of-band Lambda + rule into state and verify
`plan` is empty *before* any apply touches the `nauta-services-inbound` rule set.
Do NOT fold this with a project-rename.

### S7 — `var.project` default `"nauta-services"` names LIVE infra — never rename in a "purge" `[INFO — landmine flag]`
`infrastructure/aws/variables.tf:13-16`

`var.project` defaults to `nauta-services`, which prefixes the live S3 bucket
(`ses.tf:15`), the receipt rule set (`ses.tf:111`), and SNS topics. Renaming it =
recreating the SES pipeline + re-pointing DNS = mail outage. The maritime *domain
model* purge is safe; this *infra namespace* is not. Keep the two tasks strictly
separate. (Called out so the drift/cost lanes don't propose a rename.)

---

## Input validation at trust boundaries — status

| Boundary | State | Cite |
|---|---|---|
| tRPC inputs | Zod-validated per procedure; identity from `ctx.user` only | `trpc.ts:93-103` |
| Attachment download | UUID regex + ownership + forced `download` | `attachments/[id]/route.ts:39-146` |
| FastAPI `X-User-Id` | presence-checked, value trusted (see S2) | `user_context.py:34-46` |
| FastAPI body `importer_id` | Pydantic-validated, never an auth claim, re-checked against `X-User-Id` owner | `knowledge_edges.py:52-79` |
| SNS/SES payload | parsed, **not authenticated/verified** (see S1) | `sns_inbound.py`, `ses_parser.py` |
| Email HTML render | DOMPurify-sanitized | `body-view.tsx:86` |
| GenUI model output | no-eval renderer + opaque-origin sandboxed iframe + CSP | `spec-renderer.tsx:13`, `build-island-srcdoc.ts:5-17` |

## Dependency risk — note
Not audited live here (no network `npm audit` run in this read-only pass). Surface
worth a scheduled check: `dompurify` (the sole XSS backstop for email bodies — pin
and track its advisories), `@trpc/server`, `next`/`react` 15/19, and the Python
`httpx` used in the SSRF path (S1). Recommend wiring `npm audit`/`uv`+`pip-audit`
into CI since the app leans on DOMPurify and the sandbox CSP as load-bearing
security controls.

## Recommended sequence
1. **S1** — SNS signature verification + `SubscribeURL` host allowlist (closes the
   only unauthenticated internet-exploitable path).
2. **S2** — lock the ALB to the BFF egress + TLS + drop plaintext :80 (removes
   god-key-over-plaintext-on-public-listener).
3. **S3** — make empty `API_KEY` fail closed everywhere.
4. **S4** — rotate the pasted IAM keys (parallel, process).
5. **S6** — import the SES forwarder drift before any apply.
