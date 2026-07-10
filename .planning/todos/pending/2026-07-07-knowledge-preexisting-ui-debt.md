---
created: 2026-07-07
title: /knowledge pre-existing UI debt — glassmorphism ban violations + raw glyph icon
area: web/knowledge
files:
  - apps/web/src/app/knowledge/_components/graph-toolbar.tsx
  - apps/web/src/app/knowledge/_components/filter-rail.tsx
  - apps/web/src/app/knowledge/_components/node-detail-pane.tsx
  - apps/web/src/app/knowledge/_components/taxonomy-banner.tsx
resolves_phase: 51
---

## Problem

Found by the Phase-32 UI review audit (32-UI-REVIEW.md, score 19/24). Pre-existing on
`/knowledge` — NOT introduced by Phase 32, but violating contracts locked in v1.4:

1. **Glassmorphism ban (docs/design/product-register-and-bans.md item 3):** `backdrop-blur-md`
   persists at `graph-toolbar.tsx:42`, `filter-rail.tsx:96`, `node-detail-pane.tsx:373`,
   `taxonomy-banner.tsx:46`. v1.4 closed the app's blur debt for /chat + /studio; /knowledge
   predates that sweep and was never audited.
2. **Icon vocabulary break:** `graph-toolbar.tsx:73` renders a raw `⊞` Unicode glyph instead of
   a `lucide-react` icon.

## Solution

Mirror the v1.4 blur-debt closure: replace `backdrop-blur-md` surfaces with solid
`bg-background/95`-style treatments (see conversation-rail resolution, Phase 28), and swap the
`⊞` glyph for the appropriate lucide icon (e.g. `LayoutGrid`). Small, mechanical; candidate for
a polish pass or fold into the next milestone touching /knowledge.
