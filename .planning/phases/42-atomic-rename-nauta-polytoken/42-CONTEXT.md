# Phase 42: Atomic Rename nauta → polytoken - Context

**Gathered:** 2026-07-09
**Status:** Ready for planning
**Mode:** Autonomous smart discuss — infrastructure phase detected (rename, all-technical success criteria); minimal context with milestone-research decisions carried forward

<domain>
## Phase Boundary

Internal rename only, executed as ONE atomic pass with no hybrid states: every `@nauta/*` package scope, workspace selector, config reference, doc mention, and user-visible chrome string becomes polytoken, with the workspace regenerated and all suites green afterward. External renames (GitHub repo, AWS/Terraform resources, Vercel project, domain purchase/DNS) are delivered as a user runbook and are NOT executed in this phase.

</domain>

<decisions>
## Implementation Decisions

### Locked by requirements & milestone research (not re-litigated here)
- `@nauta/*` → `@polytoken/*` everywhere: package.json `name` fields, root package.json workspace `-w @nauta/...` script selectors, TS imports, vercel.json build command, CI YAML references, docs, UI chrome strings (RENM-01)
- External renames are runbook'd, NOT executed (RENM-02); live AWS resource name strings stay untouched — ECR `force_delete=false` + local-only tfstate make a naive Terraform rename fail or risk destroy; runbook must carry these warnings explicitly
- Workspace symlinks regenerated after the rename (`rm -rf node_modules && npm install`) — this repo is npm workspaces, NOT pnpm
- Verification gates: zero remaining `@nauta/` references, typecheck green, web tests green, Python tests green, `terraform plan` proves live AWS resource names untouched

### Claude's Discretion
- Rename mechanics (zero-dep script vs manual passes, ordering, commit granularity) — research recommends a scripted pass; keep it reviewable
- Casing convention: follow existing usage — lowercase `polytoken` in package scopes/slugs/identifiers, product-case `Polytoken` where chrome currently says `Nauta`
- How much of `.planning/` history to rename: historical docs may keep "nauta" (they describe the past); active docs and templates should say polytoken — judgment call per file class

</decisions>

<code_context>
## Existing Code Insights

### Known rename surfaces (from `.planning/research/v1.7-polytoken-foundation/`)
- ~210+ files reference nauta across apps/web, apps/email-listener, packages/*, infrastructure, docs
- Root package.json scripts use `-w @nauta/db`-style workspace selectors — separate rename site from package names themselves
- `vercel.json:3` build command references the scope — separate rename site
- Terraform `var.project` ("nauta-services") and `.github/workflows/deploy-email-listener.yml` hardcodes are UNSYNCED sources of truth — the runbook must reconcile them; this phase does not change live resource names

### Established Patterns
- Deploy workflow fires on push to main (path-filtered on apps/email-listener + infra) with its own test gate — rename commits will trigger it, so Python tests must be green before push lands
- npm workspaces: per-package node_modules absence is normal; regenerate symlinks after scope rename

### Integration Points
- CI YAML, vercel.json, Terraform variables, root workspace scripts — all must move in the same atomic pass as package.json names or the workspace breaks (hybrid-state hazard)

</code_context>

<specifics>
## Specific Ideas

No user-facing feature specifics — infrastructure phase. The one visible outcome: user-visible chrome says polytoken.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (External rename execution is explicitly out of scope per RENM-02, captured above.)

</deferred>
