# Negative Space — what the brief did NOT say, and the v1.11 draft

**Author:** negative-space (night-run, re-run after the first agent died at the session limit)
**Date:** 2026-07-17 · **Provenance:** derived from user brief 2026-07-16/17
(`DIRECTIVES-2026-07-17.md` D1–D4 + `NIGHT-RUN-2026-07-16.md`), yolo-mode precedent (v1.10 opening).
**Inputs:** the six sibling reports in this dir + `ENDGAME-2-DRAFT.md` + `REQUIREMENTS.md` +
`docs/design/taste-references.md`.
**Status: DRAFT — feeds `/gsd:new-milestone`, does not bypass it.** No phase unlocks from this file.

---

## 0. The one-paragraph reading

The brief names a foggy vision and one hard architectural demand (D2: the product emanates from the
repo). The negative space is not *more features* — it is that **every feature the user named is
already a composition problem, not a construction problem**. Deep research, PDF export, email rules,
files, sessions, the OSS ontology, even the daemon — each is "a capability, declared, permissioned,
composed." The user asked for a self-building product and then listed six things to build by hand.
The derivation is: **build the declaration layer first, then the named features fall out of it, and
the ones we never discussed also fall out of it.** That is the whole negative space. Everything
below is consequence.

Second, smaller reading: the brief's ordering (most-painful-to-lose) and the dependency graph
**disagree**, and the dependency graph wins. Dev-from-anywhere is pain #1 and infrastructure #1.
Research-chat is pain #2 and infrastructure #0. So research leads — as `ENDGAME-2-DRAFT.md` already
concluded, and this report confirms rather than overturns.

Third, the correction the brief needs: **"actually build the concrete features, don't get lost in
peripheral stuff" and D2 are in tension, and D2 wins — but only if D2 stays cheap.** A registry that
takes a milestone to build IS the peripheral stuff. A registry that is a zod declaration + a lookup,
landed inside the research milestone as its spine, is not. The whole design below is sized to that
constraint.

---

## 1. THE CRYSTALLIZING FEATURES — ranked by switching-cost-destroyed per engineering-hour

Scored honestly. "Switch value" = does the user delete an external tool. "Hours" = incremental over
what exists (v1.6 tool loop, RCNV-01 source ledger, genui engine, Phase 63 canvas, Lane B's slice
landing tonight). Ratio is the rank key.

| # | Feature | Switch value | Hours | Ratio | Verdict |
|---|---|---|---|---|---|
| 1 | **In-chat deep research** (RSRCH) | **Very high** — user's stated #1 reason to leave Claude web; the daily habit | Medium — tool loop + web_search + ledger all exist; the delta is loop *depth*, citation discipline, mid-stream refinement, trace UX | **Highest** | **v1.11 spine** |
| 2 | **Document/PDF generation** (DOCS) | **High as a multiplier, low alone** — research the user can't take out of the app hasn't replaced anything; it's the exit door on feature #1 | **Low** — playwright-core print route; the typography is already locked | **Highest (as #1's tail)** | **v1.11 — inseparable from RSRCH** |
| 3 | **Capability registry** (REG) | **Zero today, compounding forever** — retires no tool, and is the only reason v2.0/v2.1/v2.3 aren't three hand-wirings | **Low if scoped as declaration+lookup**, milestone-sized if scoped as a platform | **Highest by NPV, lowest by today's switch** | **v1.11 — the spine, deliberately** |
| 4 | **Email automation rules** (MAIL) | **High but UNREACHABLE** — the ritual only dies on real mail, and real mail is blocked on user-owed LIVE-04 console debt | Low-medium fixture-first (Lane B builds it tonight) | Good, but the payoff is escrowed | **v1.11 absorbs Lane B's slice at frozen scope; the switch moment is v1.12, user-gated** |
| 5 | **Files / self-cloud seed** (CLOUD) | Medium — OneDrive dies only when the *daemon* syncs watched folders; a web vault alone is a worse OneDrive | Medium alone, high to reach switch-grade (needs v2.0's daemon) | Middling | **DEFERRED — Lane D's slice lands as a v2.1 advance slice, not hardened in v1.11** |
| 6 | **Audio / images** | **Near zero** — no external tool dies; nobody leaves Claude web over TTS | Low each, unbounded in aggregate | Low | **DEFERRED → backlog 999.28** |

### The picks for v1.11: **RSRCH + DOCS + REG**, with MAIL frozen at its slice.

Rationale, stated once: research is the cheapest high-pain switch and is *fully autonomous to
build* (no console debt, no user gate, no hardware). Documents are its exit door and cost almost
nothing. The registry is the one thing that gets more expensive every phase we don't have it — and
v1.11 is the last milestone where it's cheap, because v2.0's daemon is being built **tonight**
(Lane C) and will otherwise ship a second, divergent tool abstraction that we then have to merge
under load.

### Explicitly deferred out of v1.11

- **Files vault hardening / self-cloud** → v2.1. Lane D's slice lands and is *registered*, not extended.
- **Session streaming hardening** → v2.2. Lane E's slice likewise.
- **Real-mail automation switch moment** → v1.12, gated on LIVE-04/LIVE-03/CLUS-07 (user console, ~30 min).
- **Audio, images, multimodal** → 999.28. Bedrock bolt-ons on real need; never a milestone.
- **Remote desktop** → 999.26 (and D3's RDP-over-Tailscale floor already covers travel).
- **OSS/MCP ontology** → 999.27 / v2.3. Rides REG; do not pre-build.
- **Orgs / teams / RLS-as-primary / billing** → gated on a launch decision (tenancy-arch §3, verbatim).

---

## 2. ARCHITECTURE INVARIANTS the foggy vision implies

Each: one line, why, and the **cheap accommodate-now move**. Nothing here is a build order except
INV-1..4, which are v1.11 Phase 68.

### The spine (D2)

**INV-1 — One registry, four consumers.** Every tool/query/mutation/data-source declares itself once
(zod in, zod out, metadata: what it does, what it needs, what it returns, cost class, risk class);
that one declaration is read by the LLM (as a tool), genui (as a composable block), the daemon (as
an executable), and the canvas (as a node type).
*Why:* D2 is unbuildable otherwise — genui can only compose what it can enumerate, and four
hand-maintained lists drift within one milestone.
*Cheap now:* `packages/capabilities` — a `Capability` type + `defineCapability()` + a registry map.
Register the **existing** chat tools through it and make the chat tool loop read from it. That is
the whole first move: no new capability, one deleted list.

**INV-2 — The daemon's ToolExecutor and the registry are the same abstraction.** Lane C's
ToolExecutor must resolve tools by **registry id**, not a `switch` on tool name; its allowlist file
keys on registry ids; its permission prompt renders from the entry's `risk` field.
*Why:* this is the reconciliation the directive flags. Lane C is building the daemon-side half
tonight with no registry to point at. If it ships a private tool enum, v2.0 and D2 diverge and the
merge is a refactor under load.
*Cheap now (tonight, if Lane C is still open):* Lane C defines its executor's tool descriptor with
**exactly** the INV-1 field names (`id`, `input` zod, `output` zod, `risk`, `cost`, `describe`), even
before `packages/capabilities` exists. Then Phase 68 is an import change, not a rewrite. If Lane C
has already merged, Phase 68 owns the adapter — still cheap, still one file.
*Instruction to the orchestrator: send this to `exec-lane-c` / `plan-lane-c` before their executors commit.*

**INV-3 — v2.3's ontology is this registry pointed outward.** An MCP-discovered, agent-installed
tool is a registry entry whose `source` is external.
*Why:* D2 §4 says so, and frontier §A says the ecosystem's differentiator is **curation, not
access** — which is a *field on an entry*, not a subsystem.
*Cheap now:* the `Capability` type carries `source: "builtin" | "external"` and
`trust: "first-party" | "verified" | "claimed" | "unvetted"` (Glama's tiering, per frontier §A) from
day one. Both are constants today. Zero cost, and v2.3 becomes a populate, not a re-architecture.

**INV-4 — Risk is data, not code; ONE permission model reads it.** No capability implements its own
confirm flow.
*Why:* v2.0 promises "ONE permission model." A registry where risk lives in each call site cannot
deliver it. Also the taste law: confirm modals and `--bad` share exactly one scope — the
irreversible (`taste-references.md` §2.2).
*Cheap now:* `risk: "safe" | "reversible" | "irreversible"` on the entry; the existing confirm-action
widget machinery (v1.6 Fork-2) keys off it. The madder rule becomes machine-checkable.

**INV-5 — The infrastructure is the limit, deliberately: a generated feature can do exactly what the
registry exposes, no more.** This single sentence is both the safety model and the extension model.
*Why:* D2 §3, verbatim, and it is the reason genui-that-mutates isn't terrifying.
*Cheap now:* one adversarial test — a genui spec binding an unregistered capability **fails closed**
— written in Phase 68 alongside the registry. That test is the invariant's only enforcement, and it
is ~30 lines. (Precedent: `cross-tenant-adversarial.test.ts`, `react-flow-stock-ban.test.ts` — this
repo already encodes lessons as law-tests, per codebase-health §5.)

**INV-6 — Generated ≠ blessed.** A genui-composed feature is INFERRED tier; a human bless promotes it
to EXTRACTED before it can run unattended or mutate on a schedule.
*Why:* the project's oldest settled stance (suggest-only, never auto-decide — entity resolution,
LEARN-02, RCNV-03) applied to D2. Without it, "self-building" means "self-breaking, silently."
*Cheap now:* reuse the existing promotion gate; a generated spec is born dashed (`--sugg`), promoted
solid (`--conf`). No new vocabulary, no new UI — the mark language already carries it.

**INV-7 — Everything the product emits carries a ledger ref.** Reports, documents, generated panels,
rule decisions.
*Why:* "provenance is the product" (taste §1) is a design law that only stays true if it's an
architectural one; also the only way a regenerated document is trustworthy.
*Cheap now:* new emitting tables carry `source_ledger_id` (RCNV-01's ledger, Phase 56). Additive.

### Tenancy (verbatim from `tenancy-arch.md` §2 — not re-derived; that report is ADR-ready as written)

**INV-8 (D1) — Ship user-as-tenant.** Orgs arrive later as `memberships(user_id, account_id, role)` +
an `account_id` indirection resolved *inside* `ownership.ts`. *Cheap now (ADR, not code):* mandate
that all scope resolution flows through `ownership.ts` — forbid inline `auth.uid()`/`user_id =`
joins in new routers; adopt the vocabulary "**owner principal**" for `user_id` in docs. **Do not add
`account_id` columns yet.**

**INV-9 (D2ᵗ) — App-boundary is primary enforcement; RLS is the live second wall.** *Cheap now:*
promote `0034`'s header note to a standing ADR + the rule: **every new user-owned table ships BOTH
`deny_all_<t>_anon` (RESTRICTIVE) and `<t>_owner_authenticated` (PERMISSIVE, auth.uid()) in the same
migration.** Don't build the non-superuser connection path.

**INV-10 (D3ᵗ) — `importer` is a per-sender sub-grouping owned by a user; it is never the tenant
boundary.** *Cheap now:* that sentence, in an ADR. It is the costliest silent mistake available.

**INV-11 (D4ᵗ) — Storage keys are opaque; authorization is ALWAYS a DB ownership assert, never path
parsing.** New buckets/keys prepend a stable owner-derived prefix. *Cheap now:* ADR; already true —
lock it in. **Directly binding on Lane D's `/files` vault tonight** (paths `{userId}/...` is correct;
the invariant is that the *authz* never reads that prefix).

**INV-12 (D5ᵗ) — Decouple from the auth vendor at the FK seam.** *Cheap now — the one place code is
warranted:* add a `public.profiles` mirror (id = `auth.users.id`, trigger-populated, the canonical
Supabase pattern) and point **new** app FKs at the public schema we own. Existing FKs stay.

**INV-13 (D6ᵗ) — Every metered/billable event row carries the owner principal at creation.**
*Cheap now:* ADR. `chat_cost_ledger` already does it. Don't build plans/quotas/Stripe.
**Binding on v1.11:** research runs are the first genuinely expensive capability — see Q7.

### Craft (D1, already binding)

**INV-14 — Taste is a standing contract, not a milestone artifact.** `docs/design/taste-references.md`
+ `58-IDENTITY.md` are read before every surface, forever; click-economy and the anti-generic
checklist are review criteria. *Cheap now (owed per D1):* fold the checklist into
`.claude/skills/polytoken-design-system/SKILL.md` so it auto-loads for every agent — then it survives
without an orchestrator remembering. **This is also codebase-health §6's lever:** the repo has **zero
CLAUDE.md files**; the tribal knowledge exists but sits where Claude Code never auto-loads it.

---

## 3. DRAFT v1.11 MILESTONE

> **Name:** v1.11 — Research Core & the Capability Spine
> **Goal (one line):** Leave Claude web for research — in-chat deep research that cites, exports,
> and composes — with every capability declared once in a registry the LLM, genui, the canvas, and
> the daemon all read.
> **Switch moment (the ladder's bar):** the user runs a real research session in polytoken instead
> of claude.ai, and the output leaves as a document. **First dogfood: D4's own AI-engineering
> research corpus lives in the product** (the user asked for exactly this — DIRECTIVES D4 close).

### Reconciliation with tonight's phases 64–67 (do NOT duplicate)

Tonight's lanes ship **vertical slices**, not phases-as-usually-scoped. Phase numbers are global in
this repo (49→63), so nothing renumbers. The correct mapping:

| Phase | Lane | Tonight's slice | Milestone home |
|---|---|---|---|
| **64 — Research, Documents & Mail Rules** | B | research loop + PDF export + rules matcher, fixture-first | **ABSORBED into v1.11 as its Phase 1.** Not re-planned. Its SUMMARY is the phase record; v1.11's later phases deepen it. |
| **65 — Agent Daemon** | C | daemon, ToolExecutor, permission model, WS protocol, one watched folder | **v2.0 advance slice.** Registered under v2.0 in ROADMAP, *not* claimed by v1.11 — except INV-2, which v1.11 Phase 68 reconciles. |
| **66 — Files Vault** | D | `/files` over Supabase Storage | **v2.1 advance slice.** Registered under v2.1. Not hardened in v1.11. |
| **67 — Session Streaming** | E | daemon PTY → WS → `/sessions` terminal | **v2.2 advance slice.** Registered under v2.2. |

So **v1.11's phase list is: 64 (absorbed), 68, 69, 70, 71, 72.** 65/66/67 are recorded in ROADMAP
under their own milestones as "advance slice landed 2026-07-17" — this is the honest accounting the
user's depth-first rule demands: a slice is real and usable, and the remaining breadth is enumerated,
never faked.

### Requirements

**Research (RSRCH)**
- **RSRCH-01**: A research request in chat runs a real multi-step agentic loop (plan → search rounds → fetch/read → adversarial verify → synthesize), streaming progress as tool rounds. *(Phase 64 slice = the floor; Phase 69 = the depth.)*
- **RSRCH-02**: Every claim in a report resolves to its source — 3-tier disclosure on the existing `pmark` (mark = tier 1, hover popover = tier 2, sources panel = tier 3). **No footnote-number system, no citation component** (taste §3).
- **RSRCH-03**: Sources used auto-land in the RCNV-01 ledger and appear as canvas nodes (reusing Phase 63's RCNV-02 work) — zero capture ceremony.
- **RSRCH-04**: A running research job accepts mid-stream refinement without restart; its trace collapses to one line when done, one click to re-expand.
- **RSRCH-05**: Research quality is measured — a fixed question set + scored rubric, re-runnable, so a regression is detectable rather than felt.

**Documents (DOCS)**
- **DOCS-01**: Any report/message exports to a typeset PDF on the locked identity (serif evidence, 45–75ch measure, provenance marks preserved).
- **DOCS-02**: Documents are first-class objects — stored, listed, re-openable, linkable as canvas nodes — not one-shot downloads.
- **DOCS-03**: A document is regenerable from its spec + ledger; provenance survives regeneration (INV-7).

**Registry (REG)**
- **REG-01**: One capability registry: every tool/query/mutation/data-source declares zod input/output + metadata (describe, needs, returns, `cost`, `risk`, `source`, `trust`). (INV-1, INV-3)
- **REG-02**: The chat tool loop reads its tool list **from** the registry. The old hand-maintained list is deleted, not shadowed.
- **REG-03**: The daemon's ToolExecutor + permission model resolve by registry id; the allowlist keys on registry ids; the permission prompt renders from `risk`. One store, not two. (INV-2, INV-4)
- **REG-04**: A genui spec can **bind** to a registry capability — a generated panel performs a real query and a real mutation, bounded by the registry. An unregistered capability fails closed. (INV-5 — **this is D2's minimum viable proof**)

**Mail (MAIL — frozen at the slice, real-mail proof escrowed)**
- **MAIL-01**: The rules matcher runs over the fixture corpus, suggest-only, reviewed in-context near the inbox (HEY Screener model, never a `/settings` Rules page — taste §3).
- **MAIL-02**: Rules execute as **registry capabilities**, not a bespoke engine — the generality proof that REG isn't a one-consumer abstraction.

*(No CLOUD-* family in v1.11 — deliberately. Lane D's vault is a v2.1 advance slice.)*

### Phase breakdown (6 phases; 5 new)

**Phase 64 — Research, Documents & Mail Rules (vertical slice)** · *ABSORBED, built 2026-07-17*
Covers: RSRCH-01 (floor), DOCS-01 (floor), MAIL-01.
Success criteria: as declared in `LANE-CONTRACTS.md` §"Slice definitions → B", verified by its own
SUMMARY. **Do not re-plan.** v1.11 opens with this phase already green.

**Phase 68 — The Capability Spine**
Covers: REG-01, REG-02, REG-03, MAIL-02.
1. `packages/capabilities` exists: `Capability` type + `defineCapability()` + registry map, zod in/out, metadata incl. `cost`/`risk`/`source`/`trust`.
2. The chat tool loop enumerates tools **from** the registry; the prior hand-maintained list no longer exists (grep proves it — not "is unused").
3. The daemon's ToolExecutor resolves by registry id and its allowlist keys on registry ids; a permission prompt's copy is derived from the entry's `risk`, not hardcoded per tool.
4. Phase 64's mail rules are re-expressed as registry capabilities with zero behavior change (the generality proof — if this hurts, the registry is wrong and we learn it here, cheaply).
5. Adversarial law-test: an unregistered capability is unreachable from **every** consumer (LLM loop, daemon, genui) and fails closed.
6. `run_chat_turn.py` (2263 lines, 2.8× the max) is carved at this contact point — tool-loop branches out to `use_cases/chat/` (codebase-health §6.4: carve it *when a phase touches it*, and this phase touches it hardest).

**Phase 69 — Research Depth & Citation Discipline**
Covers: RSRCH-01 (depth), RSRCH-02, RSRCH-03, RSRCH-04.
1. A research run executes a multi-round loop with an explicit adversarial-verification step, not a single search-and-summarize; measured on the Phase 72 question set.
2. Every claim's citation resolves to a source excerpt via `pmark` 3-tier disclosure — **hover costs 0 clicks, the panel costs 1** (taste §3). No second mark language exists (law-test).
3. Sources land as canvas nodes with no per-turn confirm widget (RCNV-03's ban holds).
4. Mid-stream refinement lands without restarting the run; the trace collapses on completion.
5. Report body renders at 45–75ch measure — **verified on the rendered PNG in both themes, never from source** (MEMORY: rendered-geometry blind spot; jsdom does no layout).

**Phase 70 — Documents as First-Class Objects**
Covers: DOCS-01 (typeset), DOCS-02, DOCS-03.
1. PDF export is typeset on the locked identity; a human reads the PDF (not the HTML) and it is not a screenshot of a web page.
2. Documents list, re-open, and appear as canvas nodes; a document node wired to a chat node injects it as context (RCNV-04's edge mechanic — reuse, don't rebuild).
3. Regenerate-from-spec reproduces a document with provenance intact (INV-7).
4. Empty state teaches the next action; the surface passes the anti-generic checklist (taste §6).

**Phase 71 — Genui × Registry Binding (the D2 proof)**
Covers: REG-04.
1. A genui spec **binds** a registry capability: one generated panel performs a real query.
2. The same panel performs a real **mutation** through the ONE permission model, with `risk` driving whether it confirms (INV-4).
3. A new primitive written **only in code** (a new `defineCapability` + no genui change) becomes composable from chat immediately — demonstrated live. **This is the milestone's D2 acceptance bar.**
4. A generated feature is born INFERRED/dashed and requires a human bless to run unattended (INV-6).
5. Fails-closed proof: a spec naming an unregistered capability renders an error, never a partial mutation.

**Phase 72 — Research Evals & the Observability Seed**
Covers: RSRCH-05.
1. A fixed question set + scored rubric lives in the repo and re-runs on demand; a research-quality regression is *detectable*.
2. Each run records cost, latency, tool rounds, source count — attributed to the owner principal (INV-13); a per-run cost ceiling is enforced and visible.
3. The judge is cheap and repeatable (LLM-judge, Haiku via Bedrock Batches — MEMORY's cost note), **no observability platform adopted** (that's 999.30, and D4's audit should decide it with evidence).
4. The eval harness is itself a registry capability — the self-building product measures itself with its own substrate.

### Non-goals (explicit)

Real inbound email and the mail switch moment (LIVE-03/04, CLUS-07 — user console debt, v1.12) ·
files-vault hardening (v2.1) · session-streaming hardening (v2.2) · remote desktop (999.26, D3's
RDP-over-Tailscale floor covers travel) · the OSS/MCP ontology (999.27/v2.3 — REG carries the seam,
nothing more) · audio/images (999.28) · browser control (v2.0) · orgs/teams/RBAC/RLS-as-primary/
billing (launch decision; tenancy-arch §3 verbatim) · adopting an agent framework or an
observability platform (999.30 — D4's audit decides with evidence, not this draft) · a perception
stack.

### Autonomously buildable vs user-gated

| Requirement | Status |
|---|---|
| RSRCH-01..05, DOCS-01..03, REG-01..04, MAIL-01/02 | **Fully autonomous.** No console debt, no hardware, no third-party account. This is why research leads. |
| **Taste gate** on Phases 69/70/71 surfaces | **User-gated (soft):** screenshot review, both themes, human reads the PNGs. Standing rule from D1 + eleven bugs shipped through green suites this milestone. Does not block the next phase; does block "done." |
| **MAIL switch moment** (rules on real mail) | **User-gated (hard):** LIVE-04. Escrowed to v1.12 — v1.11 claims only the fixture proof. |
| **REG-03** (daemon half) | **Coupled, not gated:** depends on Lane C's 65 slice existing. If C slipped, Phase 68 ships the registry + chat/genui consumers and REG-03 lands with 65. Never divergent — the field names are frozen by INV-2 tonight either way. |
| **D2 bless** | **User-gated (advisory):** DIRECTIVES D2 is explicitly "DRAFT for your bless." Phase 68/71 *implement* the seam at its cheapest scope; if the user rejects the framing, Phase 71 is dropped and Phase 68 survives on its own merits (one tool list instead of three). **Nothing here is a bet-the-milestone move.** |

---

## 4. THE UNASKED QUESTIONS (their explicit ask — each with a recommended default, so nothing blocks)

**Q1. When a generated feature is confidently wrong, what happens?**
The brief describes generation and bounds, never failure. A registry bounds *blast radius*, not
*correctness* — a panel can query exactly the right capability and present a wrong conclusion.
**Default:** INV-6 — generated is INFERRED/dashed forever until a human bless; unattended or
scheduled execution requires promotion. The suggest-only stance the project has held since entity
resolution, applied to D2. Costs nothing, and it is the difference between self-building and
self-breaking.

**Q2. Do you actually intend to leave Claude web, or run both?**
"Good enough to switch from Claude web" is a feature-parity framing; parity with a
thousand-engineer product is not reachable and not the point.
**Default:** assume **dual-run for ~3 months**, and make the success metric behavioral, not
featural — *"which surface did you open first this week."* Parity chasing is exactly the "peripheral
stuff" the brief warns against; the one axis worth winning is the one Claude web structurally
cannot: **your research is on your canvas, next to your email, in your ledger, exportable, and
composable.** Build that axis; concede the rest.

**Q3. What is the ONE dogfood corpus, and what happens if the product can't hold it?**
**Default:** D4's own AI-engineering research (the user said they want to save references *inside*
polytoken instead of Claude). It is the first real corpus, and it is a load test: if v1.11 can't
hold the research about how to build v1.11, the milestone failed and we learn it in week one rather
than at the switch moment. **This is the cheapest honest gate in the whole plan — take it.**

**Q4. Which parts are the open-source surface?**
"Accommodate open-sourcing" was stated; *what* gets opened never was. It matters now because
it determines where secrets and tenant logic may live.
**Default:** assume the OSS surface is **`packages/capabilities` + `packages/daemon-protocol` +
`packages/genui`** — the substrate, not the app. Decide nothing today; just keep those three
packages free of tenant logic, env-coupling, and Supabase imports. That is a code-review rule, not
a project. (The registry being open is also what makes v2.3's ontology *interesting* to anyone else.)

**Q5. What is the cost ceiling on a research run — and who enforces it?**
Deep research is the first capability that can burn real money on a single user action, and
`chat_cost_ledger` **attributes** cost but does not **cap** it.
**Default:** per-run hard cap declared in the registry entry's `cost` field, enforced in the loop,
surfaced in the trace UI ("4 rounds · 12 sources · $0.31"). Cap first, tune later. Also: adopt
Bedrock prompt caching on the chat path (999.15, already open, and research runs make it stop being
cost hygiene and start being the bill).

**Q6. Who picks the model per capability?**
Model control shipped as a *user* control; the brief never says who picks when the *agent* composes.
**Default:** the registry entry declares a **model class** (`cheap` | `standard` | `deep`), never a
model id; the resolver maps class→model in one place. Ad-hoc per-call model picks are how a product
gets a $400 month and an unmovable model migration. (Also the only clean seam for Q5's cap.)

**Q7. Can the current chat backend carry multi-agent graphs — and is a framework the answer?**
D4 asks it; the honest pre-answer matters because it changes Phase 68's shape.
**Default:** **carve, don't adopt.** `run_chat_turn.py` at 2263 lines is the actual constraint, not
the absence of LangGraph — and a registry *is* the graph's node type. Carve it in Phase 68; let D4's
audit propose a framework **only** against a measured failure the registry doesn't fix. A framework
adopted before the registry would calcify the wrong abstraction. (Recorded as a prediction so D4 can
falsify it — that's the point of writing it down.)

**Q8. What is the durable memory of this project's *lessons*, given zero CLAUDE.md files exist?**
Not asked, materially compounding: the most expensive recurring lesson in the project (jsdom does no
layout — four bugs in one night) lives **only** in user-global memory, invisible to every subagent.
**Default:** adopt codebase-health §6's top 2 as v1.11 Phase 68 hygiene (they're one hour, additive,
zero risk): a root `CLAUDE.md` of **pointers, not prose** (npm-not-pnpm, `build` vs `build:local`,
the env split, jsdom-no-layout→`test:geometry`, playwright port-3000/one-worker, a "where things
live" table) + fold the taste checklist into the design-system skill (D1's owed action). **A
self-building product whose builders start blind every session is a contradiction.**

**Q9 (bonus). Is v2.2's session streaming already solved by someone else?**
frontier §B found Claude Code's own **Remote Control** (any browser/mobile as a viewport onto a live
local session) and **Routines** (cloud-hosted scheduled agent runs) shipped in 2026.
**Default:** Lane E's slice lands and stays (it's built, it's ours, it composes with the registry).
But before v2.2 is *funded as a milestone*, spend 30 minutes evaluating Remote Control — the brief's
pain #1 may already be retired by a product the user already pays for. Registered as 999.36.

---

## 5. NEW BACKLOG ITEMS (suggested 999.x — the corpus currently ends at 999.25)

**999.26 — Remote desktop, luxury tier.** D3's RDP-over-Tailscale floor is enough to install things
and keep developing (and is one UAC click from done). The near-physical-latency tier is a separate
bet: per `frontier.md` §B, run **Sunshine on the box** as the primary interactive path (NVENC on the
RTX 4060, Moonlight client on whatever device is at hand, sub-30ms reported, zero subscription), and
stand up **Selkies (WebRTC) behind Cloudflare Tunnel + Cloudflare Calls TURN** as the pure-browser
fallback for devices that can't install Moonlight — accepting the TURN relay's latency tax on that
path only. **Do not build a streaming stack**; the space is dense with mature OSS. Critically,
frontier's finding is that the human's remote-desktop path and the agent's browser automation
(Playwright-MCP / agent-browser) are *different problems* — conflating them adds latency and
fragility to both. Sequenced at v2.2, gated on the always-on PC. *Cites frontier §B.*

**999.27 — The OSS/skill/MCP ontology (v2.3).** Agents discover → vet → install → run third-party
capabilities. Per `frontier.md` §A: **adopt** the Official MCP Registry (~8,400 verified servers) as
the trust root and **Smithery's Toolbox** meta-MCP as the dynamic dispatch model (an agent queries
for the right tool at runtime rather than knowing it in config); Context7 for docs freshness; GitMCP
as the zero-config repo fallback. **Build only the thin vetting gate** between "discovered" and
"installable" — because the load-bearing ecosystem finding is that curation, not access, is the
differentiator (SkillsBench: 47,150 skills, avg quality 6.2/12; Snyk ToxicSkills: prompt injection
in 36% of skills tested; curated libraries raised pass rates 16.2pp). This item is a **populate**, not
an architecture, **if and only if** INV-3 lands in v1.11: an external tool is a registry entry with
`source: "external"` and a `trust` tier. *Cites frontier §A.*

**999.28 — Audio & images in chat.** Bolt-ons to the existing Bedrock transport on real demonstrated
need, never a milestone (ENDGAME-2-DRAFT already calls this cross-cutting). Scored dead last in §1:
no external tool dies when it ships. Revisit only if a real workflow stalls on it — and when it does,
it arrives as two registry capabilities, which is the whole point of building the spine first.

**999.29 — Post-cutoff research cadence.** Per `frontier.md` §C, the infrastructure this project
depends on churns faster than training-data refresh (Smithery Toolbox, agentskills.io, Claude Code
Routines/Remote Control, Cloudflare Calls TURN, the SkillsBench audits — all 2026-dated, none
reliably in model memory). Adopt: a **weekly ~10-min WebSearch pulse** on a standing query set, a
**per-milestone `/deep-research` deep pass** at kickoff, and — the important half — a **trigger**:
any plan proposing an external tool/registry/protocol as an architectural dependency auto-fires a
research pass before the bet locks. Source priority: official repos/READMEs > Anthropic's own
changelog > security/quality audits > dated "vs" comparisons (cross-check numbers against two
independent tests). **Meta-note:** this practice is itself the first thing that should live *inside*
polytoken (Q3). *Cites frontier §C.*

**999.30 — Evals & observability platform decision.** D4's stated weak axis, and the honest read:
**we have essentially none, and that is the actual bottleneck for a self-improving system** (email
extraction, genui, chat quality). v1.11 Phase 72 seeds the cheap half (question set + rubric +
per-run trace records). The platform question — Langfuse / Braintrust / Phoenix class — stays open
until D4's audit can decide it against real traces rather than a feature matrix. **Do not adopt a
platform before there is something to observe.**

**999.31 — Carve `run_chat_turn.py` (2263 lines) and `container.py` (1284).** Per codebase-health
§1/§6.4: only ~4 first-party files exceed the 800 max — a *focused* problem, not sprawl. Do not
launch a grand split. `run_chat_turn.py` is the one file where size demonstrably taxes agent
throughput (every chat-backend phase re-reads it; merge-conflict magnet). v1.11 Phase 68 carves it
*at contact*; `container.py` waits for its own contact point. Everything else on the outlier list
stays.

**999.32 — Repo-visible agent memory: root `CLAUDE.md` + two micro-skills.** codebase-health's
headline: **zero CLAUDE.md files exist anywhere**, yet the hard-won knowledge already exists in
`docs/RUN-LOCAL.md` — parked at a path Claude Code never auto-loads. The knowledge is written; it is
in the wrong location. Add: a pointers-not-prose root `CLAUDE.md`; a **`verify-rendered-geometry`**
skill (never trust jsdom for layout — run `test:geometry`/`screenshot:review`, read the PNG, port
3000 reuse, one worker) which attacks the single most expensive recurring class of overnight failure;
and a **`verify-class-in-built-css`** micro-script (token strings in source lie; the compiled artifact
doesn't — MEMORY's "madder-on-a-status"). ~1–2 hours total, pure additive, pays back in one session.
Folded into v1.11 Phase 68 as hygiene per Q8; kept here so it survives if that phase reshapes.

**999.33 — Rule-based email automation beyond suggest-only.** `vision-corpus.md` §5.4's genuinely
uncovered area: 999.19's LEARN loop covers *classification learning*, but user-authored declarative
rules with **actions** (forward, extract-to-sheet, schedule) have no backlog home. v1.11's MAIL-01/02
ships the matcher + suggest-only review; the *acting* half needs real mail (LIVE-04) and a human's
trust before it fires unattended (INV-6). Sequenced v1.12, behind the console debt.

**999.34 — True multi-org / team tenancy.** `vision-corpus.md` §4: per-user tenancy shipped
(v1.7 Phase 44); multi-org is uncovered and implicitly gated behind E7's parked precondition. Per
`tenancy-arch.md` §3, **build none of it now** — orgs, memberships, RBAC, RLS-as-primary plumbing,
per-tenant buckets, billing, sharing, audit logs, SSO. Each becomes a mechanical,
chokepoint-localized migration *if* INV-8..13's conventions are written down now. Unpark only on a
launch decision.

**999.35 — Saving references inside polytoken.** From D1's correction: the user's "curated
references" turned out to be an Instagram-caption scrape and a business take-home PDF — **no
first-person design-taste document exists anywhere**, and the taste layer was built from researched
best-in-class patterns instead. The user's own words point at the fix: saving references is a thing
they want to do *inside* polytoken. This is D2 + v1.11's research core meeting at the first real
dogfood (Q3), and it's the cheapest possible v1.11 follow-on: a reference *is* a source ledger entry
with a canvas node. Also the concrete unblock for a sharper taste layer — if real references exist
elsewhere (Mobbin boards, saved screenshots, a Figma), they should land here.

**999.36 — Evaluate Claude Code Remote Control / Routines before funding v2.2.** frontier §B:
Anthropic shipped **Remote Control** (browser/mobile as a viewport onto a live local session) and
**Routines** (cloud-hosted scheduled agent runs, no local process) in 2026 — which may already
retire the brief's pain #1 ("develop from anywhere") without a remote-desktop stack *or* our own
session streaming. Lane E's slice stays regardless (built, ours, composes with the registry). But 30
minutes of evaluation before v2.2 is funded as a milestone is the highest-leverage half-hour on this
list. *Cites frontier §B; see Q9.*

---

## Appendix — what this report deliberately did not re-derive

- **Tenancy** — `tenancy-arch.md` §2 is ADR-ready; INV-8..13 quote it. Do not re-analyze; write the ADRs.
- **The ladder v1.12→v3.0** — `ENDGAME-2-DRAFT.md` survives this pass intact. The only amendments:
  (a) v1.11's name/scope sharpen from "Research & Documents Core" to "Research Core & the
  **Capability Spine**" (D2 postdates the draft and makes REG the spine, not a v2.0 detail);
  (b) v2.3's ontology is downgraded from a milestone-sized build to a **populate** of the v1.11
  registry (INV-3); (c) 65/66/67 are recorded as advance slices of v2.0/v2.1/v2.2.
- **Backlog 999.1–999.25** — canonical in `ROADMAP.md ## Backlog`; new items start at 999.26.
- **Phase 64's plan** — Lane B built it tonight; v1.11 absorbs its SUMMARY as the phase record.
