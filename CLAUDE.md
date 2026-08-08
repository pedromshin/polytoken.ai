# polytoken — agent memory (pointers, not prose)

Facts below are sourced from `docs/RUN-LOCAL.md` (canonical local-stack doc — it wins over any other doc) and root `package.json`. Read those before improvising.

## ⚠️ Live-infra landmines — read before touching infra or domain/resource names
- **`magnitudetech.com.br` and `nauta-*` are LIVE production names, NOT stale residue.** Inbound mail is built entirely on `magnitudetech.com.br` (`infrastructure/aws/ses.tf:3`; receipt rules route there; `personal-forward` → `pedro@magnitudetech.com.br`). The Vercel project is still named `nauta-web` (`docs/DEPLOY.md:20`); `var.project` default is `nauta-services` (`variables.tf:16`) — S3 inbound bucket, SNS topics, TF-state bucket, `nauta-el` TG prefix. Purging the maritime **domain model** is safe (done). **Renaming these *resources* recreates the SES pipeline + re-points DNS = mail outage.** Never fold "purge domain model" and "rename infra namespace" into one task.
- **No Terraform remote state backend** (S3 backend commented in `main.tf`). Any `terraform apply` from a checkout lacking the local imported state can recreate/drop live SES rules → mail outage. Do NOT `apply` until shared state exists and every live resource is imported (see `infrastructure/aws/IMPORT-RUNBOOK.md`).
- **SES may be in sandbox** (`ProductionAccessEnabled=False`) — outbound only reaches verified identities, so any multi-user outbound-mail feature is blocked on AWS production-access approval regardless of code.
- **Inbound SNS handler swallows failures** (`apps/email-listener/.../sns_inbound.py` returns 200 on any exception) — a failed ingest silently, permanently loses the email today. The graphile-worker durable runtime (Track 3a in the master plan) is the fix.

## ⚠️ DB landmine — never query the outer `db` inside a transaction
On Vercel the pool is capped at **one connection** (`packages/db/src/client.ts`, `max: 1`). A
transaction holds that connection, so any query issued against the outer `db` from inside a
`db.transaction(...)` callback waits for a second connection that cannot be freed until the
transaction commits — which waits on the query. **Self-deadlock.** It does not error: postgres-js
has no queue timeout, so the request hangs until the platform kills the function (60s), returning
**HTTP 200 with no error frame**. With `httpBatchStreamLink` the client promise never settles, so
the UI shows a permanent pending state and no toast. One stuck request also pins that warm
instance's only connection, so unrelated procedures time out beside it.

**Rule:** inside `db.transaction(async (tx) => …)`, use **`tx` for every query**. If you pass a
callback out of the transaction, hand it a `tx`-bound store (see `withUserLock` /
`LockedBillingStore` in `packages/billing/src/store.drizzle.ts`). **Unit tests cannot catch this** —
an in-memory fake has an imaginary unbounded pool; make the fake *count* outer-store calls made
under a lock instead. Cost this: three wrong fixes and a night of a blocked checkout (`bf361d18`).

## Package management
- **npm workspaces, NOT pnpm.** Root `package.json` `workspaces: ["packages/*", "apps/web", "apps/daemon"]`. `pnpm install` pollutes the tree — always `npm`.
- `apps/email-listener` is Python managed by **uv** (not pip/poetry): `uv run pytest`, `uv run ruff`, `uv run mypy app`. Root scripts wrap these (`npm run test|lint|typecheck|check`).
- Node >= 20.12.

## Build: `build` vs `build:local` (999.22 trap)
- `next dev` and `next build` share `apps/web/.next`; a second compiler against a live dev server's dir **silently corrupts it** (broken chunks, no error).
- To build while a dev server may be running use `npm run build:local` in `apps/web` — it sets `NEXT_DIST_DIR=.next-verify` (and loads `../../.env.local`). Plain `npm run build` only when no dev server owns `.next`.

## Env split (#1 footgun — details in docs/RUN-LOCAL.md §2)
- `apps/email-listener/.env` → FastAPI listener only.
- repo-root `.env.local` → web app (`dev` script: `dotenv -e ../../.env.local -- next dev`) AND `packages/db` migrations (`POSTGRES_URL_NON_POOLING`). There is no `apps/web/.env`.
- Google OAuth `env()` refs in `supabase/config.toml` resolve from the shell that runs `supabase start`, NOT from `.env.local`.

## Verifying UI: jsdom does no layout
- vitest/jsdom cannot see heights, overflow, clipping, or theme rendering. For anything geometric or visual, use the real-browser gates:
  - `npm run test:geometry` (apps/web) — asserts layout against an ALREADY-RUNNING server on port 3000; spawns nothing by design (never add a server block; never bare `npx playwright test`).
  - `npm run screenshot:review` (apps/web) — captures surfaces × viewports × both themes to `.planning/ui-reviews/<timestamp>/` (gitignored; contains signed-in state). Read the PNGs.
- Essential rules: (1) server must already be running on 3000 (`npm run web:dev` at root) — the geometry/screenshot configs spawn nothing; (2) never run bare `npx playwright test` against those configs or add a `webServer` block; (3) a passing jsdom suite proves nothing about rendering — screenshot or geometry-assert before calling visual work done.

## Playwright conventions
- baseURL `http://localhost:3000`; start server via `npm run web:dev` from repo root.
- `workers: 1`, `fullyParallel: false` in geometry/screenshot configs — all tests seed a GoTrue session for the SAME seed user, and minting a magic link invalidates prior tokens. Keep it serial.

## Where things live
| Path | What |
|------|------|
| `apps/web` | Next.js 15 app (React 19, tRPC, Tailwind 4, xyflow canvas) |
| `apps/email-listener` | FastAPI listener, Clean Architecture (`app/domain`, `app/application`, `app/infrastructure`; enforced by `uv run lint-imports`) |
| `apps/daemon` | local daemon (npm workspace) |
| `packages/capabilities` | TS capability registry — substrate: `src/capability.ts` |
| `apps/email-listener/app/application/capabilities/registry.py` | Python capability registry (mirror) |
| `packages/daemon-protocol` | daemon wire protocol |
| `packages/genui` | generative-UI components |
| `packages/db` | Drizzle schema + migrations (`npm run db:migrate` at root) |
| `packages/ui` | shared UI kit (see skill `polytoken-design-system`) |
| `.planning/` | GSD planning state. **Current status/ledger: `.planning/ORCHESTRATOR-STATE.md`** (the single live "where are we"). **Latest assessment + build sequence: `.planning/assessment/2026-07-24/00-MASTER-PLAN.md`.** `STATE.md`/`HANDOFF.json` are GSD phase-tracking (older); the 07-22 `research/META-AUDIT.md` is superseded — do not orient on it. |

## Skills tracking
- `.gitignore` ignores `.claude/skills/` wholesale — any NEW skill must be un-ignored with a `!.claude/skills/<name>/` negation line or it silently goes untracked.

## Design law
Anything visual must follow `docs/design/taste-references.md` and `.planning/phases/58-visual-identity-sketch-pick-human-gate/58-IDENTITY.md`.

## Local stack
Cold start, seeding, grants, zombie-process rules: `docs/RUN-LOCAL.md` (preflight: `scripts/preflight-local.sh` on Linux/mac, `scripts/preflight-local.ps1` on Windows). Verify against the DB, not terminal output.
