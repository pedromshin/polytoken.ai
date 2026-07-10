---
phase: 46-kickoff-hygiene-v1-8-brand-design-dossier
plan: 03
subsystem: design-research
tags: [brand, design-tokens, dtcg, style-packs, research, v1.8-kickoff]

# Dependency graph
requires:
  - phase: 26-28 (v1.4 Chat & Studio Design Uplift)
    provides: the DTCG token contract + 6 style packs this dossier maps onto (packages/genui/src/theme/tokens.ts, packs.ts)
provides:
  - "polytoken brand-identity options: 4 named directions (Nodal, Cortex, Lattice, Constellation) with naming/voice, logo direction, domain posture, rationale, comparison table, and one recommendation (Cortex)"
  - "design-pattern dossier: Claude.ai/ChatGPT/Perplexity-class chat/canvas/panel/knowledge-surface/mobile-responsive patterns mapped onto real v1.4 token aliases and style packs, with 8 concrete additive token-system follow-ups for v1.8"
  - "confirmed naming collision finding: an existing 'polytoken' CLI AI-agent daemon (docs.polytoken.dev, npm package) flagged as a pre-launch v1.8 risk"
affects: [v1.8 milestone kickoff/planning, any future re-skin (RSKN-*) or brand-adoption work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Research-doc rigor: decision-ready Markdown tables (direction/flow rows) + explicit single recommendation, matching FEATURES.md's STACK/FEATURES-style precedent"

key-files:
  created:
    - .planning/research/v1.8-design/BRAND-IDENTITY-OPTIONS.md
    - .planning/research/v1.8-design/DESIGN-PATTERN-DOSSIER.md
  modified: []

key-decisions:
  - "Used 1 of the 2-subagent research budget: one general-purpose researcher subagent fanned out WebSearch/WebFetch across the 5 DSSR-02 flow categories (chat/canvas/panels/knowledge/mobile); DSSR-01's brand-precedent and domain-posture checks were done directly by the parent agent via WebSearch/WebFetch rather than spawning a second subagent, since findings needed synthesis into the same document being drafted"
  - "Recommended brand direction is Cortex (Second-Brain Companion) over Nodal/Lattice/Constellation — VISION.md's north star is explicitly personal/emotional, not infra- or dev-tool-first, and Lattice's E7-compute-network framing would be a premature commitment per VISION's own E7 gating"
  - "Flagged (not resolved) a real naming collision: 'polytoken' is already used by an unrelated local-first AI coding-agent CLI (docs.polytoken.dev, npm package 'polytoken') — recommend v1.8 validate trademark/SEO differentiation before public launch"
  - "DSSR-02's tier-ladder (INFERRED/EXTRACTED) visual system has no competitor precedent to borrow from across Claude.ai/ChatGPT/Perplexity/Notion AI/Tana — recommended as a fresh, purpose-built token addition rather than forced onto an existing alias"

patterns-established: []

requirements-completed: [DSSR-01, DSSR-02]

# Metrics
duration: 35min
completed: 2026-07-10
---

# Phase 46 Plan 03: v1.8 Brand & Design Pattern Dossier Summary

**Two decision-ready v1.8 kickoff research docs: a 4-direction polytoken brand-identity options paper (recommending "Cortex," with a confirmed naming-collision risk flagged) and a design-pattern dossier mapping Claude.ai/ChatGPT/Perplexity-class chat/canvas/panel/knowledge/mobile flows onto the real v1.4 DTCG token aliases and style packs, closing with 8 concrete additive token-system follow-ups.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-10T09:45:00Z (approx.)
- **Completed:** 2026-07-10T10:20:00Z (approx.)
- **Tasks:** 2
- **Files modified:** 2 (both newly created)

## Accomplishments
- `BRAND-IDENTITY-OPTIONS.md`: 4 named brand directions (Nodal, Cortex, Lattice, Constellation), each with naming/voice, logo direction, domain posture, and VISION.md-grounded rationale; comparison table; one explicit recommendation (Cortex) with a 3-sentence justification tying back to VISION's north star and epoch gating.
- Live WebSearch/WebFetch during DSSR-01 research surfaced a real naming collision — an existing, unrelated "Polytoken" local-first AI coding-agent CLI at `docs.polytoken.dev` (npm package `polytoken`) — documented as a cross-cutting risk scored per-direction and folded into the recommendation.
- `DESIGN-PATTERN-DOSSIER.md`: all 5 required flows (chat, canvas, panels, knowledge surfaces, mobile-responsive) each mapped in a sourced Markdown table onto real `TOKEN_ALIASES`/`STYLE_PACKS` from `packages/genui/src/theme/tokens.ts` + `packs.ts`, with gaps explicitly called out (no pill-radius alias, no success/diff tokens, no code-typography alias, no tier-ladder precedent, no graph node-type tokens, no breakpoint-awareness, no hover-state token convention).
- Captured a fresh, dossier-relevant finding: ChatGPT Canvas was removed May 28, 2026 in favor of inline chat blocks, explicitly for cross-surface (mobile/desktop) consistency — directly informs VISION E2's own open "canvas needs a mobile answer" question.
- Closed the dossier with a prioritized "Token-system implications for v1.8" list of 8 concrete, additive follow-ups (no implementation performed).

## Task Commits

Each task was committed atomically:

1. **Task 1: Write the polytoken brand-identity options document (DSSR-01)** - `f93b4d1` (docs)
2. **Task 2: Write the design-pattern dossier mapping AI-product flows onto the v1.4 token system (DSSR-02)** - `e15cb49` (docs)

**Plan metadata:** (this commit) `docs(46-03): complete v1.8 brand & design dossier plan`

## Files Created/Modified
- `.planning/research/v1.8-design/BRAND-IDENTITY-OPTIONS.md` - 4 named brand directions + comparison table + one recommendation (Cortex); 86 lines
- `.planning/research/v1.8-design/DESIGN-PATTERN-DOSSIER.md` - 5 flows mapped onto real v1.4 tokens/packs, sourced, + 8 v1.8 implications; 100 lines

## Decisions Made
- **Research-subagent budget spent 1 of 2**: spawned a single `general-purpose` researcher subagent (foreground) to fan out WebSearch/WebFetch across DSSR-02's five flow categories, since that task required the most breadth of external sourcing. DSSR-01's narrower brand-precedent/domain-posture checks (polytoken.ai availability, "polytoken" trademark/naming search) were run directly by the parent agent via WebSearch/WebFetch rather than spawning a second subagent — the findings needed to be synthesized directly into the document being authored in the same turn, and the plan's budget is a ceiling ("AT MOST 2"), not a requirement to spend both.
- **Cortex recommended over Nodal/Lattice/Constellation** for the DSSR-01 brand direction — grounded in VISION.md's explicitly personal/emotional north star ("the tool that is everything I wanted all of my current AI tools to be") and near-term epoch gating (E2/E3 personal daily use), versus Lattice's premature commitment to the E7 compute-network vision (VISION explicitly calls E7 "LAST, HARDEST," gated on E4 + multi-user tenancy + demonstrated demand) and Nodal's higher collision risk with the existing dev-tool audience already indexing for "polytoken."
- **Naming collision flagged, not resolved**: this phase does not register domains, file trademarks, or touch external dashboards (per plan constraints) — the collision with `docs.polytoken.dev`'s CLI agent tool is documented as a v1.8 pre-launch validation item.
- **Tier-ladder tokens recommended as net-new, not mapped**: DSSR-02 confirms no competitor (Claude.ai, ChatGPT, Perplexity, Notion AI, Tana) exposes an equivalent INFERRED/EXTRACTED confidence-tier visual system, so this is called out as something to design fresh in v1.8 rather than something this research could map onto an existing token.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The researcher subagent hit 403s fetching some official help-center URLs (support.claude.com, help.openai.com) directly; it fell back to WebSearch result snippets of those same URLs and flagged the lower-confidence provenance inline in its findings, which was carried through into the dossier's citations (e.g., several rows note "fetch 403'd, cited via search snippet"). This did not block completion — the dossier's acceptance criteria only require a source citation per row, which was met throughout, with fetch-provenance caveats preserved for transparency.

## User Setup Required

None - no external service configuration required. This plan is documentation-only.

## Next Phase Readiness

- Both DSSR-01 and DSSR-02 artifacts exist under `.planning/research/v1.8-design/` and are ready for `/gsd:new-milestone` to consume directly when v1.8 opens, per VISION.md's E2 epoch.
- Phase 46 is now fully executed (3/3 plans: 46-01 HYGN-01 evidence, 46-02 HYGN-02 debt folds, 46-03 DSSR-01/02 dossier) — ready for phase-level audit/verification and v1.7 milestone close-out.
- No blockers. The naming-collision finding and the 8 token-system follow-ups are the two concrete decision points v1.8 planning should pick up first.

---
*Phase: 46-kickoff-hygiene-v1-8-brand-design-dossier*
*Completed: 2026-07-10*
