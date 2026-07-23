# polytoken

Monorepo for **polytoken** — an email-driven "Data-Entry Brain": a FastAPI listener ingests
inbound email, and a Next.js web app (chat, canvas, generative UI) sits on top of a shared
Supabase/Postgres substrate.

## Quickstart

The canonical local-stack doc is **[docs/RUN-LOCAL.md](docs/RUN-LOCAL.md)** — it wins over
anything else (including this README). Cold start in one command:

```bash
./scripts/preflight-local.sh    # Linux/macOS
./scripts/preflight-local.ps1   # Windows (primary dev shell)
```

Then start the two servers (each in its own terminal, in this order):

```bash
# 1. Listener (NO --reload — zombie-process rule, RUN-LOCAL.md #4)
cd apps/email-listener && uv run uvicorn app.main:app --host 127.0.0.1 --port 8000

# 2. Web app (loads repo-root .env.local)
npm run web:dev
```

## Structure

```
├── apps/
│   ├── web/              → Next.js 15 app (React 19, tRPC, Tailwind 4, xyflow canvas)
│   ├── email-listener/   → FastAPI service, Clean Architecture, managed by uv
│   └── daemon/           → local daemon (npm workspace)
├── packages/
│   ├── capabilities/     → TS capability registry (Python mirror lives in email-listener)
│   ├── genui/            → generative-UI components
│   ├── db/               → Drizzle schema + migrations
│   ├── ui/               → shared UI kit
│   ├── api-client/       → typed API client
│   ├── daemon-protocol/  → daemon wire protocol
│   └── shared/, cli/, integrations/, tailwind-config/
├── infrastructure/aws/   → Terraform: ECR, ECS Fargate, ALB, SES, IAM (OIDC)
├── docs/                 → RUN-LOCAL.md (canonical), design docs
└── .github/workflows/    → CI + deploy pipelines (email-listener)
```

## Tooling

- **npm workspaces, NOT pnpm** (`workspaces` in root `package.json`). `pnpm install` pollutes
  the tree — always use `npm`. Node >= 20.12.
- `apps/email-listener` is Python managed by **uv** (not pip/poetry): `uv run pytest`,
  `uv run ruff`, `uv run mypy app`. Root npm scripts wrap these.
- All day-to-day commands live in root `package.json` scripts — see [COMMANDS.MD](COMMANDS.MD).

## Quality gates

```bash
npm run check        # listener: lint + format + typecheck + architecture + tests
```

Web app gates run from `apps/web`: `npm run typecheck`, `npm run test` (vitest/jsdom), and the
real-browser gates `npm run test:geometry` / `npm run screenshot:review` (require a running dev
server on port 3000 — see CLAUDE.md).

## Deployments

| App | Where | How |
| --- | ----- | --- |
| `apps/web` | Vercel | Vercel Git integration |
| `apps/email-listener` (production) | AWS ECS Fargate | push to `main` → `.github/workflows/deploy-email-listener.yml` |
| `apps/email-listener` (staging) | AWS ECS Fargate | push to `dev` → `.github/workflows/deploy-email-listener-staging.yml` |

Listener pipeline: test → docker build → Trivy scan → push to ECR → ECS force-new-deployment →
health smoke test. (ECS/ECR resources still carry legacy `nauta-services-*` names — known naming
drift, tracked in `.planning/research/2026-07-22-META-AUDIT.md`.)

See [infrastructure/README.md](infrastructure/README.md) for provisioning.
