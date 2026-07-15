---
phase: 55-platform-migration-tailwind-v4-react-19
plan: 06
subsystem: design-system
tags: [shadcn, radix, base-ui, kibo-ui, registry-install, oklch, decision-record]

# Dependency graph
requires:
  - phase: 55-05
    provides: "unified react@19.2.7 tree, all packages/ui runtime deps React-19-compatible, both API-surface-changing components (Calendar, resizable dock) revalidated — STCK-02 complete"
provides:
  - "docs/design/radix-vs-base-ui.md — STCK-03 decision record: stay on Radix, changelog citation, verified pin mechanism (init-only -b radix + this repo's existing style:new-york pin), re-evaluation trigger"
  - "packages/ui/components.json on the v4 shape (tailwind.config: \"\") + packages/ui/src/rating.tsx — a real @kibo-ui/rating registry install proving STCK-04 with zero v3/Base-UI adaptation"
  - "apps/web/src/app/dev/design/{page.tsx,design-data.json} committed for the first time — oklch swatches render correctly, stale nauta-design-system path fixed"
  - "build-design-data.mjs's two silent-breakage bugs fixed (comment-collision block extraction, stale JS-config animation source) — the authoritative generator now correctly reflects the migrated stack"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "shadcn registry-install verification: `--dry-run --view` a payload's own imports before vendoring is the real Radix-vs-Base-UI check for third-party registries (no CLI flag exists for it) — this repo's canonical @shadcn items stay pinned to Radix via the pre-existing style:\"new-york\" components.json field, verified live against @shadcn/button and @shadcn/dialog"
    - "design-data.json regeneration is a real correctness check, not a formatting nicety — running the documented refresh command after a token-format migration surfaces silent generator bugs (comment-string collisions, stale JS-config read paths) that a build/typecheck pass alone never catches"

key-files:
  created:
    - docs/design/radix-vs-base-ui.md
    - packages/ui/src/rating.tsx
    - apps/web/src/app/dev/design/page.tsx (committed for the first time; pre-existed as untracked scratch)
    - apps/web/src/app/dev/design/design-data.json (committed for the first time; pre-existed as untracked scratch)
    - .claude/skills/polytoken-design-system/scripts/build-design-data.mjs (committed for the first time; pre-existed as untracked scratch)
  modified:
    - .claude/skills/polytoken-design-system/SKILL.md
    - packages/ui/components.json
    - apps/web/src/app/dev/components/page.tsx

key-decisions:
  - "STCK-03: stay on Radix. Zero @radix-ui/react-* package touched. Documented in docs/design/radix-vs-base-ui.md with the shadcn July-2026 changelog citation, rationale (37 forwardRef-based components, zero forcing function, official non-deprecation statement, React-19-compat already proven in 55-RESEARCH.md), and a re-evaluation trigger."
  - "Corrected the plan's own assumed `-b radix` mechanism after verifying it live against the installed shadcn@4.13.0 CLI: `-b`/`--base` exists ONLY on `shadcn init` (confirmed via --help), NOT on `add` (confirmed: `add -b radix <item>` fails with 'unknown option'). The actual, verified mechanism for this already-initialized repo: components.json's pre-existing `style: \"new-york\"` field already pins canonical @shadcn `add` calls to Radix with no flag needed — verified live against @shadcn/button and @shadcn/dialog, both resolving `radix-ui` package imports. Third-party registries (@kibo-ui, @magicui, @coss) have no Radix/Base-UI toggle at all; --dry-run --view inspection of the payload's own imports is the only real check. Both docs/design/radix-vs-base-ui.md and SKILL.md were corrected to state this precisely rather than ship an inaccurate flag reference."
  - "STCK-04 proof component: @kibo-ui/rating. Chosen for self-contained, low-dependency surface (a star-rating radiogroup) not already vendored (rating is absent from the existing VENDORED_KIBO set in build-design-data.mjs). The --dry-run --view payload required ZERO adaptation: its `@polytoken/ui` cn import already matched this repo's convention verbatim, its runtime hook (@radix-ui/react-use-controllable-state) was ALREADY a packages/ui dependency (vendored earlier for relative-time/dialog-stack/code-block, confirmed via grep before assuming a new install was needed), and none of its Tailwind classes needed a v3 rewrite. Copied verbatim from the dry-run view into packages/ui/src/rating.tsx per the documented vendor-and-adapt workflow's DO-NOT-plain-add caveat (plain `add` still resolves the write path through the package exports map to a broken `src/index.ts/<name>.tsx` location, confirmed unchanged by the components.json v4 shape change)."
  - "Task 3 (Pitfall 6) escalated beyond the plan's described cosmetic scope after live regeneration surfaced two real generator bugs, not just stale text: (1) grabBlock(\":root\")/(\".dark\") used a naive css.indexOf(selector) that matched globals.css's own prose comments mentioning \":root\"/\".dark\" in running text WELL BEFORE the real CSS rule, then grabbed the wrong block's contents entirely — design-data.json shipped ZERO oklch tokens pre-fix despite globals.css being fully migrated (silent, not a build failure). (2) the animation extractor still read packages/tailwind-config/web.ts's `animation: {}` JS object, which 55-02/55-03 emptied when animations moved natively into globals.css's @theme block — silently yielding zero motion utilities. Both are squarely within the plan's own instruction ('if build-design-data.mjs itself parses globals.css assuming HSL triplets and breaks on oklch, fix that parse too — it is the authoritative generator') and were required to satisfy Task 3's own oklch-in-design-data.json acceptance criterion, which would otherwise have failed."
  - "The dev/design directory's OTHER pre-existing untracked scratch files (previews-core.tsx, previews-vendored.tsx, live-preview.tsx, preview-types.ts) were left untracked, matching the 55-01 precedent — only page.tsx and design-data.json were in this plan's files_modified scope and are the two files actually needed for the Pitfall 6 fix."

patterns-established:
  - "Pattern: when a plan's action text prescribes a specific CLI flag from research (e.g. `-b radix`), verify it against the ACTUALLY INSTALLED CLI version's own --help output before writing it into a permanent decision record — a flag that exists on one subcommand (`init`) does not necessarily exist on a sibling subcommand (`add`) of the same CLI, and research/changelog prose can describe the flag's existence without specifying which subcommand(s) it applies to."

requirements-completed: [STCK-03, STCK-04]

# Metrics
duration: ~2h10m
completed: 2026-07-15
---

# Phase 55 Plan 06: Radix-Stays Decision + @kibo-ui Registry-Install Proof + /dev/design oklch Cleanup Summary

**STCK-03 decided (stay on Radix, documented with the shadcn July-2026 changelog citation and a corrected, live-verified pin mechanism) and STCK-04 proven (a real `@kibo-ui/rating` component vendored via the shadcn registry workflow with zero v3/Base-UI adaptation), plus the `/dev/design` reference page's oklch-swatch cleanup surfaced and fixed two real silent-breakage bugs in its authoritative data generator — closing Phase 55.**

## Performance

- **Duration:** ~2h10m
- **Tasks:** 3 (all `type="auto"`)
- **Files touched:** 8 (2 new committed docs/components, 3 committed-for-the-first-time pre-existing scratch files, 3 modified)

## Accomplishments

- **Task 1 (STCK-03):** `docs/design/radix-vs-base-ui.md` (110 lines) records the decision to stay on Radix, citing shadcn's July-2026 changelog's explicit non-deprecation statement, the 37-component zero-forcing-function rationale, and a re-evaluation trigger. `SKILL.md`'s "Stack pin" section updated from the now-false "Tailwind v3.4 + React 18... NOT Tailwind v4, NOT React 19" to the migrated stack, with a cross-reference to the new decision record.
- **Task 2 (STCK-04):** `packages/ui/components.json`'s `tailwind.config` set to `""` (v4 shape). `@kibo-ui/rating` vendored to `packages/ui/src/rating.tsx` — the `--dry-run --view` payload copied verbatim with zero adaptation (its `@polytoken/ui` import convention already matched, and its one runtime dependency, `@radix-ui/react-use-controllable-state`, was already installed). Wired onto `/dev/components` as its visual smoke home; live-verified via an authenticated Playwright screenshot showing 3 correctly-filled stars.
- **Deviation found during Task 2 (Rule 1 — inaccuracy correction):** the plan's own text (and my initial draft of the decision record/SKILL.md) assumed `-b radix` works on `shadcn add`. Verified live against the installed `shadcn@4.13.0` CLI that `--base`/`-b` exists ONLY on `init` (`add --help` lists no such flag; `add -b radix <item>` errors `unknown option '-b'`). Corrected both docs before commit to state the real, verified mechanism: this repo's existing `components.json` `style: "new-york"` field already pins canonical `@shadcn` registry items to Radix with no flag needed (verified live: `@shadcn/button` and `@shadcn/dialog` both resolve `radix-ui` package imports), and third-party registries have no toggle at all — `--dry-run --view` inspection of the payload's own imports is the real check.
- **Task 3 (Pitfall 6):** `/dev/design`'s `Swatch` component made format-agnostic (renders any literal CSS color value, not just a bare HSL triplet) and the stale `nauta-design-system` path references fixed (3 occurrences). Regenerating `design-data.json` surfaced two real bugs in the authoritative generator beyond the plan's anticipated cosmetic scope: a comment-string-collision bug in `grabBlock` that was silently extracting the WRONG CSS block (zero oklch tokens shipped pre-fix), and a stale animation-source read from a JS config object that 55-02/55-03 had already emptied. Both fixed; regeneration now correctly yields 52 real color tokens (78 `oklch(...)` occurrences) and 8 animation utilities (was 0/0 respectively before the fix). Live-verified via an authenticated Playwright screenshot of the full token table.
- **Phase-final gate sweep:** `npm run typecheck -w @polytoken/ui` / `-w @polytoken/web` / `-w @polytoken/genui` all exit 0; `npm run test -w @polytoken/web` → 64/64 files, 464/464 tests (unchanged baseline, palette-ban still green); `npm run web:build` → 20/20 routes including `/dev/design` and `/dev/components`.

## Task Commits

1. **Task 1 (STCK-03 decision + SKILL.md update):** `d6ef0fd` (docs)
2. **Task 2 (STCK-04 — components.json v4 + @kibo-ui/rating install, incl. the `-b radix` mechanism correction):** `4010a4e` (feat)
3. **Task 3 (Pitfall 6 — /dev/design oklch cleanup + generator bug fixes):** `bf294a7` (fix)

## Files Created/Modified

- `docs/design/radix-vs-base-ui.md` (NEW) — STCK-03 decision record
- `.claude/skills/polytoken-design-system/SKILL.md` — Stack pin section updated to the migrated stack + corrected Radix pin mechanism; shadcn CLI workflow section updated
- `packages/ui/components.json` — `tailwind.config: ""` (v4 shape)
- `packages/ui/src/rating.tsx` (NEW) — the `@kibo-ui/rating` STCK-04 proof component
- `apps/web/src/app/dev/components/page.tsx` — added a "rating" showcase section
- `apps/web/src/app/dev/design/page.tsx` (committed for the first time) — format-agnostic `Swatch`, stale path fixes, updated token-consumption description
- `apps/web/src/app/dev/design/design-data.json` (committed for the first time) — regenerated with correct oklch tokens + animations
- `.claude/skills/polytoken-design-system/scripts/build-design-data.mjs` (committed for the first time) — 2 bug fixes: comment-safe CSS block extraction, `--animate-*` extraction moved from the stale JS config to globals.css

## Decisions Made

See `key-decisions` in the frontmatter for full detail. Summary: stay on Radix (STCK-03, documented + cited); `@kibo-ui/rating` chosen and installed with zero adaptation (STCK-04, proven); the plan's assumed `-b radix` add-time flag corrected to the verified init-only mechanism after live CLI testing; two real (not just cosmetic) generator bugs fixed in `build-design-data.mjs` as a necessary, in-scope part of satisfying Task 3's oklch acceptance criterion.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/inaccuracy] `-b radix` does not exist on `shadcn add` in the installed CLI**
- **Found during:** Task 2, attempting to run `npx shadcn@latest add -b radix @kibo-ui/rating --dry-run --view` as the plan's action text specified
- **Issue:** The installed `shadcn@4.13.0` CLI has no `--base`/`-b` option on `add` (confirmed via `add --help`; the flag only appears in `init --help`). My own just-written `docs/design/radix-vs-base-ui.md` §4 and `SKILL.md` initially stated the flag applies to both `init` and `add`, matching the plan's own (research-derived, not live-verified) assumption.
- **Fix:** Verified live that this repo's existing `components.json` `style: "new-york"` field already pins canonical `@shadcn` registry `add` calls to Radix with no flag needed (`@shadcn/button` and `@shadcn/dialog` dry-run payloads both resolve `radix-ui` package imports). Rewrote both docs to state the real, three-layered mechanism: (a) `-b radix` is `init`-only, relevant only if `components.json` is ever regenerated from scratch; (b) this repo's current `style: "new-york"` pin already does the job for `@shadcn` items; (c) third-party registries have no toggle at all — payload inspection via `--dry-run --view` is the real check.
- **Files modified:** `docs/design/radix-vs-base-ui.md`, `.claude/skills/polytoken-design-system/SKILL.md`
- **Verification:** All decision-record/SKILL.md grep acceptance criteria re-confirmed passing after the correction (radix/base-ui/re-evaluat/changelog patterns, "NOT Tailwind v4" absence, tailwind-v4/react-19/oklch/@theme presence).
- **Committed in:** `4010a4e` (folded into the Task 2 commit since the correction was discovered while proving Task 2's own install)

**2. [Rule 1 - Bug] `build-design-data.mjs`'s `grabBlock` matched CSS comments, not the real `:root`/`.dark` rules**
- **Found during:** Task 3, running the documented `node .claude/skills/polytoken-design-system/scripts/build-design-data.mjs` regeneration command
- **Issue:** `grabBlock(selector)` used `css.indexOf(selector)`, which matched globals.css's own prose comments mentioning `:root`/`.dark` in running text (e.g. "...in :root, D-48-01)" at line 68, real `:root {` at line 316) well before the actual rule, then grabbed whatever CSS block happened to start at the NEXT `{` in the file — silently returning the wrong block's contents. `design-data.json` shipped zero `oklch(...)` tokens despite `globals.css` being fully migrated, which would have failed Task 3's own acceptance criterion.
- **Fix:** Strip CSS comments before selector-matching, and match the selector at a real rule boundary (`(^|[}\s;])selector\s*\{`) rather than a bare substring search.
- **Files modified:** `.claude/skills/polytoken-design-system/scripts/build-design-data.mjs`
- **Verification:** Regeneration now yields 52 real color tokens with 78 `oklch(...)` occurrences (was 0 pre-fix); live Playwright screenshot confirms every color-group swatch renders the correct oklch color.
- **Committed in:** `bf294a7` (Task 3 commit)

**3. [Rule 1 - Bug] `build-design-data.mjs`'s animation extractor read a JS config object 55-02/55-03 had already emptied**
- **Found during:** Task 3, same regeneration run as deviation #2
- **Issue:** The animation extractor read `packages/tailwind-config/web.ts`'s `animation: {}` JS object — but 55-02/55-03 (Phase 55's earlier waves) ported those animations natively into `globals.css`'s `@theme { --animate-*: ...; }` declarations, leaving the JS config with zero `animation` key. The generator silently produced `animations=0`.
- **Fix:** Changed the extractor to parse `--animate-<name>: <value>;` custom properties directly from `globals.css` (matching `cssNoComments`, consistent with deviation #2's comment-stripping fix), the current single source of truth per the Phase 55 migration.
- **Files modified:** `.claude/skills/polytoken-design-system/scripts/build-design-data.mjs`
- **Verification:** Regeneration now yields 8 animation utilities (was 0); the Motion utilities section of `/dev/design` populates correctly.
- **Committed in:** `bf294a7` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 1 — one a documentation-accuracy correction discovered via live CLI testing, two real generator bugs discovered via running the plan's own documented regeneration command). All were necessary to either avoid shipping an inaccurate permanent decision record or to satisfy Task 3's own stated acceptance criteria.
**Impact on plan:** No scope creep beyond what the plan's own text anticipated ("if build-design-data.mjs itself... breaks on oklch, fix that parse too — it is the authoritative generator"); both generator fixes were required, not optional polish.

## Known Stubs

None. No hardcoded empty values, placeholder text, or unwired data sources were introduced by this plan's changes.

## Threat Flags

None beyond what the plan's own `<threat_model>` anticipated. `T-55-SC` (registry payload + transitive deps): `@kibo-ui/rating`'s one runtime dependency, `@radix-ui/react-use-controllable-state`, was verified via `npm view` (`version = 1.2.3`, `repository.url = github.com/radix-ui/primitives` — the official Radix org) BEFORE confirming it was already installed and required no new `npm install` at all. `T-55-06` (non-interactive install defaulting to Base UI): mitigated by the verified `style: "new-york"` pin (not the originally-assumed `-b radix` flag, corrected per deviation #1) — confirmed live that the payload resolved Radix's own `@radix-ui/react-use-controllable-state`, not a Base UI equivalent. No new endpoints, auth paths, or schema changes were introduced.

## Issues Encountered

None blocking. The `shadcn@latest info` command failed with an unrelated CLI bug (`ENOTDIR` scanning the `ui`/`utils`/`lib`/`hooks` aliases, which all point at the same `src/index.ts` file rather than a directory) — not used for any acceptance criterion, so not investigated further (out of scope, pre-existing CLI behavior unrelated to this plan's changes).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Phase 55 (Platform Migration — Tailwind v4 + React 19) is now fully complete.** STCK-01 (55-01/02/03), STCK-02 (55-04/05), STCK-03 and STCK-04 (this plan) are all satisfied and marked complete in REQUIREMENTS.md. The phase-final gate sweep (typecheck ×3, vitest web, production build) is green.
- `docs/design/radix-vs-base-ui.md` is available for any future phase evaluating a primitive-library change — its re-evaluation trigger section states the exact conditions under which this decision should be revisited.
- `packages/ui/src/rating.tsx` is a real, usable component (not just a proof-of-concept) — available for any future surface needing a rating/review affordance.
- `.claude/skills/polytoken-design-system/scripts/build-design-data.mjs` is now correct and committed; future token or animation changes will regenerate `/dev/design`'s reference data correctly without needing another investigation of this kind.

---
*Phase: 55-platform-migration-tailwind-v4-react-19*
*Completed: 2026-07-15*

## Self-Check: PASSED

All 9 files (5 created, 3 modified, this SUMMARY.md) confirmed present on disk.
All 3 task commit hashes (`d6ef0fd`, `4010a4e`, `bf294a7`) confirmed present via
`git log --oneline --all`.
