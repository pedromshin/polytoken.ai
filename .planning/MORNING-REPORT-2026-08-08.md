# MORNING REPORT — 2026-08-08

**TL;DR: Batch A is done except what physically needs your hands. The durable worker ran
live on staging and the enqueue→drain→terminal path is PROVEN. Prod carries the full
durable-ingest DB seam. `main` = `93cd08a3`, all CI green, prod deploy success. Three lanes
were STOPPED rather than patched a fourth time. Two process failures of mine are recorded
below rather than buried.**

## Batch A — one screen

| § | State | Evidence |
|---|---|---|
| 1 · staging DB | ✅ | read-only probe: graphile schema (5 tables), `enqueue_job`, **7/7 allowlist**, journal 61/61 |
| 2 · prod migration | ✅ | run `31213827515` success · **`ALLOWLIST 7/7`**, `GRANT service_role EXECUTE = YES` |
| 3 · worker staging leg | ✅ | task def `:4`, listener HEALTHY + worker RUNNING · **CUT-06 + CUT-09 proven** · scaled back to 0 |
| 4 · Stripe | ✅ (automatable half) | key **validated against Stripe's API before publish**, then `STRIPE_SECRET_KEY` updated |
| 5 · clicks | ⛔ yours | BILL-04 (real card) · BTAP-07 (live chat turn) · MCPX-09 (your Claude config) |
| 6 · SES reply | ⛔ yours | AWS Support **API unavailable on this account** (`SubscriptionRequiredException`) — console only |
| — · `BILLING_ENABLED` | ⛔ yours | the flip that makes pricing publicly live = **BILL-05** legal gate (A4). Left untouched deliberately |

### The proof worth reading
```
enqueue via public.enqueue_job  -> job id=1
present in graphile_worker._private_jobs, attempts=0
drained ~1s, row gone, no last_error
worker log: Completed task 1 (recompute_canvas_recipe, 131.35ms) with success
dead-letter rows: 0
```
Confirmed from the worker's **own log**, not from the row's absence — absence alone cannot
distinguish success from "never enqueued". Re-runnable against prod during cutover:
`scripts/staging-enqueue-drain-proof.mjs` (staging-guarded, prod-ref refusal).

## Landmines found and defused (these are the real value of the night)

1. **Prod had THREE pending migrations, not one.** `0053`/`0054`/`0061`. And the *fix* was the
   danger, not the gap: `0054` installs a **4-identifier** allowlist, so any journal-order
   "repair" would have `CREATE OR REPLACE`d the live function and silently broken
   `cascade_relabel` + recipe recompute. Prod reads `59/61` **permanently and correctly** —
   drizzle applies by timestamp, not by pending set. Written up in PEDRO-CHECKLIST §3.
2. **The worker image was missing from ECR**, and `ecs.tf:142-145` says an unpullable image
   fails *every* task start — `essential=false` does not cover it. Applying would have taken
   the staging listener down. Now a hard refusal in `batch-a-finish.ps1`.
3. **Trivy blocked the worker image** on `js-yaml 4.3.0` (HIGH CVE via graphile-worker →
   cosmiconfig). Pinned to 4.3.1. Note: a root `overrides` entry does **not** work on npm
   11.12.1 — exact pin, `--prefer-online`, regenerated lock all kept 4.3.0.
4. **PowerShell `-like '*?*'` is a wildcard match**, so the pooler compat suffix was joined with
   `&` and no `?`, and the driver read the query string as the database name. Both scripts now
   use `.Contains` and assert the assembled URL's database segment is a bare identifier.
5. **Two CRITICAL credential leaks** in the cutover kit — `redact()` printing the password to
   stdout on a scheme-less URL, and the full connection string reaching stderr via Node's
   uncaught-exception printer. Found by review, fixed, but see the stopped lanes below.

## Stopped, not retried — `.planning/STOPPED-LANES-2026-08-07.md`
Three lanes hit three build+review rounds each. Every round closed real defects and found new
ones nearby; that is the signal to stop.

| Lane | Why it is unsafe to ship |
|---|---|
| `cutover-kit` | still reports **clean green over a five-hour mail outage** — the exact failure a cutover certifier exists to prevent |
| `driver-tooling` | pushes a lane with **no gate covering it** when another lane supplies the diff; it merges code and deletes directories |
| `flag-gate` | defeated by **one alias line** while its own docs claim otherwise — manufactures false confidence about which flags are dark |

None blocks anything. All are pre-staging tooling. Use the small manual proof instead of the
cutover kit; the flags themselves are correctly set, only the automated *proof* is unreliable.

## What shipped
Merged behind full gates: `w9-cap-live-test` (live-Postgres cap proof), `w12-wave1-kit`
(verification kit — independently verified staging live, **26 assertions 0 failures**),
`w13-close-kit` (close kit — exit contract hand-verified: `1` = not ready, `2` = could not
verify), `w13-injection-fix` (canvas emitter field guards + **import-time** read-tier gate).
Final gate: **2389 listener tests**, mypy 329 files, ruff lint + format, lint-imports 3/3,
bandit 0 high / 0 medium.

## Addendum — full cross-workspace verification (later beat)
Having found the listener gate wrong, I audited the **other** matrices against the CI workflow
files. The TS one was wrong too: it said "per touched workspace", but
`ci-web-and-packages.yml` typechecks **eleven** workspaces, tests **ten**, and runs
`drizzle-kit check` — none of which I had been running. Per-workspace gating is not equivalent,
because a change in one workspace reds another's typecheck (an `api-client` router change
breaking `web` is the standard case).

Ran the complete set. **All green, nothing had slipped through:**

| | |
|---|---|
| Typechecks | **11/11** (incl. `daemon`, which CI typechecks but does not test) |
| `drizzle-kit check` | `Everything's fine` — journal/snapshot consistent after all the migration work |
| Suites (10) | db 124 · api-client 839 · billing 31 · daemon-protocol 52 · capabilities 65 · genui 645 · ui 49 · worker 42 · mcp-server 32 · **web 2292 / 175 files** |
| Listener | 2389 passed · mypy 329 · ruff lint+format · lint-imports 3/3 · bandit 0/0 |

**~6560 tests green across the repo.** The result was luck rather than verification until now —
which is exactly why the matrix is corrected and both workflow files are named as the authority.

## ⚠️ Two failures of mine, stated plainly
1. **My gate matrix was incomplete all night.** CI runs `ruff format --check .` and `bandit`;
   my documented "FULL listener stack" ran neither. Every lane and merge for a whole night was
   gated against the wrong list. CI caught it (`31222333007`). `SESSION-CONTINUITY.md` now names
   `.github/workflows/ci-email-listener.yml` as the authority — a hand-maintained mirror of a CI
   config drifts, which is exactly the failure I kept filing against the lanes.
2. **I then pushed the format fix without re-running pytest**, in the same beat as writing that
   note. It shifted 33 pinned line-citations and broke 34 tests (`31222528158`). Repaired by
   regenerating citations against the true lines; one row needed manual fixing because my
   regenerator's parser handled only one level of nested parens. CI green now.

I also **withdrew two "findings"** I had filed against the worker from its log lines without
reading `index.ts` — `deep_research` is a listener-side chat tool nothing enqueues, and the
crontab is composed in-process as a string, so flipping either flag *does* fire the dispatcher.
Both struck through with corrections in BATCH-A-SITTING.md rather than deleted.

## 💳 Addendum — billing went live and the legal pack was published

You authorised each of these explicitly while awake ("assume positive outcome for all" → "do it"
→ "just go prod publish everything. full permission"). Recorded so the sequence is attributable.

| | |
|---|---|
| `BILLING_ENABLED` | **true** — polytoken.ai is charging |
| Stripe | `livemode=true` · **Pro USD 29/mo** · **Power USD 49/mo** · webhook **enabled** · key API-validated before publish |
| `/legal/terms` · `/legal/privacy` | **200, public**, CDC art. 49 withdrawal right stated + refund policy |
| BTAP-07 | mechanism **built**; prod enable **staged**, apply classifier-blocked (see below) |

**The find that mattered:** after deploying the refund clause I fetched the live URL rather than
trusting the deploy, and got the **sign-in page**. `/legal/*` was behind the auth guard — so no
prospective customer could read the terms *before* subscribing, Stripe could not reach them, and
consumer law expects them at the point of sale. Fixed with `PUBLIC_PATH_PREFIXES` + parametrised
tests and a pin that `/billing` still redirects. A 200 is not proof a page rendered.

**One command left for you** — it rolls the **live mail receiver**, so watch it to stable:
```
terraform -chdir=infrastructure/aws apply btap07.tfplan
aws ecs wait services-stable --cluster nauta-services-email-listener --services nauta-services-email-listener --region us-east-1
```
Plan already gated: exactly 2 changes (prod listener task-def replace + service update), no
stop-list resource, no destroy.

**Two things worth your attention, neither of them code:**
1. **Merchant of record.** A4 assumes Stripe-direct, which makes the LTDA the seller of record and
   puts foreign VAT/sales-tax obligations on it. Accountant/lawyer question, now live-money real.
2. **The Stripe account is shared with another business** (`Plus`, `Base`, `Prancha de surf`, a
   second enabled webhook at `bugigango.app.io`). A restricted key scoped to this account reaches
   those objects too.

**A correction I owe you:** my BILL-05 draft listed four "unanswered" structural questions. Two
were already answered in the repo — `legal-entity.ts` has named the contracting entity since July
(LTDA, CNPJ 65.152.447/0001-21, Brazil, `privacy@polytoken.ai`) and the pages were already linked
from billing. I wrote that draft without reading `apps/web/src/app/legal/`. Marked SUPERSEDED.

## Your move
1. **BILL-04** — subscribe on polytoken.ai with a real card, open portal, cancel. Then say
   "BILL-04 done" and the evidence harness runs.
2. **BTAP-07 / MCPX-09** — the two live gestures.
3. **SES case 178464704400134** — console paste, draft in decision sheet §C1.
4. **`BILLING_ENABLED`** once the legal pack is settled (BILL-05).
5. Backcheck **ASSUMPTIONS A1–A14**. A8 is now **verified green** (`terraform plan` = "No
   changes" before the worker wiring).
6. **Roll the two credentials pasted into the session transcript** — the GitHub token and the
   Stripe `rk_live_` key.

Then: BURN-06 → `/gsd:audit-milestone` → `/gsd:complete-milestone` → **sauce backup**
(blocker-grade). `scripts/check-close-readiness.mjs` already reports exactly what is missing —
the 7 seams still read ASSUMED rather than EXECUTED.
