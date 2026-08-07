# Wave 1 verification — post-Batch-A gate

`scripts/verify-wave1.mjs` answers one question: **did Batch A actually land, on the
environment I am about to run Wave 1 against?** Run it the moment Batch A
(`.planning/BATCH-A-SITTING.md`) finishes, before any Wave-1 step. It is
verify-only — it reads, it never writes.

```
node scripts/verify-wave1.mjs                  # worker section + STAGING leg (default)
node scripts/verify-wave1.mjs --prod           # worker section + PROD leg
node scripts/verify-wave1.mjs --staging --prod # both legs
node scripts/verify-wave1.mjs --help
```

## Exit codes — this is the contract

| Code | Meaning | What to do |
|------|---------|------------|
| `0` | Every requested assertion passed | Start Wave 1 |
| `1` | At least one assertion FAILED | Do not start Wave 1. Fix the FAIL, re-run |
| `2` | A requested leg could not be evaluated (no credentials, no `postgres` driver, connect failure) | A human must look — nothing was proven for that leg |
| `3` | Safety refusal **and nothing was connected to** — a connection string pointed at the wrong Supabase project, or an argument was not recognised | Fix the env var / env file / typo. No database was contacted |

`SKIP` rows never on their own mean "fine"; they mean "not proven". A run that ends
`exit 2` has verified nothing about the database.

Exit `3` means *nothing ran*. When one leg is refused but another leg **did** run
and **did** fail, the run exits `1`, not `3` — the real failure wins, so a driver
keying on the exit code cannot mis-triage a broken database as a config typo. A
refusal never exits `0`.

Unrecognised arguments are rejected with exit `3` and nothing runs. `--production`,
`-prod` and friends used to be ignored, silently verifying **staging** and exiting
`0` while the operator believed prod had been checked.

## Credentials

Read-only, session-mode (`:5432`) connection strings. First match wins per leg;
nothing is ever written to disk, and the password is masked in every line the
script prints (including driver error text — see safety point 4 for the exact
reach of that claim).

| Leg | Source 1 (env var) | Source 2 (file, key `POSTGRES_URL_NON_POOLING`) |
|-----|--------------------|--------------------------------------------------|
| staging | `$STAGING_POSTGRES_URL_NON_POOLING` | `.env.staging` |
| prod | `$PROD_POSTGRES_URL_NON_POOLING` | `.env.production` |

Against the Supabase pooler the URL needs `?uselibpqcompat=true&sslmode=require`
(same note as `.github/workflows/deploy-migrate-prod.yml`).

## What each assertion proves, and what a FAIL means

### Database legs (`STAGING`, `PROD`)

| Assertion | Proves | A FAIL means |
|-----------|--------|--------------|
| `read-only session established` | The connection reports `default_transaction_read_only = on`; the leg refuses to run further queries otherwise | The server would not accept a read-only session — do not proceed; investigate the role/proxy before running anything else against it |
| `drizzle.__drizzle_migrations readable` | The drizzle bookkeeping table exists and the role can read it | Either the DB was never migrated, or the connecting role lacks `usage` on the `drizzle` schema. Every migration row below is unknowable until this passes |
| `0058_secret_mesmero recorded` … `0061_… recorded` | The sha256 of the tracked migration file appears in `drizzle.__drizzle_migrations` — the exact value drizzle's migrator stores | That migration has not been applied here. For `0061` on prod, Batch A step 2 did not complete: run `deploy-migrate-prod.yml` with `confirm=MIGRATE-PROD` (after installing the graphile_worker schema — 0061 raises without it) |
| `0058…: public.canvas_recipes exists`, `0059…: public.code_islands.provenance exists`, `0060…: public.correction_propagations exists` | The migrations did what they claim — the objects are really in the live schema, not just a row in a bookkeeping table | The journal row and the schema disagree. Someone inserted a migration row without applying it, or the objects were dropped. Treat as data-integrity, not bookkeeping |
| `graphile_worker schema present` | The worker's own schema is installed | 0061 cannot apply and the durable queue cannot run. Install it FIRST (`node apps/worker/dist/install-schema.js` with the session-mode URL), then migrate |
| `public.enqueue_job(text,jsonb,integer,text) exists` | The guarded enqueue seam is present with the expected signature | Nothing can enqueue through the allowlist. If overloads are listed but the 4-arg one is missing, an older signature is still in place |
| `enqueue_job is SECURITY DEFINER` | The function still runs with owner privileges, as 0053/0054/0061 declare | Someone replaced the function by hand. `graphile_worker.add_job` will fail for `service_role` |
| `allowlist covers the repo 0061 set` | Every identifier declared by `packages/db/migrations/0061_…sql` is present in the live `pg_get_functiondef` body. **The expected set is parsed from the migration file, never hardcoded** | The live function predates 0061 (typically missing `cascade_relabel`, `recompute_canvas_recipe`, `dispatch_recipe_recomputes`). The correction-flywheel and recipe-recompute fan-outs would raise `enqueue_job: unknown identifier` at runtime |
| `allowlist has no identifiers the repo does not declare` | The live privileged allowlist is not a superset of the repo's | The DB is ahead of this checkout (or was hand-edited). `git pull` and re-run; if it still fails, a privileged function was changed outside migrations |
| `enqueue_job not EXECUTE-able by PUBLIC` | 0061's `REVOKE ALL … FROM public` stuck | Any role could enqueue arbitrary allowlisted jobs. Re-apply the REVOKE |
| `enqueue_job EXECUTE granted to service_role` | 0061's `GRANT … TO service_role` stuck (SKIPped when the DB has no `service_role`) | The app boundary cannot enqueue. Re-apply the GRANT |
| `every journal entry recorded` *(staging only)* | All 61 journal entries have a matching hash row — the 2026-08-06 staging repair held | Staging drifted again. Re-run `node scripts/staging-repair.mjs` (dry run first), then `npm run db:migrate:staging` |
| `recorded high-water not ahead of journal` **(both legs)** | The newest recorded `created_at` is not greater than the newest journal `when`. This is the *mechanism* of the 2026-08-06 freeze: drizzle applies only entries whose `when` exceeds the newest recorded `created_at`, so a stamp ahead of the journal silently skips every future migration | The next generated migration would be skipped without any error. Fix the offending row's `created_at` before generating anything new |

On the PROD leg, journal **coverage** is printed as `INFO` rather than asserted —
prod is not expected to carry every journal entry the way staging is after the
repair. That is the only thing the per-leg `requireFullJournal` policy governs.

**The high-water assertion is NOT downgraded on prod.** It is
environment-independent and never benign: a database merely *behind* the journal
has `highWater <= journalTop` and passes, so the only way to fail it is to carry
the freeze condition itself — on the one environment where migrations are
hand-triggered (`deploy-migrate-prod.yml` with `confirm=MIGRATE-PROD`), i.e.
exactly where a poisoned stamp arises. It was previously reported as `INFO` on
prod, which meant the verifier printed the known-bad state and exited `0`.
`migrationChecks()` now emits the row on every leg;
`wave1-assertions.test.mjs` asserts it is present **and failing** under the prod
policy, so re-gating it turns that test RED.

### Worker image (`WORKER`) — credential-free, repo-only

This section never calls AWS. It checks that the repo's own worker-image
expectations agree with each other, then prints the command for a human.

| Assertion | Proves | A FAIL means |
|-----------|--------|--------------|
| `terraform worker ECR repo name resolves` | `infrastructure/aws/ecr.tf` + the `var.project` default in `variables.tf` yield a concrete repository name. The block is parsed **bounded to its own resource**, so a restructured `ecr.tf` cannot make the parser adopt a neighbouring resource's name | The terraform was restructured; the printed aws command below would be wrong |
| `<env>: WORKER_ECR_REPOSITORY matches terraform` | The deploy workflow pushes to the repository terraform actually creates. Both sides must be **non-empty** — two failed parses are not a match | CI would push to (or fail against) the wrong repo. Reconcile `.github/workflows/deploy-email-listener*.yml` with `ecr.tf` |
| `<env>: image tag matches terraform locals` | The workflow's `IMAGE_TAG` equals the `image_tag` that env's task definition pulls (`locals.tf`) | ECS would pull a tag CI never pushes — a silent no-op deploy |
| `<env>: ECR push gated on WORKER_DEPLOY_ENABLED` | The push step is still behind `vars.WORKER_DEPLOY_ENABLED == 'true'` (`.github/actions/worker-image/action.yml`) | The gate was removed; worker images now push unconditionally |

**The image itself must be checked by a human** — this kit deliberately does not
call `aws`. The script prints these lines; run them with your AWS credentials:

```
aws ecr describe-images --region us-east-1 --repository-name nauta-services-email-worker \
  --image-ids imageTag=latest \
  --query 'imageDetails[0].{tag:imageTags[0],pushedAt:imagePushedAt,digest:imageDigest}' --output table

aws ecr describe-images --region us-east-1 --repository-name nauta-services-email-worker \
  --image-ids imageTag=staging \
  --query 'imageDetails[0].{tag:imageTags[0],pushedAt:imagePushedAt,digest:imageDigest}' --output table
```

`ImageNotFoundException` means CI has not pushed the worker image yet: set the
repo variable `WORKER_DEPLOY_ENABLED=true` (Batch A step 3.1) and re-run the
deploy workflow. A `pushedAt` older than the last `apps/worker/**` commit means
the running image is stale.

### Self-audit (`SELF`)

| Assertion | Proves |
|-----------|--------|
| `no write statement in the SQL this kit sends` | `findWriteSql()` re-reads `scripts/verify-wave1.mjs` **and every non-test module under `scripts/lib`** — enumerated from the directory by `auditedSourceFiles()`, so a new module cannot be silently excluded — extracts the SQL they send, and fails if any contains a write keyword |

## Safety posture — what is enforced, and where it stops

Claims here are worth only the code behind them, so each one names it.

1. **The prod leg only connects with `--prod` *and* a prod-ref URL.** `runProd`
   gates the leg; `guardUrl()` requires the prod project ref and refuses (exit 3)
   if the staging ref is present. The staging leg refuses symmetrically on the
   prod ref — the same guard shape as `scripts/staging-repair.mjs`.
   *Stops at:* substring matching on the project ref. It constrains which Supabase
   project is reached, not which role or database inside it.
2. **Sessions are read-only, and the script proves it before querying.**
   `openReadOnly()` sends `default_transaction_read_only=on` as a startup
   parameter, issues `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`, reads
   the setting back, and throws unless it is `on`.
   *Stops at:* ordinary writes. It would not stop an explicitly read-write
   transaction or a SECURITY DEFINER function that writes; this script opens
   neither.
3. **The read-only claim is checked, not narrated.** The `SELF` assertion above
   fails the run if a write statement is ever added, in the CLI **or** in any lib
   module.
   *Stops at:* two call shapes (postgres.js tagged template, `sql.unsafe` with a
   single-quoted literal). SQL assembled from variables at runtime would still not
   be seen — the server-side read-only session (point 2) is the backstop, and
   `wave1-assertions.test.mjs` pins that limitation so it stays disclosed rather
   than drifting into a false claim. To check by hand:
   `grep -nEi "\b(insert|update|delete|create|drop|alter|truncate|grant|revoke)\b" scripts/verify-wave1.mjs scripts/lib/wave1-*.mjs`
   (test files excluded — their fixtures contain write SQL on purpose).
4. **Credentials are never printed or persisted.** They come only from
   `process.env` or the env files the repo already uses. `maskUrl()` hides
   user+password wherever a connection string is printed, and `makeRedactor()`
   strips the password and the full URL out of driver error text — including a
   password whose percent escape is invalid (`p%ssw0rd`), which used to make
   `decodeURIComponent` throw and discard the parsed password with it.
   *Stops at:* the host and query string are kept on purpose, so the project ref
   and a missing `sslmode` stay visible. Query-parameter values whose key looks
   sensitive (`pass`, `secret`, `token`, `key`, `credential`) are masked.

## Tests — every guard above has one

```
npm run test:scripts        # node --test scripts/lib/*.test.mjs
```

Pure fixtures, no database and no network. Each test names the guard it protects;
removing that guard turns it RED. Coverage is deliberately concentrated on the
things that would otherwise be prose: the high-water assertion on **both** legs,
the project-ref refusal, password redaction, argument rejection, the exit-code
precedence, the non-empty worker predicates, the bounded terraform parse, and the
`ok === true` rule that stops a truthy value from recording a PASS.

Not yet wired into CI — `.github/workflows/` is out of scope for this lane, so the
suite runs on demand via the script above. State that plainly rather than assume it.

## Files

| Path | Role |
|------|------|
| `scripts/verify-wave1.mjs` | CLI: credential resolution, connection, queries, reporting |
| `scripts/lib/wave1-cli.mjs` | Pure run decisions — `parseArgs`, `LEGS` (+ per-leg journal policy), `guardUrl`, `maskUrl`, `makeRedactor`, `decideExit`. No fs, no env, no DB |
| `scripts/lib/wave1-expectations.mjs` | Repo-derived expectations — journal + hashes, the 0061 allowlist, ECR/tag names, the audited source list. No DB |
| `scripts/lib/wave1-assertions.mjs` | Pure comparisons and the per-leg check rows (`compareMigrations`, `migrationChecks`, `workerChecks`, `compareAllowlist`, `findWriteSql`) — kept out of the CLI so the FAIL paths are exercised without a database |
| `scripts/lib/wave1-report.mjs` | PASS/FAIL/SKIP/INFO recorder and table renderer |
| `scripts/lib/*.test.mjs` | The suite above |
