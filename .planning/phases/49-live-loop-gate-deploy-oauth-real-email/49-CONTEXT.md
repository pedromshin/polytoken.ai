# Phase 49: Live-Loop Gate — Deploy, OAuth & Real Email - Context

**Gathered:** 2026-07-10
**Status:** Ready for planning

<domain>
## Phase Boundary

The live loop becomes technically operational: the app runs green locally via a documented,
reproducible start procedure; migrations 0026–0035 are applied and live-verified on staging AND
production; ECS + Vercel deploys are green on the renamed codebase; the user signs in to the
deployed app with their real Google account (session persists, sign-out works); a real forwarded
message lands in polytoken via the SES catch-all with correct threading and attachment storage;
and every EXTERNAL-RENAME-RUNBOOK.md leftover is decided — executed or explicitly re-parked —
including the local Supabase project-id decision.

Covers: LIVE-01, LIVE-02, LIVE-03, LIVE-04, LIVE-07.
Out of scope: UAT backlog burn-down + screenshot harness (Phase 50), any re-skin work (Phase 51).

STANDING RULE applies: deploy/OAuth/live-UAT gates are first-class phase work, never
deferrable-by-default. User-executed steps surface as in-phase checkpoint tasks.

</domain>

<decisions>
## Implementation Decisions

### Deploy & Migration Execution (LIVE-02)
- Migrations-first per the deploy playbook: apply 0026–0035 to staging → live-verify → apply to
  production → only then code deploys
- Deploys ride the existing pipelines: git push to main triggers the path-filtered ECS workflow;
  Vercel git auto-deploy is already on. Watch both to green — no manual dispatch paths
- "Live-verified" = read-only SQL checks against both hosted DBs (expected tables/columns from
  0026–0035 present) plus live health-endpoint checks; never trust the migration tool's exit
  code alone
- Red deploys are diagnosed and fixed forward within the phase — the deploy gate is first-class
  and is not rolled back and parked

### User-Gated Checkpoints — OAuth & Forwarding (LIVE-03/04)
- Consolidated in-phase checkpoints: Claude preps everything preppable (exact redirect URIs,
  env-var tables, terraform plan output), pauses once per gate with a copy-paste checklist, the
  user executes the console steps, Claude verifies afterward against live systems
- Ordering: OAuth first (LIVE-03) — a live session unblocks /settings/forwarding — then the
  Gmail forwarding handshake (LIVE-04)
- SES catch-all: Claude writes the `forwarding_catchall` terraform rule and runs
  `terraform plan` (read-only proof); the USER runs `terraform apply` after personally reviewing
  the plan — same discipline as the runbooks
- The catch-all routes to the PROD pipeline (runbook default — the forwarding user's account
  lives in the prod database)

### Local Stack Green Procedure (LIVE-01)
- The start procedure gets a canonical home: docs/RUN-LOCAL.md (or refresh the existing doc if
  one is found), encoding the env-file split (listener .env vs root .env.local), start order,
  and zombie-process preflight
- Zombie handling is scripted, not manual: preflight kills stale uvicorn/node processes, servers
  start WITHOUT --reload, checks verify via the DB not terminal output
- E2E verification is Playwright-core driven: login → inbox → thread → email detail → chat with
  tool rounds → genui panel → /knowledge, with DB assertions backing each step

### External-Identity Decisions (LIVE-07 — decided, not parked)
- GitHub repo rename nauta→polytoken: EXECUTE now (low risk, redirects preserved; runbook §1)
- Vercel project rename: EXECUTE now (low risk; runbook §3)
- AWS/Terraform resource renames: RE-PARK explicitly (runbook §2 Hazards A/B/C — two unsynced
  sources of truth, ECR force_delete=false destroy risk, local-only tfstate; high risk, zero
  user value now). Record the re-park decision in STATE.md
- Local Supabase project-id nauta→polytoken: RENAME now (local-only; accept fresh containers +
  re-run migrations; local data is disposable)
- Domain purchase / DNS remains user-only external action (out of scope per REQUIREMENTS.md)

### Claude's Discretion
- Exact structure of RUN-LOCAL.md and the preflight script
- SQL check specifics for migration live-verification
- Order of GitHub vs Vercel rename execution and how CI references are updated afterward

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- GOOGLE-OAUTH-RUNBOOK.md (v1.7 Phase 43) — complete console procedure, redirect-URI table for
  local/staging (fyfwkjvbcrmjqjysdyqw)/prod (dazyccjijdahxyciptkp), env-var table, JWT-mode note
- FORWARDING-RUNBOOK.md (v1.7 Phase 45) — draft `forwarding_catchall` HCL, Gmail handshake
  procedure, troubleshooting; ForwardingAddressResolver already ingests the Gmail verification
  email under the user's account
- EXTERNAL-RENAME-RUNBOOK.md (v1.7 Phase 42) — GitHub/AWS/Vercel/domain rename procedures with
  hazard analysis and per-file checklists
- deploy playbook (memory + repo workflows) — migrations-first; ECS deploy on main/dev push
  (path-filtered); Vercel git auto-deploy on; Deploy workflow has its own test gate
- supabase/config.toml already declares [auth.external.google] with env() sources
- redrive-inbound.sh exists for SES redrive (terraform-synced)

### Established Patterns
- User-gated runbook precedent: documented, not executed — autonomous execution never touches
  Google Console, Supabase Dashboard, or live terraform apply
- Local-dev zombie-process gotcha: stale uvicorn/python answer silently; kill all + run without
  --reload; verify via DB not terminal (memory: local-dev-logs-buffering)
- Chat stack local run: env-file split (listener .env vs root .env.local), start order,
  playwright-core driving (memory: chat-stack-local-run)
- Migrations live at packages/db/migrations/ (0026–0035 are local-only so far)
- Prod secret gotcha: non-ASCII secret caused a prod outage once — validate secret values ASCII

### Integration Points
- infrastructure/aws/ses.tf — receipt rules (3 exact-match; catch-all rule goes after prod rule)
- infrastructure/aws/ecs.tf — currently has uncommitted modifications (check before deploying)
- .github/workflows/deploy-email-listener{,-staging}.yml — deploy pipelines with env vars
- supabase/config.toml — project_id rename target; also has uncommitted modifications
- apps/web /auth/callback route (Phase 43) — app-side OAuth callback, already shipped
- /settings/forwarding (Phase 45) — get-or-create forwarding address UI, already shipped

</code_context>

<specifics>
## Specific Ideas

- Checkpoint checklists must be copy-paste ready: exact URIs, exact env-var names/values-sources,
  exact dashboard paths — the user should never have to hunt through runbooks mid-checkpoint
- Success is DB-verified: "a real forwarded message lands, threads group correctly, attachments
  stored" is checked by querying the prod DB, not by trusting logs
- JWT signing-key mode for staging + production should be recorded while in the Supabase
  Dashboard anyway (JWT-SIGNING-KEY-AUDIT.md exists from Phase 43 — verify/complete it)

</specifics>

<deferred>
## Deferred Ideas

- In-app forwarding onboarding wizard / multiple forwarding addresses (already deferred in
  45-CONTEXT.md — stays deferred)
- Sign-up restriction (allowlist / disable signup) — documented in OAuth runbook §5, revisit
  only when the product opens beyond single-user
- AWS/Terraform resource renames — re-parked this phase by explicit decision (LIVE-07)

</deferred>
