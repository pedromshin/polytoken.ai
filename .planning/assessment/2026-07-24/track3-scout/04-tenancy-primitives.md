# Track 3b Scout — Workspace / Tenancy Primitives

> Scope: map the EXISTING Workspace/tenancy primitives that Track 3b
> (`chat_canvas_layouts` JSONB blob → first-class `Workspace → Canvas → Node`
> rows) builds on. Analysis/design only — no source edits.
> Every claim below is cited to `file:line`. A downstream designer builds ONLY
> from this doc, so critical code is quoted inline.

---

## 0. TL;DR (the sharpest findings)

1. **Three tables + three enums, all born together in migration `0047`.**
   `workspaces`, `workspace_members`, `resource_shares` (+ enums `workspace_role`,
   `share_permission`, `shared_resource_type`). The design is deliberately
   **ADDITIVE / widening**: the single-user `user_id` anchor on every existing
   table is UNTOUCHED — a workspace/share only ever *grants* access beyond the
   owner, never narrows it (`workspaces.ts:5-9`, `access-control.ts:8-24`).

2. **`resource_shares` is a *generic polymorphic grant table*, NOT per-resource
   columns.** One row = "resource (type,id) is shared to {a workspace | a user} at
   {view|edit}". No FK on the target (`resourceType`+`resourceId`), owner resolved
   at check-time by dispatch (`resource-shares.ts:54-56`, `access-control.ts:158-196`).
   A CHECK constraint forces EXACTLY ONE grantee (`0047_workspaces_teams_rbac.sql:50-52`).

3. **Live control-plane, dormant data-plane.** The `workspacesRouter` IS registered
   (`root.ts:33`) with full CRUD + RBAC + sharing, and is unit-tested. But **no
   `apps/web` UI calls it** (zero `.workspaces.` / `shareResource` / `listShares`
   references in the web app), and the **Python `email-listener` has ZERO
   references** to any workspace table. The ONLY resource router that reads through
   the sharing gate today is `documents.byId` (`documents/index.ts:34,97`). So the
   primitives are wired and proven at the API layer, but no user-facing feature
   drives them yet — effectively dormant.

4. **Canvas nodes today are a JSONB blob, not rows.** `chat_canvas_layouts` is
   one row per conversation with `nodes`/`edges` as `jsonb`
   (`chat-canvas-layouts.ts:85,88`), already carrying a bolted-on `scope='home'`
   discriminator from migration `0046` — the exact thing Track 3b promotes. There
   is **no `canvases` / `canvas_nodes` / `data_node_specs` table anywhere yet**
   (confirmed: no schema file, no `pgTable("canvas…")`).

5. **Two distinct RLS idioms already exist to copy** — pick per table:
   `workspaces` uses a **member-visibility** policy (`owner OR EXISTS member`,
   `0047:74-83`); `documents`/`spreadsheets` use a **flat owner** policy
   (`user_id = auth.uid()`, `0040:38-40`). A `canvases` table that must be visible
   to workspace members should mirror the FORMER, not the latter.

**Doc written to:** `.planning/assessment/2026-07-24/track3-scout/04-tenancy-primitives.md`

---

## 1. The three tables — full schemas, FKs, RLS

All three are Drizzle table defs under `packages/db/src/schema/`, re-exported from
the barrel (`schema/index.ts:45-47`). Their DDL — including the CHECK and all RLS
policies — ships in ONE migration, `migrations/0047_workspaces_teams_rbac.sql`.

### 1.1 `workspaces` — the sharing container

Source: `packages/db/src/schema/workspaces.ts:35-58`

```ts
export const Workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Direct ownership anchor (INV-8/9). Cascade so a deleted user's workspaces go with them.
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => AuthUsers.id, { onDelete: "cascade" }),   // → auth.users(id)
    name: text("name").notNull().default("Untitled workspace"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspacesOwnerUserIdIdx: index("idx_workspaces_owner_user_id").on(t.ownerUserId),
  }),
);
```

- **Columns**: `id` (uuid PK, `gen_random_uuid()`), `owner_user_id` (uuid NOT NULL
  FK → `auth.users(id)` ON DELETE CASCADE), `name` (text NOT NULL default
  `'Untitled workspace'`), `created_at` (timestamptz NOT NULL default `now()`).
- **FK**: `workspaces_owner_user_id_users_id_fk` (`0047:31`).
- **Index**: `idx_workspaces_owner_user_id` on `owner_user_id` (`0047:37`) — "workspaces I own".
- **Ownership model note** (`workspaces.ts:10-16`): the owner is *also* seeded as a
  `workspace_members` row with role `owner` at create time, so membership queries
  never special-case the owner. `owner_user_id` is the durable **delete-authority**
  record.
- **Inferred types**: `WorkspaceRow`, `InsertWorkspace` (`workspaces.ts:63-64`).

**RLS** (`0047:69-83`) — member-visibility, owner-only write:

```sql
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all_workspaces_anon" ON "workspaces"
  AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "workspaces_member_authenticated" ON "workspaces"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM "workspace_members" m
               WHERE m.workspace_id = "workspaces".id AND m.user_id = auth.uid())
  )
  WITH CHECK (owner_user_id = auth.uid());
```

### 1.2 `workspace_members` — RBAC membership join

Source: `packages/db/src/schema/workspace-members.ts:41-74`

```ts
export const WorkspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull()
      .references(() => Workspaces.id, { onDelete: "cascade" }),      // → workspaces(id)
    userId: uuid("user_id").notNull()
      .references(() => AuthUsers.id, { onDelete: "cascade" }),       // → auth.users(id)
    role: workspaceRoleEnum("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceMembersUnique: unique("uq_workspace_members_workspace_user")
      .on(t.workspaceId, t.userId),
    workspaceMembersWorkspaceIdIdx: index("idx_workspace_members_workspace_id").on(t.workspaceId),
    workspaceMembersUserIdIdx: index("idx_workspace_members_user_id").on(t.userId),
  }),
);
```

- **Columns**: `id` (uuid PK), `workspace_id` (uuid NOT NULL FK → `workspaces(id)`
  CASCADE), `user_id` (uuid NOT NULL FK → `auth.users(id)` CASCADE), `role`
  (`workspace_role` enum NOT NULL default `'member'`), `created_at` (timestamptz).
- **Unique**: `uq_workspace_members_workspace_user` on `(workspace_id, user_id)`
  (`0047:17`) — a user holds at most one role per workspace.
- **FKs**: `..._workspace_id_workspaces_id_fk`, `..._user_id_users_id_fk` (`0047:32-33`).
- **Indexes**: `idx_workspace_members_workspace_id`, `idx_workspace_members_user_id`
  (`0047:38-39`) — "members of this workspace" + "workspaces this user belongs to".
- **Inferred types**: `WorkspaceMemberRow`, `InsertWorkspaceMember` (`workspace-members.ts:79-80`).
- **RBAC is app-enforced, not schema-enforced** (`workspace-members.ts:9-16`): only
  owner/admin may mutate membership; the schema does not encode this — the router
  does (see §3).

**RLS** (`0047:90-111`) — member sees own rows; workspace owner sees all rows for
their workspace; only the workspace owner may write:

```sql
CREATE POLICY "workspace_members_scoped_authenticated" ON "workspace_members"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM "workspaces" w
               WHERE w.id = "workspace_members".workspace_id AND w.owner_user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM "workspaces" w
            WHERE w.id = "workspace_members".workspace_id AND w.owner_user_id = auth.uid())
  );
```

### 1.3 `resource_shares` — generic polymorphic grants (the key design move)

Source: `packages/db/src/schema/resource-shares.ts:49-93`

```ts
export const ResourceShares = pgTable(
  "resource_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Polymorphic target — NO FK; owner resolved by resource_type at check time.
    resourceType: sharedResourceTypeEnum("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    // Grantee: EXACTLY ONE of these is non-null (CHECK num_nonnulls = 1, 0047).
    workspaceId: uuid("workspace_id").references(() => Workspaces.id, { onDelete: "cascade" }),
    targetUserId: uuid("target_user_id").references(() => AuthUsers.id, { onDelete: "cascade" }),
    permission: sharePermissionEnum("permission").notNull().default("view"),
    // Audit: who created the grant. Cascade with the granting user.
    grantedBy: uuid("granted_by").notNull()
      .references(() => AuthUsers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    resourceSharesResourceIdx: index("idx_resource_shares_resource").on(t.resourceType, t.resourceId),
    resourceSharesTargetUserIdx: index("idx_resource_shares_target_user").on(t.targetUserId),
    resourceSharesWorkspaceIdx: index("idx_resource_shares_workspace").on(t.workspaceId),
  }),
);
```

- **Polymorphic target** (`resource-shares.ts:54-56`): `resource_type`
  (`shared_resource_type` enum) + `resource_id` (uuid) — **no FK** (target lives in
  one of several tables). Owner resolved at check time by `resolveResourceOwner`
  (`access-control.ts:158-196`).
- **Grantee XOR** (`resource-shares.ts:58-64`): `workspace_id` (FK → `workspaces(id)`
  CASCADE) XOR `target_user_id` (FK → `auth.users(id)` CASCADE). EXACTLY ONE set.
- **`permission`** = `share_permission` enum (`view`|`edit`), default `view`.
- **`granted_by`** (uuid NOT NULL FK → `auth.users(id)` CASCADE) — audit + revoke authority.
- **CHECK constraint** — hand-written in the migration, NOT expressible in the
  Drizzle table shape (`0047:44-52`):

  ```sql
  ALTER TABLE "resource_shares"
    ADD CONSTRAINT "ck_resource_shares_one_grantee"
    CHECK (num_nonnulls("workspace_id", "target_user_id") = 1);
  ```
- **FKs**: `..._workspace_id_workspaces_id_fk`, `..._target_user_id_users_id_fk`,
  `..._granted_by_users_id_fk` (`0047:34-36`).
- **Indexes** (`0047:40-42`): `idx_resource_shares_resource` on
  `(resource_type, resource_id)` — the "who is this shared with" lookup;
  `idx_resource_shares_target_user` on `target_user_id`;
  `idx_resource_shares_workspace` on `workspace_id`.
- **Revoke = row delete** (`resource-shares.ts:24-28`): no soft-delete flag; an
  absent row = no access.
- **Inferred types**: `ResourceShareRow`, `InsertResourceShare` (`resource-shares.ts:98-99`).

**RLS** (`0047:116-132`) — visible to grantor / direct target / target-workspace
members; only grantor writes:

```sql
CREATE POLICY "resource_shares_scoped_authenticated" ON "resource_shares"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (
    granted_by = auth.uid()
    OR target_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM "workspace_members" m
               WHERE m.workspace_id = "resource_shares".workspace_id AND m.user_id = auth.uid())
  )
  WITH CHECK (granted_by = auth.uid());
```

### 1.4 The three enums

Source: `packages/db/src/schema/enums.ts:87-113`

```ts
export const workspaceRoleEnum = pgEnum("workspace_role", ["owner","admin","member","viewer"]); // ordered viewer<member<admin<owner
export const sharePermissionEnum = pgEnum("share_permission", ["view","edit"]);                 // edit implies view
export const sharedResourceTypeEnum = pgEnum("shared_resource_type", ["document","entity","file","conversation"]);
```

DDL: `0047:1-3` (`CREATE TYPE … AS ENUM(...)`). Note `shared_resource_type` is
currently `document | entity | file | conversation` — **adding a new shareable
resource (e.g. `canvas`, `node`) = extend this enum AND add its owner resolver**
in `resolveResourceOwner` (`enums.ts:102-113`, `access-control.ts:158-196`).

---

## 2. Migration `0047_workspaces_teams_rbac.sql` — what it did

Single file `packages/db/migrations/0047_workspaces_teams_rbac.sql` (7402 bytes),
journal entry tag `0047_workspaces_teams_rbac` in `migrations/meta/_journal.json`.
It performs, in order:

| Lines | Action |
|---|---|
| `1-3`   | `CREATE TYPE` the 3 enums (`share_permission`, `shared_resource_type`, `workspace_role`). |
| `4-29`  | `CREATE TABLE` the 3 tables (with the `uq_workspace_members_workspace_user` UNIQUE inline). |
| `31-36` | `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY` — all 6 FKs (owner_user_id; member workspace_id+user_id; share workspace_id+target_user_id+granted_by). |
| `37-42` | `CREATE INDEX` — all 6 indexes. |
| `50-52` | Hand-written `ck_resource_shares_one_grantee` CHECK (`num_nonnulls = 1`) — the grantee-exclusivity rule not expressible in Drizzle (comment `44-49`). |
| `69-83` | `workspaces` RLS: enable + RESTRICTIVE anon-deny + PERMISSIVE member-visibility. |
| `90-111`| `workspace_members` RLS: enable + anon-deny + member/owner-scoped. |
| `116-132`| `resource_shares` RLS: enable + anon-deny + grantor/target/member-scoped. |

**Brand-new-table idiom** (`0047:55-66`): because these tables are created *here*,
there is no pre-existing "deny-all-authenticated" policy to DROP (contrast with
`0034_rls_user_scoping.sql`, which retrofits RLS onto old tables). RLS is enabled
and the scoped policy is created directly; anon stays denied per
`0001_rls_deny_all.sql`.

**RLS is defense-in-depth ONLY** (`0047:60-65`, echoed in every table doc-comment):
Drizzle connects as the Postgres **superuser** (`packages/db/src/client.ts`) and
FastAPI as **service_role** — **both bypass RLS**. The PRIMARY enforcement wall is
the app boundary: `assertCanAccess` / `assertWorkspaceRole` in `access-control.ts`
plus the workspaces router's server-side RBAC.

---

## 3. How workspaces relate to users/importers today — USING or DORMANT?

**Verdict: a fully-built, unit-tested control-plane that NO product surface drives
yet. The data-plane is dormant.** Details:

### 3.1 What IS wired

- **Router registered**: `workspacesRouter` is imported and mounted at
  `workspaces:` on the root tRPC router — `packages/api-client/src/root.ts:15,33`.
- **Full server surface** (`packages/api-client/src/router/workspaces/index.ts:75-428`):
  `create` (seeds owner membership, `81-104`), `list`, `members`, `addMember`,
  `changeRole`, `removeMember`, `leave`, `shareResource` (`299-343`), `listShares`,
  `revokeShare`. Every procedure is `protectedProcedure`; identity is always
  `ctx.user.id`, never a client field (`index.ts:9-24`).
- **RBAC helpers** live in `packages/db/src/access-control.ts`:
  `assertCanAccess` (`285-306`), `resolveResourceOwner` (`158-196`),
  `effectiveSharedPermission` (`214-267`), `getWorkspaceRole` (`333-349`),
  `assertWorkspaceRole` (`357-368`), the pure algebra `permissionSatisfies`/`roleRank`/`capPermission` (`97-138`).
- **Transport mapping**: `assertAccessOrNotFound` / `assertRoleOrForbidden`
  (`packages/api-client/src/router/_ownership.ts:48-79`).
- **Tests exist**: `packages/db/src/access-control.test.ts`,
  `packages/db/src/workspaces-schema.test.ts`,
  `packages/api-client/src/router/workspaces/workspaces.test.ts`.

### 3.2 What is NOT wired (dormancy evidence)

- **No web UI consumes it**: `grep` for `.workspaces.` / `api.workspaces` /
  `trpc.workspaces` / `shareResource` / `listShares` across `apps/web` → **zero
  hits**. (The `apps/web` "workspace" grep hits are all unrelated — vitest
  workspaces, `next.config`, etc.)
- **Python listener has ZERO references**: `grep -i "workspace|resource_share|
  assertCanAccess|ResourceShare"` across `apps/email-listener` → **no files**. The
  entire tenancy-widening layer is **TypeScript-only**; the Python capability
  registry mirror does not model it.
- **Only ONE resource router reads the sharing gate**: `documents.byId` swapped its
  owner-only assert for the sharing-aware `assertCanAccess(ctx.db, ctx.user.id,
  "document", input.id, "view")` — `packages/api-client/src/router/documents/index.ts:34,86-97`.
  Every OTHER resource router still uses the owner-only `assert*Ownership` helpers
  in `ownership.ts` (see §4.1). So even the "widening" path is exercised for exactly
  one resource type in one read.

### 3.3 The relationship model (how the pieces connect)

- **User ↔ workspace**: `workspaces.owner_user_id` → `auth.users(id)`; membership via
  `workspace_members(workspace_id, user_id, role)`. Owner is always ALSO a member row
  (seeded at `create`, `index.ts:97-101`), so a single membership scan answers "which
  workspaces am I in" (`list`, `index.ts:110-125`).
- **Importers are NOT involved.** Workspaces sit on the **direct-`user_id`** side of
  the tenancy split (like `documents`, `chat_conversations`, `forwarding_addresses`),
  NOT the importer-anchored side (`emails`, `entity_instances`, `knowledge_nodes`,
  which resolve ownership via a join to `importers.user_id`). See the two anchors in
  `ownership.ts:5-14`. `resource_shares` bridges to importer-anchored resources only
  polymorphically: `resource_type='entity'` resolves the owner via
  `entity_instances → importers.user_id` (`access-control.ts:182-190`).
- **The scoping decision, verbatim** (`access-control.ts:8-24`): rather than
  re-anchor every table on a workspace (a huge, risky migration), W5 keeps `user_id`
  and adds a WIDENING layer: `assertCanAccess` allows when (a) caller is the direct
  owner — the unchanged `user_id` path — OR (b) an active `resource_shares` grant to
  the caller or a workspace they belong to satisfies the need. Owner path
  short-circuits before any share query (`access-control.ts:292-305`).

---

## 4. Ownership/scoping model — how Canvas/Node tables should be shaped

The question: **Canvas belongs to a Workspace; Node belongs to a Canvas.** What FKs +
indexes + RLS make new first-class `canvases` / `canvas_nodes` tables match the
existing tenancy pattern. There is currently **no `canvases`/`canvas_nodes` table** —
canvas state lives entirely as JSONB in `chat_canvas_layouts` (§4.3). Below is a
design grounded in the two exemplar patterns already in the repo.

### 4.1 The two ownership anchors this repo uses (pick one per new table)

From `ownership.ts:5-14` — there are exactly two:

1. **importer-anchored** — resolve ownership via a join to `importers.user_id`
   (`emails`, `email_components`, `entity_instances`, `threads`, `knowledge_nodes`).
2. **direct-`user_id`** — a `user_id` column referencing `auth.users(id)`, no join
   (`chat_conversations`, `documents`, `forwarding_addresses`, `spreadsheets`,
   `desktop_sessions`, `references`, and the home-scoped `chat_canvas_layouts` row).

Canvas/Node belong on the **direct-`user_id` / `owner`-container** side, exactly like
`workspaces` — they are greenfield tenancy containers, not email-derived data.

The central assert helper pattern to add for each new owner-scoped table (mirroring
`assertDocumentOwnership`, `ownership.ts:229-244`):

```ts
export async function assertCanvasOwnership(db, canvasId, userId): Promise<void> {
  const rows = await db.select({ userId: Canvases.ownerUserId /* or via workspace */ })
    .from(Canvases).where(eq(Canvases.id, canvasId)).limit(1);
  const row = rows[0];
  if (!row || row.userId !== userId) throw new OwnershipError("canvas", canvasId);
}
```

### 4.2 Proposed FK + index + RLS shape (matching the 0047 pattern)

**`canvases` (Canvas belongs to a Workspace):**

- `id uuid PK default gen_random_uuid()`.
- `workspace_id uuid NOT NULL → workspaces(id) ON DELETE CASCADE` — the containment
  edge (mirrors `workspace_members.workspace_id`, `workspace-members.ts:46-48`).
  Cascade so deleting a workspace removes its canvases.
- **Ownership denormalization decision** — TWO viable options, both precedented:
  - (A) **Derive owner via the workspace** (no `owner_user_id` column): ownership =
    `canvases → workspaces.owner_user_id`, or membership = `canvases → workspaces →
    workspace_members`. Keeps a single source of truth; matches how `entity`
    ownership derives through `importers` (`access-control.ts:182-190`).
  - (B) **Denormalize `owner_user_id uuid NOT NULL → auth.users(id) CASCADE`** onto
    `canvases` for cheap direct scoping (mirrors `workspaces.owner_user_id`,
    `workspaces.ts:42-44`). Faster ownership checks, at the cost of a copy that must
    track the workspace owner. Given the repo's stated preference for a DIRECT
    anchor where possible (`documents.ts:29-37`), (B) is the more house-consistent
    default; (A) is acceptable if canvases must be *member*-owned rather than
    single-owner.
- `name text NOT NULL default 'Untitled canvas'`, `is_default boolean` (the research
  doc's shape, `2026-07-23-CANVAS-WORKSPACE-PLATFORM.md:§3`), `created_at`/`updated_at`
  timestamptz.
- **Indexes**: `idx_canvases_workspace_id` on `workspace_id` (the "canvases in this
  workspace" list — mirrors `idx_workspace_members_workspace_id`); if a per-user
  home-canvas uniqueness is needed, a **partial unique index** exactly like
  `chat_canvas_layouts`'s `idx_chat_canvas_layouts_home_user … WHERE scope='home'`
  (`chat-canvas-layouts.ts:117-121`).
- **RLS** — mirror `workspaces_member_authenticated` (the member-visibility idiom,
  `0047:74-83`), NOT the flat-owner `documents` idiom, because a canvas must be
  visible to every member of its workspace:

  ```sql
  ALTER TABLE "canvases" ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "deny_all_canvases_anon" ON "canvases"
    AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
  CREATE POLICY "canvases_member_authenticated" ON "canvases"
    AS PERMISSIVE FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM "workspace_members" m
                   WHERE m.workspace_id = "canvases".workspace_id AND m.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM "workspace_members" m
                        WHERE m.workspace_id = "canvases".workspace_id AND m.user_id = auth.uid()));
  ```

**`canvas_nodes` (Node belongs to a Canvas):**

- `id uuid PK`, `canvas_id uuid NOT NULL → canvases(id) ON DELETE CASCADE` (deleting
  a canvas removes its nodes).
- `type text NOT NULL` (the 13 registered node types today live only in the JSONB
  `nodes` array; promoting them to a column, discriminator, or FK to a node-type
  registry is a design choice), `position jsonb`, `data jsonb`, optional provenance
  refs (`spec_id?`, `job_id?`, message/part refs — the research doc's shape,
  `§3`). Per `chat-canvas-layouts.ts:8-11`, genui-panel nodes must carry **only
  provenance refs, never spec content** — a first-class node table MUST preserve that
  invariant (spec rehydrates from `chat_messages`).
- **Indexes**: `idx_canvas_nodes_canvas_id` on `canvas_id` (load a canvas's nodes).
- **RLS**: cannot reference the parent's `workspace_id` directly (it's a join away),
  so either (a) a nested `EXISTS canvases JOIN workspace_members`, or (b) denormalize
  `workspace_id` onto `canvas_nodes` for a flat policy. The nested-EXISTS approach
  matches the `workspace_members`/`resource_shares` RLS style (`0047:99-104,126-131`).
- **Edges**: `canvas_edges (canvas_id, source_node_id, target_node_id, kind)` FK-ing
  both endpoints to `canvas_nodes(id)` CASCADE — see the existing
  `knowledge_node_edges.ts` for a two-endpoint edge table precedent, and
  `chat_context_edges.ts` for the context-edge provenance shape that the research doc
  folds in as the first node-edge kind (`2026-07-23-CANVAS-WORKSPACE-PLATFORM.md:§6`).

### 4.3 Sharing a Canvas/Node (if it should be shareable)

To make a canvas/node shareable through the EXISTING share machinery (not a new
system): add `'canvas'` (and/or `'node'`) to `sharedResourceTypeEnum`
(`enums.ts:108-113`) AND add its branch to `resolveResourceOwner`
(`access-control.ts:158-196`). Then any router gating a canvas read/write calls
`assertCanAccess(db, userId, "canvas", canvasId, need)` exactly as `documents.byId`
does (`documents/index.ts:97`). **No churn to `resource_shares` itself** — that is the
whole point of the polymorphic table (`resource-shares.ts:1-11`).

### 4.4 The blob being promoted (what Track 3b replaces)

`chat_canvas_layouts` (`packages/db/src/schema/chat-canvas-layouts.ts`) is the
current home of all node/edge state:

- One row per conversation, `nodes jsonb`/`edges jsonb`/`viewport jsonb`/`shared_state
  jsonb` (`chat-canvas-layouts.ts:85-95`), UNIQUE on `conversation_id`
  (`111-113`).
- Already bolted-on `scope='home'` discriminator + partial unique index + a
  three-way CHECK from migration `0046_home_canvas_scope.sql` (`chat-canvas-layouts.ts:22-42,117-135`)
  — the "the blob is straining" symptom the master plan calls out
  (`00-MASTER-PLAN.md:23,67`). Track 3b promotes this to real
  `Workspace → Canvas → Node` rows; the research doc notes each conversation's canvas
  migrates into a `canvas` in an auto-created "personal" workspace
  (`2026-07-23-CANVAS-WORKSPACE-PLATFORM.md:§3`).
- **Naming caution**: "node" is overloaded in this repo. `knowledge_nodes`
  (`knowledge-nodes.ts`) and `knowledge_node_edges` are the *knowledge-graph* node
  concept — UNRELATED to canvas nodes. A new canvas-node table should be named
  unambiguously (`canvas_nodes`, not `nodes`).

---

## 5. Drizzle migration conventions (so the new-migration step matches house style)

### 5.1 Toolchain

- **drizzle-kit** (`^0.31.1`) + **drizzle-orm** (`^0.44.2`),
  `packages/db/package.json:37,46`. Config at `packages/db/drizzle.config.ts:5-15`:
  `schema: "./src/schema"`, `out: "./migrations"`, `dialect: "postgresql"`,
  `schemaFilter: ["public"]`, `dbCredentials.url = env.POSTGRES_URL_NON_POOLING`
  ("transaction pooler breaks DDL", `drizzle.config.ts:11-12`).

### 5.2 Generate

- **Auto-diff generate**: root `npm run db:generate` → `migration:generate` (`-w
  @polytoken/db`) → `drizzle-kit generate` (root `package.json:53`;
  `packages/db/package.json:23`). Wrapped in `dotenv -e ../../.env.local` via the
  `with-env` script (`packages/db/package.json:14,23`).
- **Custom (hand-SQL) generate**: `migration:generate:custom` → `drizzle-kit generate
  --custom --name=<name>` (`packages/db/package.json:24`). Used when the DDL is not
  expressible from the Drizzle schema (RLS policies, CHECK constraints, RPCs, seeds).
- **Numbering + naming**: zero-padded 4-digit sequential prefix (`0000`…`0050`). The
  latest is `0050_purge_maritime_data.sql`, so **the next Track 3b migration is
  `0051_…`**. Auto-generated migrations get a drizzle random slug
  (`0006_bitter_white_queen`); custom/named ones use `--name=` for a descriptive tag
  (`0040_documents`, `0044_spreadsheets`, `0047_workspaces_teams_rbac`,
  `0046_home_canvas_scope`). Track 3b should use a descriptive `--name=`.
- **Metadata drizzle-kit maintains**: `migrations/meta/_journal.json` (ordered entry
  list — `idx`, `version:"7"`, `when` epoch-ms, `tag`, `breakpoints:true`) and a
  per-migration `migrations/meta/NNNN_snapshot.json`. These are auto-written by
  `generate` — do not hand-edit; commit them with the `.sql`.

### 5.3 The house pattern for a new owner-scoped table + RLS (COPY THIS)

Every recent new-table migration is: **generated table DDL, then hand-appended RLS
(and any CHECK) in the SAME numbered `.sql` file**, because RLS/CHECK are not
expressible in the Drizzle table shape. Exemplars:

- `0040_documents.sql` — the canonical direct-`user_id` flat-owner table + RLS
  (`0040:1-40`): `CREATE TABLE` + FK + indexes (generated), then
  `ENABLE ROW LEVEL SECURITY` + RESTRICTIVE `deny_all_documents_anon` + PERMISSIVE
  `documents_owner_authenticated (user_id = auth.uid())`.
- `0044_spreadsheets.sql` — same idiom, one line at a time
  (`0044:29-37`).
- `0047_workspaces_teams_rbac.sql` — the container/membership/share variant with
  member-visibility RLS + the hand-written CHECK (`0047:44-132`).

The generated portion carries `--> statement-breakpoint` separators (drizzle-kit
emits these); hand-appended statements keep the same breakpoint convention
(`0047:53,73,84`). Note migration 0047's comment that the CHECK "lives here only (no
residual `generate` diff — the snapshot has no check)" (`0047:47-48`) — i.e. the
snapshot won't know about hand-SQL, which is expected and fine.

### 5.4 Apply

- **Runner**: root `npm run db:migrate` → `migrate:local` → `tsx src/migrate.ts`
  (root `package.json:54`; `packages/db/package.json:25`), wrapped in
  `dotenv -e ../../.env.local`. Staging/prod variants: `migrate:staging` /
  `migrate:prod` with `.env.staging` / `.env.production` (`package.json:26-27,56-57`).
- **What `src/migrate.ts` does** (`packages/db/src/migrate.ts`): connects with
  `POSTGRES_URL_NON_POOLING` (non-pooling, DDL-safe), `CREATE EXTENSION IF NOT EXISTS`
  for `vector` / `uuid-ossp` / `pg_trgm`, then
  `migrate(db, { migrationsFolder: "migrations" })` via
  `drizzle-orm/node-postgres/migrator`. There is also a one-time `BACKFILL_USER_ID`
  db-level GUC path for the 0032 tenancy backfill (only on a fresh empty DB).
- `drizzle-kit push` exists (`push:staging`, `package.json:29`) but the normal path
  is generate-file → `migrate.ts`, NOT `push`.

### 5.5 LANDMINE — migrations are FILES ONLY in this workflow

Per the task's own guardrails and `CLAUDE.md`: **no Terraform remote state / prod DB
access here, and nobody in this workflow applies migrations to the live Supabase DB.**
Track 3b's deliverable is the `.sql` migration file(s) + schema + snapshot/journal
updates — NOT a `db:migrate` run against staging/prod. The `.planning/` tree already
carries a `PROD-ROLLBACK-0043-0047.sql` and a `PROD-DEPLOY-RUNBOOK.md` showing that
deploy/rollback of these exact migrations is handled OUT of band by a human runbook,
not by an agent.

---

## 6. Exact-cite index (for the downstream designer)

| Concern | Cite |
|---|---|
| `workspaces` table | `packages/db/src/schema/workspaces.ts:35-58` |
| `workspaces` RLS | `packages/db/migrations/0047_workspaces_teams_rbac.sql:69-83` |
| `workspace_members` table + unique | `packages/db/src/schema/workspace-members.ts:41-74` |
| `workspace_members` RLS | `0047_workspaces_teams_rbac.sql:90-111` |
| `resource_shares` table (polymorphic, XOR grantee) | `packages/db/src/schema/resource-shares.ts:49-93` |
| `resource_shares` CHECK (one grantee) | `0047_workspaces_teams_rbac.sql:44-52` |
| `resource_shares` RLS | `0047_workspaces_teams_rbac.sql:116-132` |
| 3 enums | `packages/db/src/schema/enums.ts:87-113` (DDL `0047:1-3`) |
| Schema barrel exports | `packages/db/src/schema/index.ts:45-47` |
| Access gate `assertCanAccess` | `packages/db/src/access-control.ts:285-306` |
| Owner resolution (per resource_type) | `packages/db/src/access-control.ts:158-196` |
| Share-widening permission | `packages/db/src/access-control.ts:214-267` |
| RBAC role helpers | `packages/db/src/access-control.ts:333-368` |
| Owner-only assert family (2 anchors) | `packages/db/src/ownership.ts:5-14,229-244` |
| Router registration | `packages/api-client/src/root.ts:15,33` |
| Router (create/share) | `packages/api-client/src/router/workspaces/index.ts:81-104,299-343` |
| Transport mapping | `packages/api-client/src/router/_ownership.ts:48-79` |
| Only sharing-gated resource read | `packages/api-client/src/router/documents/index.ts:34,86-97` |
| Current canvas blob | `packages/db/src/schema/chat-canvas-layouts.ts:62-137` |
| `scope='home'` bolt-on | `packages/db/migrations/0046_home_canvas_scope.sql:22-34` |
| New-table + RLS exemplar | `packages/db/migrations/0040_documents.sql:1-40` |
| Migration config | `packages/db/drizzle.config.ts:5-15` |
| Migration runner | `packages/db/src/migrate.ts` |
| Generate/migrate scripts | `package.json:53-54`; `packages/db/package.json:23-25` |
| Journal | `packages/db/migrations/meta/_journal.json` |
| Track 3b intent | `.planning/assessment/2026-07-24/00-MASTER-PLAN.md:23,62-67`; `.planning/research/2026-07-23-CANVAS-WORKSPACE-PLATFORM.md:§3` |
