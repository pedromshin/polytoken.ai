# 07 — Solo vs Team: what stays AI-driven, what forces a hire, and how to pay for it

Research date: 2026-07-22. Ground rules per `README.md`: every externally-stated claim is
sourced (URL) or labeled **ASSUMPTION**. Repo-grounded claims cite paths. Companion tracks:
`03-fundraising.md` (solo-founder funding data), `05-cost-structure.md` (infra burn this
staffing plan sits on top of), `06-compliance-and-privacy.md` (the obligations that force
the first external spend), `08-milestones-to-fundability.md` (the milestones each hire maps to).

---

## 1. The baseline: what the repo proves can stay AI-driven-solo

The strongest evidence in this whole folder is the repo itself. What one founder + agents has
demonstrably covered (per `.planning/PROJECT.md`, `.planning/research/2026-07-22-META-AUDIT.md`,
git log):

| Function | Solo-with-AI status | Evidence |
|---|---|---|
| Product engineering (full-stack: Next.js/tRPC/Drizzle web + FastAPI Clean-Architecture backend + Terraform) | **Proven** | 10 shipped milestones v1.0–v1.9; phases 64+68–72 built in overnight runs (`night-run/BUILD-MARCH-2026-07-20.md`, commits bd514b3…31220f5) |
| QA / regression discipline | **Proven, unusually strong** | committed gates: screenshot harness, geometry tests, palette bans, WCAG checks, adversarial tenancy suites, import-linter architecture enforcement |
| Design system + visual identity | **Proven at system level** | `packages/ui`, `docs/design/taste-references.md`, phase-58 identity gate — pixel taste still gated on Pedro personally |
| Planning / PM / documentation | **Proven (with hygiene debt)** | GSD tree in `.planning/`; the meta-audit shows drift but also shows the system self-audits |
| Security engineering (app-level) | **Proven at design level** | per-user RLS on 13 tables, SSRF-guarded web tool, fail-closed cost circuit breaker, CSPRNG forwarding tokens |
| Infra/DevOps (single-region, small) | **Proven** | Terraform-managed AWS stack at ~$50/mo (05 §1), though with drift debt (meta-audit §2) |

This matches the 2025–26 environment: solo founders are 36.3% of new startups (H1 2025, up from
23.7% in 2019 — [Carta Solo Founders Report](https://carta.com/data/solo-founders-report/)), and
"the first five hires — sales, marketing, ops, customer success, finance — can now be replaced
or delayed with AI" is an explicitly argued playbook
([Foundra, "The Solo Founder Ceiling," May 2026](https://www.foundra.ai/key-reads/solo-founder-ceiling-ai-stack-hire-first-may-2026-fortune),
[Pancake](https://getpancake.ai/blog/replacing-first-five-hires-with-ai) — advocacy sources,
directional). The operating rule from that literature worth adopting verbatim: **hiring is the
option of last resort — first ask whether the work can become a repeatable system an agent runs.**

**ASSUMPTION:** this velocity is sustainable because the founder is also the sole user and sole
reviewer. Both stop being true the day outside users arrive; the sections below are about
exactly which functions break first.

---

## 2. Where hires (or paid externals) are unavoidable for an email + drive + inference product

Ordered by when they bind, not by cost. The forcing functions are specific to *this* product:
it reads other people's email 24/7, promises to store their files, and burns metered inference.

### 2a. Binds before launch (external spend, not headcount)

1. **Legal counsel** — incorporation, SAFE docs, ToS/privacy policy for an email-reading
   product, IP assignment of pre-incorporation solo work (track 02). Always external; never a hire
   at this stage.
2. **Security review / pen test (contract)** — a product whose pitch is "forward me all your
   mail" cannot self-attest security. A one-off external pen test of the ingest path (SES →
   listener → S3 → DB) and the RLS/tenancy model is a contractor engagement by nature.
   **ASSUMPTION:** $5–20K one-off for a scoped app pen test at this size; get quotes.
3. **Accounting/bookkeeping (fractional)** — trivial until revenue; a few hundred $/mo after.

### 2b. Binds at "real outside users" (the first true hire decision)

4. **On-call / reliability — the real reason for engineer #1.** The ingest pipeline is a 24/7
   system with a documented silent-failure surface: ~60 `except Exception` sites where every
   post-persist stage swallows errors, so mail can be "received but never analyzed" with no
   alarm (meta-audit §3, `ingest_inbound_email.py:160-313`). Today the entire on-call rotation
   is one human's sleep. AI agents can *fix* incidents; they cannot yet be the accountable pager
   for other people's mail. This is a **key-person-risk answer for investors** as much as an
   operational need (03 §1 lists it among the standard solo objections). Note Carta finds solo
   founders actually hire *earlier* than teams — the data supports planning this hire, not
   deferring it indefinitely ([Carta Solo Founders Report](https://carta.com/data/solo-founders-report/)).
5. **Compliance operations (fractional first)** — LGPD/GDPR data-subject requests, DPO
   obligations, SOC 2 evidence collection (track 06). DPO-as-a-service and vCISO retainers exist
   precisely so this is not a hire until the customer base demands SOC 2 Type II.

### 2c. Binds only if/when the expansion products ship (do NOT staff ahead)

6. **Drive (polydrive) at scale** → storage/infra engineer (durability, backup verification,
   quota enforcement — data-loss liability per track 06).
7. **Distributed inference / credit marketplace** → this is effectively a second company
   (marketplace + adversarial-peer security; 01 §2d) and needs specialist hires. Tracks 01/03
   already recommend parking it; the staffing cost is another reason.
8. **Remote desktops live** → infra + abuse/fraud surface (billed VMs) — at minimum a second
   engineer before GA.
9. **Sales/marketing/support** — for a prosumer PLG product at $15–25/mo, defer behind AI
   tooling + founder-led support until clearly past seed. First GTM hire only when a repeatable
   motion exists to hand over.

**The honest headcount curve:** 0 employees through pre-seed close is defensible and increasingly
normal; 1–2 engineers between pre-seed and seed; compliance/GTM stay fractional until seed.
**ASSUMPTION:** this maps to polytoken's milestones (08 §2) as: hire #1 triggered by ≥100 real
users or the first paid cohort, whichever comes first.

---

## 3. Contractor vs employee

### 3a. Decision rule

Contractor when the work is a bounded deliverable (pen test, SOC 2 evidence prep, a design
sprint, a data migration); employee when the person must carry ambient, open-ended
responsibility — on-call, product judgment, roadmap ownership. A 30-day paid trial before
converting to full-time is a common de-risking pattern
([Startupa.ge first-hire guide](https://startupa.ge/blog/how-to-hire-first-startup-employee)).
For polytoken specifically: everything in §2a is contract; §2b item 4 is the first genuine
employee.

### 3b. IP assignment is non-negotiable either way

Every contractor and employee signs a PIIA/CIIA-style invention-assignment + confidentiality
agreement before touching the repo — for a product whose moat claims include the codebase and
capability registry, un-assigned contractor IP is a diligence-killer (ties into track 02's
pre-incorporation IP cleanup). **ASSUMPTION:** standard practice, not sourced to a single URL;
any startup counsel will confirm.

### 3c. Brazil-specific reality (PJ vs CLT vs EOR)

**ASSUMPTION** (carried from tracks 02/03): Pedro is Brazil-based/-connected, and the natural
first hires may be Brazilian. The structures:

- **CLT (formal employment)** costs the employer roughly **70–100% on top of base salary**
  (INSS 20%, FGTS 8%, Sistema S, RAT, 13th salary, vacation bonus)
  ([Kaptas Global, Brazil hiring costs 2025](https://kaptasglobal.io/blog/brazil-hiring-costs-2025-total-cost-guide),
  [salary-calculator.ai Brazil](https://salary-calculator.ai/brazil-salary-calculator)); one
  worked example: $50K base ⇒ ~$75K total employer cost before EOR fees
  ([Kaptas](https://kaptasglobal.io/blog/brazil-hiring-costs-2025-total-cost-guide)).
- **PJ (contractor via the person's own legal entity)** is the dominant startup pattern —
  cheaper and fastest to start — **but misclassification risk is severe**: a labor court finding
  subordination/exclusivity/economic dependence reclassifies retroactively, owing back FGTS,
  INSS, 13th, vacation, plus the 40% FGTS termination penalty, potentially for years
  ([Multiplier, contractors vs employees in Brazil](https://www.usemultiplier.com/brazil/hiring-contractors-vs-employees),
  [Nearshore Business Solutions](https://nearshorebusinesssolutions.com/news/contractor-vs-full-time-employee-latam/)).
  A full-time, exclusive, on-call engineer #1 on PJ is exactly the profile that gets reclassified.
- **EOR (Deel/Remote/etc.)** if the hiring entity is the Delaware C-corp (02's likely structure)
  with no Brazilian subsidiary: **$400–999/employee/mo** admin fee, onboarding in 5–15 business
  days ([Peorient EOR Brazil guide](https://peorient.com/blog/employer-of-record-brazil/),
  [Gloroots](https://www.gloroots.com/blog/best-eor-in-brazil)); Deel at the premium end
  $599–999/mo plus 3–5% FX fees ([Kaptas](https://kaptasglobal.io/blog/brazil-hiring-costs-2025-total-cost-guide)).

**Recommendation:** true deliverable-scoped work → PJ contractors, honestly scoped (no fixed
hours, no exclusivity). Engineer #1 → EOR-employed CLT under the Delaware entity (or CLT under
the Brazilian operating company if the Tostada structure from 02/03 is chosen). Budget the CLT
multiplier into the hire's real cost from day one. If hiring US/global instead, standard
1099-contractor → W-2 conversion norms apply and the cost delta is far smaller.

---

## 4. Equity planning norms (2025–26 data)

### 4a. Option pool

Create a **10–15% option pool** at the first financing — the entrenched investor norm; recent
data medians: **~12.5% at seed**, trimmed to 10–12% at Series A
([Carta option-pool guide](https://carta.com/learn/startups/equity-management/option-pool/),
[No Cap blog on pool sizing](https://nocap.blog/startup-option-pool-size-pre-seed-vs-series-a/),
[Glencoyne pre-seed pool guide](https://www.glencoyne.com/guides/share-option-pool-pre-seed)).
Negotiation note: the pool is carved pre-money (it dilutes the founder, not the investor), so
size it to the *actual* 18-month hiring plan — which per §2 is 1–2 people — not to the 15%
default. A bottom-up plan justifying ~10% is credible and saves real points.

### 4b. Early-hire grant benchmarks

| Hire | Median grant (4-yr vest, 1-yr cliff) | Source |
|---|---|---|
| First engineering hire | **~2.0%** (range 1.5–2.5%) | [SaaStr on Carta data](https://www.saastr.com/how-much-equity-to-give-your-first-employees-the-real-data-from-50000-startups) |
| Hire #1 (any role) | 1.50% | [Carta, Equity for Your First 8 Hires](https://community.carta.com/c/corporations-updates/equity-for-your-first-8-hires) |
| Hire #2 | 0.85% | same |
| Hire #3 | 0.50% | same |
| Hire #4 / #5 | 0.44% / 0.33% | same |
| First sales/BD | 1.0–2.0% | [SaaStr/Carta](https://www.saastr.com/how-much-equity-to-give-your-first-employees-the-real-data-from-50000-startups) |
| First designer/PM | 0.8–1.5% | same |

AI-market premium: AI-specialist engineers are commanding multiples of ordinary grants —
"AI engineers are getting ~3x the equity" and $250K cash for seed-stage seniors is described as
the new normal ([Motive Notes](https://www.motivenotes.ai/p/ai-engineers-are-getting-3x-the-equity),
[Carta, AI shifts in compensation](https://carta.com/data/AI-shifts-in-compensation/)).
**Mitigation for polytoken:** engineer #1 does not need to be a frontier-AI researcher — the AI
leverage is already systematized in the repo. Hire a strong product/infra generalist at normal
benchmarks; the premium market is for a talent pool this product doesn't require yet.

### 4c. Advisors

Medians have compressed: **0.21% at pre-seed, 0.12% at seed** (Carta H1 2024 data via
[ICanPitch advisor guide](https://www.icanpitch.com/blog/startup-advisor-equity-guide)); only
10% of pre-seed advisors get ≥1%. Use the **FAST agreement (v3, June 2026)** with the standard
**24-month monthly vesting, no cliff**
([youstartups advisory-shares guide](https://youstartups.com/advisory-shares)). This corrects
track 03 §4's older 0.1–0.5% placeholder — for the 1–2 VC/PE contacts recruited as advisors,
0.15–0.25% each is the defensible 2025–26 number, more only for a name that demonstrably
de-risks the raise.

### 4d. Founder vesting (the solo-specific clause)

Investors in a solo company will almost certainly require the founder's own shares on a vesting
schedule (typically 4 years, sometimes with credit for time served) as the key-person-risk
backstop. **ASSUMPTION:** norm asserted from practice, varies by lead — decide the
credit-for-time-served ask *before* the first SAFE conversation, not during.

---

## 5. Key-person risk: the answer that doesn't involve hiring

The standing VC objection to solo (03 §1) is partially answered by artifacts that already exist
and should be maintained *as an investor-facing asset*:

1. **The repo is self-documenting by construction** — CLAUDE.md, `docs/RUN-LOCAL.md`, the GSD
   planning tree, phase VERIFICATION trails. A competent engineer + agent could resume the
   project. Keep this true (the meta-audit's hygiene fixes are therefore diligence prep, not
   housekeeping).
2. **Advisor bench** (§4c) of 1–2 named, vested advisors from the VC/PE network.
3. **The explicit hire plan in this document** — investors don't need the team to exist at
   pre-seed; they need to see the founder knows exactly which function breaks first (on-call for
   the ingest pipeline) and what it costs to fix.

---

## 6. Bottom line

- Stay at **zero employees** through the live-loop close and first design-partner cohort
  (08 §2 M0–M3); spend externally only on counsel, a scoped pen test, and bookkeeping.
- **Engineer #1** (product/infra generalist, shares the pager) is triggered by real-user load —
  target at/just after the first outside capital; budget ~2.0% equity + Brazil CLT-multiplied
  cash or US-market salary; EOR if hiring into Brazil from a Delaware entity.
- Everything else stays **fractional/contract** (compliance ops, design polish, GTM) until seed.
- Pool 10–12% (bottom-up justified), advisors 0.15–0.25% on FAST v3 terms, founder accepts
  vesting with a negotiated time-served credit.
- Never staff ahead of the expansion products (drive/inference/desktops) — each carries its own
  hires and none is on the fundable critical path (01 §3, 03 §6).
