/**
 * FEATURE-CATALOG W5 — the `resource_shares` table (generic sharing grants).
 *
 * The KEY design move: a single generic grant table that shares an
 * individually-owned resource WITHOUT altering every existing resource table.
 * Instead of adding a `workspace_id` / share columns to documents, entities,
 * files, conversations, … each of which anchors on its own `user_id`, one row
 * here records "resource (type,id) is shared to {a workspace | a user} at
 * {view|edit}". This keeps the widening ADDITIVE — zero churn on the owner's
 * `user_id` path.
 *
 * ## Shape
 *   - `resource_type` (shared_resource_type enum) + `resource_id` (uuid) — the
 *     polymorphic target. No FK (the target lives in one of several tables); the
 *     resource's OWNER is resolved at check time by `resolveResourceOwner`
 *     (access-control.ts), which dispatches on `resource_type`.
 *   - `workspace_id` XOR `target_user_id` — the grantee. EXACTLY ONE is set:
 *     a share targets a whole workspace (every member gets it, capped by role) OR
 *     a single user directly. Enforced by a CHECK constraint (num_nonnulls = 1)
 *     in migration 0047.
 *   - `permission` (share_permission enum) — view or edit (edit implies view).
 *   - `granted_by` — the user who created the grant (audit / revoke authority).
 *
 * ## Revoke = row delete
 * There is no soft-delete flag: revoking a share deletes the row, so an absent
 * row = no access. The access-control truth table's "revoked → no" case is
 * therefore just "no matching row".
 *
 * ## Tenancy / RLS (0047, mirrors 0040 caveat)
 * A share row is visible to its grantor, its direct target user, and members of
 * its target workspace. Primary enforcement is the app boundary (assertCanAccess
 * + the workspaces router's share procedures); RLS is defense-in-depth.
 */

import {
  index,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { AuthUsers } from "./_auth";
import { sharePermissionEnum, sharedResourceTypeEnum } from "./enums";
import { Workspaces } from "./workspaces";

// ---------------------------------------------------------------------------
// resource_shares — generic (resource) -> (workspace | user) grants (W5)
// ---------------------------------------------------------------------------
export const ResourceShares = pgTable(
  "resource_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Polymorphic target — no FK; owner resolved by resource_type at check time.
    resourceType: sharedResourceTypeEnum("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),

    // Grantee: EXACTLY ONE of these is non-null (CHECK num_nonnulls = 1, 0047).
    workspaceId: uuid("workspace_id").references(() => Workspaces.id, {
      onDelete: "cascade",
    }),
    targetUserId: uuid("target_user_id").references(() => AuthUsers.id, {
      onDelete: "cascade",
    }),

    permission: sharePermissionEnum("permission").notNull().default("view"),

    // Audit: who created the grant. Cascade with the granting user.
    grantedBy: uuid("granted_by")
      .notNull()
      .references(() => AuthUsers.id, { onDelete: "cascade" }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // "who is this resource shared with" — the listShares read + the
    // assertCanAccess resource lookup.
    resourceSharesResourceIdx: index("idx_resource_shares_resource").on(
      t.resourceType,
      t.resourceId,
    ),
    // "what is shared with this user directly" — the direct-share access path.
    resourceSharesTargetUserIdx: index("idx_resource_shares_target_user").on(
      t.targetUserId,
    ),
    // "what is shared with this workspace" — the workspace-share access path.
    resourceSharesWorkspaceIdx: index("idx_resource_shares_workspace").on(
      t.workspaceId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type ResourceShareRow = typeof ResourceShares.$inferSelect;
export type InsertResourceShare = typeof ResourceShares.$inferInsert;
