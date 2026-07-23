# Commands

Canonical commands live in two places — this file is only a pointer:

1. **Root `package.json` scripts** (run with `npm run <script>` from the repo root):
   - Listener (Docker): `dev`, `dev:watch`, `dev:down`, `logs`
   - Listener quality gates (wrap uv): `test`, `lint`, `lint:fix`, `format`, `format:fix`,
     `typecheck`, `architecture`, `security`, `check`
   - Supabase: `sb:start`, `sb:stop`, `sb:status`, `sb:reset`
   - DB (Drizzle): `db:generate`, `db:migrate`, `db:migrate:staging`, `db:migrate:prod`,
     `db:studio`, `db:check`
   - Web: `web:dev`, `web:dev:staging`, `web:dev:prod`, `web:build`, `api-client:build`
   - Infra: `infra:tf` (Terraform in `infrastructure/aws`)

2. **[docs/RUN-LOCAL.md](docs/RUN-LOCAL.md)** — the canonical local-stack doc: cold start
   (`scripts/preflight-local.sh` / `.ps1`), env-file split, how to run the listener
   (bind `127.0.0.1`, **never `--reload`** — zombie-process rule), and DB-based verification.

If anything here appears to contradict RUN-LOCAL.md, RUN-LOCAL.md wins.
