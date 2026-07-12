# Morning Checklist — Phase 49 Plan 06 (LIVE-03, LIVE-04, LIVE-07)

**One ordered, copy-paste runsheet.** Everything preppable is already done (deploys green,
migrations 0021-0035 live on staging+prod, SES catch-all rule written + plan-proofed,
external-identity dispositions recorded). This is the last mile — the parts only you can do.

Do the sections in order: **A (OAuth) -> B (Forwarding) -> C (GitHub rename) -> D (Vercel
rename) -> E (other queued decisions)**. B depends on a live OAuth session from A
(`/settings/forwarding` requires sign-in). C and D are independent decisions you can make any
time, but they're grouped here so nothing gets lost.

When you're done with A, reply **"oauth verified"** (or describe what broke). When you're done
with B, reply **"forwarding verified"** (or describe what broke). Claude verifies both live
against the real databases — never against logs — and records the outcomes in `49-HUMAN-UAT.md`.

---

## A. OAuth — Google sign-in on the deployed app (LIVE-03)

*Also closes Phase-50 UAT scenario 43.1 (live Google OAuth round-trip) — see
`.planning/phases/50-live-loop-gate-uat-burn-down-screenshot-coverage/50-UAT-BURNDOWN.md`.*

### A.1 Google Cloud Console — consent screen + client

1. Open [Google Cloud Console](https://console.cloud.google.com/) -> select (or create) the
   project that will own this app's OAuth client.
2. **APIs & Services -> OAuth consent screen**: confirm scopes are exactly —
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
3. **APIs & Services -> Credentials -> Create Credentials -> OAuth client ID** (if you don't
   already have one): Application type **Web application**.
4. Save the **Client ID** and **Client secret** somewhere you can paste from — you'll need them
   in A.2. **Never paste the real secret into any file in this repository.**

### A.2 Authorized redirect URIs — register BOTH, on the same OAuth client

Paste these two values verbatim into **Authorized redirect URIs** on the Google OAuth client:

```
https://fyfwkjvbcrmjqjysdyqw.supabase.co/auth/v1/callback
https://dazyccjijdahxyciptkp.supabase.co/auth/v1/callback
```

(Optional, if you also test locally: `http://127.0.0.1:54321/auth/v1/callback`.)

**Why these and not the app's own URL:** Supabase Auth (GoTrue) is the actual OAuth redirect
target. Google redirects to Supabase's fixed `/auth/v1/callback`, and Supabase then redirects a
second time to this app's own `/auth/callback` with a `code` param. The app's own callback route
is **not** registered in Google Cloud Console — only the Supabase-hosted one, per project.

### A.3 Supabase Dashboard — enable Google provider, BOTH hosted projects separately

Do this twice. Config does **not** carry over between projects (Pitfall 10).

**Staging** (`fyfwkjvbcrmjqjysdyqw`):
1. Open the Supabase Dashboard for project `fyfwkjvbcrmjqjysdyqw`.
2. **Authentication -> Providers -> Google** -> toggle **enabled**.
3. Paste the **Client ID** and **Client secret** from A.1.
4. **Save.**

**Production** (`dazyccjijdahxyciptkp`):
1. Open the Supabase Dashboard for project `dazyccjijdahxyciptkp`.
2. **Authentication -> Providers -> Google** -> toggle **enabled**.
3. Paste the same **Client ID** and **Client secret**.
4. **Save.**

> **Known gotcha (memory):** the hosted dashboards may still hold a STALE/WRONG secret ending
> `...hRh6`. The CORRECT client secret ends `...EKM7`. If sign-in fails with an
> invalid-client-secret style error on either project, re-check which secret is pasted there —
> paste the one from the `client_secret` JSON you saved in A.1, not the old `...hRh6` value.

### A.4 Environment variables

| Variable | Public/Secret | Source |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase Dashboard -> Project Settings -> API -> Project URL (per env) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Supabase Dashboard -> Project Settings -> API -> anon/publishable key (per env) |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` | Not `NEXT_PUBLIC_`, not sensitive if leaked | Google Cloud Console -> Credentials -> the OAuth client from A.1 |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET` | **SECRET — Dashboard-only, never a repo file, never `NEXT_PUBLIC_`, never logged** | Google Cloud Console -> same OAuth client's secret (the `...EKM7` one) |

`.env.example` already documents these four vars as commented placeholders (Section "Web app —
Google OAuth via Supabase Auth"). Copy that structure into your real `.env.local` /
`.env.staging` / `.env.production` and fill in real values — never commit a real value. Vercel
project env vars (for the deployed app) are set in the Vercel Dashboard -> Project -> Settings ->
Environment Variables, same four names, same sources.

### A.5 JWT signing-key re-confirm (one line, matches the folded audit)

**Supabase Dashboard -> Settings -> API -> JWT Keys**, for BOTH hosted projects:

- Confirm staging (`fyfwkjvbcrmjqjysdyqw`) reads **ES256** (asymmetric).
- Confirm production (`dazyccjijdahxyciptkp`) reads **ES256** (asymmetric).

This matches `JWT-SIGNING-KEY-AUDIT.md` (Phase 43, re-verified 2026-07-10). If either project
shows legacy HS256 instead, stop and flag it — that's a deviation from the audit Phase 44's
verification approach assumed, and needs a decision before FastAPI-side JWT work relies on it.

### A.6 Sign in on the DEPLOYED app

1. Open the deployed production app (Vercel: `https://nauta-web.vercel.app`, unless you did the
   Section D rename first, in which case use the new URL).
2. Click **Sign in with Google**, complete the real Google sign-in with your account
   (`pedromaschio.shin@gmail.com`).
3. **Reload the page fully** — confirm you stay signed in (session persists).
4. **Sign out** — confirm you land signed-out.

### A.7 What Claude verifies on your "oauth verified" resume signal

Server-side, never trusting the browser alone:
- A `getUser()` round-trip against the hosted project confirms a valid session.
- A read-only query confirms the `auth.users` row for the signed-in identity.
- A read-only query confirms `auth.identities` gained a **google** provider row linked to the
  pre-existing user row (see below) — **not** a second, duplicate user row.

**Why this matters:** tonight's migration run pre-created your auth user on both hosts
(`email_confirm=true`, email `pedromaschio.shin@gmail.com`) so migration 0032's backfill guard
would pass:
- staging `auth.users.id = a829b79d-bec5-4cfe-b06f-cf2e880d9982`
- prod `auth.users.id = 179370cf-93e0-470f-9f3e-5e0305042827`

Google sign-in with the **same verified email** should **link** to these existing rows via GoTrue
identity linking, not create new ones. Claude's resume-time check specifically confirms:
`SELECT id, email FROM auth.users WHERE email = 'pedromaschio.shin@gmail.com'` returns **exactly
one row per project**, and that row's `id` matches the UUID above; then
`SELECT provider, user_id FROM auth.identities WHERE user_id = '<that uuid>'` shows a `google`
row was added alongside (or instead of) any existing email/password identity.

Outcomes recorded in `49-HUMAN-UAT.md`: sign-in OK, reload-persistence OK, sign-out OK, the
server-side `getUser`/`auth.users`/`auth.identities` confirmation, and your GitHub-rename decision
(see Section C — Claude asks for this in the same resume turn).

---

## B. Forwarding — SES catch-all apply + Gmail handshake (LIVE-04)

*Also closes Phase-50 UAT scenarios 45.6 (live SES + Gmail forwarding round-trip) and 45.7's
real-verification-email-arrival slice — see
`.planning/phases/50-live-loop-gate-uat-burn-down-screenshot-coverage/50-UAT-BURNDOWN.md`.*

**Do this after Section A** — `/settings/forwarding` requires a live signed-in session.

### B.1 Review the saved terraform plan

The plan was already generated and saved for your review (read-only — no `apply` has run):

```
.planning/phases/49-live-loop-gate-deploy-oauth-real-email/artifacts/forwarding-catchall-tfplan.txt
```

Confirm it shows **exactly**:
```
Plan: 1 to add, 0 to change, 0 to destroy.
```
— one new resource, `aws_ses_receipt_rule.forwarding_catchall` (bare-domain catch-all,
`recipients = ["magnitudetech.com.br"]`, positioned `after = "agent-prod"`, routes into the prod
S3/SNS pipeline). No diff on the three existing rules (`agent-local`, `agent-staging`,
`agent-prod`).

### B.2 Apply

Run this on the machine holding the authoritative `infrastructure/aws/terraform.tfstate`
(the same machine/session used for prior applies — local tfstate is not synced elsewhere):

```bash
npm run infra:tf -- apply
```

Approve only after Terraform re-prints a plan matching the saved output above (Terraform always
re-plans at `apply` time; confirm it still says `1 to add, 0 to change, 0 to destroy` before
typing `yes`).

### B.3 Get your forwarding address

1. Open the deployed app -> **`/settings/forwarding`**.
2. Your personal address `u-{token}@magnitudetech.com.br` is generated the first time you visit
   (get-or-create, idempotent — same address every time after). Copy it.

### B.4 Gmail — add the forwarding address

1. In Gmail: **Settings (gear icon) -> See all settings -> Forwarding and POP/IMAP**.
2. Click **Add a forwarding address**.
3. Paste your `u-{token}@magnitudetech.com.br` address from B.3.
4. Click **Next -> Proceed -> OK**.

Gmail now sends a confirmation email **to that address** — this is the destination-verification
handshake.

### B.5 Retrieve the verification code

1. Wait ~1-2 minutes for the forward + SES pipeline to process (SNS -> ingest -> your inbox).
2. Open the app's inbox at `/` and look for a new email from a `google.com` sender (subject
   typically "Gmail Confirmation - Forward Emails"). It should land under **your** account — the
   pipeline is scoped by your forwarding token, not a shared inbox.
3. Open it, copy the numeric confirmation code from the body.
4. Return to the Gmail "Add forwarding address" dialog (or the reminder email) and paste the code
   in to activate the forward.

**Fallback** if it doesn't appear in the inbox UI within a few minutes: check the raw email store
(S3 bucket `nauta-services-ses-inbound-emails`, prefix `inbound/prod/`) or the ingestion logs, in
case the inbox list query is filtering it out.

### B.6 Verify end-to-end with a real message

1. Send a normal test email (with an attachment) to your Gmail address from any other account.
2. Let Gmail forward it to your `u-{token}@magnitudetech.com.br` address.
3. Confirm it appears in the app's inbox (`/`) within a couple of minutes, attributed to your
   account.

### B.7 Must-match note

`FORWARDING_EMAIL_DOMAIN` (web app env var) **must equal** the SES-verified domain,
**`magnitudetech.com.br`**. A mismatch here produces addresses that are syntactically valid but
unroutable — mail bounces or vanishes silently, no error surfaces in the app. If B.5's code never
arrives, this is the first thing to check.

### B.8 Troubleshooting (if the code never arrives)

1. Confirm the B.2 `apply` actually completed (not just planned) —
   `terraform -chdir=infrastructure/aws state list | grep forwarding_catchall` should show the
   resource.
2. Confirm `FORWARDING_EMAIL_DOMAIN` in the deployed app's env exactly matches
   `magnitudetech.com.br` (Section B.7).
3. Check the S3 raw-store fallback (bucket `nauta-services-ses-inbound-emails`,
   prefix `inbound/prod/`) for the message even if it never surfaced in the inbox UI.
4. Confirm the `agent-prod` exact-match rule's `after` chain wasn't reordered by the apply — the
   catch-all must still be positioned after the three exact-match rules.

### B.9 What Claude verifies on your "forwarding verified" resume signal

Read-only queries against the **production** database (never logs):
- `forwarding_addresses` — the row for your `user_id` (token -> user_id mapping).
- `emails` — the row for the forwarded message, and its `thread_id` FK into `threads` (proves
  threading grouped it correctly, not left it orphaned).
- Supabase Storage bucket `email-attachments` — the stored attachment object for that email.

Outcomes recorded in `49-HUMAN-UAT.md`.

---

## C. GitHub repo rename decision (LIVE-07)

**The hazard:** `infrastructure/aws/iam.tf:110-131` grants GitHub Actions' OIDC deploy role via a
trust condition matching `sub = repo:${var.github_repository}:*`, and
`infrastructure/aws/terraform.tfvars:4` currently pins
`github_repository = "pedromshin/nauta.services.email-listener"`. After a GitHub repo rename,
every new CI run's OIDC token presents a `sub` claim with the **new** repo name, which no longer
matches the trust policy — `sts:AssumeRoleWithWebIdentity` fails, and **both ECS deploy pipelines
(staging + prod) go red** at the `configure-aws-credentials` step. This does not affect the
currently-running services (`/health` stays 200) — only *new* deploys are blocked until fixed.

**Choose one:**

**Option 1 — Rename now, with the companion IAM apply, same sitting:**
```bash
gh repo rename polytoken --repo pedromshin/nauta.services.email-listener
git remote set-url origin git@github.com:pedromshin/polytoken.git   # or your remote's actual protocol/URL shape
```
Then update `infrastructure/aws/terraform.tfvars:4`:
```hcl
github_repository = "pedromshin/polytoken"
```
Then, on the machine holding the authoritative tfstate:
```bash
terraform -chdir=infrastructure/aws plan
```
Confirm the plan shows **only** the IAM trust-policy JSON diff on
`aws_iam_role_policy.github_deploy` / the role's assume-role policy — no `# forces replacement` on
unrelated resources (ECR/ECS/ALB stay untouched). Review personally, then:
```bash
terraform -chdir=infrastructure/aws apply
```
Deploys stay green throughout because the fix lands with the rename.

**Option 2 — Re-park for now:** do nothing. No rename, no apply. Deploys keep working exactly as
they do today. Revisit this decision whenever you're ready to do both steps together.

GitHub auto-redirects old clone/fetch/push URLs after a rename, so Option 1's blast radius is
low **provided the companion IAM apply lands in the same sitting** — renaming alone (without the
apply) is the one sequencing mistake that silently breaks both deploy pipelines.

**Tell Claude your choice** in the same reply as "oauth verified" (or separately) — it gets
recorded in `49-HUMAN-UAT.md`. Claude will **not** perform the rename or the IAM apply
autonomously either way.

---

## D. Vercel project rename (fallback from plan 49-05)

**Status:** decided EXECUTE, attempted autonomously in plan 49-05, correctly blocked by that
session's own domain-change safety boundary (a project rename changes the live `*.vercel.app`
default domain). No mutation occurred — `nauta-web` / `prj_70hRKIxh1giNAfzQvbrR1tX7pP2j` is
unchanged. A repo-wide grep confirmed **zero hardcoded** `nauta-web`/`vercel.app` references in
application code — only planning docs — so this is low-risk from a code-reference standpoint.

**Dashboard steps (copy-paste ready):**

1. Go to <https://vercel.com/dashboard>, switch to team scope
   `team_V2cgPPeWDBTsSBVg3fwh1Jof` if not already active.
2. Open project **nauta-web** -> **Settings** -> **General** -> **Project Name**.
3. Change the name to `polytoken-web` -> **Save**.
4. Confirm the git integration still auto-deploys on the next push to `main`/`dev` (it's
   repo-id-based, not name-based — should need no reconfiguration).
5. Note the new default production URL becomes `https://polytoken-web.vercel.app`. Since no
   custom domain is attached and no application code hardcodes the old
   `https://nauta-web.vercel.app` URL, the only follow-up is any *external* bookmarks/links you
   personally maintain.

**CLI alternative** (if you prefer, run from the repo root so `.vercel/project.json`
auto-resolves the project):
```bash
vercel project rename nauta-web polytoken-web
```
(The CLI may prompt for scope confirmation interactively — expected and safe to accept.)

This is optional and independent of A/B/C — do it whenever convenient, or skip it.

---

## E. Other queued decisions from tonight's run

### E.1 Refresh the stale hosted DB passwords

`.env.staging` / `.env.production`'s `POSTGRES_URL_NON_POOLING` passwords no longer authenticate
(`28P01`) — URLs and usernames are well-formed, only the password is stale. Migrations 0021-0035
were applied and verified tonight via the Supabase Management API instead (see
`artifacts/migration-verification.md`), so nothing is blocked, but the native verify scripts
can't run until this is fixed.

**Steps:**
1. Supabase Dashboard -> Project Settings -> Database -> reset/copy the database password, for
   **both** staging (`fyfwkjvbcrmjqjysdyqw`) and production (`dazyccjijdahxyciptkp`).
2. Update the `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` password segment in `.env.staging` and
   `.env.production` respectively. **Do not commit these files.**
3. Run the ten verify scripts natively to confirm the refreshed credentials work end-to-end:
   ```bash
   npm run with-env:staging -- tsx scripts/verify-0026-live.ts   # repeat for 0027..0035
   npm run with-env:prod -- tsx scripts/verify-0026-live.ts      # repeat for 0027..0035
   ```
   (run from `packages/db/`; all ten already passed tonight via the Management API path — this
   step is a native-path confirmation, not a re-verification of unknown state.)

### E.2 ECS deploy workflow coverage-gate decision

The ECS deploy workflow is red on **one** gate: pytest coverage 68.10% vs
`--cov-fail-under=80` (`apps/email-listener/pyproject.toml:108`). All tests pass; ruff + mypy are
green in CI as of commit `997e1bc`. The running prod service is unaffected (previous image,
`/health` 200) — only *new* ECS image deploys are blocked.

**Choose one:**
- **(a) Approve a documented ratchet** — lower `--cov-fail-under` to a value at or below today's
  68.10% (e.g. 65), with a tracked plan to step it back up as coverage improves. Unblocks ECS
  deploys immediately.
- **(b) Hold ECS image deploys** until coverage recovers above 80% organically. Vercel deploys are
  unaffected either way (separate pipeline, no coverage gate).

Tell Claude your choice; it is not something this session can decide (lowering a user-stated
quality floor was correctly policy-denied for autonomous execution).

### E.3 Brand-mark visual fit sign-off (Phase 47 scenario 47.1, routed by Phase 50 Plan 04)

A one-glance judgment call — no setup needed.

1. Open `.planning/ui-reviews/2026-07-11T04-32-30-989Z/login-desktop.png` (or the live dev
   server / deployed app's `/login` page — either is fine).
2. Look at the rendered brand mark (sidebar slot, login card, favicon/browser tab). Does it read
   as a credible rounded "node/brain hybrid" (D-47-02) that feels at home with the warm polytoken
   register, and is it an acceptable foundational asset for the total re-skin to build on?
3. Tell Claude either **"brand mark approved"** or what's off (regenerating the SVG geometry is
   cheap if it misses).

Recorded in `49-HUMAN-UAT.md` item 6. Also closes Phase-50 UAT scenario 47.1 — see
`.planning/phases/50-live-loop-gate-uat-burn-down-screenshot-coverage/50-UAT-BURNDOWN.md`.

---

## F. Phase-50 UAT remainders

Two more auth-gated/manual items surfaced by Phase 50's UAT burn-down
(`50-UAT-BURNDOWN.md`, LIVE-05). One is genuinely new (no prior item covered it); the other
(47.1) already has a home in Section E.3 above — noted here only so nothing reads as missing.

### F.1 Gmail-forward fixture realism (THRD-02 / Phase-50 UAT scenario 45.5)

A standalone manual confirmation step — no cross-reference to Section A/B, no deploy/OAuth
gate. No setup needed beyond your own Gmail account.

1. In Gmail's UI, forward any real email to yourself, then open that forwarded message and use
   **Show original → Download original** to save the raw `.eml` source.
2. Compare its header shape against the constructed fixture at
   `apps/email-listener/tests/fixtures/threads/gmail_forward_stripped.eml` — specifically:
   `References`/`In-Reply-To` headers stripped, subject prefixed `Fwd:`, and the original
   headers embedded in the body (not the top-level header block).
3. If the real message's shape differs from the fixture in any of those respects, replace the
   constructed fixture with the real one (redact anything sensitive first) and re-run:
   ```bash
   uv run pytest tests/domain/services/test_thread_grouping.py --no-cov
   ```
   (run from `apps/email-listener/`) to confirm thread-grouping still parses it correctly.
4. Tell Claude **"fixture verified"** (or describe what differed) — recorded in
   `49-HUMAN-UAT.md` item 7.

### F.2 Brand-mark sign-off (47.1) — already covered

No new action here. The 47.1 brand-mark visual-fit sign-off already has its own item —
**Section E.3** above (added by Plan 50-04). Phase 50's burn-down roll-up
(`50-UAT-BURNDOWN.md`) confirmed the destination is real and did not duplicate it.

---

*Assembled by Plan 49-06, Task 1 — 2026-07-11. Sources: `GOOGLE-OAUTH-RUNBOOK.md`,
`FORWARDING-RUNBOOK.md`, `EXTERNAL-IDENTITY-DECISIONS.md`, `artifacts/migration-verification.md`,
`artifacts/forwarding-catchall-tfplan.txt`, `.env.example`. Section E.3 added by Plan 50-04
(LIVE-05) — routes the 47.1 brand-mark aesthetic sign-off here rather than leaving it
`[pending]` in 47-HUMAN-UAT.md. Section F added by Plan 50-05 (LIVE-05) — routes the 45.5
Gmail-forward fixture-realism confirmation here, and cross-references the 47.1 item back to
Section E.3 rather than duplicating it.*

## G. Docker/WSL recovery + queued live-stack verification (added 2026-07-11 overnight)

Docker Desktop's WSL2 backend wedged mid-run (~19:17): `wsl` commands hang, vmmem
unresponsive, com.docker.service stopped — recovery needs elevation, so it's queued here.

1. **Recover the stack:** reboot (simplest), or elevated PowerShell:
   `Restart-Service WSLService; Start-Service com.docker.service`, then launch Docker
   Desktop and wait for "engine running".
2. **Bring the app stack up:** `./scripts/preflight-local.ps1` (then listener + web per
   docs/RUN-LOCAL.md).
3. **Re-run the queued Phase-51 regression evidence (51-07 Tasks 2+3):**
   - E2E suite: the six-spec Playwright run in `51-07-PLAN.md` `<verify>` (live-loop-green
     + uat-39/41/43/45/48)
   - Screenshot re-capture: `npm run screenshot:review` → fresh 16-surface run under
     `.planning/ui-reviews/<ts>/`, compare against before-baseline
     `.planning/ui-reviews/2026-07-11T04-32-30-989Z/`
   These are execution-environment re-runs only — no code changes pending.
4. Any Phase 52–54 items marked "queued to §G" in their SUMMARYs follow the same pattern.
5. **Phase-52 live-canvas confirmation (Editable Genui Panels / Studio-on-Canvas,
   PANL-01..04)** — added by Plan 52-06, consolidating the individual "queued to §G"
   notes from 52-02/52-03/52-04/52-05/52-06's own SUMMARYs into ONE runsheet entry. Do
   this after Docker/FastAPI/Bedrock (IAM role) are all reachable:
   1. Bring the stack up (Section G.1-G.2 above), open a chat conversation that has at
      least one genui-spec panel on the canvas.
   2. On a REAL panel, manually verify all five PANL actions in order:
      - **Pack switch (PANL-01):** switch the toolbar's style-pack `Select` — the panel
        re-themes immediately; reload the page and confirm the choice persisted.
      - **Param edit (PANL-02):** open the `SlidersHorizontal` popover, edit a
        whitelisted field, Save — confirm the panel re-renders with the new value and a
        real `genui.applyPanelEdit` round-trip (server-side `SpecRootSchema`
        re-validation) actually ran.
      - **Regenerate (PANL-03):** click the `RotateCw` button — confirm a real
        `genui.generate` call (live Bedrock, not the mocked transport used in tonight's
        unit tests) swaps the panel's content in place.
      - **Version history + restore (PANL-03):** open the `History` popover, confirm
        prior versions list with the correct icon/verb/relative-time, click "Restore
        version" on one, confirm the panel content reverts and a NEW version was
        appended (supersede-never-mutate — check nothing was deleted).
      - **NL re-theme (PANL-04):** open the `Wand2` popover, type an instruction (e.g.
        "make it feel more playful and colorful"), click "Apply look" — confirm a REAL
        `genui.resolveRetheme` round-trip (live Bedrock forced-tool-use, the actual
        `POST /v1/genui/retheme` FastAPI route Plan 52-05 verified via direct-adapter
        smoke calls only, never through a running FastAPI server) resolves and the panel
        visibly re-themes with the `toast.success("Panel re-themed")` confirmation.
   3. **Screenshot-diff:** run `npm run screenshot:review` for the chat-canvas surface
      and compare the fresh capture against the Phase-51 baseline
      (`.planning/ui-reviews/2026-07-11T04-32-30-989Z/`) — confirm the new toolbar row +
      3 popovers render as designed (52-UI-SPEC.md) with no unintended layout regression
      on the rest of the panel/canvas chrome.
   4. **Authored-but-unrun Playwright specs from Phase 52:** none — Phase 52 shipped
      unit/component-level vitest coverage only (jsdom, mocked tRPC transport); no
      Playwright E2E spec was authored this phase. This live-canvas confirmation is the
      first real-browser exercise of PANL-01..04.
   These are execution-environment re-runs/first-live-verifications only — no code
   changes pending from Plans 52-02 through 52-06 unless this pass finds a real bug.
