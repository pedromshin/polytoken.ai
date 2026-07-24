# Multi-tenancy readiness — retrofit or rewrite

**Assessment date:** 2026-07-24 · **Branch reality:** `claude/polytoken-email-infra-cont-qi9q5g`
**Lane:** RECON — how far the current model is from personal / team / org / workspace tenancy with real permissions, access control, sharing.

## Verdict (up front)

**RETROFIT, not rewrite — but the retrofit is only ~15% done and the finished 15% is invisible end-to-end.**

The W5 tenancy primitives (`workspaces`, `workspace_members`, `resource_shares`) and the additive authorization gate (`assertCanAccess`) exist, are well-designed, migrated (0047), unit-tested, and mounted. The architecture deliberately chose *additive widening*: keep `user_id` as the ownership anchor on every table, and layer sharing on top rather than re-anchoring resources on a workspace. That decision is sound and is precisely what makes full team-tenancy a retrofit rather than a rewrite — you can wire it table-by-table without a big-bang re-anchoring migration.

But today the sharing layer is wired into **exactly one read path** (`documents.byId`), **zero list paths**, and **zero frontend surfaces**. A shared resource is currently *unreachable* by its recipient in practice (see Finding 2). So the honest state is: the hard, risky schema/algebra work is done and correct; what remains is broad, mechanical, low-risk wiring — plus one genuinely structural gap (list queries).

## What actually exists (verified)

- **Schema** — `packages/db/src/schema/workspaces.ts:35`, `workspace-members.ts:41`, `resource-shares.ts:49`. Migration `packages/db/migrations/0047_workspaces_teams_rbac.sql:1-40` creates the three enums (`share_permission`, `shared_resource_type` = document|entity|file|conversation, `workspace_role` = owner|admin|member|viewer), tables, FKs, indexes, a `num_nonnulls(...)=1` grantee-XOR CHECK (`:56-60`), and RLS policies.
- **Authorization algebra** — `packages/db/src/access-control.ts`: `assertCanAccess` (`:285`) checks owner-first (`:293`) then share-widened (`:297`); `effectiveSharedPermission` (`:214`) unions direct-user shares + workspace shares capped by role; `capPermission`/`roleRank`/`permissionSatisfies` are pure and unit-tested (`access-control.test.ts`).
- **RBAC router** — `packages/api-client/src/router/workspaces/index.ts`: create/list/members/addMember/changeRole/removeMember/leave + shareResource/listShares/revokeShare. No-self-escalation (`assertNotOutranking` `:462`), immutable-owner (`:205`, `:239`), share-requires-edit (`:309`). Mounted at `root.ts:33`.

This is a real, coherent foundation. The design comments are unusually honest about their own limits.

## Findings

### 1. Sharing is wired into ONE resource read path; 99 owner-only gates remain

`assertCanAccess` appears in only **9 non-test call sites**, all inside two routers (`documents/index.ts`, `workspaces/index.ts`). Every other id-addressed read/mutation across the API still calls the **owner-only** `ownership.ts` asserts — **99 call sites** of `assertImporterOwnership` / `assertEmailOwnership` / `assertConversationOwnership` / `assertDocumentOwnership` / etc. Only `documents.byId` (`documents/index.ts:97`) actually consults shares. `conversation` and `entity` have owner-resolution in `resolveResourceOwner` (`access-control.ts:164-190`) but their routers still gate owner-only, so a share of those types is inert. `file` (`:192`) returns `null` by design — the `file` share type is a **fails-closed no-op** until file owner-resolution lands. Retrofit cost here is breadth, not depth: swap the owner-only assert for `assertCanAccess` at each site where sharing should apply.

### 2. No LIST path surfaces shared resources — sharing is effectively unreachable

This is the structurally important gap, not just breadth. Every list/index query filters flatly on the caller's own id. The canonical example is the *representative wired* router: `documents.list` does `.where(eq(Documents.userId, ctx.user.id))` (`documents/index.ts:64`) with no share union — even though `documents.byId` right below it is share-aware. `ResourceShares` is referenced by **only one file in the entire read layer** (the workspaces router itself); no `.list` anywhere joins it. Net effect: a recipient of a share can open the resource *only if they already possess its raw UUID* (via the by-id path), because it never appears in any list they can see. End-to-end, sharing does not yet function. Fixing this means rewriting ~56 user-scoped list queries from `eq(userId)` to `owned ∪ shared` unions — the one part of the retrofit that touches query *shape*, not just the assert line.

### 3. Zero frontend surface for workspaces or sharing

`grep` for `trpc.workspaces` / `shareResource` / `useWorkspace` across `apps/web/src` (excluding tests) returns **nothing**. The router is mounted and callable but no UI creates a workspace, invites a member, or shares a resource. Multi-tenancy is currently a backend-only skeleton with no user-reachable path.

### 4. RLS is defense-in-depth only — the app boundary is the sole real wall

The 0047 policies (`0047...sql:63-67`) and the schema doc-comments state plainly: Drizzle connects as the Postgres superuser and FastAPI as `service_role`, **both bypass RLS**. So `assertCanAccess` + the router RBAC are the *only* enforcement. That is a defensible posture but means every unmigrated read path (Finding 1) is a place where a future share-aware resource could leak or fail to widen if wired wrong — there is no DB backstop.

### 5. No organization tier above workspace

Workspaces are flat and single-owner (`workspaces.owner_user_id`, `:42`). There is no org/tenant entity above them: no org-level roles, no billing/tenant boundary, no workspace nesting, no SSO/domain-claim concept. "Organization" tenancy (resources belonging to an org, org-scoped billing, admin console) is entirely unbuilt. Because of the additive design this is still reachable incrementally (add an `org_id` to workspaces, an `organizations` table, org-role checks) rather than by rewrite — but it is net-new, not a wiring task.

## Retrofit plan (ordered by leverage)

1. **Make sharing reachable (Finding 2, highest leverage).** Add `owned ∪ shared` unions to the list queries for the four shareable types, starting with `documents.list`. Without this, all other wiring is invisible. This is the only step that changes query shape; scope it carefully and test each.
2. **Wire the by-id gates (Finding 1).** Mechanically swap owner-only asserts → `assertCanAccess` for `conversation` and `entity` id-reads where sharing is intended. Leave non-shareable resources (emails/importers/desktop/spreadsheets) owner-only until a product reason exists.
3. **Land `file` owner-resolution** so the `file` share type stops being a no-op (`access-control.ts:192`), or explicitly defer and document it as unsupported.
4. **Build the sharing UI (Finding 3)** — a share sheet + workspace/member management, the first user-reachable surface.
5. **Defer org tier (Finding 5)** until team-sharing is proven; it is additive and non-blocking.

**Do NOT** attempt to re-anchor resource tables on `workspace_id` — that is the rewrite the current design was explicitly built to avoid, and it would regress the well-tested single-user isolation for no gain.

## Risks if deferred

Sharing/teams is advertised in planning docs as "shipped" (GRAND-COMPLETION-REPORT) but is functionally unreachable end-to-end (Findings 2+3). Any go-to-market claim of collaboration is currently false. Separately, because RLS is bypassed (Finding 4), each list query rewritten for sharing is a potential cross-tenant leak if done wrong and has no DB backstop — the retrofit must be test-gated per path, not batch-applied.
