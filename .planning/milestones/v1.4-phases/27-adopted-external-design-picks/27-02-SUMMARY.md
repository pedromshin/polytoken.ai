---
phase: 27-adopted-external-design-picks
plan: 02
subsystem: ui
tags: [react, radix-accordion, lucide-react, studio, file-tree, magic-ui]

# Dependency graph
requires: []
provides:
  - "FileTree — a trimmed, data-driven file/folder tree component (apps/web/src/components/file-tree.tsx) built on raw @radix-ui/react-accordion, exported for reuse by any future multi-file-tree consumer (v1.5+)"
  - "Code-Island tab's preset picker is now a FileTree (4 preset folders -> island.js leaves) instead of a <Select>"
affects: [28-token-value-pass, future-multi-file-code-island-work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "External hand-port convention: fetch source at execution time via gh/curl, re-verify license, content-review for fetch/eval/process.env/dynamic-import, mandatory attribution header (source URL + license + fetch date) at top of file"
    - "Build directly on a raw Radix primitive instead of this repo's own @nauta/ui wrapper when the wrapper bakes in an unwanted style (accordion.tsx's font-medium trigger) — avoids inheriting the violation rather than overriding it after the fact"

key-files:
  created:
    - apps/web/src/components/file-tree.tsx
    - apps/web/src/components/file-tree.test.tsx
  modified:
    - apps/web/src/app/studio/_components/code-sandbox-island.tsx

key-decisions:
  - "Plan A mount used (not the Plan B fallback) — FileTree replaces the preset <Select> directly; leaf-select UX reads as an improvement (browsable folder structure) over a flat dropdown, not a regression"
  - "selectedId/defaultExpandedIds derived from existing presetId state (`${presetId}/island.js`) rather than adding a duplicate state variable — presetId remains the single source of truth"
  - "Trimmed Magic UI's compound Tree/Folder/File/CollapseButton JSX-composition API down to a single data-driven <FileTree data={...} /> per 27-CONTEXT.md's Claude's-Discretion note — this repo's one consumer needs a static render from data, not arbitrary JSX composition"
  - "Chevron rotation uses Tailwind's group/group-data-[state=open] variant (matches the existing sidebar.tsx convention in this repo) rather than a manually-set data-state attribute on the icon"

patterns-established:
  - "Hand-port-with-attribution: any future externally-sourced component/CSS technique gets a mandatory top-of-file attribution comment (source URL, project, license, fetch date) and a content-review note for dangerous patterns before being trusted in the codebase"

requirements-completed: [ADOPT-02]

# Metrics
duration: 15min
completed: 2026-07-06
---

# Phase 27 Plan 02: FileTree (Magic UI hand-port) Summary

**Hand-ported Magic UI's `file-tree` into a trimmed, data-driven `FileTree` component on raw `@radix-ui/react-accordion`, mounted as the Code-Island tab's preset browser (4 preset folders → `island.js` leaves), replacing the old `<Select>` — zero new npm dependencies.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-06T23:38:00Z
- **Completed:** 2026-07-06T23:51:25Z
- **Tasks:** 2/2 completed
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- `FileTree` shared component ships on raw `@radix-ui/react-accordion` + `lucide-react` only (both already installed) — never inherits `packages/ui/src/accordion.tsx`'s baked-in bold trigger weight, since it doesn't import that wrapper at all
- Colocated vitest suite (5 tests): renders folders+files from data, `onSelect` fires with the exact file node, selected-row treatment (`bg-primary/10 text-primary`), folder expand/collapse + Folder→FolderOpen glyph swap, and zero bold-weight (`font-medium`) rows
- Code-Island tab's "Or try a preset" control is now a real folder browser (mounted and visible, not dead code) — selecting an `island.js` leaf calls the exact same `handlePreset(presetId)` the `<Select>` used; "Run preset" is untouched (D-06 manual-trigger-only preserved)

## Task Commits

Each task was committed atomically:

1. **Task 1: Port Magic UI file-tree to a raw-Radix, data-driven FileTree (+ colocated test)** - `3f1abc6` (feat)
2. **Task 2: Mount FileTree as the preset browser in code-sandbox-island.tsx (Plan A)** - `2437d62` (feat)

## Files Created/Modified
- `apps/web/src/components/file-tree.tsx` - Trimmed data-driven `FileTree`/`FileTreeNode`/`FileTreeProps` on raw `AccordionPrimitive`, MIT attribution header, zero `font-medium`
- `apps/web/src/components/file-tree.test.tsx` - Colocated createRoot+act vitest coverage (5 tests)
- `apps/web/src/app/studio/_components/code-sandbox-island.tsx` - Replaced the preset `<Select>` with `<FileTree>`; added `FILE_TREE_DATA` (derived from `PRESETS`) and `handleFileTreeSelect`; removed now-unused `Select`/`SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue` imports

## External Source Vetting Evidence (Registry Safety, per 27-UI-SPEC.md)

- **Source:** `magicuidesign/magicui`, path `apps/www/registry/magicui/file-tree.tsx`, fetched via `gh api repos/magicuidesign/magicui/contents/...` — **fetched + reviewed — no flags — 2026-07-06**.
- **License:** confirmed MIT via `gh api repos/magicuidesign/magicui/license` (`spdx_id: MIT`, `https://github.com/magicuidesign/magicui/blob/main/LICENSE.md`).
- **Content review:** grepped the fetched source for `fetch(`, `eval(`, `process.env`, `import(`, `dangerouslySetInnerHTML` — zero matches. The original is pure presentational (React state + Radix Accordion + lucide icons + a `ScrollArea`/`Button` from Magic UI's own `@/components/ui`, neither of which this port pulls in).
- **Port, not verbatim copy:** the trimmed component in this repo does not reproduce Magic UI's `Tree`/`Folder`/`File`/`CollapseButton`/`TreeIndicator`/sort/RTL surface — only the visual DNA (accordion-based folder rows, icon-swap-on-open, indent-by-depth) was carried over, re-implemented against this repo's own trimmed `FileTreeNode[]` data contract and 27-UI-SPEC.md's exact class strings.

## Decisions Made
- **Plan A (not Plan B):** the leaf-picker replacement reads as a genuine UX improvement over the flat `<Select>` (folder browsing groups the 4 fixtures with clearer visual hierarchy), so no fallback to the read-only Plan B tree was needed.
- **No duplicate state:** `selectedId`/`defaultExpandedIds` are derived from the existing `presetId` state (`${presetId}/island.js`) rather than introducing a second piece of state that could drift out of sync.
- **API trim:** dropped Magic UI's `ScrollArea` wrapper, RTL support, custom sort modes, and `CollapseButton` — none has a consumer in this repo's one fixed 2-level tree.
- **Chevron rotation via `group`/`group-data-[state=open]`:** matches the `group-data-[collapsible=...]` pattern already established in `packages/ui/src/sidebar.tsx`, rather than manually setting a `data-state` attribute on the icon.

## Deviations from Plan

None - plan executed exactly as written (Plan A mount, as anticipated by the default path).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `FileTree`'s data-driven API (`FileTreeNode[]` with `folder`/`file` + nested `children`) is generic enough to accept a real multi-file structure with no rewrite when multi-file code-island output arrives (v1.5+ orchestration work) — flagged in 27-UI-SPEC.md's "Out of Scope" section, not a blocker for this phase.
- No blockers for Phase 27's remaining plans (ADOPT-03/04/05) or Phase 28's token-value pass.

---
*Phase: 27-adopted-external-design-picks*
*Completed: 2026-07-06*

## Self-Check: PASSED

All created files verified present on disk; both task commits (`3f1abc6`, `2437d62`) verified present in git log.
