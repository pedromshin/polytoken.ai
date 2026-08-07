# MORNING REPORT — overnight run, 2026-08-07 (~04:30 → ~07:30)

**TL;DR: four waves shipped, merged, pushed, CI green. The chat-turn cap system is LIVE
end-to-end on both chat paths. One live incident (worktree junction deletion) — fully recovered
from git, zero loss, codified into law. One lane safety-blocked (correctly). Everything left
needs your sitting: [BATCH-A-SITTING.md](BATCH-A-SITTING.md).**

## Shipped overnight (all hostile-reviewed, full gates at every merge, main = `b8401780`)

| Wave | What landed |
|---|---|
| **0.5** (6 lanes) | Listener-side monthlyChatTurns gate (server-locus, pre-insert, fail-open) · duplicate-createdAt fix · over-allowance toast · tier narrowing → billing · RQ-v5 fix · structural stream classifier · migration-sourced worker SQL · email-detail 901→603 · ship-dark ecs.tf flip wiring + staging worker CI |
| **0.6** (16-item review batch) | **Parity fixture** (`chat-cap-parity.json`, both language suites assert it) · fail-closed tier narrowing · paid `over_limit` rides SSE → Billing toast on the primary path · **draft preservation** on cap block (one-click restore) · tier = active/trialing BOTH gates (A11) · panel status machine · controller <800 · gather/head-count · e2e typecheck in CI · staging mirrors prod (build/scan unconditional, push gated) · migration-by-content |
| **0.65** (breadth) | WorkspaceSwitcher in nav (+ sheet-close) · `/spreadsheets/[id]` read-only viewer · workspace add-member **user search** · 999.21 sidebar root-cause + pin · screenshot camera scenarios (/billing, /settings/account, /workspaces, /spreadsheets) |
| **0.7** (queue burn) | `run_chat_turn.py` 1905→1236 (AST-verified verbatim carves ×4) · test-double consolidation ×3 (union fakes, identical counts) · `jsonlStreamConsumer` replaces vendored decode · WebLLM draft-restore parity · worker-image composite action (+ paths-filter fix) |

**Reviews:** three 10-angle rounds over the night; 26+ findings filed with outcomes
(ReportFindings); every CRITICAL/HIGH fixed pre-push or explicitly queued.
**Gates at final push:** listener 2190 + mypy(329) + ruff + lint-imports · api-client 839 ·
web 2267 (174 files) + e2e tsc leg · billing 31 · worker · CI: prod deploy ✅ web ✅ (0.7 CI
watcher was still running at report time — check `gh run list` if curious).

## 🔥 Incident (resolved, zero loss)
The 0.65 nav lane created node_modules **junctions pointing at the main checkout**; my worktree
`rm -rf` sweep followed them through npm's workspace links and deleted **1265 tracked files**
(`packages/*`, `apps/daemon`) from the working tree. All deletions were unstaged → `git restore .`
recovered everything; `npm install` rebuilt node_modules; full gates re-verified green before the
0.7 push. Codified as the **WORKTREE JUNCTION LAW** in VLAUNCH-WAVE-PLAN §4 (own-worktree
junctions only; reparse-point-safe cleanup; never `rm -rf` a worktree dir). Your `.env*` files and
the listener venv were never touched.

## ⛔ Safety-blocked (correctly — no retry)
The **legal-pack lane** (billing-terms page + privacy contact) was killed by the safety
classifier: publishing live billing terms requires your **BILL-05 written GO** (ASSUMPTIONS A4
boundary). It stays a draft task for your sitting.

## Live-behavior changes you should know about
- **Free tier: 200 chat turns/month is enforced on BOTH paths** (browser + server models), with
  the friendly upgrade message, one-click draft restore, and fail-open on any lookup error.
- **Paid tiers: never blocked**; over-allowance shows one Billing toast per session.
- **Tier for enforcement = active/trialing only** (A11) — a `past_due` pro enforces as free.
  Say the word if you want a dunning grace window.

## What needs YOU (nothing else is executable)
1. **[BATCH-A-SITTING.md](BATCH-A-SITTING.md)** — the ordered ~60-min script (fresh session,
   staging one-paste, PROD_* + 0061, worker staging leg + zero-churn plan gate, Stripe durable
   key, BILL-04/BTAP-07/MCPX-09 clicks).
2. **[ASSUMPTIONS-2026-08-07.md](ASSUMPTIONS-2026-08-07.md)** — backcheck A1–A12 (A11 tier
   posture and A12 widget-path policy are the two real decisions).
3. **Decision sheet §C** — SES paste + Legal/MoR confirm.

## Addendum — Wave 0.8 (after the first report was written)
- ✅ **Upsell banner shipped** (`040f4d45`, web 2287 tests / 175 files green, CI watched): the
  last billing-map debt ("no upgrade prompts outside /billing") is closed — a quiet ink notice
  above the composer at ≥80% of a finite chat-turn allowance, dismissible, fail-quiet, power
  tier never sees it. Recorded **A13**: it reads the *display* tier, not A11's status-narrowed
  enforcement tier (a lapsed pro gets no warning before the block) — one shared helper away if
  you want it changed.
- ⏳ **Capability nested-args lane: STALL #1 → relaunched.** The first attempt was killed by the
  **Fable 5 usage limit** (a model-budget stall, not a code failure). The session was switched
  to Opus and the lane relaunched once, investigation-first. If it stalls again it stops for
  good and lands in your lap as a decision, per the two-strikes rule.
- 🔒 **SECURITY FIX — read this one (`26da8ea4`).** The nested-args lane came back
  "not contained" (right answer), but its hostile reviewer refuted the analysis's core claim
  and I verified the refutation in the code: the **agent-emitted capability binding path was
  reachable from untrusted content**. The listener stores `emit_ui_spec` JSON verbatim; the
  web strips `capability` *before* the strict spec parse (so `.strict()` never rejected it);
  the invoker is mounted with five real write-tier mutations; and the confirm card showed
  **no arguments** — so an instruction injected via an email body or a web-search result
  could put a live "Approve" in front of you for an action you couldn't see. Fixed three
  ways: a **default-OFF kill switch**, **required argument disclosure** on the card, and
  **fail-closed arg validation** before any approve is offered. Nothing user-visible changes
  (no emitter exists). Recorded as **A14**; full write-up at `docs/NESTED-ARGS-ANALYSIS.md`.
- Everything else in this report stands; the Pedro-gated list is unchanged.

## Token spend (subagents, whole night)
~7.4M across 5 workflows (Wave 0 1.48M · reviews ~3.1M · 0.5 1.38M · 0.65 1.06M · 0.7 1.34M)
plus driver-session usage. 63 subagents, zero unresolved errors, 2 lanes blocked-and-resolved,
1 safety-blocked (respected).
