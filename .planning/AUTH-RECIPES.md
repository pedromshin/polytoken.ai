# AUTH-RECIPES — how sessions reach external systems (no raw secrets in this file)

> Doctrine (Pedro, 2026-08-06): **never ask Pedro for keys/envs/tokens.** Every credential this
> project needs is already stored on the dev machine; this file says where (raw values live in the
> gitignored env files, OS keyrings, and Windows user env — never in committed files).
> Only surface a request when a credential has verifiably EXPIRED — and say which one and why.
>
> Stripe live object registry (2026-08-06, not secret): products `prod_V1duIpCHy7CTEu` ($29 Pro) /
> `prod_V1duQ1gQvZNJfI` ($49 Power); prices `price_1U1acy010o9nrmKiNVC0FFMN` /
> `price_1U1ad8010o9nrmKiFLamKSlC`; webhook `we_1U1adf010o9nrmKik2ctF9yH` → /api/stripe/webhook.
> SES DKIM CNAME tokens for polytoken.ai (pending DNS): 4ymqltxn6cytfpkwwlk5vc6ewpeumvms /
> mzya442gnnczbx5xxmi23a5va3dm4o54 / z27nhihddkdw4vjyqrny6xvj2me4so5x.

| System | Auth | Where the secret lives | Notes |
|---|---|---|---|
| Supabase (both projects) | Management API token | Windows user env var `SUPABASE_ACCESS_TOKEN` (Pedro: run `setx SUPABASE_ACCESS_TOKEN <token>` ONCE — every future shell then has it) | Full self-serve: project status, config; password resets are an agent-blocked class (user-run script pattern: see PEDRO-CHECKLIST §8) |
| Postgres prod/staging | Connection strings | `.env.production` / `.env.staging` / `.env.local` (gitignored) | Pooler `aws-1-…:6543/5432`; migrations via `npm run db:migrate:*` or the GH pipeline |
| Vercel (`nauta-web`) | CLI keyring (`vercel whoami`) | machine keyring | Env writes: `vercel env add NAME production < valuefile` |
| Stripe (live) | CLI keyring (`stripe login`) | machine keyring | Login key expires ~90d (next ~2026-11-04) — the one legitimate re-ask |
| AWS `271369143207` | CLI credentials (`aws sts get-caller-identity`) | `~/.aws` | Terraform remote state lives in S3+DynamoDB (Track 1, 2026-08-06) |
| GitHub | `gh` keyring (repo+workflow) | machine keyring | Can set repo/environment secrets |
| Gmail/Calendar/Drive | claude.ai connectors | claude.ai account | Read via MCP tools |
| Listener runtime | env file | `apps/email-listener/.env` | x-api-key, SES bucket, Bedrock |

Session bootstrap: read `~/.claude/auth-recipes/polytoken.md` FIRST when any external system is involved.
