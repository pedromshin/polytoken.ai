# BOOTSTRAP-PROMPT — paste-into-any-session grand-orchestrator resume

> Evergreen. Any Claude Code session (new or concurrent) can start by reading this
> file and following it. It self-orients from LIVE state (git + the ledger), so it
> never goes stale even when a sibling session has advanced `main`. Contains NO
> secret values. Keep this file current: if the ship mechanism, gates, or backlog
> change, edit here.

---

You are Claude Code (Opus 4.8) resuming the unattended "grand orchestrator" run on
polytoken.ai with Pedro's FULL power-of-attorney authorization: launch, publish,
deploy to prod, do not wait for input. Standing intent, in Pedro's words: "you are
horrible at making things literally APPEAR ON SCREEN — stop building invisible
backend plumbing; build NEW user-facing interfaces on the CANVAS (the primary
surface) over already-wired backend, and ship them." Bias to action, ship to main,
keep every gate green.

⚠️ ANOTHER SESSION MAY BE RUNNING CONCURRENTLY on the same repo/branch. Do NOT trust
any commit hash from memory as "latest." ORIENT FROM LIVE STATE FIRST, every time:

## STEP 0 — ORIENT (run before doing anything; re-run if you've been idle)
```
git fetch origin
git log --oneline -15 origin/main
git branch --show-current ; git status
git log --oneline -10 origin/claude/polytoken-email-infra-cont-qi9q5g
# Read the single source of truth for "where are we" (newest block at top):
sed -n '1,120p' .planning/ORCHESTRATOR-STATE.md
```
Then reconcile:
- If your local branch is behind origin, `git pull --ff-only` (or rebase your
  uncommitted work onto it). NEVER force-push over commits you didn't make — a
  sibling session may have pushed. If the work branch diverged, rebase yours on top;
  keep both sets of commits.
- Work branch = `claude/polytoken-email-infra-cont-qi9q5g`. If its PR is already
  merged, restart it from latest `main` (same name) for follow-up work; never stack
  on merged history. Ship = commit on branch → `git push -u origin HEAD` →
  fast-forward `git push origin HEAD:main` (origin/main is a linear ancestor).
- Before starting a work item, DETECT whether the sibling already did it (probes
  below). Never duplicate in-flight work; pick the next UNSTARTED unit.
- No PR unless Pedro asks. Commit trailers REQUIRED on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: <this session's claude.ai/code URL>
  ```
  NEVER put the model id in commits/PRs/code/pushed artifacts (chat only).

## ENVIRONMENT / TOOLCHAIN  (docs/RUN-LOCAL.md wins over any other doc)
- Remote ephemeral container; repo cloned fresh; commit+push or it's lost.
- npm workspaces (NOT pnpm) — `["packages/*","apps/web","apps/daemon","apps/worker"]`.
  Node ≥20.12. `apps/email-listener` is Python via uv. GitHub ops via `mcp__github__*`
  (no gh CLI; load via ToolSearch).
- This container has NO secrets and needs none for the build work: tsc, vitest,
  drizzle-kit check, and the placeholder build all run credential-free. Real secrets
  live in the platforms and are used only at deploy/runtime (Vercel + GH Actions on
  `main` push). See CREDENTIAL INVENTORY if you must run the full local stack.
- SHIP GATES — run ALL green before ff-to-main:
  - **web:** `npx tsc --noEmit -p apps/web` · `(cd apps/web && npx vitest run)` ·
    placeholder build:
    ```
    SKIP_ENV_VALIDATION=1 NEXT_DIST_DIR=.next-verify \
      NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
      NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key npx next build
    # then: git checkout -- next-env.d.ts tsconfig.json; rm -rf .next-verify
    ```
  - **packages** (genui, capabilities, api-client, db):
    `(cd packages/<pkg> && npx tsc --noEmit && npx vitest run)`
  - **db:** `(cd packages/db && SKIP_ENV_VALIDATION=1 npx drizzle-kit check)`.
    New migration: write schema → `npx drizzle-kit generate --name=<x>` →
    hand-append the RLS block (idiom: `migrations/0055_code_islands.sql`).
  - **listener:** `uv run ruff check . && uv run lint-imports && uv run mypy app &&
    uv run pytest` (FULL pytest, no path filter).
  - **worker:** tsc + vitest.
- jsdom does NO layout — visual/geometry claims need `npm run test:geometry` or
  `npm run screenshot:review` against an ALREADY-RUNNING :3000 (`npm run web:dev`),
  never a bare `npx playwright test`. 999.22 trap: never plain `next build` while a
  dev server owns `.next`.

## LIVE-INFRA LANDMINES (CLAUDE.md — read before touching infra/domain names)
- `magnitudetech.com.br` and `nauta-*` are LIVE prod names. Renaming those RESOURCES
  = MAIL OUTAGE. Purging the maritime DOMAIN MODEL is done+safe; do not conflate.
- NO `terraform apply` (no remote state backend; can drop live SES rules).
- SES may be in sandbox. NEVER read email CONTENT / S3 email objects / Lambda env vars.
- Models: `claude-fable-5` / `claude-opus-4-8` / `claude-sonnet-5` only; never haiku.
- Any listener change to the live merge/ingest path ships FLAG-GATED OFF + FULL pytest.

## CREDENTIAL INVENTORY (names only — values live in the platforms; Pedro rotating EOD)
Env split: `apps/email-listener/.env` → listener; repo-root `.env.local` → web +
`packages/db` migrations; `supabase/config.toml` OAuth resolves from the `supabase
start` shell. No `apps/web/.env`. Authoritative key lists: `apps/web/src/lib/env.ts`
(web, zod) and `apps/email-listener/app/settings.py` (listener, with defaults).
- **Supabase** (ref `dazyccjijdahxyciptkp`): `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`
  (SECRET), `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING` (SECRET).
- **Vercel** (project `nauta-web` → polytoken.ai): the web set above + deploy token.
- **AWS** (ECS/ECR `nauta-services-email-listener`; Bedrock; Textract; S3; SES):
  listener runtime env — `API_KEY` (== web `EMAIL_LISTENER_API_KEY`, ONE shared
  secret), `SUPABASE_SECRET_KEY`, `BEDROCK_*`, `AWS_TEXTRACT_REGION`,
  `ATTACHMENTS_BUCKET`, `RAW_EMAILS_BUCKET`, `DEFAULT_IMPORTER_ID`, `GENUI_*`,
  `OPENROUTER_API_KEY` (SECRET), `COST_CAP_*`, feature flags; deploy via GH OIDC
  `AWS_DEPLOY_ROLE_ARN`.
- **GH Actions** (env production): `AWS_DEPLOY_ROLE_ARN`, `PROD_POSTGRES_URL`,
  `PROD_POSTGRES_URL_NON_POOLING`, `PROD_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  Vercel token.
- **Worker:** `GRAPHILE_WORKER_CONNECTION_STRING`(=`POSTGRES_URL_NON_POOLING`),
  `LISTENER_INTERNAL_URL`, `API_KEY` (shared), `MORNING_BOARD_ENABLED`.

Rotation: the listener `API_KEY` == web `EMAIL_LISTENER_API_KEY` is ONE shared secret
— rotate BOTH sides in the same window or web↔listener auth breaks. Update each secret
in EVERY place it appears (Vercel + ECS + GH Actions + local .envs). NEVER echo a
secret value into chat or commit one.

## WHERE WE ARE — vNEXT "Living Canvas" milestone (phases 73–77)
Do NOT assume the state below is current — CONFIRM against the live ledger + probes.
LIVE sources of truth: `.planning/ORCHESTRATOR-STATE.md` (top block = newest);
specs `.planning/phases/7{3..7}-*/SPEC.md`;
`.planning/assessment/2026-07-24/00-MASTER-PLAN.md`.

Known-shipped as of this handoff (verify still on main; a sibling may have added more):
Phase 73 Waves A+B (agent draws/wires nodes + publish port); Phase 74 (self-assembling
morning board incl. /home canvas render); Phase 75 VISIBLE half (merge repaints every
EntityNode live + cascade-highlight ring); Phase 76-01 (island DATA CHANNEL — frozen
`window.__ISLAND_DATA__`, CSP pinned); Phase 76-03 (the code-island CANVAS NODE —
`code_islands` table+0055 migration+RLS, `codeIslands.*` router, node type in both
allowlists, `code-island-node.tsx` hosting `<CodeIslandFrame data>`). Note: migration
0055 may still be UNAPPLIED to prod — check; apply via `db:migrate`.

DETECTION PROBES (decide what's actually done before picking work):
```
git log --oneline -20 origin/main | grep -iE 'phase 7[4-7]|code-island|BTAP|CPF|reconciler'
grep -rl "useCanvasPublish" apps/web/src/app/chat/_canvas/spreadsheet-node.tsx   # 76-04 prereq done?
grep -rl "Build a tool\|emit_code_island\|codeIslandGenerate" apps/web/src packages/api-client/src
ls .planning/phases/76-*/ ; sed -n '1,60p' .planning/ORCHESTRATOR-STATE.md
```

NEXT BACKLOG (ordered; take the first UNSTARTED unit; ship each green slice to main):
1. **Phase 76 SUMMON LOOP** — makes the code-island node user-reachable (the visible
   payoff). In order:
   1. PREREQ: add Phase-73 publish port to `spreadsheet-node.tsx` (`useCanvasPublish`
      → `shared.published.{id}`, BOUNDED projection: columns+rowCount+small sample;
      respect the LCAN-03 size cap). Mirror the 10 nodes that already publish.
   2. **76-02a** (api-client, Vercel-only/safe): optional bounded `inputs` manifest on
      `CodeIslandInput` (`packages/api-client/src/router/genui/code-island.ts`),
      forwarded in the POST body (listener ignores unknown fields today).
   3. **76-04** (apps/web): "Build a tool from these" — multi-select ≥2 data nodes →
      read `shared.published.{id}` → `{inputs manifest, targetKey→{sourceNodeKey,
      sourcePath} bindings}` → `api.useUtils().genui.codeIslandGenerate.fetch(...)` →
      `codeIslands.create` → materialize ONE code-island node + one data-edge per
      source (mirror `handleAssembleBoard`/`handleAddEntity` + Phase-73 `toFlowEdge` in
      `chat-canvas.tsx`; scheduleSave; idempotent, BTAP-06). Add a selection-aware entry
      in `add-node-menu.tsx`. Geometry gate is live (:3000).
   4. **76-02b** (LISTENER, redeploy): consume `inputs` in the generator prompt
      (`genui_code.py` + `generate_code_island.py`) so emitted code reads
      `window.__ISLAND_DATA__.{targetKey}`. Additive, FULL pytest.
   5. **76-05** (live): agent-authored `emit_code_island` behind `CANVAS_EMIT_TOOL_ENABLED`
      (default OFF, fails closed) + `canvas_code_island` message part.
2. **Phase 75 SERVER cascade** (deferred; touches LIVE listener merge path, effect is
   live-loop-gated): 75-01 `correction_propagations` ledger migration · 75-02
   `CascadeCorrectionUseCase` (promote AMBIGUOUS sender→entity edges via
   `PromoteEdgeUseCase`, D-21, idempotent job_key) · 75-03 wire into
   `ConfirmMergeUseCase` BEST-EFFORT + summary passthrough · 75-04 worker
   `cascade_relabel`. SPEC: `.planning/phases/75-correction-propagation-flywheel/SPEC.md`.
3. **Phase 77** capability-registry-mcp-server (specced, not started).
4. **5-seam v1.x punch-list** (RCNV-02/03, DOCS-01, REG-04, RSRCH-04) + human-gated legs.

Dormant flags to flip when going live: `CANVAS_EMIT_TOOL_ENABLED` (agent draws
nodes/edges), `MORNING_BOARD_ENABLED` (listener setting + worker env — flip BOTH ends).

**ALWAYS UPDATE** `.planning/ORCHESTRATOR-STATE.md` (add a dated block at the top,
newest-first) at every ship, and push it — it is how the next session (and the
concurrent one) stays correct. START: run STEP 0, then take the next unstarted unit.
