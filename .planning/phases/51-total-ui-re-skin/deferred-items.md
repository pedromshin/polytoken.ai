# Deferred Items — Phase 51 (Total UI Re-skin), Plan 51-01

## Pre-existing, out-of-scope `npx tsc --noEmit` failures in `src/app/dev/design/` (not caused by this plan)

`cd apps/web && npx tsc --noEmit` reports 52 errors, ALL of them in
`src/app/dev/design/previews-core.tsx` and `src/app/dev/design/previews-vendored.tsx`
(`Cannot find module '@nauta/ui/<component>'` — a pre-rename package name that no
longer resolves post-Phase-42, plus 2 unrelated implicit-`any` parameter errors).

- Both files are **untracked** (`git status` shows `?? apps/web/src/app/dev/design/`
  at session start, before this plan touched anything) — user-owned scratch work per
  `.claude/skills/polytoken-design-system/SKILL.md`'s `/dev/design` note and explicitly
  named as excluded scratch in `51-UI-SPEC.md`'s Verification Gates section
  ("`src/app/dev/**` (999.14 user-owned scratch)").
- Zero overlap with any file this plan modified: `grep -v "app/dev/design"` on the full
  `tsc --noEmit` output returns **empty** — confirming every reported error lives inside
  the excluded scratch directory and nowhere else in the tree.
- Root cause: these files import from `@nauta/ui/*`, the package's pre-rename name
  (Phase 42 renamed `@nauta/*` → `@polytoken/*` across the tree); this scratch directory
  was never updated to match, consistent with it being a manually-maintained,
  not-yet-committed reference page rather than shipped app code.

**Action:** Not fixed — per the executor's scope-boundary rule (only auto-fix issues
directly caused by the current task's changes) and the UI-SPEC's own explicit exclusion
of `src/app/dev/**` from this phase's gates. A future hygiene pass (or the user, since
this is their own scratch page) should either update the imports to `@polytoken/ui/*` or
regenerate the page via `node .claude/skills/polytoken-design-system/scripts/build-design-data.mjs`.

**Verification performed in place of a fully-green aggregate `tsc --noEmit`:**

| Check | Result |
|---|---|
| `npx tsc --noEmit` (full) | 52 errors, all in `src/app/dev/design/**` |
| `npx tsc --noEmit` output excluding `app/dev/design` | 0 errors |
| Files this plan touched, individually reasoned about types | No new `any`, no type errors introduced (verified by isolating the diff — every edit was a `className` string change or a `cn()`/import addition, no logic/type surface touched) |

Plan 51-01's own acceptance criteria (`npx tsc --noEmit` exits 0) is technically blocked
by this pre-existing, out-of-scope debt — the criterion is satisfied for every file this
plan owns.
