# polytoken — agent memory (pointers, not prose)

Facts below are sourced from `docs/RUN-LOCAL.md` (canonical local-stack doc — it wins over any other doc) and root `package.json`. Read those before improvising.

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
- See skill `.claude/skills/verify-rendered-geometry/SKILL.md`.

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
| `.planning/` | GSD planning state (roadmap, phases, ui-reviews) |

## Design law
Anything visual must follow `docs/design/taste-references.md` and `.planning/phases/58-visual-identity-sketch-pick-human-gate/58-IDENTITY.md`.

## Local stack
Cold start, seeding, grants, zombie-process rules: `docs/RUN-LOCAL.md` (preflight: `scripts/preflight-local.ps1`). Verify against the DB, not terminal output.
