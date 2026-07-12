---
phase: 52-editable-genui-panels-studio-on-canvas
plan: 03
subsystem: ui
tags: [trpc, zod, react, genui, canvas, tdd, security]

# Dependency graph
requires:
  - phase: 52-02
    provides: PanelActionsToolbar/PanelActionControlProps contract, EditParamsControl interface-first skeleton, usePanelOverlay/appendVersion wiring
provides:
  - packages/api-client/src/router/genui/panel-edit-schema.ts — PANEL_EDIT_FIELDS/editableFieldsFor/PanelEditParamsSchema/applyWhitelistedParams, the single authoritative (DB-free) param whitelist client and server both import
  - packages/api-client/src/router/genui/panel-edit.ts — genui.applyPanelEdit protectedProcedure (mutation), the server-side FOUND-6 gate for PANL-02
  - apps/web/.../controls/edit-params-control.tsx — the Parameter Editor Popover (52-UI-SPEC Component 2), replacing Plan 52-02's inert skeleton
  - @polytoken/api-client's new ./genui/panel-edit-schema export subpath (mirrors the existing ./chat-canvas precedent)
affects: [52-04-regenerate-history, 52-06-nl-retheme-client, panel-toolbar]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Client/server share ONE whitelist module via a package export subpath (not a deep src import, not a hand-duplicated copy) — @polytoken/api-client/genui/panel-edit-schema mirrors the ./chat-canvas precedent already used for CanvasSnapshotSchema"
    - "Two-gate re-validation: applyWhitelistedParams re-validates its own patched output via SpecRootSchema.safeParse even when params already passed the tRPC input schema — defense-in-depth, not merely trusting an upstream check"
    - "Unset optional field seeding: a bounded editor control never opens on a blank/invalid value — an absent optional attribute (e.g. grid with no explicit cols) seeds from the field descriptor's own bound (min, or the enum's first option)"

key-files:
  created:
    - packages/api-client/src/router/genui/panel-edit-schema.ts
    - packages/api-client/src/router/genui/__tests__/panel-edit-schema.test.ts
    - packages/api-client/src/router/genui/panel-edit.ts
    - packages/api-client/src/router/genui/__tests__/panel-edit.test.ts
    - apps/web/src/app/chat/_canvas/__tests__/edit-params-control.test.tsx
  modified:
    - packages/api-client/src/router/genui/index.ts
    - packages/api-client/package.json
    - apps/web/src/app/chat/_canvas/controls/edit-params-control.tsx
    - apps/web/src/app/chat/_canvas/__tests__/genui-panel-node-toolbar.test.tsx

key-decisions:
  - "genui.applyPanelEdit is a .mutation() (not .query() like generate.ts/retheme.ts's read-shaped FastAPI proxies) — Task 3 calls it via api.genui.applyPanelEdit.useMutation(), matching its state-changing intent (the result feeds a new overlay version) even though the procedure itself is DB-free"
  - "PanelEditParamsSchema is the UNION of every whitelisted key across every root type (not per-root-type) — it doesn't know the caller's root type; applyWhitelistedParams's own allowedKeys filter (derived from editableFieldsFor(root.type)) is what ignores a key valid for a different root type"
  - "Added @polytoken/api-client's ./genui/panel-edit-schema export subpath rather than a deep src import or a hand-duplicated client-side copy of the whitelist — mirrors the ./chat-canvas precedent and respects the established 'no subpath export for router internals' convention already documented in knowledge-graph.tsx"
  - "An unset optional numeric/enum root attribute (e.g. a grid with no explicit cols) seeds the form with a concrete default (the field's own min bound, or the enum's first option) instead of blank — avoids the editor opening in a false-invalid state"

requirements-completed: [PANL-02]

# Metrics
duration: ~35min
completed: 2026-07-11
---

# Phase 52 Plan 03: Bounded Param Editor + Server FOUND-6 Gate Summary

**Bounded, schema-driven spec-parameter editing (card/section/stack/grid) through a shared client/server whitelist, gated server-side by the same SpecRootSchema.safeParse re-validation pattern as FOUND-6 — no free-form JSON, no partial apply.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-11T22:45:00-03:00 (approx, first context read)
- **Completed:** 2026-07-11T23:03:58-03:00
- **Tasks:** 3 completed
- **Files modified:** 9 (5 created, 4 modified)

## Accomplishments
- `panel-edit-schema.ts` — the single, authoritative, DB-free whitelist contract: `PANEL_EDIT_FIELDS` maps `card`/`section`/`stack`/`grid` root types to bounded field descriptors (`title`/`description` strings, `heading` string, `gap`/`direction` enums, `cols` int 1-12); `PanelEditParamsSchema` (`.strict()`) is the union of every whitelisted key, each individually bounded; `applyWhitelistedParams` is pure/immutable — patches ONLY whitelisted root attrs (never `type`/`children`/`header`/`footer`), then re-validates the patched result via `SpecRootSchema.safeParse` before ever returning `ok:true`
- `panel-edit.ts` — `genui.applyPanelEdit` (`protectedProcedure`, `.mutation()`, DB-free/no FastAPI call): parses + re-validates `currentSpecJson` (FOUND-6), applies the whitelisted params, re-validates the result; malformed JSON, an invalid base, and a patch that fails re-validation all degrade to the SAME friendly `{ ok:false, reason }` with raw errors logged server-side only — registered as `applyPanelEdit` in `genui/index.ts`
- `edit-params-control.tsx` — the full Parameter Editor Popover replacing Plan 52-02's inert skeleton: computes `editableFieldsFor(root.type)` from the panel's active spec; an empty-whitelist root (e.g. `text`) shows the button disabled with "This panel has no editable parameters"; otherwise renders one field row per 52-UI-SPEC's field-type mapping (`Input`/`Textarea`/`Select`/`Input type=number`) seeded from the current root value; Save calls `applyPanelEdit`, on success appends an `edit` version via `appendVersion` and closes, on failure (or mutation error) shows the exact banner copy "Couldn't save these changes — check the highlighted fields." with typed values preserved — no partial apply
- Added `@polytoken/api-client`'s `./genui/panel-edit-schema` export subpath so the client imports the SAME whitelist module the server uses — zero duplicated whitelist logic anywhere

## Task Commits

Each task was committed atomically (Tasks 1 and 2 are TDD — RED then GREEN):

1. **Task 1: Authoritative param whitelist schema + pure applyWhitelistedParams (TDD)**
   - `4c4687d` test: add failing test for panel-edit-schema whitelist (RED)
   - `19001e0` feat: implement panel-edit param whitelist + applyWhitelistedParams (GREEN)
2. **Task 2: genui.applyPanelEdit procedure — server-side FOUND-6 gate (TDD)**
   - `fcf3d1b` test: add failing test for genui.applyPanelEdit procedure (RED)
   - `86e0648` feat: implement genui.applyPanelEdit server-side FOUND-6 gate (GREEN)
3. **Task 3: Parameter Editor Popover (edit-params-control.tsx)**
   - `66a57cd` feat: implement Parameter Editor Popover (edit-params-control.tsx)

**Plan metadata:** (this commit) docs: complete plan

_Both TDD tasks' RED tests genuinely failed (module-not-found for Task 1; "No procedure found on path" for Task 2), not pre-passing assertions — see verification runs in the transcript._

## Files Created/Modified
- `packages/api-client/src/router/genui/panel-edit-schema.ts` - `PANEL_EDIT_FIELDS`/`editableFieldsFor`/`PanelEditParamsSchema`/`applyWhitelistedParams` (pure, DB-free)
- `packages/api-client/src/router/genui/__tests__/panel-edit-schema.test.ts` - 13 tests: bounds, whitelist-ignore, no-op on empty fields, defense-in-depth ok:false, immutability
- `packages/api-client/src/router/genui/panel-edit.ts` - `genui.applyPanelEdit` protectedProcedure (mutation) — the server FOUND-6 gate
- `packages/api-client/src/router/genui/__tests__/panel-edit.test.ts` - 7 tests: valid apply, malformed JSON (no leaked detail), invalid base, tRPC-input-gate rejections, whitelist-ignore via the wire, session requirement
- `packages/api-client/src/router/genui/index.ts` - registers `applyPanelEdit: applyPanelEditProcedure`
- `packages/api-client/package.json` - new `./genui/panel-edit-schema` export subpath
- `apps/web/src/app/chat/_canvas/controls/edit-params-control.tsx` - `EditParamsControl`: the full Parameter Editor Popover
- `apps/web/src/app/chat/_canvas/__tests__/edit-params-control.test.tsx` - 5 tests: card fields render, successful save appends an edit version, server rejection banner + no partial apply, text-root disabled+tooltip, isLocked disabling
- `apps/web/src/app/chat/_canvas/__tests__/genui-panel-node-toolbar.test.tsx` - `~/trpc/react` mock extended with `genui.applyPanelEdit.useMutation` (Rule 1 fix, see below)

## Decisions Made
See `key-decisions` in frontmatter above (mutation vs. query, the union-not-per-root-type param schema, the new export subpath over a deep import or a duplicated whitelist, and the unset-optional-field seeding default).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Stale, gitignored `packages/api-client/dist/index.d.ts` broke apps/web's typecheck for the new procedure**
- **Found during:** Task 3 (`npm run typecheck -w @polytoken/web`)
- **Issue:** `@polytoken/api-client`'s package.json `exports["."]` declares BOTH a `types` condition (`./dist/index.d.ts`) and a `default` condition (`./src/index.ts`). TypeScript's `moduleResolution: "bundler"` resolves the `types` condition for type-checking — so `apps/web` type-checks `AppRouter` against the compiled `dist/index.d.ts`, not the live `.ts` source. That dist file is a local, gitignored build artifact that predates even Plan 52-05's `resolveRetheme` procedure (confirmed via grep — 0 matches for both `resolveRetheme` and `applyPanelEdit`). This was a LATENT bug: `resolveRetheme` shipped in 52-05 without tripping it because no `apps/web` file called `api.genui.resolveRetheme` yet (that's 52-06's job) — Task 3 is the first plan in this phase to add a server procedure AND its client `.useMutation()` call in the SAME plan.
- **Fix:** Ran `npm run build -w @polytoken/api-client` to regenerate `dist/` from current source, confirmed via grep that `applyPanelEdit` (and `resolveRetheme`) now appear in `dist/index.d.ts`.
- **Files modified:** `packages/api-client/dist/*` (gitignored, not committed — a regenerable local build artifact, not a tracked source change)
- **Verification:** `npm run typecheck -w @polytoken/web` clean outside the pre-existing `app/dev/design` exclusion (confirmed via `grep -v "app/dev/design"` — zero remaining errors)
- **Committed in:** N/A (dist/ is gitignored — the fix is a local rebuild, not a commit; flagged here so a future session doesn't need to rediscover it if `apps/web`'s typecheck breaks again after another genui procedure lands without a rebuild)

**2. [Rule 1 - Bug] `genui-panel-node-toolbar.test.tsx`'s `~/trpc/react` mock only stubbed `api.useQueries`**
- **Found during:** Task 3 (`npm run test -w @polytoken/web -- _canvas --run` regression pass)
- **Issue:** Plan 52-02's toolbar-wiring test mocks `~/trpc/react` with only `api.useQueries` (the only tRPC surface `EditParamsControl`'s INERT skeleton needed at the time). Once Task 3 replaced that skeleton with the real control — which the SAME test mounts inside the full `GenuiPanelNode` — the missing `api.genui.applyPanelEdit.useMutation` threw `Cannot read properties of undefined (reading 'applyPanelEdit')`, breaking 2/3 tests in that file.
- **Fix:** Extended the mock with `genui: { applyPanelEdit: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } }` — inert, since this suite only exercises toolbar/theming wiring, not the edit-params save flow itself (covered by `edit-params-control.test.tsx`).
- **Files modified:** `apps/web/src/app/chat/_canvas/__tests__/genui-panel-node-toolbar.test.tsx`
- **Verification:** Full `_canvas` suite green (20 files / 171 tests, including this file's 3/3)
- **Committed in:** `66a57cd`

**3. [Rule 3 - Blocking] Added a new `@polytoken/api-client` export subpath for `panel-edit-schema.ts`**
- **Found during:** Task 3 (before writing `edit-params-control.tsx`)
- **Issue:** The plan's own Task 3 `<read_first>` names `packages/api-client/src/router/genui/panel-edit-schema.ts` as the source of `editableFieldsFor` for the client. `apps/web` cannot deep-import router internals from `@polytoken/api-client/src/...` — the package's `exports` map only declares `.`/`./geometry`/`./chat-canvas`, and this repo has an established convention AGAINST deep-importing router internals (see `knowledge-graph.tsx`'s own comment: "No subpath export from @polytoken/api-client for the router internals — Local type mirrors ..."). Hand-duplicating the whitelist client-side would also violate the plan's own "ONE whitelist" intent.
- **Fix:** Added `./genui/panel-edit-schema` to `packages/api-client/package.json`'s `exports` map, mirroring the exact shape already used for `./chat-canvas` (`types` → `dist`, `default` → `src`) — the SAME precedented pattern, not a new one.
- **Files modified:** `packages/api-client/package.json`
- **Verification:** `edit-params-control.tsx` imports `editableFieldsFor`/`PanelEditParamsSchema`/`PanelEditFieldDescriptor` from `@polytoken/api-client/genui/panel-edit-schema`; typecheck clean.
- **Committed in:** `66a57cd`

---

**Total deviations:** 3 auto-fixed (2 Rule 3 blocking, 1 Rule 1 bug)
**Impact on plan:** All three were necessary for Task 3's own tests/typecheck to pass and did not change the plan's must-haves, artifacts, or key-links. None expand scope beyond what Task 3 already required.

## Issues Encountered
- Confirmed by direct schema comparison that `PanelEditParamsSchema`'s per-field bounds (title/description max-length, `cols` 1-12, `gap`/`direction` enums) are always a SUBSET-OR-EQUAL of the real underlying node schemas in `spec-schema.ts` (which have no max-length bound on title/description, and identical enum/int bounds elsewhere) — by construction, a value that passes the tRPC input gate can never independently break `applyWhitelistedParams`'s own re-validation for today's field set. This means the plan's "params that break validation return `{ ok:false }`" acceptance bullet is reachable at the PURE-FUNCTION level (tested directly in `panel-edit-schema.test.ts` via a type-bypassing cast — proving the safety net is real, not merely trusted) but NOT independently reachable via the procedure's own schema-valid input surface (tested instead as a `.rejects.toThrow()` at the tRPC input gate in `panel-edit.test.ts`, the same posture `generate.test.ts`'s D-17-04 already uses for an analogous case). This is a deliberate security property (whitelist bounds intentionally never looser than the real schema), not a gap — documented here so a future reader doesn't mistake the procedure-level test's shape for an oversight.
- Radix `Tooltip` (used directly by `EditParamsControl`, matching the toolbar's own "one shared `TooltipProvider`" convention from 52-02) requires a `TooltipProvider` ancestor even in a standalone unit test — `edit-params-control.test.tsx`'s harness wraps the control in `TooltipProvider` itself (mirrors how the real toolbar wraps all 4 action controls).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 52-04 (Regenerate + Version History) and Plan 52-06 (NL Re-theme client) can proceed independently — neither depends on this plan's files beyond the already-stable `PanelActionControlProps`/`usePanelOverlay`/`appendVersion` contracts from 52-01/52-02.
- PANL-02 is now genuinely complete end-to-end: bounded param editing, server FOUND-6 gate, no free-form JSON, no partial apply, empty-whitelist disabling.
- Live-canvas confirmation (open a card/grid panel in a real browser, edit a param, save, confirm the panel re-renders with the new value) is AUTHORED-BUT-NOT-RUN — Docker/WSL was down this session (52-CONTEXT.md's environment-constrained posture, same as Plans 52-01/52-02/52-05). Queued to `.planning/phases/49-live-loop-gate-deploy-oauth-real-email/MORNING-CHECKLIST.md` §G, which already has a standing catch-all: "Any Phase 52-54 items marked 'queued to §G' in their SUMMARYs follow the same pattern" — no separate edit needed to that file.
- The `packages/api-client/dist/` staleness pattern (Deviation 1) is worth a standing note for future plans in this phase: any plan that adds a NEW genui (or other api-client) procedure AND consumes it client-side in the SAME plan should run `npm run build -w @polytoken/api-client` before its own `npm run typecheck -w @polytoken/web` step, since `dist/` is gitignored and does not auto-regenerate.
- No blockers.

---
*Phase: 52-editable-genui-panels-studio-on-canvas*
*Completed: 2026-07-11*

## Self-Check: PASSED

All 9 files created/modified confirmed present on disk (plus this SUMMARY.md); all 5 task
commit hashes (`4c4687d`, `19001e0`, `fcf3d1b`, `86e0648`, `66a57cd`) confirmed present in
`git log`.
