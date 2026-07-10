# Phase 48: Token-System Extensions - Context

**Gathered:** 2026-07-10
**Status:** Ready for planning
**Mode:** Smart discuss, autonomous — grey areas resolved with dossier-grounded recommendations
auto-accepted under the user's standing "DO EVERYTHING" mandate. All additive; nothing removes or
renames an existing alias (VISION guardrail: "extend, don't discard — the token discipline is the
asset that makes a re-skin cheap").

<domain>
## Phase Boundary

`packages/genui/src/theme/` (tokens.ts TOKEN_ALIASES + packs.ts STYLE_PACKS) is extended with the
dossier punch list, each new alias consumed at its designated call sites. This phase does NOT
re-skin whole surfaces (Phase 49) and does NOT implement the mobile layouts (Phase 50) — it lands
the primitives + two recorded conventions those phases build on. Existing packs/specs must remain
valid; the WCAG-AA contrast and token-family registration regression gates extend to every new
alias.

</domain>

<decisions>
## Implementation Decisions

### D-48-01 (LOCKED): radius.pill
New alias in TOKEN_ALIASES + all 6 packs. Value semantics: a full-round radius (e.g. 9999px)
allowed to vary per pack ONLY if a pack deliberately wants squared chips (brutalist may legitimately
choose a small value — its zero-radius identity wins over pill-ness; document the exception inline).
Consumers to convert in THIS phase: citation chips (`<ProvenanceLink>` chip rendering), follow-up
chips if present, tab pills in studio chrome — surfaced 3× independently in the dossier (flows a+c).

### D-48-02 (LOCKED): color.success / color.successForeground
All 6 packs, WCAG-AA verified via the existing per-pack inline contrast-ratio comment convention +
the committed contrast regression test (extend it). First consumers: existing success-toast/confirm
visuals where semantically correct — but do NOT relabel control actions (the dossier's rule:
stop/cancel is `color.muted*`, never destructive; success is for confirmed-good outcomes only).

### D-48-03 (LOCKED): typography.code.family
All 6 packs get an explicit monospace answer. brutalist migrates its JetBrains Mono
display-family workaround onto the new alias (display.family returns to a display face of its
register — pick within brutalist's identity, e.g. keep mono for display AND code if that IS its
identity; the point is code.family exists explicitly, not that display must change — planner
decides with the pack's register comment as source). Other 5 packs: a sensible mono stack
(ui-monospace/SFMono/Consolas class). Consumer: inline code/code-block rendering in chat markdown
+ genui code islands chrome.

### D-48-04 (LOCKED): tier-ladder tokens
`color.tier.inferred` / `color.tier.extracted` (+Foreground pair each) as purpose-built aliases —
NEVER overloading accent/muted (dossier flow d: genuinely novel, no competitor precedent).
Semantics: EXTRACTED = confirmed/trustworthy (stronger, closer to primary/success family),
INFERRED = provisional (quieter, clearly distinct from disabled/muted). All 6 packs, AA-checked.
Consumers converted in THIS phase: the knowledge tier badges (apps/web knowledge components +
knowledge-preview canvas node badge styling) — currently styled via generic tokens.

### D-48-05 (LOCKED): graph node/edge-type palette
A closed, small palette (exactly the types the canvas renders today: email, chat/conversation,
knowledge, artifact/genui-panel + edge tiers where colored) as DTCG aliases per pack. Consumer:
the xyflow canvas node chrome (apps/web canvas node components) — replacing any hardcoded
differentiation. Zero raw hex in TSX (D-03/STYLE-03). Closed = adding a node type later REQUIRES a
new alias (documented rule), preventing palette drift.

### D-48-06 (LOCKED): hover/active-state convention
ONE documented derivation rule, recorded in `docs/design/` (extend the design docs, cite from the
brand guide): interactive-state styling derives from the resting alias via a fixed recipe (e.g.
hover = accent surface or a fixed opacity/mix step; active = one step stronger) — token-driven
where cheap, documented-utility where not. The deliverable is the RULE (written, with examples
applied to the chips/badges this phase touches), not a sweep of every component (Phase 49 applies
it broadly).

### D-48-07 (LOCKED): breakpoint-awareness decision (TOKN-07 — gates Phase 50)
A recorded design decision (`docs/design/breakpoint-decision.md` or brand-guide section):
- Chosen shape: keep pack tokens breakpoint-STATIC; breakpoint behavior lives in a small set of
  documented layout primitives/Tailwind conventions (md: breakpoint = the canvas/feed switch line),
  plus ONE new density mechanism only if genuinely needed by Phase 50's feed layout.
- Must answer: which breakpoint switches canvas→feed (default: Tailwind `md` 768px), how
  spacing.density interacts with small screens (minimum touch-target guard ≥44px on interactive
  elements regardless of pack density), and what Phase 50 may/may not add.
The dossier calls this "the largest structural gap — its own design conversation"; the decision doc
IS that conversation's output. Minimal mechanism: a `touch-target` utility/guard + the documented
md-breakpoint rule is sufficient; do NOT build a per-breakpoint token dimension this milestone.

### D-48-08 (LOCKED): verification
Extend the existing committed gates: WCAG-AA contrast test covers success + tier + graph palette
pairs in all 6 packs; token-family registration test covers every new alias (the "var exists but
utility never registered" bug class). Use the Phase 47 screenshot harness for a before/after
capture of a chip/badge surface as the visual evidence artifact.

### Claude's Discretion
- Exact HSL values per pack (within register identity + AA gates), alias naming details
  (`color.tier.inferred` vs nested shape — follow existing TOKEN_ALIASES naming idiom),
  file organization within packages/genui/src/theme/.
- Whether follow-up chips exist yet as a component (if not: convert citation chips + tab pills
  only; note it).
</decisions>

<code_context>
## Existing Code Insights

- `packages/genui/src/theme/tokens.ts` (160 lines): 20 TOKEN_ALIASES today; `packs.ts` (365
  lines): 6 packs with inline WCAG contrast comments.
- Committed regression gates from v1.4: WCAG contrast test + token-family registration test (find
  them in packages/genui tests — extend, don't fork).
- `<ProvenanceLink>` is the ONE shared provenance primitive (chips + preview node) — pill radius
  lands there once.
- Knowledge tier badges: apps/web knowledge components (tier ladder INFERRED/EXTRACTED from v1.5);
  knowledge-preview canvas node (v1.6).
- Canvas nodes: NODE_TYPE_REGISTRY (3 entries as of v1.6) + xyflow node chrome in apps/web.
- Locked renderer files (spec-renderer.tsx, render-node.tsx, genui-part-boundary.tsx) stay
  byte-identical — token consumption changes happen in consumer components, not the locked
  renderer.
- CONCURRENT SESSION WARNING: another chat session is rebooting local Supabase — do NOT touch
  supabase/, .env files, or run DB-dependent tests this phase (none should be needed; the theme
  work is DB-free).

</code_context>

<specifics>
## Specific Ideas

- Dossier sequencing note: pill radius + breakpoint-awareness recurred across the most flows
  (3 and 2) — they are the load-bearing items.
- The two "novel" systems (tier + graph palettes) are polytoken differentiators — design them to
  look intentional, not bolted on.

</specifics>

<deferred>
## Deferred Ideas

- Canvas-first 7th style pack (CNVP-01, v2).
- Per-breakpoint token dimension (explicitly rejected this milestone by D-48-07).
- Motion/animation timing tokens (dossier flow a gap — not in TOKN scope; backlog candidate).

</deferred>

---

*Phase: 48-token-system-extensions*
*Context gathered: 2026-07-10 via autonomous smart discuss*
