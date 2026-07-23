/**
 * FEATURE-CATALOG W5 — the `workspace_members` table (RBAC membership).
 *
 * One row per (workspace, user) pair, carrying the member's `role`
 * (workspace_role enum: owner/admin/member/viewer). This is the join table the
 * authorization layer (access-control.ts) walks to answer "is this user a member
 * of a workspace that a resource was shared with, and at what role?".
 *
 * ## RBAC (server-enforced, workspaces router)
 *   - Only owner/admin may mutate membership (add/change-role/remove). A non-admin
 *     member/viewer cannot add members or escalate a role — enforced in the
 *     router via `assertWorkspaceRole`, NOT by the schema.
 *   - `role` also caps any workspace-directed share the member receives: a viewer
 *     is capped at `view` even on an `edit` share (roleRank/capPermission in
 *     access-control.ts).
 *
 * ## Tenancy / RLS
 * There is no single owning-user column here (the row is ABOUT a user's
 * membership), so RLS is scoped to "rows for a workspace the acting user can see"
 * — a member may read their own membership rows. The primary enforcement wall is
 * the app boundary; RLS is defense-in-depth (0047, mirrors the 0040 caveat).
 *
 * `unique(workspace_id, user_id)` — a user has at most one role per workspace.
 */

import {
  index,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { AuthUsers } from "./_auth";
import { workspaceRoleEnum } from "./enums";
import { Workspaces } from "./workspaces";

// ---------------------------------------------------------------------------
// workspace_members — (workspace, user, role) membership rows (W5)
// ---------------------------------------------------------------------------
export const WorkspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => Workspaces.id, { onDelete: "cascade" }),

    userId: uuid("user_id")
      .notNull()
      .references(() => AuthUsers.id, { onDelete: "cascade" }),

    role: workspaceRoleEnum("role").notNull().default("member"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // A user holds at most one role per workspace.
    workspaceMembersUnique: unique("uq_workspace_members_workspace_user").on(
      t.workspaceId,
      t.userId,
    ),
    // "members of this workspace" and "workspaces this user belongs to" lookups.
    workspaceMembersWorkspaceIdIdx: index(
      "idx_workspace_members_workspace_id",
    ).on(t.workspaceId),
    workspaceMembersUserIdIdx: index("idx_workspace_members_user_id").on(
      t.userId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type WorkspaceMemberRow = typeof WorkspaceMembers.$inferSelect;
export type InsertWorkspaceMember = typeof WorkspaceMembers.$inferInsert;
