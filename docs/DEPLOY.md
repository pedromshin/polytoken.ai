# Production deploy — target architecture (design doc)

**Status: DESIGN / NOT YET IMPLEMENTED.** This describes the production-grade deploy
pipeline we want *before a real public launch*. It is intentionally not built yet — today
we ship via the manual, backup-first runbook in
[`.planning/PROD-DEPLOY-RUNBOOK.md`](../.planning/PROD-DEPLOY-RUNBOOK.md). When we're ready
to publish for real, implement the pipeline below and retire the manual steps.

> Canonical local-stack doc is still `docs/RUN-LOCAL.md`. This doc governs **prod deploys**.

---

## 1. The problem this solves

The product has **three independently-deployable layers** with an ordering dependency:

| Layer | Artifact | Ships to | Current trigger |
|-------|----------|----------|-----------------|
| DB schema | Drizzle migrations (`packages/db/migrations`) | Supabase Postgres (`dazyccjijdahxyciptkp`) | manual (`db:migrate:prod`, or Management API when a runner can't reach PG) |
| Web app | Next.js build | Vercel project `nauta-web` → prod domain **`polytoken.ai`** (+ www) | Vercel Git integration, auto on `main` push |
| Listener | Docker image | ECR/ECS `nauta-services-email-listener` | `deploy-email-listener.yml` on `main` push (paths filter) |

**Why it's fragile today:** the three triggers are *independent and concurrent*. Pushing
`main` fires Vercel and the listener Action simultaneously, while the migration is a
separate manual step. Nothing enforces "DB first," and a build that fails *after* a
migration already changed the schema leaves the stack half-migrated. That's the desync
risk. The fix is not "deploy all three at the same instant" (impossible in a distributed
system) — it's the four patterns below.

---

## 2. Pattern 1 — Expand/contract migrations (the core guarantee)

**This is the single most important rule and it's free — it's a discipline, not
infrastructure.** Make every migration backward-compatible with the *currently running*
code (N-1 compatible), so deploy ordering can never corrupt the system:

- **Expand (safe to ship with code):** additive only — new tables, new *nullable* columns,
  new indexes, new enums, `CREATE OR REPLACE FUNCTION`, new RLS policies. Old code ignores
  them; new code uses them. **DB-first ordering is always safe** because the old app still
  runs against the new schema.
- **Contract (separate, later deploy):** destructive changes — `DROP COLUMN`, `NOT NULL`
  tightening, type rewrites, renames. Ship these only *after* a release where no running
  code references the old shape. A rename = add-new + backfill + dual-write + switch reads +
  (next release) drop-old, never a single `RENAME`.

Our `0043–0047` are already pure expand (new tables `spreadsheets`/`file_versions`/
`workspaces`/`workspace_members`/`resource_shares`, `chat_canvas_layouts.scope`+`user_id`,
re-`CREATE OR REPLACE` of two resolution functions). Keep it that way.

**Consequence:** with expand/contract, an app rollback *never* needs a schema rollback —
the previous app version is by definition compatible with the newer additive schema. That's
what makes the whole thing safe without lockstep atomicity.

**Guardrail to add:** a CI check on PRs that flags any migration containing `DROP`,
`ALTER COLUMN ... SET NOT NULL`, `ALTER COLUMN ... TYPE`, or a rename, and requires an
explicit `# contract: acknowledged` marker + a note that the prior release stopped using it.

---

## 3. Pattern 2 — One orchestrated pipeline (build → migrate → deploy → smoke)

Replace the three independent triggers with a **single `deploy-prod.yml`** whose job DAG
enforces ordering, gated behind a GitHub **Environment** (`production`) with a required
manual approval:

```
build-web  ──────┐          # `vercel build --prod`  → upload prebuilt output as artifact
build-listener ──┤          # docker build → push to ECR tagged by GIT SHA (immutable)
                 ▼          #   (both builds + all tests/lint/typecheck must be green first)
              migrate       # needs: [build-web, build-listener]
                 │          #   → runs `npm run db:migrate:prod` on the runner (direct PG)
                 ▼
   deploy-listener   deploy-web    # needs: migrate
                 │          #   listener: ECS update-service to the SHA image tag
                 │          #   web: `vercel deploy --prebuilt --prod` (promote the built output)
                 ▼
               smoke        # needs: [deploy-listener, deploy-web]
                            #   GET https://polytoken.ai/api/pipeline/health (web, auth-gated:
                            #   use a seeded session or a health token) + listener /health;
                            #   unexpected status ⇒ fail ⇒ rollback.
                            #   NB: smoke-test the CANONICAL domain (polytoken.ai), never a
                            #   *.vercel.app default — nauta-web.vercel.app is a stale separate
                            #   domain that does NOT track this deployment.
```

**The critical ordering decision: build BOTH artifacts before migrating.** Never migrate
the DB and *then* discover the app didn't compile. Build + test both to known-good, migrate
only then, deploy last. This shrinks the desync window to near-zero and makes
"migrated-but-code-never-shipped" impossible by construction. Because migrations are
expand-only (Pattern 1), even the residual window (migrate done, deploy in progress) is
safe — the old code still works against the new schema.

**Take Vercel off Git auto-deploy.** This is *the* fix for the web/DB race. Today Vercel
ships the instant `main` moves, ignoring the migration. Disable automatic production
deploys in the Vercel project (Settings → Git → Production Branch → turn off auto-deploy)
and drive it from the pipeline with `vercel build` + `vercel deploy --prebuilt --prod`.
Now the pipeline owns ordering.

---

## 4. Pattern 3 — Immutable artifacts + automatic rollback

- **Tag the ECR image by git SHA**, not `:latest`. Rollback = point ECS at the prior SHA;
  you always know exactly what's running. (Current workflow pushes `:latest` — change to
  `${{ github.sha }}` and keep `:latest` as a convenience alias only.)
- **Enable the ECS deployment circuit breaker** on the service:
  `deploymentConfiguration.deploymentCircuitBreaker = { enable: true, rollback: true }`.
  A failed/ unstable deploy auto-reverts to the last good task-definition. (The workflow
  already waits for service stability + runs a smoke step — the circuit breaker makes the
  failure path automatic instead of leaving a wedged deploy.)
- **Vercel rollback = promote the previous production deployment** (instant, no rebuild).
  The `smoke` job promotes-previous on failure.
- **Build once, promote the same artifact** staging→prod rather than rebuilding per env —
  what you tested is byte-for-byte what ships.

---

## 5. Pattern 4 — Environments, approval gates, per-env secrets

- Define GitHub **Environments** `staging` and `production`. Put a **required reviewer** on
  `production` so a prod release is an explicit human approval, not a side effect of a push.
- Scope secrets **per environment** (prod DB URLs, `AWS_DEPLOY_ROLE_ARN`, Vercel token live
  under `production`; staging equivalents under `staging`). No prod credential is ever
  readable from a non-prod job.
- **Trigger: prefer a release tag (`v*`) over push-to-`main`.** Cutting a tag is an explicit
  "make a release" action and pairs naturally with the approval gate and immutable artifacts.
  (Push-to-`main` is acceptable early on, but tag-based is the target.)

---

## 6. One-time setup checklist (do these when implementing)

- [ ] **GitHub Environments:** create `production` (+ `staging`), add required reviewer on prod.
- [ ] **Env secrets (production):** `PROD_POSTGRES_URL_NON_POOLING`, `PROD_POSTGRES_URL`,
      `PROD_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AWS_DEPLOY_ROLE_ARN`,
      `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
- [ ] **Vercel:** disable automatic Git *production* deploys; confirm Production env has
      **`NEXT_PUBLIC_SUPABASE_URL`** + **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** (required at BUILD
      time — a build without them fails; this bit us and is why they're now in
      `apps/web/.env.example`).
- [ ] **Supabase:** **enable PITR** (currently OFF on `dazyccjijdahxyciptkp`). Until it's on
      there is no coordinated point-in-time restore — the only DB rollback is a hand-written
      DROP script (see `.planning/PROD-ROLLBACK-*.sql`). PITR is the real safety net.
- [ ] **ECS:** enable `deploymentCircuitBreaker { enable, rollback }`; switch image tag to git SHA.
- [ ] **CI guardrail:** add the "destructive-migration needs acknowledgement" check (Pattern 1).
- [ ] Write `deploy-prod.yml` implementing the §3 DAG; delete/retire the standalone
      auto-triggers (`deploy-email-listener.yml` push trigger, Vercel git auto-deploy).

---

## 7. Rollback playbook (per layer, fastest-first)

- **Web (Vercel):** promote the previous production deployment. Instant, no DB impact.
- **Listener (ECS):** update-service to the prior SHA task-def, or let the circuit breaker
  do it. Stateless — safe to flip.
- **DB:** with expand/contract you almost never roll the schema back — roll *forward* with a
  compensating additive migration and keep the old code compatible. True rollback = **PITR
  restore** (once enabled) or the additive-migration DROP script as a last resort. After any
  DB restore, also roll the app back so code and schema match.
- **Order for a full rollback:** app + listener first (stops new writes against the new
  schema), then DB only if data was actually corrupted.

---

## 8. Note on the migration transport (why today looked manual)

Today's deploy applied `0043–0047` by hand over the **Supabase Management API** because the
agent sandbox only has HTTPS-443 egress and can't open a Postgres socket (5432/6543 time
out). **That is a sandbox limitation, not the system's.** A GitHub-hosted runner reaches
Supabase directly, so in the pipeline the migrate job is just `npm run db:migrate:prod`
(`drizzle migrate`, which manages `drizzle.__drizzle_migrations` itself). The staged
`.github/workflows/deploy-migrate-prod.yml` is essentially this job standalone — fold it
into `deploy-prod.yml` as the §3 `migrate` step.

---

## 9. Incremental adoption (don't do it all at once)

1. **Now (highest value, zero infra):** adopt the expand/contract rule + the CI guardrail.
   This alone removes the corruption risk.
2. **Next:** enable Supabase PITR and the ECS circuit breaker + SHA image tags — cheap,
   turns rollback from manual into automatic.
3. **Then:** build `deploy-prod.yml` with build→migrate→deploy→smoke and move Vercel onto
   pipeline-driven deploys behind the `production` Environment gate.
4. **Finally:** switch the trigger to release tags and add the `staging` promotion path.
