---
phase: 42-atomic-rename-nauta-polytoken
verified: 2026-07-09T22:18:58Z
status: gaps_found
score: 7/8 must-haves verified
overrides_applied: 0
gaps:
  - truth: "TypeScript typecheck is green across all 5 workspace packages (`npm run typecheck -w @polytoken/{web,api-client,db,genui,ui}` each exit 0) — Roadmap SC2 / must_haves truth #3"
    status: failed
    reason: >
      `npm run typecheck -w @polytoken/web` (`tsc --noEmit`) currently fails with 22 errors — 20×
      TS2307 "Cannot find module '@nauta/ui/*'" plus 2 downstream TS7006 errors — in
      `apps/web/src/app/dev/design/previews-vendored.tsx`. Root cause: Next.js auto-generates
      `.next/types/validator.ts`, which explicitly imports every `app/**/page.tsx` including the
      excluded `dev/design/page.tsx` ("// Validate ../../src/app/dev/design/page.tsx" +
      `import("../../src/app/dev/design/page.js")`). TypeScript's `tsconfig.json` `exclude` field
      (the fix applied in Task 3, deviation #4a) only removes files from the initial glob-matched
      root set — it does NOT stop a file from being type-checked once another *included* file
      (here, `.next/types/validator.ts`, itself matched by `tsconfig.json`'s
      `"include": [..., ".next/types/**/*.ts"]`) imports it transitively. The fix only "worked" in
      the narrow window right after Task 3's `rm -rf apps/web/.next` when `.next/types` did not
      yet exist (empty glob match); it does not survive normal `next dev`/`next build` usage,
      which regenerates `.next/types` and reintroduces the failure. This is a regression directly
      caused by the rename itself (removing `node_modules/@nauta` broke resolution of the
      untouched `dev/design` scratch content's `@nauta/ui/*` imports, which resolved fine before
      Phase 42). `apps/web/next.config.mjs` sets `typescript: { ignoreBuildErrors: false }`, so a
      real `next build` would fail the same way, not just the standalone `typecheck` script.
      Reproduced twice in this verification session (once against the pre-existing `node_modules`
      state, once again after a fresh `npm install` triggered by an unrelated `npm ci` EPERM
      failure) — not a stale-cache artifact of this session.
    artifacts:
      - path: "apps/web/tsconfig.json"
        issue: "The 'src/app/dev/design' exclude entry does not prevent transitive type-checking via .next/types/validator.ts's auto-generated route import"
      - path: "apps/web/src/app/dev/design/previews-vendored.tsx"
        issue: "Still imports @nauta/ui/* (20 modules) — the package no longer exists post-rename, so these imports are now permanently unresolvable, not merely stale"
    missing:
      - "A durable fix: either (a) rename/stub the @nauta/ui imports in apps/web/src/app/dev/design/previews-vendored.tsx to @polytoken/ui (this conflicts with the plan's own hard-exclusion instruction to leave that pre-existing dirty directory's content untouched — needs explicit operator sign-off to lift that constraint), or (b) remove the directory from Next's route-type generation entirely, e.g. Next.js's underscore private-folder convention (would require renaming the dev/design/ directory itself — same conflict as (a)), or a next.config.mjs-level exclusion, or (c) formally accept/override this gap if the operator wants apps/web/src/app/dev/design/ treated as fully out-of-scope debt (in which case SC2's 'typecheck green' should be understood as 4/5 packages, not 5/5, until that scratch content is formalized or removed)."
deferred:
  - truth: "npm run check (Python aggregate gate: ruff check + ruff format --check + mypy + lint-imports + pytest) passes — must_haves truth #3 (partial) / plan 42-01 acceptance criterion"
    addressed_in: "Phase 46 (Kickoff Hygiene + v1.8 Brand & Design Dossier)"
    evidence: >
      Phase 46 success criterion 2 (ROADMAP.md): "pytest event-loop cleanup + grid `colSpan`
      support landed with tests (999.2)" — 999.2 in the Backlog section explicitly names
      "the cross-file pytest event-loop test-isolation cleanup (migrate
      get_event_loop().run_until_complete() -> asyncio.run/pytest-asyncio)", which is the exact
      root cause of the 10 pytest failures. Verified in this session: a single named test from
      the failing class (`test_retrieve_returns_retrieval_result`) passes in isolation with only a
      DeprecationWarning, matching deferred-items.md's "tests pass in isolation" claim and the
      byte-identical Phase 38-02 finding (git diff against Phase 42 commits is empty for that
      test file). The 281 ruff / 75 format / 22 mypy findings were independently cross-checked
      against every Phase-42-touched file with zero overlap (per deferred-items.md's own
      per-gate table), and `lint-imports` (architecture) is clean (3 kept, 0 broken) — so no
      NEW Python issue was introduced by this phase; all failures are pre-existing debt this
      phase did not cause and correctly declined to fix (scope-boundary discipline), tracked in
      `.planning/phases/42-atomic-rename-nauta-polytoken/deferred-items.md`.
---

# Phase 42: Atomic Rename nauta -> polytoken Verification Report

**Phase Goal:** The codebase is polytoken everywhere internally — one atomic pass, no hybrid states — with external renames runbook'd for the user.
**Verified:** 2026-07-09T22:18:58Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Zero `@nauta/` references remain in code/config (excluding documented gaps: `.planning/` historical docs, `apps/web/src/app/dev/design/`, `graphify-out/`); user-visible chrome reads Polytoken | VERIFIED | Repo-wide grep for `@nauta/` across `*.ts,*.tsx,*.json,*.mjs,*.py` (excluding node_modules/.next/dist/.planning/dev-design/graphify-out) returns **0** matches. `grep -rn "Nauta" apps/web/src` returns 0. All 6 `packages/*/package.json` + `apps/web/package.json` read `@polytoken/*`. Root `package.json` name is `polytoken-services`, 11 `-w @polytoken/*` selectors present. `vercel.json` buildCommand reads `npm run build -w @polytoken/web`. |
| 2 | Workspace symlinks regenerated (`npm install`); `node_modules/@polytoken/*` present (6), `node_modules/@nauta` absent | VERIFIED | `ls node_modules/@polytoken` → 6 entries (api-client, db, genui, tailwind-config, ui, web). `node_modules/@nauta` does not exist. Confirmed twice: once against the checked-out state, once after a fresh `npm install` triggered mid-verification (see gap #1 note). |
| 3 | TypeScript typecheck green across all 5 workspace packages (`web`, `api-client`, `db`, `genui`, `ui`) | **FAILED** | `npm run typecheck -w @polytoken/{api-client,db,genui,ui}` — all 4 pass clean (0 errors). `npm run typecheck -w @polytoken/web` **fails** with 22 errors (20× TS2307 unresolved `@nauta/ui/*` + 2× TS7006), reproduced twice. See gaps YAML for full root-cause. |
| 4 | TS/JS test suites green (`web`, `api-client`, `genui`) | VERIFIED | `npm run test -w @polytoken/api-client` → 211/211 pass. `npm run test -w @polytoken/genui` → 501/501 pass (includes the artifacts drift-gate test, confirming the `genui-prompt.json` regeneration fix holds). `npm run test -w @polytoken/web` → 275/275 pass. Total 987, matching the SUMMARY's claimed count. |
| 5 | Python `npm run check` passes | **DEFERRED** (see Deferred Items) | Literal criterion not met (281 ruff / 75 format / 22 mypy / 10 pytest failures), but every failure is independently proven pre-existing and unrelated to the rename — see Deferred Items section. Addressed by Phase 46. |
| 6 | External-rename runbook exists covering GitHub/AWS-Terraform/Vercel/domain, with the 3 hazards documented verbatim, `terraform plan` named as the proof step, `terraform apply` explicitly out of scope | VERIFIED | `.planning/phases/42-atomic-rename-nauta-polytoken/EXTERNAL-RENAME-RUNBOOK.md` exists, 259 lines, 4 ordered sections (GitHub / AWS-Terraform / Vercel / Domain). Contains `force_delete` (Hazard B, §2.3), the two-sources-of-truth reconciliation checklist (Hazard A, §2.2) naming both `variables.tf:16` and both workflow YAML files, and the local-only tfstate hazard (Hazard C, §2.4). `terraform plan` named as proof step (§2.6, exact command `npm run infra:tf -- plan`); `terraform apply` explicitly marked out of scope for phase 42. |
| 7 | `terraform plan` shows no diff (live AWS resource names untouched) | VERIFIED | Ran `npm run infra:tf -- plan` in this session — output: **"No changes. Your infrastructure matches the configuration."** All 30+ live AWS resources (ECS, ALB target groups, ECR, IAM, S3, SNS, SES) refreshed with no diff. |
| 8 | KEEP surfaces provably untouched: `nauta_id`/`nautaId`/`nauta_sync` counts identical before/after; no `.tf`/migration/workflow file in any phase commit | VERIFIED | `grep -rc 'nauta_id\|nautaId\|nauta_sync'` → 65 in `packages/db`, 39 in `apps/email-listener` (matches SUMMARY's claimed pre/post counts exactly). `git show --name-only` on all 4 phase commits (`82d3c8b`, `32a5226`, `c6b8ce5`, `afbcdc0`) contains zero paths under `infrastructure/`, `packages/db/migrations/`, or `.github/workflows/`. `git status --porcelain infrastructure/ .github/workflows/ README.md` shows only the pre-existing, out-of-scope `infrastructure/aws/ecs.tf` modification. |
| 9 | Skill directory renamed to `polytoken-design-system`; old path gone; dirty edits preserved | VERIFIED | `.claude/skills/polytoken-design-system/` exists, `.claude/skills/nauta-design-system/` does not. `grep -rn '@nauta/'` inside the new dir returns 0. `SKILL.md` frontmatter reads `name: polytoken-design-system`. `scripts/build-design-data.mjs` exists and is untracked (`git status --porcelain` shows `??`), confirming the pre-existing untracked file survived the directory move without being staged. |

**Score:** 7/8 must-haves verified (1 deferred to Phase 46, not counted against this phase's score)

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | `npm run check` (Python aggregate gate) does not exit 0 | Phase 46 | ROADMAP.md Phase 46 SC2: "pytest event-loop cleanup + grid `colSpan` support landed with tests (999.2)"; Backlog item 999.2 explicitly names the `get_event_loop()` → `asyncio.run`/`pytest-asyncio` migration that is the exact root cause of the 10 pytest failures. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` (root) | `polytoken-services` name + `@polytoken/*` `-w` selectors | VERIFIED | Confirmed via read; 11 `-w @polytoken/*` selectors present |
| `apps/web/package.json` | `@polytoken/web` name | VERIFIED | `"name": "@polytoken/web"` |
| `vercel.json` | buildCommand references `@polytoken/web` | VERIFIED | `npm run build -w @polytoken/web` |
| `.claude/skills/polytoken-design-system/SKILL.md` | renamed skill, teaches `@polytoken/ui` conventions, zero `@nauta/` refs | VERIFIED | frontmatter `name: polytoken-design-system`; grep clean |
| `.planning/phases/42-atomic-rename-nauta-polytoken/rename-nauta-to-polytoken.mjs` | committed reviewable rename script | VERIFIED | Present, committed in `82d3c8b`, under `.planning/` deliberately per its own documented rationale |
| `.planning/phases/42-atomic-rename-nauta-polytoken/EXTERNAL-RENAME-RUNBOOK.md` | user runbook, ≥60 lines, contains `force_delete` | VERIFIED | 259 lines, contains `force_delete` multiple times (§2.3) |
| `.planning/phases/42-atomic-rename-nauta-polytoken/deferred-items.md` | evidence trail for pre-existing Python debt | VERIFIED | Present, cross-references Phase 38-02, per-gate table with 0 phase-42-caused issues |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `package.json` (-w selectors + vercel.json buildCommand) | `packages/*/package.json` + `apps/web/package.json` name fields | npm workspace scope resolution | VERIFIED | `@polytoken/(web\|db\|api-client\|genui\|ui\|tailwind-config)` pattern confirmed present in all 6 package name fields; `node_modules/@polytoken/*` symlinks resolve correctly for 4/6 consuming typecheck contexts confirmed clean (db, genui, ui, api-client); `web`'s typecheck resolution fails for one specific untouched file (see gap #1) — not a workspace-resolution failure, an unrenamed-import failure. |
| `EXTERNAL-RENAME-RUNBOOK.md` | `infrastructure/aws/variables.tf` + `.github/workflows/deploy-email-listener.yml` | documents exact live resource names | VERIFIED | Runbook §2.1 table cites `variables.tf:16` (`"nauta-services"`) and both workflow YAML files' `ECR_REPOSITORY`/`ECS_CLUSTER`/`ECS_SERVICE` env blocks with exact values, cross-checked live in this session. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `@polytoken/ui` typechecks clean | `npm run typecheck -w @polytoken/ui` | 0 errors | PASS |
| `@polytoken/db` typechecks clean | `npm run typecheck -w @polytoken/db` | 0 errors | PASS |
| `@polytoken/genui` typechecks clean | `npm run typecheck -w @polytoken/genui` | 0 errors | PASS |
| `@polytoken/api-client` typechecks clean | `npm run typecheck -w @polytoken/api-client` | 0 errors | PASS |
| `@polytoken/web` typechecks clean | `npm run typecheck -w @polytoken/web` | 22 errors (`@nauta/ui/*` unresolved) | **FAIL** |
| `@polytoken/api-client` tests pass | `npm run test -w @polytoken/api-client` | 211/211 passed | PASS |
| `@polytoken/genui` tests pass (incl. artifact drift gate) | `npm run test -w @polytoken/genui` | 501/501 passed | PASS |
| `@polytoken/web` tests pass | `npm run test -w @polytoken/web` | 275/275 passed | PASS |
| `terraform plan` shows no diff | `npm run infra:tf -- plan` | "No changes." | PASS |
| Documented pre-existing pytest failure reproduces only in full-suite context, not in isolation | `pytest tests/test_genui_retrieval_provider.py::TestLexicalRetrievalProviderBehavior::test_retrieve_returns_retrieval_result` (single named test) | Passed, with a `DeprecationWarning` (not the `RuntimeError` seen in full-suite runs) | PASS (confirms deferred-items.md's "pass in isolation" claim) |
| `npm ci` reproduces the lockfile | `npm ci` | **EPERM** on an unrelated native SWC binary (Windows file lock, not lockfile/rename related); a subsequent `npm install` regenerated all 6 `@polytoken/*` symlinks correctly | INCONCLUSIVE (environment issue, not scored against the phase — see note below) |

**Note on the `npm ci` result:** The failure (`EPERM: operation not permitted, unlink ... next-swc.win32-x64-msvc.node`) is a Windows-specific file-lock error on a native binary, most likely held open by another running process (e.g. an active dev server) on this machine — it is unrelated to the `@nauta`→`@polytoken` rename or the lockfile's contents. The subsequent `npm install` cleanly regenerated `node_modules/@polytoken/*` (6/6 correct entries), confirming the lockfile itself is structurally sound. This is not counted as a phase-42 gap.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| RENM-01 | 42-01-PLAN.md | Internal rename atomic and complete, typecheck+test green, symlinks regenerated | **PARTIALLY BLOCKED** | Rename itself is complete and atomic (truths 1, 2, 8, 9 all VERIFIED). The "typecheck + test suites green" clause is not fully satisfied: 4/5 typechecks + all 3 test suites pass, but `@polytoken/web` typecheck fails (gap #1). Python `npm run check` is pre-existing debt, deferred to Phase 46. |
| RENM-02 | 42-02-PLAN.md | External renames delivered as documented runbook, not executed; live resource names untouched | SATISFIED | Runbook complete (truth 6), `terraform plan` proves zero diff (truth 7), zero live-resource strings edited by this plan (`git status --porcelain infrastructure/ .github/workflows/ README.md` clean apart from the pre-existing `ecs.tf` dirty file). |

No orphaned requirements: `.planning/REQUIREMENTS.md` maps only RENM-01 and RENM-02 to Phase 42, both claimed by plan frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No `TBD`/`FIXME`/`XXX` debt markers found in any file touched by phase-42 commits (the 2 `XXX` grep hits in `package-lock.json` are substrings of sha512 integrity hashes, not debt markers) | — | None |

No stub patterns, empty handlers, or hardcoded-empty-data patterns found in the rename script or touched files — this is a mechanical string-substitution phase with no new business logic.

## Gaps Summary

Phase 42's internal rename is substantively complete and well-executed: the `@nauta/*` → `@polytoken/*` scope rename is atomic across 242+ files, workspace symlinks regenerate cleanly, all KEEP surfaces (legacy `nauta_id` DB column, live AWS/Terraform resource names, pre-existing dirty working-tree files) are provably untouched, and the external-rename runbook is thorough and accurate (verified live against the actual `variables.tf`/workflow YAML/`terraform plan` state).

**One real gap blocks full goal achievement:** `npm run typecheck -w @polytoken/web` currently fails. The Task 3 fix (adding `apps/web/src/app/dev/design` to `tsconfig.json`'s `exclude`) does not durably solve the problem it targeted — TypeScript's `exclude` only affects the initial root-file glob match, not files reached transitively through another *included* file. Next.js's auto-generated `.next/types/validator.ts` (matched by `tsconfig.json`'s own `include` pattern) explicitly imports every `app/**/page.tsx`, including the excluded `dev/design/page.tsx`, which pulls in `previews-vendored.tsx`'s 20 unresolvable `@nauta/ui/*` imports. This surfaces reliably once `.next/types` exists — a normal, unavoidable byproduct of running `next dev` or `next build` (and since `next.config.mjs` sets `ignoreBuildErrors: false`, a real production build would fail identically, not just the standalone `typecheck` script). Reproduced twice independently in this verification session, including once after a completely fresh `npm install`.

This is a genuine tension the phase's own constraints created: the operator's hard-exclusion instruction says `apps/web/src/app/dev/design/` content must not be touched, but the roadmap's SC2 requires `typecheck ... green post-rename` with no carve-out for that directory. The rename itself (removing `node_modules/@nauta`) is what broke this previously-working (pre-rename) import resolution — so it is fair to call this rename-caused, not pre-existing debt, unlike the Python `npm run check` failures (which are unrelated to naming and independently proven pre-existing via Phase 38-02 cross-reference, and are already scheduled for Phase 46).

**This looks like it may be intentional** (an accepted consequence of preserving the untouched scratch directory) rather than an oversight, given how carefully the phase's other KEEP-surface protections were engineered. If the operator wants to accept the current state, add to VERIFICATION.md frontmatter:

```yaml
overrides:
  - must_have: "TypeScript typecheck is green across all 5 workspace packages"
    reason: "apps/web/src/app/dev/design/ is pre-existing untracked scratch content explicitly excluded from this phase's rename scope; its stale @nauta/ui imports break typecheck only when .next/types is regenerated, which is accepted as known debt until that directory is formalized or removed."
    accepted_by: "<name>"
    accepted_at: "<ISO timestamp>"
```

Absent that override, this is a BLOCKER: the roadmap's own SC2 is not durably true in the current codebase.

---

*Verified: 2026-07-09T22:18:58Z*
*Verifier: Claude (gsd-verifier)*
