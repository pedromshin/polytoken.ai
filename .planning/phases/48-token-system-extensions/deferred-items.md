# Deferred Items — Phase 48 (token-system-extensions)

Items discovered during execution that are out of scope for the current plan
(scope boundary: only fix issues directly caused by the current task's changes).

## 48-01 Task 2 — `npm run typecheck -w @polytoken/web` pre-existing failure

**Found during:** Task 2 verification (`npm run typecheck -w @polytoken/web`).

**Issue:** The command reports ~50 errors, ALL located in
`apps/web/src/app/dev/design/previews-core.tsx` and
`.../previews-vendored.tsx` (untracked, uncommitted scratch files — not part
of any git commit, `git log` returns no history for the directory). Every
error is `Cannot find module '@nauta/ui/<component>'` (stale pre-rename
package scope — the atomic Phase 42 rename to `@polytoken/*` never touched
these files because they didn't exist in the repo at rename time) plus 2
unrelated implicit-`any` parameter errors.

`apps/web/tsconfig.json` already carries an `exclude: ["src/app/dev/design"]`
entry with a comment stating this is a deliberate "Phase 42 hard exclusion,"
but `npx tsc --listFilesOnly` proves the exclude is NOT effective — the six
files under `src/app/dev/design/` are still pulled into the program. Root
cause not investigated (out of scope for this plan; `tsconfig.json` and
`src/app/dev/design/` are not in 48-01's `files_modified`).

**Verification that this is unrelated to 48-01's changes:** none of the ~50
errors reference `success`, `radius-pill`, `font-code`, `borderRadius`,
`fontFamily`, or any identifier this plan introduced. The error set is
identical whether or not this plan's edits are present (confirmed by
reviewing the full error list — every line is either a `@nauta/ui/*` module
resolution failure or an implicit-`any` parameter, both pre-existing and
confined to the excluded-in-theory directory).

**Action:** Not fixed (scope boundary — `tsconfig.json` and
`src/app/dev/design/` are untouched by 48-01's file list). Logged here for a
future plan (or the phase's dev/design consultation-page owner — see
`.claude/skills/polytoken-design-system/SKILL.md` "Consultation page") to
either fix the tsconfig exclude mechanism or commit/rename the scratch files
to `@polytoken/ui` imports.
