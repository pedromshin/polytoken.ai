# Phase 17: Tier A — Design-Token/Theme Layer + Style Packs + Assembly RAG - Discussion Log

> **Audit trail only.** Not consumed by downstream agents (researcher/planner/executor).
> Decisions are captured in 17-CONTEXT.md — this log preserves how they were reached.

**Date:** 2026-06-28
**Phase:** 17-tier-a-design-token-theme-layer-style-packs-assembly-rag
**Mode:** discuss (interactive); Area 4 resolved with documented defaults after the user switched to `/gsd:autonomous` mid-session
**Areas selected by user:** Style packs, Stylization depth, Assembly RAG, Measuring the win (all four)

## Area 1 — Style packs (the look)
| Question | Options offered | Chosen |
|----------|-----------------|--------|
| Pack count | ~5–6 / ~3 / 8+ | **~5–6** |
| Aesthetic range | Distinct brand personalities / Variations on one baseline / You describe | **Distinct brand personalities** |
| Authoring | Hand-authored DTCG JSON / Parameterized / Hybrid | **Hand-authored DTCG JSON** |
| /studio selection | Dropdown + Auto/Surprise / Dropdown only / Auto-from-intent | **Dropdown + Auto/Surprise** |
→ D-01..D-04.

## Area 2 — Stylization depth (how custom)
| Question | Options offered | Chosen |
|----------|-----------------|--------|
| Depth | Color+personality / Color-only / + per-component token props | **+ per-component token props** (maximal) |
| Model styling role | Pack-driven deterministic / Model picks from token aliases / You decide | **Model picks from token aliases** |
| Fonts | Curated fonts per pack / System only / You decide | **Curated fonts per pack** |
| Provenance | Pack id in envelope + cache key / Render-only / You decide | **Pack id in envelope + cache key** |
→ D-05..D-08 (+ D-09 contrast constraint, derived: model-chosen colors must not regress a11y).

## Area 3 — Assembly RAG (what + how)
| Question | Options offered | Chosen |
|----------|-----------------|--------|
| Retrieve over | Catalog + curated exemplars / Catalog only / Catalog + template embeddings | **Catalog + templates — fullest feasible now, behind a seam that receives the deferred (embedding/FLY) structure** |
| Method | Lightweight deterministic now / Embeddings now / You decide | **Most-full implementation now, documented + seamed for the deferred complex structure** |
| Exemplars | Hand-authored real / Promote from prior / You decide | **Hand-authored real exemplars** |
| Prove influence (RAG-02) | Log retrieved ids + assert in eval / Manual / You decide | **Log retrieved ids + assert in eval** |
→ D-10..D-14. User's framing drove the `RetrievalProvider` seam (ship fullest-now, drop-in embedding/promotion later) — mirrors Phase-11's edge-provider seam.

## Area 4 — Measuring the win (eval) — *documented defaults (autonomous)*
User switched to `/gsd:autonomous /strategic-compact` before this area's questions. Per autonomous discipline
(never block, pick defaults + document), resolved with research-grounded defaults rather than interactive Q&A:
- Style-distinctiveness = **additive, separately-reported** signal (preserves Phase-16 baseline comparability) — D-15.
- Distinctiveness **measured deterministically** (same intent under ≥2 packs, token/structure divergence) — D-16.
- Added **LLM-judge "custom-not-generic / on-brand"** sub-criterion (escalation judge, temp 0) — D-17.
- Pass bar = **no regression on the 4 criteria (a11y HARD, incl. new contrast) + lift on composed/on-intent + positive distinctiveness**, via `compare_reports.py` — D-18.
- Runner gains **`--style-pack`/`--all-packs`** mode — D-19.

## Deferred ideas captured
FLY flywheel (embeddings/promotion) — seamed not built; catalog expansion (Ph18); form engine (Ph19);
code-island + axe/adversarial fixtures (Ph20, sign-off); pairwise/TrueSkill ranking; model-chosen pack
selection; per-request remote fonts.

## Scope creep redirected
None raised — discussion stayed within STYLE/RAG. Catalog/forms/code-island explicitly kept to their phases.
