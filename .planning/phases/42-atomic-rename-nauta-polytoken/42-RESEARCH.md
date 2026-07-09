# Phase 42: Atomic Rename nauta → polytoken - Research

**Researched:** 2026-07-09
**Domain:** Monorepo-wide mechanical rename (npm workspace scopes, config, docs, UI chrome) with a hard exclusion boundary around live external infrastructure and one unrelated legacy DB column
**Confidence:** HIGH — every claim below is either grep-verified directly against this repo in this session or drawn from the milestone research's already-cited file:line evidence.

## Summary

This phase is a mechanical, low-risk, single-repo find/replace with three hazards that make it genuinely require a plan rather than a blind `sed`: (1) the rename surface is wider than `@nauta/*` npm imports — it includes JSON/YAML string literals (`vercel.json`, root `package.json` `-w` selectors) that a TypeScript-only tool would miss; (2) two things in this codebase merely *look* like rename targets but are load-bearing and must NOT be touched — `entity_instances.nauta_id`/`nauta_sync` (a live Postgres column + stored data value from an unrelated legacy system) and every live AWS/Terraform resource-name string; and (3) the working tree already carries pre-existing uncommitted changes in exactly the kind of files a broad rename script would touch (`.claude/skills/nauta-design-system/SKILL.md`, `infrastructure/aws/ecs.tf`, `apps/web/src/app/dev/design/`), which must be routed around, not swept up.

Verified inventory (this session, grep-based, current repo state — supersedes the milestone research's earlier "~210–246 files" / "~243 files" estimates, which were approximate pre-phase counts): **6** `package.json` `name` fields carry `@nauta/*`; **197** `.ts`/`.tsx` source files (excluding `dist/`) import from `@nauta/*`; **11** `-w @nauta/*` workspace-selector strings live in root `package.json`; `vercel.json` has exactly 1 occurrence; **9** literal `"Nauta"` UI-chrome strings exist in `apps/web/src/app/**` (page `<title>` metadata + one sidebar brand string); `.github/workflows/*.yml` has **zero** `@nauta/*` occurrences (its only nauta-adjacent content is live AWS resource names — a different, RUNBOOK-only concern). The `entity_instances.nauta_id` column (plus the literal `nauta_sync` string value and the `entity_instance_unique_per_importer` partial-unique-index expression, defined in migrations 0006/0016/0017) is unrelated to the product/package rename and is explicitly out of scope — confirmed both by the milestone ARCHITECTURE.md doc and by this session's own migration read.

**Primary recommendation:** Run this as a single reviewable Node script (no new dependency) doing scoped literal substring substitution across an explicit allow-list of file globs (not a blanket repo-wide grep-replace), with `entity_instances`-related identifiers and every path under the pre-existing-dirty exclusion list hard-excluded by construction; follow with a full `node_modules`/lockfile regeneration and the package-by-package `typecheck`/`test` verification matrix below before touching the runbook doc.

## User Constraints (from CONTEXT.md)

### Locked Decisions
- `@nauta/*` → `@polytoken/*` everywhere: package.json `name` fields, root package.json workspace `-w @nauta/...` script selectors, TS imports, vercel.json build command, CI YAML references, docs, UI chrome strings (RENM-01)
- External renames are runbook'd, NOT executed (RENM-02); live AWS resource name strings stay untouched — ECR `force_delete=false` + local-only tfstate make a naive Terraform rename fail or risk destroy; runbook must carry these warnings explicitly
- Workspace symlinks regenerated after the rename (`rm -rf node_modules && npm install`) — this repo is npm workspaces, NOT pnpm
- Verification gates: zero remaining `@nauta/` references, typecheck green, web tests green, Python tests green, `terraform plan` proves live AWS resource names untouched

### Claude's Discretion
- Rename mechanics (zero-dep script vs manual passes, ordering, commit granularity) — research recommends a scripted pass; keep it reviewable
- Casing convention: follow existing usage — lowercase `polytoken` in package scopes/slugs/identifiers, product-case `Polytoken` where chrome currently says `Nauta`
- How much of `.planning/` history to rename: historical docs may keep "nauta" (they describe the past); active docs and templates should say polytoken — judgment call per file class

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. (External rename execution is explicitly out of scope per RENM-02, captured above.)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RENM-01 | Internal rename nauta → polytoken is atomic and complete — package scopes, workspace selectors, vercel.json, CI YAML, docs, UI strings — typecheck+tests green, symlinks regenerated | Full grep-verified inventory below (§ Rename Surface Inventory) classifies every occurrence class as MUST-rename / KEEP / RUNBOOK-only; § Code Examples gives the substitution-site list and verification command matrix |
| RENM-02 | External renames (GitHub repo, AWS/Terraform, Vercel, domain) delivered as a runbook, NOT executed; live AWS resource names untouched | § Runbook-Only Surfaces enumerates every live-resource string (ECR/ECS/ALB/S3/SNS/tfstate) found this session with exact file:line; § Common Pitfalls documents the ECR `force_delete`/tfstate hazards inherited from milestone PITFALLS.md #14 |

## Project Constraints (from CLAUDE.md)

No repo-root `./CLAUDE.md` exists in `nauta.services.email-listener` — no project-specific directives to reconcile. The user's **global** `CLAUDE.md` (`C:\Users\pc\.claude\CLAUDE.md`) applies by default and is directly relevant to this phase's mechanics:
- "Immutable only: always return new objects, spread/Object.assign" — not applicable to a file-content rename script (it's I/O, not application state), but the rename script itself should be a pure function `(content: string) => string` per substitution rule, not an in-place-mutating string-builder, for testability.
- "Named exports exclusively" — if the rename script is authored as a `.mjs`/`.ts` utility (vs. a one-off inline block), its helper functions should use named exports, consistent with every existing `packages/*` module in this repo.
- "Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`" — the rename is a `refactor:` commit (or `chore:` if the planner's convention set includes it — this repo's own recent commit log, e.g. `docs(41-01): ...`, `feat(41-01): ...`, uses scoped conventional commits; follow `refactor(42): ...` or `chore(42): ...` for this phase).
- "Type everything explicitly; use `unknown` and narrow when unsure" / "Validate inputs at system boundaries (Zod/Pydantic)" — not directly load-bearing for a text-substitution script, but any new TS helper written for this phase should still follow it.
- "Run typecheck after code changes; run single tests, not full suite" — directly actionable: this phase's own verification gate should run the package-scoped `typecheck`/`test` commands enumerated in § Code Examples, not a slower alternative.

**Project skills:** Only one relevant skill exists — `.claude/skills/nauta-design-system/SKILL.md`. Per explicit instruction, this research did **not** open or modify that file's content beyond the read already performed to establish its dirty/untracked state (see § Special-Handling Surface below); its patterns (vendored `@nauta/ui` conventions, shadcn CLI workflow) are noted only insofar as they name `@nauta/*` — no other skill-derived conventions apply to a rename phase.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| npm package scope rename (`@nauta/*` → `@polytoken/*`) | Build/Tooling (root `package.json`, workspace `package.json` files) | — | Pure monorepo-tooling concern; no runtime tier owns it |
| TS import statement rewrite | Browser/Client + Frontend Server (all of `apps/web`) and cross-cutting `packages/*` | — | Every workspace package that imports another workspace package is affected; not tier-specific, it's structural |
| UI chrome string rename (`<title>`, sidebar brand text) | Frontend Server (SSR) — Next.js metadata + Server/Client Components | Browser/Client (rendered text) | `title` metadata is resolved server-side (Next.js `generateMetadata`/static `metadata` export); the sidebar string renders client-side but is authored server-side |
| CI/CD YAML rename | CI/CD (GitHub Actions) | — | Confirmed this session: **zero** `@nauta/*` npm-scope strings exist in `.github/workflows/*.yml` today — this capability is a no-op for the actual rename substitution, see § Rename Surface Inventory |
| Live AWS/Terraform resource naming | Infra/Deploy (Terraform, ECS, ECR, ALB, CloudWatch, S3, SNS) | CI/CD (hardcoded workflow env vars) | Explicitly OUT of this phase's execution scope (RENM-02) — RUNBOOK-only; both sources of truth (`var.project` default + workflow YAML env block) are unsynced today, a pre-existing condition this phase does not fix, only documents |
| `entity_instances.nauta_id`/`nauta_sync` legacy identity field | Database/Storage (Postgres column + stored row data) | — | Unrelated to the package/brand rename; a schema-level rename would require a live-data migration, explicitly excluded by the milestone ARCHITECTURE.md's own scope carve-out |
| `.claude/skills/nauta-design-system/` skill directory | Tooling/DX (agent skill, not runtime code) | — | Directory name + `SKILL.md` frontmatter `name:` field are a legitimate rename surface, but the file's current dirty/untracked git state requires special handling (see below) |

## Rename Surface Inventory

Every occurrence class below was grep-verified against the live working tree in this research session (not the milestone research's earlier estimate, which is now superseded by these exact counts).

### MUST-rename (code/config the planner should target)

| Surface | Count (verified) | Example | Notes |
|---|---|---|---|
| `package.json` `"name"` fields | 6 | `apps/web/package.json:2` `"@nauta/web"`, plus `packages/{api-client,db,genui,tailwind-config,ui}/package.json` | Direct scope rename |
| Root `package.json` `"name"` field | 1 | `package.json:2` `"nauta-services"` | Not `@nauta/*`-shaped (no scope prefix), but still a rename surface — Claude's Discretion on target string (e.g. `polytoken` or `polytoken-services`); private, unpublished, zero downstream coupling risk |
| Root `package.json` `-w @nauta/*` script selectors | 11 | `package.json:30-40` — `db:generate`, `db:migrate`, `db:migrate:staging`, `db:migrate:prod`, `db:studio`, `db:check`, `web:dev`, `web:dev:staging`, `web:dev:prod`, `web:build` (×2 selectors on one line), `api-client:build` | A separate rename site from the `name` fields themselves — confirmed the milestone PITFALLS.md #15 warning is accurate for this repo |
| Cross-package `@nauta/*` dependency declarations | 5+ | `apps/web/package.json:46` `"@nauta/tailwind-config": "*"`, `packages/ui/package.json:63` same | Every workspace `package.json`'s own `dependencies`/`devDependencies` block referencing a sibling workspace package |
| `.ts`/`.tsx` import statements of `@nauta/*` | 197 files (excl. `dist/`) | `apps/web/src/app/chat/_canvas/chat-canvas.tsx:59` `import { Button } from "@nauta/ui/button"` | The bulk of the surface; standard `import`/`export from` statement rewrite. `packages/api-client/dist/**` (39 files matched) is `.gitignore`'d build output (`.gitignore:47` `packages/api-client/dist/`) — do NOT hand-edit; it regenerates from `npm run build -w @polytoken/api-client` after source rename |
| `vercel.json` build command | 1 | `vercel.json:3` `"buildCommand": "npm run build -w @nauta/web"` | Exactly one occurrence, confirmed |
| `apps/web/tailwind.config.ts` / `packages/ui/tailwind.config.ts` | 2 | `import baseConfig from "@nauta/tailwind-config/web"` | Same class as the import-statement bucket, called out separately since it's a config file, not `src/` |
| UI chrome — page `<title>` / metadata strings | 8 | `apps/web/src/app/layout.tsx:12` `"Nauta — Emails"`, `.../emails/[id]/page.tsx:11`, `.../entities/page.tsx:6`, `.../entities/[id]/page.tsx:11`, `.../knowledge/page.tsx:6`, `.../studio/page.tsx:11-12` (title AND description), `.../studio/preview/page.tsx:18` | All Next.js `metadata`/`generateMetadata` string literals |
| UI chrome — rendered brand text | 1 | `apps/web/src/components/app-sidebar.tsx:125` — literal `Nauta` text node | The one true "user sees this on screen" string found this session |
| Docs — `README.md` prose | 2 lines | `README.md:1` `# nauta.services`, `README.md:3` "Monorepo for Nauta services... Nauta 'Data-Entry Brain' pipeline" | Prose only — do NOT touch the same file's resource-name table cells (`nauta-services-email-listener`), see RUNBOOK section |
| Docs — `apps/web/README.md` | 5 | `@nauta/web`, `@nauta/api-client` (×2), `@nauta/db`, `@nauta/*` workspace mention | Same import-scope class, doc context |
| Docs — `apps/email-listener/README.md` | 1 | line 4: "...arrive in later stages of the Nauta data-entry pipeline" | Prose |
| `pyproject.toml` description | 1 | `apps/email-listener/pyproject.toml:4` `description = "Nauta email listener — receives and logs raw inbound emails"` | Python package metadata, not published externally — safe, low-risk |
| Python — product name / pack-id identifiers | ~40+ occurrences across ~10 files | `apps/email-listener/app/settings.py:68` `APP_NAME: str = "Nauta Email Listener"`; the `"nauta-teal"` style-pack id (see next row) | See discretionary sub-item below — `APP_NAME` is unambiguously UI-chrome-adjacent (surfaces in logs/health responses) and MUST rename |
| **Discretionary:** `"nauta-teal"` style-pack identifier | 21 files (TS+Python), ~60+ occurrences | `packages/genui/src/theme/packs.ts:270-348` (`STYLE_PACKS["nauta-teal"]`, `DEFAULT_PACK_ID`), mirrored in `apps/email-listener/app/infrastructure/llm/genui_style_packs.py` | Not explicitly named in CONTEXT.md's locked decision list. This is a product-facing *identifier string* (flows into generated UI specs, test assertions, and the genui LLM system prompt as a literal token), not merely a comment. Recommend treating as **Claude's Discretion, lean MUST-rename** (`"polytoken-teal"` or similar) since VISION.md's "rename once" guardrail implies no lingering brand-named identifiers — but flag explicitly for the planner to confirm scope, since it touches ~21 files including hardcoded test-assertion strings (`packages/genui/src/theme/__tests__/packs.test.ts`) and an LLM-facing default value whose exact wire format other systems may pattern-match on |
| `supabase/config.toml` `project_id` | 1 | `supabase/config.toml:5` `project_id = "nauta"` | Local Supabase CLI container-naming label only (own comment: "distinguish different Supabase projects on the same host") — zero code references anywhere (grep-verified), purely cosmetic, safe MUST-rename |
| `.env.example` comment labels | 4 lines | `.env.example:10,14,27,31` — `"nauta-staging"`/`"nauta-prod"` as human-readable comment labels next to the real project refs (`fyfwkjvbcrmjqjysdyqw`/`dazyccjijdahxyciptkp`) | Comment-only, zero functional coupling; git-tracked (unlike the other `.env.*` files, which are gitignored and machine-local — not in scope) |
| Exemplar copy (genui few-shot prompt data) | 1 file, ~7 occurrences | `apps/email-listener/app/infrastructure/llm/exemplars/__init__.py:466-542` — "Nauta reads your business emails...", "Sign up for early access to Nauta", aria-labels | Product-copy exemplar data fed to the LLM as a style reference — cosmetic, MUST-rename for brand consistency, zero structural risk |

**Total MUST-rename file count (this session's precise grep, all classes above, excluding `.planning/` and `dist/`):** ~230 files. This is consistent with (slightly refines) the milestone research's ~210–246 estimate.

### KEEP — must NOT be touched (looks like a rename target, is not)

| Surface | Where | Why it's excluded |
|---|---|---|
| `entity_instances.nauta_id` column + `nautaId` Drizzle field | `packages/db/src/schema/entity-instances.ts:48`; migrations `0006_bitter_white_queen.sql:29,38`, `0016_entity_identity.sql` (5 occurrences), `0017_entity_resolution_rpcs.sql:14` | **Confirmed this session:** a real, live Postgres column with a partial unique index (`entity_instance_unique_per_importer ... WHERE nauta_id IS NOT NULL`). Per the schema file's own doc comment: "Originally a lightweight Nauta-entity mirror... rows may now be email-extracted (nauta_id NULL) or Nauta-synced (nauta_id set, source='nauta_sync')" — this refers to an **external upstream system** entities were historically synced from, unrelated to this repo's own product/package name. Renaming it would require a live-data column-rename migration across every environment — entirely out of RENM-01's scope (package/import/config rename, not schema rename) |
| `nauta_sync` literal string (stored `source` column value) | Same migrations; consumed by `apps/email-listener/app/domain/entities/entity_instance.py`, `entity_instance_repository.py`, `promote_entity_on_confirm.py`, and 8+ test files (`nauta_id=None` kwarg usage) | Same reasoning — a stored data-discriminator value, not a brand string. 14 files total reference `nautaId`/`nauta_id` across TS+Python; none should be touched |
| `.planning/` historical milestone docs | `.planning/milestones/v1.1-*` through `v1.6-*`, `.planning/RETROSPECTIVE.md`, `.planning/v1.0-MILESTONE-AUDIT.md`, `.planning/v1.1-MILESTONE-AUDIT.md`, research docs under `.planning/research/{STACK,SUMMARY}.md` (the pre-v1.7 ones) | Per CONTEXT.md's Claude's-Discretion note: "historical docs may keep 'nauta' (they describe the past)". These describe completed phases under the old name — rewriting history is not the goal |
| `.env.local`, `.env.production`, `.env.staging`, `.env.vercel.check`, `.env.vercel.prod` | Repo root | **Confirmed this session: none of these are git-tracked** (only `.env.example` is) — machine-local secrets, out of scope for a code rename entirely |
| `.vercel/project.json` (`"projectName":"nauta-web"`) | `.vercel/` | **Confirmed this session: `.vercel/` is `.gitignore`'d and not git-tracked** (`.gitignore:43`) — a local CLI-linking artifact regenerated by `vercel link`; not part of the committed rename surface at all |
| `COMMANDS.MD` local absolute paths | `COMMANDS.MD:6,50,63` | Contains the literal local clone path `C:\Users\pc\Desktop\nauta.services.email-listener\...` — this is the user's local folder name, not a code identifier. Out of scope for a code-level rename; if the user later renames the clone folder, this doc goes stale regardless of anything this phase does |

### RUNBOOK-only — live external resources, NOT executed this phase (RENM-02)

Every occurrence below is a **live, named AWS/Terraform/Vercel resource** or a **local-only Terraform state artifact**. Confirmed this session (supersedes/confirms milestone PITFALLS.md #14's file:line citations):

| Surface | File:line | Live resource it names |
|---|---|---|
| Terraform `var.project` default | `infrastructure/aws/variables.tf:16` | `"nauta-services"` — flows into `locals.service_name`, ECR repo name, ECS cluster/service name, CloudWatch log group |
| Terraform `tg_prefix` local | `infrastructure/aws/locals.tf:4` | `"nauta-el"` — ALB target group name prefix (32-char cap) |
| GitHub Actions env block (production) | `.github/workflows/deploy-email-listener.yml:13-15` | `ECR_REPOSITORY`/`ECS_CLUSTER`/`ECS_SERVICE: nauta-services-email-listener` — **confirmed this session: this file has ZERO `@nauta/*` npm-scope references; its only nauta content is these three AWS resource-name env vars** |
| GitHub Actions env block (staging) | `.github/workflows/deploy-email-listener-staging.yml:13-15` | Same three vars, staging variant (`ECS_SERVICE` suffixed `-staging`) — same zero-npm-scope finding |
| Terraform commented S3 backend | `infrastructure/aws/main.tf:13` | `#   bucket = "nauta-services-terraform-state"` (commented out — backend is local-only per PITFALLS.md #14) |
| `terraform.tfstate` (local file) | `infrastructure/aws/terraform.tfstate` | **Confirmed this session: gitignored (`.gitignore:24-25` `*.tfstate*`), not git-tracked.** Contains the live ALB DNS name, ECR registry URL, ECS cluster/service names, IAM role ARN, S3 bucket name, and 3 SNS topic ARNs — all real, deployed resource identifiers. This file must never be hand-edited; any Terraform-side rename must go through `terraform state mv`/`plan`/`apply`, never a text substitution |
| `README.md` deploy-target table | `README.md:56-57` | `nauta-services-email-listener` / `nauta-services-email-listener-staging` — table cells documenting the SAME live ECS resource names as above; rename only in lockstep with an actual infra rename, not as part of this phase's prose cleanup |
| S3 bucket (SES inbound storage) | `apps/email-listener/app/settings.py:97` `SES_S3_BUCKET: str = "nauta-services-ses-inbound-emails"` | Live S3 bucket name — a Python **config value string**, but it must match the real bucket name; changing it in code without renaming the bucket breaks ingestion |

**Runbook must document, verbatim, for the user:** the two-source-of-truth problem (Terraform `var.project` vs. hardcoded workflow YAML — update both in the same PR, never split); the ECR `force_delete=false` hazard (a Terraform-level rename is destroy+recreate for immutable-name resources; `apply` will fail loudly on a non-empty repo, which is safer than succeeding silently — do not flip `force_delete=true` casually, and do not attempt `terraform state mv` without first confirming the AWS provider's actual rename-in-place support); the local-only tfstate hazard (confirm which machine/runner holds current state before any rename-triggered `apply`); and that `SES_S3_BUCKET`/GitHub Actions env vars/`terraform.tfstate` all describe the SAME live resources from different angles — renaming one without the others breaks deploy or ingestion.

### Special-Handling Surface: `.claude/skills/nauta-design-system/`

**Confirmed this session:**
- `git status --porcelain` shows `.claude/skills/nauta-design-system/SKILL.md` as modified (`M`, 7-line uncommitted addition, diff-verified) and `.claude/skills/nauta-design-system/scripts/build-design-data.mjs` as untracked (`??`).
- `SKILL.md`'s own frontmatter `name: nauta-design-system` and its prose contain 10 `@nauta/ui`/`@nauta/tailwind-config` references; `references/component-catalog.md` has 3; `scripts/build-catalog.mjs` and `scripts/build-design-data.mjs` together have 6 (import-path template strings for generated design-catalog output).
- Per the orchestrator's explicit instruction, this research session did **not** modify this file.

**Guidance for the planner:** the directory name (`nauta-design-system` → `polytoken-design-system`) and every `@nauta/*` string inside it are legitimate MUST-rename surface — the skill exists to teach agents `@nauta/ui` conventions, and a stale skill actively misleads future work. However, because `SKILL.md` currently has uncommitted local edits and `build-design-data.mjs` is untracked, the plan must NOT include a step that discards or resets this directory's working-tree state. A plain literal-substring substitution script operates on file *contents* regardless of git status, so it is safe to include this directory in the rename pass's file glob — the risk is only in any step that does `git checkout`/`git restore`/`git clean` touching this path, which must be avoided. Recommend the plan calls this out as its own reviewed diff hunk (not because the mechanism differs, but because a reviewer needs to see "uncommitted pre-existing change + rename change, combined" clearly rather than assume the whole diff is rename-only).

## Pre-Existing Dirty-File Exclusion List (hard exclusions, do not touch)

Per the orchestrator's explicit instruction and confirmed via `git status --porcelain` this session, the following paths carry pre-existing uncommitted state unrelated to this phase and MUST be excluded from any rename script's file glob, even where they contain `nauta` text:

| Path | Git state | Contains nauta text? |
|---|---|---|
| `infrastructure/aws/ecs.tf` | Modified (5 ins/2 del) | No (confirmed this session — zero matches) |
| `.planning/HANDOFF.json` | Modified | Not checked for content (excluded regardless per instruction) |
| `apps/web/src/app/dev/design/` | Untracked (4 files) | Yes — `design-data.json`, `page.tsx`, `previews-core.tsx`, `previews-vendored.tsx` all reference `@nauta/*` |
| `graphify-out/` | Untracked | Yes — heavy nauta content (graph chunks), but this is generated tool output, not source |
| `links.md` | Untracked | No (confirmed this session — zero matches) |
| `COWORK-BRIEFING.md` | Untracked | Yes — 1+ matches |
| `"0 - nauta_design_case.pdf"` | Untracked | N/A (binary, filename itself contains "nauta" — do not rename the file either) |
| `"Nauta - Guia de Arquitetura (PT-BR).pdf"` | Untracked | N/A (binary, filename itself contains "Nauta") |

Note `apps/web/src/app/dev/design/` is the one path in this list that DOES contain live `@nauta/*` references that would otherwise be in the MUST-rename bucket — it is excluded here purely because it's pre-existing dirty/untracked scratch content the user has asked not to be touched this phase, not because its content differs in kind from the rest of the MUST-rename surface. The planner should note this as a known, deliberate gap against "zero `@nauta/` references remain" (SC1) — flag it, don't silently violate the acceptance criterion without explanation.

## Standard Stack

### Core

No new runtime dependency is required for this phase — the milestone STACK.md research (confirmed, still valid) recommends a **zero-dependency Node script** doing literal substring substitution, not `ast-grep`/`jscodeshift`. This repo already has Node 24.15.0, npm 11.12.1 available (verified this session via `node --version`/`npm --version`).

| Tool | Version (verified this session) | Purpose | Why standard |
|---|---|---|---|
| Node.js (built-in `fs`/`path`, no package) | v24.15.0 | Walk the file tree, apply substitutions, write back | Zero new dependency, fully auditable in a single script file, matches the milestone STACK.md recommendation |
| npm workspaces (already in use) | npm 11.12.1 | Regenerate `node_modules/@polytoken/*` symlinks post-rename | This repo's own existing tooling — confirmed NOT pnpm |

### Alternatives Considered

| Instead of | Could use | Tradeoff |
|---|---|---|
| Zero-dep Node script | `jscodeshift`/`ts-morph` codemod | AST-aware, but overkill for a literal scope-string substitution and a new dependency for a one-time operation; also wouldn't help with the JSON/YAML/TOML/Markdown occurrences, which are the majority of the non-import surface |
| Zero-dep Node script | Shell `sed`/`grep -rl \| xargs sed` | Works but is not cross-platform-safe on Windows (this repo's dev environment, confirmed `win32`/PowerShell) and harder to make the exclusion-list logic (KEEP/RUNBOOK/dirty-file exclusions) reviewable in one place |

**Installation:** none — no `npm install` needed for the rename mechanism itself.

## Package Legitimacy Audit

Not applicable — this phase installs zero new external packages (RENM-01/RENM-02 are a rename + documentation phase). Skip the slopcheck/registry-verification gate entirely; do not fabricate a table for it.

## Architecture Patterns

### Rename Execution Flow

```
1. INVENTORY (this document) — the explicit allow-list of file globs +
   the explicit deny-list (KEEP items, RUNBOOK items, dirty-file exclusions)
        │
        ▼
2. SUBSTITUTION PASS (single Node script, single commit)
   - package.json name/dependency fields: "@nauta/X" -> "@polytoken/X"
     (6 files) + root package.json name + 11 -w selectors
   - *.ts/*.tsx import specifiers: "@nauta/X" -> "@polytoken/X" (197 files)
   - vercel.json buildCommand (1 file)
   - UI chrome strings: "Nauta" -> "Polytoken" (9 occurrences, apps/web/src/app/**)
   - docs (README.md x3, apps/web/README.md, pyproject.toml) — prose only,
     NEVER touching the same files' live-resource-name table cells
   - supabase/config.toml project_id, .env.example comment labels
   - discretionary: "nauta-teal" -> "polytoken-teal" style-pack id (confirm
     scope with the planner before including — 21-file surface)
   - .claude/skills/nauta-design-system/ (content substitution only;
     directory rename via `git mv` as a distinct, reviewable step)
        │
        ▼  hard exclusions enforced by the glob itself:
        │  entity_instances.nauta_id/nautaId/nauta_sync (never matched —
        │  script must specifically NOT touch packages/db/migrations/**
        │  and packages/db/src/schema/entity-instances.ts for this string)
        │  .planning/ historical docs, dirty-file exclusion list,
        │  RUNBOOK-only infra/CI resource-name strings
        ▼
3. WORKSPACE REGENERATION
   rm -rf node_modules **/node_modules package-lock.json apps/web/.next
   npm install
   (regenerates node_modules/@polytoken/* symlinks; without this step,
    stale @nauta/* symlinks + a stale lockfile break `npm ci` in CI even
    though local `npm install` silently "works" — PITFALLS.md #15)
        │
        ▼
4. VERIFICATION MATRIX (package-scoped, per CLAUDE.md "run typecheck after
   code changes; run single tests, not full suite" — still run the FULL
   per-package suite here since this is a repo-wide mechanical change,
   not a targeted code edit)
   npm run typecheck -w @polytoken/web
   npm run typecheck -w @polytoken/api-client
   npm run typecheck -w @polytoken/db
   npm run typecheck -w @polytoken/genui
   npm run typecheck -w @polytoken/ui
   npm run test -w @polytoken/web        (vitest)
   npm run test -w @polytoken/api-client (vitest)
   npm run test -w @polytoken/genui      (vitest)
   npm run check   (root — Python lint+format+typecheck+architecture+test,
                     apps/email-listener; unaffected by the TS-side rename
                     but must still pass to prove nothing broke)
   grep -rn "@nauta/" --include="*.ts" --include="*.tsx" --include="*.json"
     --include="*.mjs" . | grep -v node_modules   (must return ZERO,
     excluding .planning/ historical docs and the explicit dirty-file list)
        │
        ▼
5. RUNBOOK DOC (separate deliverable, no code change)
   External renames: GitHub repo name, AWS/Terraform resources (with the
   two-source-of-truth + force_delete + tfstate warnings verbatim),
   Vercel project, domain purchase/DNS — `terraform plan` (not `apply`)
   included as the human-reviewed proof step
```

### Pattern 1: Explicit allow-list glob, not repo-wide grep-replace

**What:** The substitution script's file-discovery step enumerates specific globs (`apps/web/src/**/*.{ts,tsx}`, `packages/*/src/**/*.{ts,tsx}`, `packages/*/package.json`, `package.json`, `vercel.json`, `.claude/skills/nauta-design-system/**`, specific doc files) rather than `grep -rl nauta . | xargs sed`.
**When to use:** Any repo where a naive case-insensitive substring match would also hit unrelated legacy identifiers (here: `nauta_id`/`nauta_sync`) or generated/binary content (here: `packages/api-client/dist/`, `graphify-out/`, two PDFs).
**Why:** A blanket `-i nauta` replace is provably wrong for this repo — it would corrupt `entity_instances.nauta_id`'s migration SQL and Drizzle schema, silently breaking a live partial unique index's referenced column name.

### Pattern 2: Two-tier casing convention (per CONTEXT.md discretion)

**What:** `polytoken` lowercase everywhere a package scope/slug/identifier currently reads `nauta` lowercase (npm scopes, `project_id`, style-pack ids); `Polytoken` product-case everywhere UI chrome currently reads `Nauta` product-case (page titles, sidebar brand text, exemplar copy).
**Example (grep-verified current casing pairs):**
```
@nauta/web            -> @polytoken/web            (lowercase scope)
"Nauta — Emails"       -> "Polytoken — Emails"       (product-case title)
project_id = "nauta"   -> project_id = "polytoken"   (lowercase config label)
Nauta (sidebar text)   -> Polytoken (sidebar text)   (product-case chrome)
```

### Anti-Patterns to Avoid

- **Case-insensitive blanket substitution:** would corrupt `nauta_id`/`nauta_sync` (live DB column + stored data) and touch the excluded dirty-file list — must use an explicit file allow-list plus a string-level (not regex-`/nauta/i`) match that targets only the confirmed classes above.
- **Renaming `.github/workflows/*.yml` resource-name env vars "because it says nauta":** these are NOT `@nauta/*` scope references (confirmed zero occurrences) — they are live AWS resource names, RUNBOOK-only. Conflating the two is the exact mistake PITFALLS.md #14 warns about.
- **Running `terraform apply` (or even letting a rename-triggered CI run touch Terraform) as part of this phase:** RENM-02 explicitly scopes this out; `terraform plan` review only, and only as part of the runbook the user executes later, not this phase's own verification gate.
- **Trusting a green local `npm install` as proof the rename worked:** per PITFALLS.md #15, local `npm install` silently rewrites a mismatched lockfile; only a clean `rm -rf node_modules **/node_modules package-lock.json && npm install` followed by `npm ci` (the CI-faithful command) proves the lockfile itself is consistent.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Cross-file consistent string rename with an exclusion list | A hand-typed sequence of dozens of individual `Edit` tool calls | One reviewable Node script, single commit, with the file-glob allow-list and the `entity_instances`/dirty-file deny-list encoded as data at the top of the script | Individual edits across ~230 files is not just slower — it is where a human/agent silently skips a file class (e.g., forgets `.env.example`'s comment labels or `supabase/config.toml`) and produces exactly the "hybrid state" VISION.md's rename-once guardrail forbids |
| Verifying the rename is complete | Manually re-reading files | The exact `grep -rn "@nauta/"` command in § Architecture Patterns step 4, run as a scripted acceptance check, not a visual scan | Matches SC1's own literal wording ("zero `@nauta/` references remain") — make it a command, not a judgment call |

**Key insight:** the danger in this phase isn't technical difficulty (it's a find/replace) — it's *scope leakage in both directions*: touching things that must stay (`nauta_id`, live AWS names, dirty files) and missing things that must move (JSON/YAML/TOML string literals a TS-import-only tool wouldn't catch). Both directions are solved the same way: an explicit, data-driven allow-list/deny-list reviewed once, not ad hoc judgment calls per file.

## Common Pitfalls

(Inherited directly from the milestone PITFALLS.md #14/#15, confirmed still accurate against this session's own repo reads — not re-derived, cross-referenced.)

### Pitfall 1: Big-bang rename — two unsynced sources of truth for AWS naming
**What goes wrong:** Terraform's `var.project` and the GitHub Actions workflow YAML's hardcoded `ECR_REPOSITORY`/`ECS_CLUSTER`/`ECS_SERVICE` env vars are two independent strings today (confirmed this session, both still say `nauta-services-email-listener`). This phase does not touch either (RUNBOOK-only) — but the runbook the phase produces must warn that whoever DOES execute the external rename must change both in the same PR, or risk a workflow deploying to a resource Terraform just renamed away from.
**How to avoid:** Document explicitly in the runbook; this phase's own acceptance gate (`terraform plan` showing zero unreviewed diff) proves this phase itself didn't touch either source, not that they're reconciled — reconciliation is the user's later job.
**Warning signs:** `terraform plan` output showing any `# forces replacement` on ECR/ECS/ALB/CloudWatch resources after this phase's commits land — should be impossible if RUNBOOK-only surfaces were correctly excluded; if it appears, something in the code-rename pass touched a Terraform file it shouldn't have.

### Pitfall 2: npm workspace/lockfile/cache mechanics
**What goes wrong:** `package.json` `name` fields change but stale `node_modules/@nauta/*` symlinks + a stale `package-lock.json` make `npm ci` fail in CI (hard failure) while local `npm install` silently "works" by rewriting the lockfile — masking the real problem until a cold-cache CI run.
**How to avoid:** The mandatory `rm -rf node_modules **/node_modules package-lock.json apps/web/.next && npm install` step in § Architecture Patterns step 3 — verified this session that exactly 6 `@nauta/*` symlinks currently exist under `node_modules/@nauta/` (`api-client`, `db`, `genui`, `tailwind-config`, `ui`, `web`), confirming all 6 packages need the clean-reinstall treatment.
**Warning signs:** `npm run <workspace-script>` failing with "no workspaces found" after `package.json` names change but before every `-w @nauta/X` selector is updated to match; `npm ci` failing in CI specifically (not locally) immediately post-merge.

### Pitfall 3 (new this session, not in milestone PITFALLS.md): `entity_instances.nauta_id` false-positive rename target
**What goes wrong:** Any tool or reviewer doing a case-insensitive repo-wide "nauta" grep will surface `nauta_id`/`nautaId`/`nauta_sync` (14 files) as if they were part of the brand-rename surface. If actually renamed, this breaks a live Postgres column (with a partial unique index depending on its exact name) across every deployed environment, requires an actual data migration, and conflates two unrelated concepts (this repo's own package/brand name vs. a legacy external system's record-id field) that happen to share a string by historical coincidence.
**Why it happens:** The column predates the current product name context — per the schema file's own comment, `entity_instances` was "originally a lightweight Nauta-entity mirror" (syncing from an external system called Nauta, not this repo's own product), later repurposed in Phase 10 as this repo's cross-email identity store while keeping the legacy column name.
**How to avoid:** Explicit exclusion in the rename script's file glob (never touch `packages/db/migrations/*.sql` or the `nautaId`/`source` field definitions in `packages/db/src/schema/entity-instances.ts`); if the planner wants this field renamed for genuine confusion-avoidance reasons, that is a SEPARATE, later, migration-bearing phase — not this one.
**Warning signs:** A diff touching any `packages/db/migrations/*.sql` file, or any `nauta_id`/`nautaId`/`nauta_sync` string, appearing in this phase's rename commit — should never happen; treat as a hard stop if seen in review.

## Code Examples

### Verification command matrix (all confirmed runnable this session)

```bash
# TypeScript/JS side, per-workspace (npm 11.12.1, node v24.15.0 confirmed present)
npm run typecheck -w @polytoken/web
npm run typecheck -w @polytoken/api-client
npm run typecheck -w @polytoken/db
npm run typecheck -w @polytoken/genui
npm run typecheck -w @polytoken/ui
npm run test -w @polytoken/web          # vitest run
npm run test -w @polytoken/api-client   # vitest run
npm run test -w @polytoken/genui        # vitest run

# Python side (uv 0.11.8, Python 3.13.0 confirmed present) — root package.json's
# own "check" script, unaffected by the TS rename but must stay green
npm run check   # cd apps/email-listener && ruff check + ruff format --check +
                 # mypy app + lint-imports + pytest

# Rename-completeness acceptance check (matches SC1's literal wording)
grep -rn "@nauta/" --include="*.ts" --include="*.tsx" --include="*.json" \
  --include="*.mjs" . | grep -v -E "node_modules|\.next|/dist/|^\.planning/"
# Expected: zero output (any hit outside .planning/ historical docs is a miss)

# Infra proof step (RENM-02's own acceptance criterion — read-only, no apply)
npm run infra:tf -- plan   # == terraform -chdir=infrastructure/aws plan
# Expected: no diff at all (this phase touches zero .tf files); any diff here
# means a Terraform file was accidentally included in the rename pass
```

### Current workspace symlink state (baseline, verified this session)

```
$ ls node_modules/@nauta
api-client@  db@  genui@  tailwind-config@  ui@  web@
```
Post-rename, `node_modules/@polytoken/*` should show the identical 6 entries after `npm install`; `node_modules/@nauta` should no longer exist.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| `@nauta/*` npm scope, `"nauta-services"` root package name | `@polytoken/*` scope, `"polytoken"`/`"polytoken-services"` root name | This phase (42) | Every subsequent v1.7+ phase (43 Auth, 44 Tenancy, 45 Threads, 46 Hygiene) authors new files under the final name — per VISION.md's "rename once" guardrail, this is why the milestone sequenced rename FIRST |

**Deprecated/outdated:** none — this is a first-time rename, not a migration off a deprecated pattern.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `"nauta-teal"` style-pack identifier (21-file surface) should be renamed as part of this phase | Rename Surface Inventory (discretionary row) | LOW-MEDIUM — if the planner/user decides to leave it as-is (treating it as a data/config value distinct from the brand string, similar reasoning to why `nauta_id` is excluded), the phase's "zero `@nauta/` references" gate is unaffected (it doesn't match the `@nauta/` pattern), but SC1's broader "user-visible chrome says polytoken" intent could be read either way. Flagged explicitly as needing a planner/user confirmation rather than assumed silently. |
| A2 | Root `package.json`'s `"name": "nauta-services"` should be renamed even though it isn't `@nauta/*`-scoped | Rename Surface Inventory | LOW — private/unpublished field with zero downstream coupling found this session; safe either way, included for completeness per "polytoken everywhere internally" |

**If this table is empty:** N/A — two low-risk discretionary items above, no HIGH-risk assumptions. Everything else in this document (file counts, git-tracked status, migration content, workflow YAML content) was grep/read-verified directly against the live repo in this session, not assumed.

## Open Questions (RESOLVED)

1. **Does "nauta-teal" get renamed this phase?**
   - RESOLVED: YES — renamed to `polytoken-teal` (no alias), including the hardcoded test-assertion strings. See `42-01-PLAN.md` `<autonomous_decisions>` DECISION 1 for full rationale (brand identifier, unlike the excluded `nauta_id` data surface; genui cache keys are regenerable per TENA-01).
   - What we know: it's a product-facing identifier (not a comment), spans 21 files across TS+Python, and is embedded in an LLM system-prompt-adjacent default value.
   - What's unclear: CONTEXT.md's locked-decision list doesn't explicitly enumerate it, and it's arguably closer to "config value" than "brand chrome."
   - Recommendation: planner should make an explicit, stated call (not silently include or silently skip) — either way, update the 5+ hardcoded test-assertion strings in `packages/genui/src/theme/__tests__/packs.test.ts` and `apps/email-listener/tests/application/test_cache_key.py` consistently with whatever is decided.

2. **Should the `.claude/skills/nauta-design-system/` directory itself be `git mv`'d to `polytoken-design-system` this phase, or left as a follow-up?**
   - RESOLVED: Renamed THIS phase as its own isolated task/commit (42-01 Task 2), per the recommendation below; pre-existing dirty edits (SKILL.md, untracked build-design-data.mjs) preserved through the rename. See `42-01-PLAN.md` `<autonomous_decisions>` DECISION 2.
   - What we know: its content (SKILL.md, references, scripts) is legitimate rename surface; it currently has uncommitted local changes.
   - What's unclear: whether combining a directory rename with in-flight uncommitted edits in the same commit is acceptable, or whether the planner should sequence it as its own isolated task so the diff is easy to review.
   - Recommendation: treat as its own task/commit within the phase (not skipped, not silently bundled into the bulk substitution commit) — this matches PITFALLS.md #15's own general advice to keep the rename as "an isolated commit... with no unrelated logic changes mixed in."

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Node.js | Rename script execution, npm workspace tooling | Yes | v24.15.0 | — |
| npm | Workspace install/typecheck/test commands | Yes | 11.12.1 | — |
| Python / uv | `npm run check` (Python-side verification gate) | Yes | Python 3.13.0 / uv 0.11.8 | — |
| Terraform CLI | `terraform plan` proof step (RENM-02 acceptance criterion) | Yes | v1.15.6 | — |

No missing dependencies — every tool this phase's verification gates need is already present in this environment.

## Security Domain

`security_enforcement` is not set in `.planning/config.json` (absent = enabled per the default), so this section is included per protocol. However, this phase is a pure rename/documentation phase with zero new input-handling surface, zero new authentication/authorization code, and zero new data flows — none of the ASVS categories are newly applicable as a *result of this phase's own changes*.

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | No | No auth code touched this phase |
| V3 Session Management | No | No session code touched this phase |
| V4 Access Control | No | No access-control code touched this phase |
| V5 Input Validation | No | No new input-handling code; string substitution is a build-time/dev-time script, not a runtime input path |
| V6 Cryptography | No | No crypto code touched this phase |

**One genuinely security-adjacent note, not ASVS-shaped:** the rename script itself is a one-time dev-tooling script, not shipped runtime code — it does not need to be hardened against untrusted input (its "input" is this repo's own source tree, already fully trusted). The only security-relevant discipline here is operational: never let the rename script or its verification step touch `.env.*`/secrets files (none of which are in the MUST-rename inventory above) and never let it write to `infrastructure/aws/terraform.tfstate` (already gitignored and explicitly excluded).

## Sources

### Primary (HIGH confidence)
- Direct repo reads/greps performed in this research session (all file:line citations above): `package.json` (root + 6 workspace packages), `vercel.json`, `.github/workflows/{deploy-email-listener,deploy-email-listener-staging,ci-email-listener}.yml`, `infrastructure/aws/{variables,locals,main,ecs}.tf`, `infrastructure/aws/terraform.tfstate`, `packages/db/migrations/{0006_bitter_white_queen,0016_entity_identity,0017_entity_resolution_rpcs}.sql`, `packages/db/src/schema/entity-instances.ts`, `apps/email-listener/{settings.py,pyproject.toml,README.md}`, `apps/email-listener/app/infrastructure/llm/{exemplars/__init__.py,genui_style_packs.py}`, `packages/genui/src/theme/{packs.ts,tokens.ts,themed-wrapper.tsx,__tests__/packs.test.ts}`, `apps/web/{package.json,tailwind.config.ts,README.md,src/app/layout.tsx,src/app/**/page.tsx,src/components/app-sidebar.tsx}`, `supabase/config.toml`, `.env.example`, `.gitignore`, `.claude/skills/nauta-design-system/{SKILL.md,references/component-catalog.md,scripts/*.mjs}`, `README.md`, `COMMANDS.MD`, `git status --porcelain`, `git diff --stat`, `node/npm/python/uv/terraform --version`.
- `.planning/research/v1.7-polytoken-foundation/{SUMMARY,PITFALLS,ARCHITECTURE}.md` — milestone-level research this phase's own research extends and cross-verifies (all Pitfall #14/#15 file:line citations independently re-confirmed against the live repo this session, not merely trusted).
- `.planning/phases/42-atomic-rename-nauta-polytoken/42-CONTEXT.md` — user decisions, copied verbatim above.
- `.planning/REQUIREMENTS.md`, `.planning/config.json` — requirement text and workflow settings (`nyquist_validation: false`, confirmed via direct read).

### Secondary (MEDIUM confidence)
None — every claim in this document was either grep/read-verified this session or is a direct carry-forward from the already-HIGH-confidence milestone research docs.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Rename surface inventory (MUST-rename/KEEP/RUNBOOK counts): HIGH — every count is a grep result from this session, re-run and cross-checked, not estimated
- `entity_instances.nauta_id` exclusion: HIGH — confirmed via direct migration-file reads, not just the milestone doc's earlier claim
- Verification command matrix: HIGH — every command's underlying `package.json` script was read directly; tool versions confirmed via `--version` in this environment
- `"nauta-teal"` discretionary scope call: MEDIUM — the file/occurrence count is HIGH confidence (grep-verified), but whether it belongs in this phase's scope at all is a genuine open judgment call, flagged as such

**Research date:** 2026-07-09
**Valid until:** Effectively unbounded for the inventory/counts (this is a point-in-time snapshot of a repo the planner will act on immediately) — treat as stale only if other uncommitted work lands in this repo between this research and plan execution (re-verify `git status --porcelain` at plan time if there's a gap).
