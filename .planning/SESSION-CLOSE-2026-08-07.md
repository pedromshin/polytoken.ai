# SESSION CLOSE — 2026-08-07 → 08-08

**Read this first next session.** It supersedes the morning reports as the single "where things
actually stand." `main` = `3ad57f23`, all CI green, prod deploy success, 0 worktrees, tree clean.
Sauce backup taken: `sauce-2026-08-07-milestone-close` (tag pushed, bundle verified, zip written).

---

## 1. The state of the world (what is LIVE)

| Thing | State |
|---|---|
| **Prod durable-ingest DB seam** | graphile schema · `public.enqueue_job` · **7/7 allowlist** · `service_role` EXECUTE |
| **Durable worker** | proven on staging: enqueue → drain → terminal success ~1s, **0 dead letters**, confirmed in the worker's own log |
| **Billing** | **LIVE — polytoken.ai is charging.** Pro USD 29/mo · Power USD 49/mo · webhook enabled |
| **Legal** | `/legal/terms` + `/legal/privacy` **public**, CDC art. 49 withdrawal right stated, refund policy reachable |
| **BTAP-07 canvas emit** | **enabled on prod** (task def `:4`), listener HEALTHY, all 5 SES rules intact |
| **`user-files` vault bucket** | **created on prod** (was missing entirely — that was the upload 500) |
| Staging | scaled back to `desiredCount=0` (rehearsal finished) |

**Test totals at close:** listener **2389** + web **2296/175 files** + api-client 839 + genui 645 +
db 124 + capabilities 65 + daemon-protocol 52 + ui 49 + worker 42 + mcp-server 32 + billing 31
≈ **6,560 green**, plus mypy(329), ruff lint+format, lint-imports 3/3, bandit 0/0, drizzle-kit check.

---

## 2. Two OPEN bugs

### 🔴 BUG — `billing.createCheckoutSession` hangs ("Starting…" forever)
**Not diagnosed.** The client handlers are correct (`onError` toasts, `isPending` clears), so a
permanently-pending button means the request never returns — a hang, not an error.
- **Ruled out:** lingering advisory lock (two snapshots: 0 idle-in-transaction, 0 blocked queries,
  0 advisory locks) · Stripe key write scope (`POST /v1/customers` succeeded) · stale build
  (the serving deployment was built after `BILLING_ENABLED` went true).
- **LEADING HYPOTHESIS (added 2026-08-08, from static analysis — fits every observation):**
  **the function is killed mid-stream and the client promise never settles.**
  1. Both clients use **`httpBatchStreamLink`** (`src/trpc/react.tsx:6`,
     `files/_lib/vault-api.tsx:109`), which commits **HTTP 200 before procedures resolve**.
  2. `api/trpc/[trpc]/route.ts` sets **no `maxDuration` and no `runtime`** — it inherits Vercel's
     default (10s Hobby / 15s Pro).
  3. `createCheckoutSession` does a DB transaction + advisory lock + **two Stripe round trips**
     (customer reuse-or-create, then session create) inside one request. On a cold start that can
     exceed the default budget.
  4. When Vercel kills the function the stream is cut **without an error frame**, so `onError`
     never fires, `isPending` never clears, and the button says "Starting…" forever.

  This explains all four otherwise-odd facts: no error toast, permanent pending, **no DB lock
  residue** (the connection died, so the transaction rolled back — which is why both lock
  snapshots were clean), and `files.requestUpload` returning a *clean* 500 in 2062ms because it
  failed fast, inside the budget.

- **The check that would confirm it:** Vercel dashboard → Functions → that invocation, or
  `vercel logs`, looking for a **timeout / "Task timed out"** on `/api/trpc`. The route's
  `onError` logs to `console.error`, so a genuine thrown error WOULD appear — its absence
  alongside a killed invocation is the signature.
- **Two candidate fixes, once confirmed** (not applied — a speculative change to a live payment
  path, unattended, is not worth the risk):
  (a) `export const maxDuration = 60` on the tRPC route, so the work has a real budget; and/or
  (b) move the Stripe calls **outside** the DB transaction — the advisory lock only needs to cover
      the read-modify-write of the subscription row, not two network round trips.
  (b) is the better fix: holding a per-user lock across an external API call is the actual defect,
  and it also removes the cold-start sensitivity.
- **Fallback if the logs are inconclusive:** click Subscribe and, *while the button still reads
  "Starting…"*, run `pwsh -File scripts/prod-diagnose-live-bugs.ps1` from a second terminal.
- **This blocks BILL-04**, and therefore the first dollar.

### 🟠 GAP — vault upload bound is unverified and probably wrong
`user-files` was created with **no explicit `file_size_limit`**, so it inherits the project global —
which is **provably below 100MB**, because the explicit 100MB create was refused `EntityTooLarge`.
`VAULT_MAX_UPLOAD_BYTES` is 100MB. A file between the two is accepted by the app, uploads fully,
and is rejected by storage at the end — the exact failure `storage-adapter.ts:48-57` warns about.
**Fix:** read Supabase → Storage → Settings → "Upload file size limit", then either raise it to
100MB or lower `VAULT_MAX_UPLOAD_BYTES` to match. Small files work today.

---

## 3. 🔑 Credentials to rotate — in priority order

1. **Supabase `service_role` key** — pasted into a terminal and this transcript. Bypasses RLS on
   **every table for every tenant**, plus storage. Issued 2026-06, **expires 2096**. Rotate:
   Supabase → Project Settings → API → `service_role`, then update Vercel.
2. **Stripe `rk_live_…`** — in the transcript. Note the Stripe account is **shared with another
   business** (`bugigango`), so its reach is wider than polytoken.
3. **GitHub `ghp_…`** — in the transcript; was never needed (`gh` authenticates via keyring).

---

## 4. What is still owed

| # | Item | Owner |
|---|---|---|
| 1 | **BILL-04** — card → checkout → portal → cancel | Pedro (**blocked by the hang above**) |
| 2 | **BTAP-07 turn** — live chat with ≥2 published source nodes (flag is ON) | Pedro |
| 3 | **MCPX-09** — `mcpServers` entry + `searchMyKnowledge` | Pedro |
| 4 | **SES case 178464704400134** — console paste (no Support API on this plan) | Pedro |
| 5 | **Merchant of record** — A4 assumes Stripe-direct ⇒ the LTDA is seller of record with foreign VAT/sales-tax exposure. **Money is moving now** | accountant/lawyer |
| 6 | Backcheck **A1–A19** (`ASSUMPTIONS-2026-08-07.md`, `ASSUMED-PASS-2026-08-08.md`) | Pedro |

**Milestone close is NOT ready** and `scripts/check-close-readiness.mjs` says exactly why: the 7
seams read ASSUMED rather than EXECUTED, and the three ledgers do not yet record vNEXT as closed.
Items 1–4 are what flip them. I did **not** run `/gsd:complete-milestone` — closing on assumed
seams would be the same false-green this session kept finding.

---

## 5. Parked, with reasons

- **3 stopped lanes** (`cutover-kit`, `driver-tooling`, `flag-gate`) — three review rounds each;
  branches preserved. `STOPPED-LANES-2026-08-07.md` records *why each is unsafe*, not just that it
  is blocked. **Treat as fresh designs, not fourth patches.**
- Terraform `dynamodb_table` → `use_lockfile` deprecation (breaks on a future major).
- `0053`'s header claims `deep_research` enqueues through the seam; it does not (listener-side tool).

---

## 6. The pattern this session kept finding — including in my own work

**Absence of a failure signal treated as evidence of success.** Five instances:

1. The cutover kit reported PASS + exit 0 on a database where the durable path had never run.
2. A redaction guard whose only test used a well-formed URL — it could not fail, so it never did.
3. My Stripe key check called a key "valid" after a **read-only** probe when the need was **write**.
4. My bucket check reported no warning on a `null` size limit — a bound it never checked.
5. My gate matrix omitted `ruff format --check` and `bandit` for an entire night; CI caught it, and
   the TS matrix was wrong the same way (per-workspace, missing `drizzle-kit check`).

Two hard-won rules came out of it, both now in `SESSION-CONTINUITY.md`:
- **Derive gates from the CI workflow file, never from prose.** A hand-maintained mirror drifts.
- **A 200 is not proof a page rendered.** `/legal/terms` returned 200 while serving the sign-in
  page — found only by fetching the deployed URL and reading the body.

Corrections I shipped rather than buried: two withdrawn worker "findings" (filed from log lines
without reading `index.ts`), a BILL-05 draft whose §0 listed questions the repo had already
answered, and four consecutive revisions of the injection audit each closing the last false claim
by making a slightly weaker one.

---

## 7. Next session starts here

1. Read this file, then `ORCHESTRATOR-STATE.md` ⭐ CURRENT.
2. **Rotate the service-role key** (§3.1) before anything else.
3. Catch the checkout hang live (§2) — it blocks the first dollar.
4. Close the vault bound (§2).
5. Then Pedro's four gestures → `check-close-readiness` → audit → complete-milestone → sauce backup.

After vLAUNCH: **v2.0 Local Agent Platform** = E4 (desktop app + daemon) + E5 + E6 (tool registry
+ agent self-repository), on one shared daemon/permission/ToolExecutor foundation. **E5 has been
redefined** by backlog **999.39** — not a browser panel but a whole cloud machine streamed into the
app — and that redefinition still needs folding into `VISION.md`. Check whether v1.10's scope was
absorbed by vNEXT before planning; `/gsd:audit-milestone` is the tool that answers it.
