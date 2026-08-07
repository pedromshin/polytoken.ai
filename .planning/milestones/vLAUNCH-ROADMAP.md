# vLAUNCH — Durable Mail & First Dollar (Phases 78–81)

**Status:** OPEN (blessed per Pedro's 2026-08-07 marching orders D1 "BLESSED as proposed";
formalized by the driver under the nonstop order — assumption A1 in
[../ASSUMPTIONS-2026-08-07.md](../ASSUMPTIONS-2026-08-07.md)).
**Source of truth for scope:** [PROPOSAL-vLAUNCH.md](PROPOSAL-vLAUNCH.md) (27 requirements).
**Execution plan:** [VLAUNCH-WAVE-PLAN.md](VLAUNCH-WAVE-PLAN.md) (collision matrix, wave plan,
human-gate batches, safety rails — LAW for every lane).
**Prep artifacts:** [vlaunch-prep/](vlaunch-prep/) (0a cutover runsheets · 0b BILL-04 harness ·
0c UAT pack + WEDGE-BASELINE skeleton).

| Phase | Name | Requirements | State |
|---|---|---|---|
| **78** | Durable Ingest Cutover | CUT-01..10 | CUT-03 essentially banked (image pipeline green, ECS wired dark); CUT-01 half-done; rest = the runbook sequence, Batch-A-gated |
| **79** | Billing Go-Live | BILL-01..07 | BILL-02/03 DONE (billing LIVE 2026-08-06); BILL-01 shrunk to durable-key mint; BILL-04→07 human-gated (🚦BILL-05 blocks public pricing) |
| **80** | Live-Acceptance Burn-Down | BURN-01..06 | Prep staged (screenshot cascade scenario merged; runsheets ready); execution = Batch A/B + one overnight |
| **81** | Wedge Opener | WEDG-01..04 | WEDG-03 metric code MERGED dark (Wave 0); 81 stays LAST + SERIAL — baseline reads only the fully-live stack |

**Wave 0 (pre-bless prep): SHIPPED 2026-08-07** — 5 build lanes merged behind full gates + 10-angle
review (`8263578c`, CI green). **Wave 0.5 (follow-up burn + dark wiring): in flight same day.**
Waves 1–4 per the wave plan; human gates batched as 🅰 (unblock everything) and 🅱 (prod flips +
close). vNEXT closes via BURN-06 (all 7 Decision-Ledger rows executed/dispositioned) →
`audit-milestone` → `complete-milestone` → **sauce-backup ritual (BLOCKER)** per
[../decisions/2026-08-07-HARNESS-LOCK.md](../decisions/2026-08-07-HARNESS-LOCK.md).
