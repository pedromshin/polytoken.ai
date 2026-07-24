# Tests — what matters, what's worthless, and speed

_Assessment lane, 2026-07-24. Branch `claude/polytoken-email-infra-cont-qi9q5g`. Read-only. All timings measured on this machine with `node_modules` already installed._

## Bottom line

The test **suites** are large, fast, and — where they matter — well-aimed. The test **gating** is the problem: **the entire TypeScript side of the product (web, tRPC API, DB schema, capabilities, genui, daemon) has ZERO CI.** The only automated gate that exists is `ci-email-listener.yml`, path-filtered to `apps/email-listener/**`. Everything a browser touches is verified only when a human remembers to run `vitest` in eight separate workspaces by hand. A green Python CI run tells you nothing about whether the app compiles, whether a router leaks another tenant's data, or whether the canvas renders.

Second-order problem: every tenant-isolation gate — the load-bearing security property of a multi-user product — is tested against **fake DB chains / mocked repositories**, never against real Postgres. The suites prove "the router calls the ownership assertion"; nothing proves the assertion's SQL actually filters by `importer_id`.

Third: the **daemon suite is currently red** (12 failing tests) and nobody would know, because it is not gated anywhere.

---

## 1. The gate map (what actually runs on a change)

| Suite | Files | Tests | Wall time | In CI? |
|---|---|---|---|---|
| `apps/email-listener` (pytest) | 157 | ~1847 fns | not timed (needs `uv sync`) | **YES** — the only gate |
| `apps/web` (vitest/jsdom) | 136 | 1722 | **75s** | no |
| `packages/api-client` (vitest) | 56 | 733 | 21s | no |
| `packages/genui` (vitest) | 30 | 627 | 14s | no |
| `apps/daemon` (vitest) | 10 | 216 (**12 FAILING**) | 7s | no |
| `packages/db` (vitest) | 7 | 84 | 6s | no |
| `packages/capabilities` (vitest) | 5 | 65 | 2s | no |
| `packages/ui` (vitest) | 4 | — | ~3s | no |
| `packages/daemon-protocol` (vitest) | 2 | — | ~2s | no |
| `apps/web` e2e / geometry / screenshot (Playwright) | 11 specs | — | needs live server on :3000 | no |

Evidence:
- CI workflows: only four exist — `ci-email-listener.yml`, two `deploy-email-listener*.yml`, `deploy-migrate-prod.yml` (`.github/workflows/`). Grepping every workflow for `vitest|npm run test|playwright` returns **only** the three `uv run pytest` lines in the email-listener workflows. No workflow runs a single TS test.
- Root `package.json:19` `"test": "cd apps/email-listener && uv run pytest"` — the repo-level `test`/`check` scripts are **Python-only**. There is no root script that runs the TS suites; each workspace's `vitest run` must be invoked by hand (`apps/web/package.json`, `packages/*/package.json` each define their own `"test": "vitest run"`).
- pytest gate is real and strict: `apps/email-listener/pyproject.toml:104-117` — `--strict-markers`, `--cov=app`, `--cov-fail-under=80`. This is the one place coverage is enforced.

---

## 2. Coverage of what actually matters

### Auth / route guard — thin but adequate for what exists
- `apps/web/src/lib/auth/redirect.test.ts` covers open-redirect / `safeNextPath` (rejects `//evil.com`, absolute URLs) and the signed-out→`/login` redirect. Pure logic, good.
- `packages/api-client/src/trpc.test.ts:27` proves `protectedProcedure` rejects a sessionless caller and that `ctx.user.id` is the server-verified identity (not client input). Correct property, minimal cases.
- Gap: no test asserts the FastAPI `X-User-Id` header (`app/presentation/middleware/user_context.py`, `USER_ID_HEADER`) is **trustworthy**. The adversarial suite asserts 401 when it's absent, but the listener trusts whatever `X-User-Id` arrives. If the listener is reachable independent of the web tier, tenant identity is spoofable and no test covers it. (Security-lane overlap; flagging because it's a test gap.)

### Tenant isolation — well-designed at the boundary, UNTESTED at the SQL
This is the most important and most misleading area. There are two dedicated adversarial acceptance gates:
- TS: `packages/api-client/src/router/__tests__/cross-tenant-adversarial.test.ts` — drives the **real** `appRouter` as user B over user A's rows, one cross-tenant read + write per router, plus positive controls. Genuinely good coverage of router wiring.
- Python: `apps/email-listener/tests/adversarial/test_cross_tenant.py` — same idiom on the FastAPI surface; asserts fail-closed 404 (no existence oracle) and that the promote-edge proxy rejects B supplying A's real `importer_id`.

**The catch:** both mock the enforcement boundary. The TS suite `vi.mock("@polytoken/db/ownership")` (line ~40) so `assertEmailOwnership` etc. are stubs — it proves routers *call* the guard, not that the guard works. The guard's own correctness is `packages/db/src/ownership.test.ts`, which by its own header comment (`lines 3-9`) runs against "a fake Drizzle chain stub … terminal `.then()` resolving to a seeded rows array" — i.e. the actual JOIN/WHERE SQL is never executed. The Python adversarial suite likewise uses `AsyncMock`/`MagicMock` repositories with seeded in-memory rows.

Net: a real bug in `ownership.ts`'s SQL (wrong column, dropped `importer_id` predicate, join to the wrong table) passes every tenancy test. And RLS cannot backstop it — see below.

### RLS is a deny-all backstop, NOT the isolation mechanism
- Migrations enable RLS, but the policies are `deny_all_*_anon` / `deny_all_*_authenticated` (`packages/db/migrations/0023_chat_spine.sql:95-126`). Newer tables add owner policies (`0040_documents.sql:38 documents_owner_authenticated`, `0047_workspaces_teams_rbac.sql`).
- The app connects with **service role**, which *bypasses RLS entirely*: `packages/api-client/src/router/files/service-client.ts:51` and `apps/web/src/app/api/attachments/[id]/route.ts:137` (`SUPABASE_SERVICE_ROLE_KEY`). So RLS provides no runtime tenant isolation for the main data paths — it only blocks a leaked anon/authenticated key from reading anything. **App-level ownership assertions are the only real isolation, and they're the exact thing tested only against fakes.**
- The RLS tests that exist (`packages/db/src/workspaces-schema.test.ts:122`) assert the migration *string* `.toContain('ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY')` — a text-match on SQL that never runs. Worthless as a behavioral guard; fine as a "don't delete this line" tripwire.

### Ingestion idempotency — genuinely strong
`apps/email-listener/tests/test_reingest_idempotency.py` is a model test: drives the **real** `IngestInboundEmailUseCase` + real `PdfParser` + real `ProposeRegionsUseCase` + real `ReprocessEmailUseCase` over an in-memory repo with **production-shaped upsert-on-id and DB-clock timestamp semantics**, and asserts the user-visible invariant (two reprocesses ≠ row growth). This is the "duplicate boxes" regression (REG-1) locked down properly. `test_reingest_email.py`, `test_inbound_sns.py`, `test_inbound_email.py` cover the SNS/SES entrypoint.

### Migrations — not exercised
- 40+ SQL migrations in `packages/db/migrations/`. **No test applies them to a database.** `db:check` (`drizzle-kit check`) validates migration graph consistency only; it does not run them. The `schema.test.ts` files (`file-versions-schema`, `spreadsheets-schema`, `workspaces-schema`, etc.) assert the generated SQL *text*, not the applied result. A migration that is valid SQL-text but breaks on real Postgres (constraint conflict, enum ordering, data backfill like `0032_backfill_user_id.sql`) is caught only by `deploy-migrate-prod.yml` running against **prod** — there is no staging/ephemeral-DB migration test. The one real-Postgres test that exists (`test_integration_real_postgres.py`) is `@pytest.mark.integration` + skipped unless `INTEGRATION_SUPABASE_URL`/`_KEY` are set, so it never runs in CI.

### Capability enforcement — covered at unit level
`packages/capabilities/src/__tests__/{capability,canvas,desktop,table,vetting}.test.ts` (65 tests, 2s) plus `packages/api-client/src/router/capabilities/__tests__/{builtin-manifest,projection-map}.test.ts` and `apps/email-listener/app/application/capabilities/__tests__/test_registry.py` (the Python mirror). The tool-envelope gate — the injection boundary — is covered by `app/domain/services/__tests__/test_tool_envelope_gate.py` and `tests/infrastructure/tools/test_tool_envelope_contract.py`, plus a real adversarial injection battery (`tests/evals/test_injection_adversarial_suite.py`, `test_web_search_injection_suite.py`, `test_live_injection_harness.py`). Prompt-injection is the best-tested security surface in the repo.

---

## 3. Tested but low-value / worthless

- **String-match-on-SQL schema tests** (`packages/db/src/*-schema.test.ts` `.toContain('ALTER TABLE …')`): tripwires against accidental deletion, not behavioral guards. Cheap, keep, but do not mistake them for migration coverage.
- **Design-law grep gates** (`apps/web/src/app/__tests__/palette-ban.test.ts`, `react-flow-stock-ban.test.ts`, `role-hue-ban.test.ts`, `colour-law.test.ts`, `token-registration.test.ts`): these walk `src` and regex-ban Tailwind palette classes / stock React-Flow CSS. They are **lint rules wearing a test costume** — real value, wrong runner. They inflate the 1722-count web suite and pay jsdom startup cost for a filesystem grep. Better as an ESLint rule or a fast Node script, not inside the 75s vitest run.
- **jsdom "structure" tests** (`*-structure.test.tsx`, `*-baseline.test.tsx`): per CLAUDE.md's own warning, jsdom does no layout — these assert DOM shape, not rendering. They're fine as contract tests but cannot substitute for the geometry/screenshot Playwright gates, which are the only thing that proves the UI actually renders. Those real-browser gates exist (`playwright.geometry.config.ts`, `playwright.screenshot.config.ts`) but run **nowhere automatically** (they need a live server on :3000 and are manual).

---

## 4. Speed — fast enough per-change, IF you know which command to run

- Individual suites are per-change-friendly: capabilities 2s, db 6s, daemon 7s, genui 14s, api-client 21s. The api-client wall time (21s) is almost entirely esbuild transform + module collection — actual test execution is **1.29s** (`tests 1.29s` in the run summary). Same story for web: `tests 23.9s` but `environment 105s` (cumulative jsdom setup across workers) → 75s wall. The cost is jsdom instantiation and TS transform, not the assertions.
- Full TS sweep, run serially by hand: ~130s. Parallelized in CI across workspaces: under a minute wall. This is well within a per-PR budget. **There is no performance reason the TS suites aren't gated — only that no one wrote the workflow.**
- Python pytest wasn't timed here (needs `uv sync`), but it carries the `--cov` instrumentation overhead on every run; the 80% gate is the slow-but-correct choice.

---

## 5. Live-production landmine notes (test angle)

- **Stale infra names baked into test fixtures.** `test_inbound_sns.py` fixtures use `agent@magnitudetech.com.br` and `arn:aws:sns:…:nauta-services-ses-inbound`. These are *test constants*, harmless to change, but they confirm the drift: tests still encode the old domain. Do **not** treat renaming them as coupled to renaming live infra (the `nauta-services` bucket/topic/SES ruleset) — they are independent. A test-fixture rename is safe; the live-namespace rename is the mail-outage hazard the brief warns about.
- No test covers the out-of-band SES forwarder Lambda / personal-forward receipt rule (they're not in Terraform, so nothing to test against). Untestable from this repo by design; the gap is infra, not tests.

---

## 6. Recommended CI gate set (priority order)

1. **P0 — Add a `ci-web-and-packages.yml` that runs the TS suites on any `apps/web/**`, `apps/daemon/**`, `packages/**` change.** Matrix over workspaces (or one job with `npm test` per workspace). This is the single highest-leverage fix: the browser-facing product currently ships with no automated verification at all. Budget < 2 min.
2. **P0 — Fix or quarantine the 12 red daemon tests** (`src/__tests__/tools.test.ts` 9 fails, `paths.test.ts` 3 fails). Root cause here is environment: fs/terminal capabilities return `ok:false` and the `isInsideRoots` junction-escape cases fail because `/tmp` realpaths outside the sandbox root and junctions are a Windows concept. Either make them hermetic (write under a realpath-stable root, `describe.skipIf(process.platform !== 'win32')` for junction cases) or they'll keep the daemon suite un-greenable and therefore un-gateable.
3. **P1 — One real-Postgres tenancy test in CI.** Stand up an ephemeral Postgres (or local Supabase) in the job, run `ownership.test.ts`'s allow/deny matrix against **real** joins, not the fake chain. This closes the single biggest coverage lie: today nothing executes the isolation SQL. The `@pytest.mark.integration` real-Postgres test already exists (`test_integration_real_postgres.py`) — wire an ephemeral DB and drop the skip so it runs.
4. **P1 — Gate migrations against an ephemeral DB.** Apply every `packages/db/migrations/*.sql` from scratch in CI (including data-backfills like `0032`). Catches enum-ordering / constraint / backfill breakage before `deploy-migrate-prod.yml` hits prod — right now prod is the first place migrations run against real data.
5. **P2 — Move the design-law grep gates out of vitest** into a fast lint step; keep them gating but stop paying jsdom startup for a regex.
6. **P2 — Wire the Playwright geometry gate into CI** with a spawned server (a CI-only config may add a `webServer` block; the ban in CLAUDE.md is about the local always-running-server workflow, not CI). jsdom passing proves nothing visual — geometry is the only automated proof the UI renders.
7. **Keep as-is:** the pytest 80% gate, the injection/eval battery, the idempotency test, the cross-tenant router-wiring suites (they're correct at the boundary — just add the SQL-level layer beneath them).
