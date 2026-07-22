# Meta audit — GSD state, meta directories, wishlist gap map (2026-07-22)

Consolidated from three parallel audits (GSD planning tree, meta/config dirs, codebase-vs-vision).
Companion to `.planning/prompts/2026-07-22-vision-and-handoff.md` (the vision prompt backup).

---

## 1. Where GSD actually stands (state reconciliation needed)

Four sources disagree about "current":

| Source | Claims |
|---|---|
| `STATE.md` front-matter (2026-07-20) | v1.11 in progress, 1/6 phases, 16% |
| `STATE.md` body (~2026-07-16, never rewritten) | Phase 61 (v1.10) live, awaiting human gate 61-08 |
| `ROADMAP.md` | BOTH v1.10 and v1.11 headers say "— CURRENT"; phases 68–72 unchecked `[ ]`; phase 58 unchecked despite being LOCKED in STATE.md |
| `night-run/BUILD-MARCH-2026-07-20.md` + git log | Phases 64, 68, 69, 70, 71, 72 BUILT + tested (commits bd514b3…31220f5), only wiring deferred |

**Truth (best evidence):** everything through Phase 61 is done; 58 is a resolved-but-unticked gate;
64 + 68–72 are *built-but-unwired-and-unverified*; 62–63 are pixel-gated on Pedro. `HANDOFF.json`
is empty/stale (2026-07-11). STATE.md's "Operator Next Steps" still lists a Phase-51 Docker blocker
that closed 2026-07-12.

### What's actually ahead
1. **v1.11 closeout**: wire + verify phases 68–72 (capability spine, research depth/citations, documents, genui×registry binding, evals seed). No phase dirs / PLAN / VERIFICATION trail exists for them — the march built code without planning artifacts.
2. **v1.10 remainder**: 62 (Knowledge/Studio/Settings/Login redesign), 63 (research-canvas visual surfaces) — blocked on Pedro's pixel gates.
3. **Carried debt**: v1.9 live-acceptance legs (LIVE-03 OAuth, LIVE-04 real email, CLUS-07) — user-only runsheet at `phases/49-.../MORNING-CHECKLIST.md`.
4. **Pre-landed future slices**: 65 Agent Daemon (v2.0), 66 Files Vault (v2.1), 67 Session Streaming (v2.2).
5. **Un-integrated major feature**: 999.39 Cloud Desktop (RFC in `research/cloud-desktop/`) — roadmap itself says it must be folded into VISION.md at next milestone boundary.
6. **Epochs after**: v2.0 Local Agent Platform, v2.1–v2.3, E7 compute pooling (parked).

Milestones shipped: v1.0 → v1.9 (10), v1.10 mostly shipped, v1.11 in flight.

---

## 2. Health & organization issues (prioritized)

### P0 — correctness/security of the planning system itself
- [ ] Reconcile STATE.md (front-matter + body + Operator Next Steps), ROADMAP checkboxes (tick 58; decide 68–72 status = "built/unverified"), refresh HANDOFF.json.
- [ ] Untrack from git: `graphs/graph.json` + `graphs/.last-build-snapshot.json` (25 MB stale build artifacts = 58% of `.planning/`), `night-run/HEARTBEAT` (daemon liveness file), `.planning/.pending-auth-captures.jsonl` (credential-probe capture log — should not live in the repo at all).
- [ ] `CLAUDE.md:23` references skill `.claude/skills/verify-rendered-geometry/SKILL.md` which **does not exist**; `.gitignore` ignores `.claude/skills/` wholesale so new skills silently go untracked. Decide: vendor skills tracked, or fix CLAUDE.md.

### P1 — stale/contradictory docs
- [ ] `README.md`: still titled polytoken.services, calls apps/web a "placeholder" — rewrite for the real monorepo.
- [ ] `COMMANDS.MD`: obsolete nauta-era, Windows-only, contradicts RUN-LOCAL.md (`--host 0.0.0.0` vs mandated `127.0.0.1`, uses `--reload`). Delete or reduce to a pointer at RUN-LOCAL.md + package.json scripts.
- [ ] `scripts/` has only `preflight-local.ps1` (PowerShell). The documented one-command cold start cannot run on Linux (where Claude Code cloud sessions live). Add a bash equivalent.
- [ ] No `.claude/settings.json` (permissions allowlist), no hooks, no commands/agents dirs — the repo is under-tooled for the Claude-Code-first workflow Pedro wants.

### P2 — organization hygiene
- [ ] `todos/pending/` missing (dir gone); `todos/completed/` and `todos/done/` duplicate each other — collapse.
- [ ] `v1.0`/`v1.1-MILESTONE-AUDIT.md` at `.planning/` root; v1.2–v1.9 live under `milestones/` — move.
- [ ] `STATE.md` is 5,451 lines / 572 KB append-only — rotate history into `milestones/` archives; keep <100-line live header.
- [ ] `night-run/` mixes planning docs, 280 KB of reports, runtime `.ps1`/`.cmd` scripts, and a remote-desktop setup kit — split docs from plumbing.
- [ ] `debug/chat-blank-pane.md` unresolved at top level (resolve or file under `debug/resolved/`); empty phase dirs `999.12`, `999.13` orphaned (999.12 already promoted to Phase 55).
- [ ] `research/` mixes milestone-versioned dirs (v1.3, v1.6…) with topic dirs — fold version-scoped research into milestone archives.
- [ ] `.gitignore` blanket `.env*` (line 57) would exclude new `.env.example` files (existing ones tracked only by grandfathering).

### Infra drift (confirmed)
- `polytoken-ses-forwarder` Lambda and `personal-forward` SES receipt rule exist in AWS but are **absent from `infrastructure/aws/ses.tf`** — codify in Terraform (incl. rule ordering vs `forwarding-catchall`).
- Terraform still emits `nauta-services-*` names (`variables.tf` project default) and deploy workflows hardcode `nauta-services-email-listener*` while product is polytoken — naming drift to schedule (a rename is a real migration, not a find-replace).
- SES production access request still pending AWS approval (sandbox until then).
- No committed secrets found in tracked files (scanned for AKIA/keys/JWTs — clean).

---

## 3. Vision wishlist ↔ codebase gap map

| Wishlist item | Status | Evidence |
|---|---|---|
| Email ingest + entity resolution (multi-address → abstract entity) | **Substantially built** | `entity_instances` (aliases, merged_into, halfvec), `sender_profiles`, `resolve_entity_candidates.py` (BlendedRAG RRF), curate/promote/backfill use cases |
| Correctable AI analysis + reprocess-to-date | **Built, bug-suspect** | `entity_type_corrections`, `reprocess_email.py` (fragile SES-id derivation; only supersedes *pending* regions) |
| Circular treemap (emails or drive) on canvas | **Greenfield** | zero treemap/circle-pack code anywhere |
| Excel-like tabular system | **Built but 100% unwired** | full `packages/ui/src/spreadsheet-grid/` (editors, clipboard, find, conditional formatting) imported by NO surface; no persistence schema; agent-suggested tables greenfield |
| Agentic genui home w/ persistent panels | **Exists as /chat canvas, not home** | xyflow panel system + `chat_canvas_layouts` persistence, snap/stash/resize present; home page is the inbox |
| Drive: versioning/backups/quota/files-in-chat | **Vault exists; all four greenfield** | `apps/web/src/app/files/`, files router; no versioning/backup/quota tables; composer has no attach affordance |
| Canvas interactivity (right-click, keyboard, add/remove) | **Partial** | only 2 files with contextmenu/keydown handlers; add via popovers/pickers exists |
| Distributed inference / credit sharing | **Stub only** | `execution_locus` reserves `remote-peer`; WebLLM browser inference works; no credits/BYOK/peers |
| Remote desktops + live cost | **Foundations built** | `desktop_sessions` (hourly_rate_cents, idle reaper), `packages/capabilities/src/desktop.ts`, desktop router + canvas node; real provider binding fail-closed, not live |
| Multiuser / teams / workspaces / sharing | **Greenfield** | single-user `user_id`/`importer_id` anchor everywhere; isolation well-tested; zero sharing/RBAC tables |

### Email AI-analysis bug surface (for the manual-testing review Pedro asked for)
The suspicion of bugs is well-founded; top suspects:
1. ~60 `except Exception` sites; every post-persist ingest stage swallows failures (`propose_regions_failed` etc., `ingest_inbound_email.py:160-313`) → emails that look "received but never analyzed" with no surfaced error.
2. `reprocess_email.py:87` fragile `raw_storage_key.rsplit("/",1)[-1]` with `# type: ignore` on a nullable field.
3. Reprocess supersedes only *pending* regions — human-touched regions never refresh.
4. Reprocess re-runs full ingest → duplicate-region accumulation risk (code comments reference past "thousands of duplicate regions").
5. LLM adapter failures degrade silently to unclassified (`entity_type_classifier_adapter.py:218`, `segmentation_adapter.py:179`, `embedding_adapter.py:68`).
Swallow-branches are the least-tested code; entity resolution + knowledge edges are separate user-triggered flows, NOT part of inbound ingest (the "AI establishes relationships automatically" vision requires wiring them into the pipeline).

---

## 4. Suggested sequencing (proposal, not decided)

1. **v1.11-close + planning-hygiene phase** — reconcile state, untrack blobs, fix CLAUDE.md/README/COMMANDS, wire-and-verify 68–72. Small, unblocks everything.
2. **Email-analysis hardening** — surface swallowed errors, fix reprocess, wire entity-resolution into ingest; produce Pedro's manual-testing runsheet.
3. **Terraform drift codification** (Lambda + personal-forward rule) — small, independent, do early.
4. Then the big verticals in vision order: agentic home (reuse /chat canvas), circular treemap, spreadsheet wiring, drive versioning/quota, canvas interactivity, teams/sharing, distributed inference (E7), remote desktops live.
