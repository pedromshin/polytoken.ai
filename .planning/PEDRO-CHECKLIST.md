# PEDRO — when you're at your computer (ordered)

> Single consolidated checklist of everything that needs YOU (a real machine, dashboard
> access, or a human judgment call). Everything buildable-on-mobile has been shipped to
> `claude/phase-76-summon-loop-al5emg`. Last updated 2026-07-27 · session_01NhVUcfpAuwy4YBkvme7dUp.
> This supersedes the scattered "[PEDRO]" notes in the ledger for day-to-day use; the
> ledger stays the full historical record.

## 0. First: rotate the pasted tokens (security — do before anything else)
The Supabase `sbp_…`, Vercel `vcp_…`, and Stripe LIVE `rk_live_…` tokens you pasted earlier
must be **rotated** — treat them as exposed. They were never committed (env-only), but rotate
them anyway and re-store the new values wherever they live (Vercel/Supabase/Stripe dashboards).

## 1. Verify the shipped work visually (the accumulated browser-pass debt)
Everything below passed tsc + jsdom + design-law gates, but **jsdom does no layout** — these
need a real browser (`npm run web:dev` at root, then `npm run screenshot:review` in apps/web,
both themes). Nothing here is claimed visually-done until you eyeball it:
- **/billing** — per-tier entitlement limits + live "X / Y used" usage meters.
- **/settings/account** — the new Sign-out card.
- **Chat → save-as-document** — the Save action in the message action row → a real stored doc → PDF export.
- **Canvas sources** — open a conversation that collected web sources; confirm source nodes land.
- **Capability confirm card** — when an agent emits a capability binding, the confirm card renders + invokes.
Screenshots land in `apps/web/.planning/ui-reviews/<ts>/` (gitignored, signed-in state).

## 2. Turn billing ON (Stripe + Vercel — classifier-blocked for me)
The auto-mode classifier blocks my outbound curls carrying your live `rk_live_`/`vcp_` keys to
api.stripe.com / api.vercel.com. Two ways to finish (either works):
- **(a)** Add a `Bash(curl:*)` allow rule → I create the Stripe products/prices/webhook + set the
  Vercel env in ~2 min. OR
- **(b)** Do the ~5-min dashboard steps yourself: create Pro ($29) + Power ($49) products/prices,
  a webhook to the billing endpoint, then set Vercel env `BILLING_ENABLED=true`, the price ids
  (`STRIPE_PRICE_PRO` / `STRIPE_PRICE_POWER`), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BILLING_APP_URL`.
- **Before real charges:** legal review of privacy/ToS (LGPD/SCCs), and a Merchant-of-Record decision.

## 3. Apply the DB migration + the two infra changes (needs shared TF state / DB access)
- **`db:migrate`** — migration `0057_sour_peter_quill` (adds `subscriptions.last_event_at`) must run
  before billing is enabled, or the webhook's ordered-sync path errors. Also now **`0058_secret_mesmero`**
  (adds `canvas_recipes` + its RLS policies) for Phase 73 Wave C — safe additive table, no existing data
  touched. `npm run db:migrate` (via the sanctioned `deploy-migrate-prod.yml` path once its
  `environment: production` scoping is fixed — see ledger).
- **IAM `s3:DeleteObject`** grant on the SES inbound bucket (`infrastructure/aws/iam.tf`) — WITHOUT it,
  self-serve account deletion 502s for any user who has received SES mail (right-to-erasure gap).
  **Gated: no TF remote state yet** — do NOT `terraform apply` from a checkout until shared state
  exists + every live resource is imported (`IMPORT-RUNBOOK.md`), or you risk recreating live SES rules.
- **Durable worker** — provision per `docs/DURABLE-WORKER-RUNBOOK.md` (graphile_worker schema →
  migrations 0053/0054 → deploy worker container → flip `INGEST_ENQUEUE_ENABLED`). The worker ECS
  container is **not yet wired in `ecs.tf`** (needs a Node runtime image).

## 4. Flip the safety/feature flags (after a live smoke loop)
Default-OFF today (byte-identical). Flip after a real end-to-end mail loop confirms them:
- `INGEST_TIER_CAPS_ENABLED` — tier-aware ingest caps (free 100 / pro 500 / power 2000 per day).
- `INGEST_BACKGROUND_ENABLED` — fast-200 SNS bridge (mitigates the 15s-timeout retry waste).
- `CANVAS_EMIT_TOOL_ENABLED` — agent-emits-canvas-node/connect.
- (Add an AWS budget cap + an ingest-failure alarm while you're in the console.)

## 5. Round-3 (5-stream) follow-ups — buildable by me next, not blocking
Shipped 2026-07-27 to `claude/phase-76-summon-loop-al5emg` (see ledger ROUND 3). Gate-green; these are
the honest remaining edges:
- **Discoverability wiring** — `/spreadsheets` and `/workspaces` are functional but reachable only by
  direct URL. Small web follow-up: a "Recent tables" `BoardPanel` on the home board (mirror the documents
  panel) + a workspaces entry point / mount the built `WorkspaceSwitcher` in shared nav.
- **MCP server go-live (Phase 77)** — code + tests are in `apps/mcp-server` (SDK installed). Before it
  runs: (a) a runtime build strategy so `node dist/index.js` works (it imports `@polytoken/api-client` as
  TS source — bundle via esbuild/tsup, or build deps to dist first); (b) set `POLYTOKEN_MCP_USER_ID` (your
  auth.users id) + `POLYTOKEN_MCP_TOKEN` + `POSTGRES_URL_NON_POOLING`; (c) add the one `mcpServers` entry
  to your own Claude Code config; (d) MCPX-09 live check — `tools/list` shows the 3 polytoken tools and
  `searchMyKnowledge` returns grounded results from your real graph.
- **code_islands provenance upsert** — the agent code-island path (Phase 76-05) can re-mint a
  `code_islands` row on remount-before-save-flush or delete+reload (islandId is network-minted). Clean fix:
  a provenance-keyed (conversationId, messageId, partIndex) upsert on `codeIslands.create`. LOW; the whole
  path is flag-OFF (`CANVAS_EMIT_TOOL_ENABLED`) until go-live.
- **Table viewer route** — `/spreadsheets` rows are non-navigating cards because a table only opens as a
  canvas node today; wire an open-on-canvas / standalone viewer affordance.
- **Workspace member user-search** — add-member takes a raw user UUID; add a user-search endpoint.
- **Phase 73 Wave C durability (LCAN-09)** — `canvas_recipes.sourceRef` is stored but unconsumed; the
  graphile-worker after-close recompute is the live-only seam (needs the worker provisioned, §3).

## 6. Earlier dark-seam follow-ups (still open)
- **Canvas sources are load-time only** — no mid-session query invalidation yet, so sources collected
  during an open session appear on remount, not instantly. Small web follow-up.
- **Capability confirm card** drives flat-input capabilities today (canvas.connect/removeNode, title-only
  table.update); nested-arg ones (canvas.addNode, table.create) light up when an emit path supplies
  runtime args (the binding descriptor carries primitives only today).

## 7. Deliberately NOT built (GSD hazard / least-urgent — do not batch-build without direction)
- **Workspace *sharing*** — `shareResource`/`listShares`/`revokeShare` + rewriting the ~56 resource list
  queries to `owned ∪ shared`. Master-plan Track 5: each rewrite is a cross-tenant leak with **no RLS
  backstop** (the app connects as `service_role`), and the real-Postgres isolation CI job that would catch
  a mistake does not exist yet (Track 2). Build the isolation job FIRST, then do these one path at a time.
- **Desktop spawn/attach** — GSD ranks remote desktops least-urgent, and spawning bears live $/hr cost.
