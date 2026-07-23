/**
 * access-control.ts — the W5 (multiuser/teams/workspaces) authorization module.
 *
 * ## The scoping decision (make it explicit)
 *
 * Today every scoped table anchors on a single-user `user_id` and the ONLY
 * question a procedure asks is "does this user OWN this row?" (ownership.ts).
 * Workspaces introduce a second, ADDITIVE question: "has this row been SHARED
 * with this user, or with a workspace this user belongs to?". Rather than rip
 * `user_id` out of every table and re-anchor on a workspace (a huge, risky
 * migration that would regress the well-tested single-user isolation), W5 keeps
 * `user_id` exactly as-is and adds a WIDENING layer on top:
 *
 *   assertCanAccess(db, userId, resourceType, resourceId, need) allows when
 *     (a) the caller is the resource's DIRECT OWNER — the EXISTING user_id path,
 *         unchanged and always sufficient for both view and edit; OR
 *     (b) there is an active `resource_shares` grant to the caller directly, or
 *         to a workspace the caller is a member of, whose effective permission
 *         satisfies `need`.
 *
 * This is strictly additive: (a) is byte-for-byte the old owner check, so every
 * existing owner-only test still passes; (b) can only GRANT access the owner
 * never had, never revoke the owner's. Sharing widens, never narrows.
 *
 * ## Effective permission
 *   - Owner: unconditional (view AND edit).
 *   - Direct user share: the share's own permission (view or edit).
 *   - Workspace share: the share's permission CAPPED by the member's role — a
 *     `viewer` is capped at `view` even on an `edit` share (capPermission). This
 *     yields the "role-insufficient → deny" case in the truth table.
 * The strongest permission across all matching grants wins; `edit` implies
 * `view` (permissionSatisfies).
 *
 * ## Fail-closed transport (mirrors ownership.ts)
 * A denied access and a missing resource both throw the same `AccessError` — no
 * signal distinguishing "doesn't exist" from "not shared with you". Callers map
 * it to NOT_FOUND (assertAccessOrNotFound, packages/api-client _ownership.ts).
 *
 * All queries are parameterized Drizzle builders; db is the first parameter
 * (test-injectable, framework-agnostic), exactly like ownership.ts.
 */

import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "./schema";
import { ChatConversations } from "./schema/chat-conversations";
import { Documents } from "./schema/documents";
import { EntityInstances } from "./schema/entity-instances";
import { Importers } from "./schema/importers";
import { ResourceShares } from "./schema/resource-shares";
import { WorkspaceMembers } from "./schema/workspace-members";

/** The Drizzle handle every access-control function accepts as its first param. */
export type AccessDb = PostgresJsDatabase<typeof schema>;

/** The permission a caller needs — mirrors the share_permission enum. */
export type AccessNeed = "view" | "edit";

/** A shareable resource kind — mirrors the shared_resource_type enum. */
export type SharedResourceType = "document" | "entity" | "file" | "conversation";

/** A member's role — mirrors the workspace_role enum. */
export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

/** A grant's permission — mirrors the share_permission enum. */
export type SharePermission = "view" | "edit";

/**
 * Thrown when the caller is neither the owner nor sufficiently-shared. Same
 * fail-closed convention as OwnershipError: no signal distinguishing
 * "doesn't exist" from "not yours/not shared".
 */
export class AccessError extends Error {
  readonly resourceType: SharedResourceType;
  readonly resourceId: string;
  readonly need: AccessNeed;

  constructor(
    resourceType: SharedResourceType,
    resourceId: string,
    need: AccessNeed,
  ) {
    super(`Access denied: ${need} on ${resourceType} ${resourceId}`);
    this.name = "AccessError";
    this.resourceType = resourceType;
    this.resourceId = resourceId;
    this.need = need;
  }
}

// ---------------------------------------------------------------------------
// Permission + role algebra (pure, exported for direct unit testing)
// ---------------------------------------------------------------------------

/** edit implies view; view satisfies only view. */
export function permissionSatisfies(
  have: SharePermission,
  need: AccessNeed,
): boolean {
  if (need === "view") return true; // both view and edit grant view
  return have === "edit"; // only edit grants edit
}

/** viewer < member < admin < owner. Higher rank = more authority. */
export function roleRank(role: WorkspaceRole): number {
  switch (role) {
    case "viewer":
      return 0;
    case "member":
      return 1;
    case "admin":
      return 2;
    case "owner":
      return 3;
  }
}

/**
 * capPermission — a workspace share's permission as experienced by a member of
 * a given role. A `viewer` can never exceed `view`, even on an `edit` share;
 * member/admin/owner experience the share's own permission unchanged.
 */
export function capPermission(
  sharePermission: SharePermission,
  role: WorkspaceRole,
): SharePermission {
  if (role === "viewer") return "view";
  return sharePermission;
}

/** The stronger of two permissions (edit > view). */
function strongerPermission(
  a: SharePermission,
  b: SharePermission,
): SharePermission {
  return a === "edit" || b === "edit" ? "edit" : "view";
}

// ---------------------------------------------------------------------------
// Owner resolution (the EXISTING user_id path, per resource type)
// ---------------------------------------------------------------------------

/**
 * resolveResourceOwner — the owning user_id of a resource, or null when the
 * resource does not exist / has no DB-resolvable owner. Dispatches on
 * resource_type. This is the SAME anchor the per-resource assert* helpers in
 * ownership.ts read — never a new/parallel notion of ownership.
 *
 *   - document / conversation — DIRECT user_id (no join).
 *   - entity — importer-anchored: entity_instances -> importers.user_id.
 *   - file — path-addressed under the owner's storage prefix, NOT a DB row, so
 *     there is no owner user_id to resolve here. Owner access to one's own files
 *     stays on the filesRouter prefix rails (never via assertCanAccess); a file
 *     may still be SHARED through resource_shares, and THAT path works. Returns
 *     null so a file is reachable through assertCanAccess only via a share.
 */
export async function resolveResourceOwner(
  db: AccessDb,
  resourceType: SharedResourceType,
  resourceId: string,
): Promise<string | null> {
  switch (resourceType) {
    case "document": {
      const rows = await db
        .select({ userId: Documents.userId })
        .from(Documents)
        .where(eq(Documents.id, resourceId))
        .limit(1);
      return rows[0]?.userId ?? null;
    }

    case "conversation": {
      const rows = await db
        .select({ userId: ChatConversations.userId })
        .from(ChatConversations)
        .where(eq(ChatConversations.id, resourceId))
        .limit(1);
      return rows[0]?.userId ?? null;
    }

    case "entity": {
      const rows = await db
        .select({ userId: Importers.userId })
        .from(EntityInstances)
        .innerJoin(Importers, eq(Importers.id, EntityInstances.importerId))
        .where(eq(EntityInstances.id, resourceId))
        .limit(1);
      return rows[0]?.userId ?? null;
    }

    case "file":
      // Path-addressed; no DB owner row. See doc comment above.
      return null;
  }
}

// ---------------------------------------------------------------------------
// Share resolution (the ADDITIVE widening path)
// ---------------------------------------------------------------------------

/**
 * effectiveSharedPermission — the STRONGEST permission the user holds on a
 * resource via any active share (direct-to-user OR via a workspace they belong
 * to, capped by their role), or null when no share grants them anything.
 *
 * Two parameterized queries (kept separate so each is trivially seedable in a
 * DB-free chain-stub test):
 *   1. direct shares: resource_shares.target_user_id = userId.
 *   2. workspace shares: resource_shares JOIN workspace_members on workspace_id
 *      where workspace_members.user_id = userId — returns (permission, role)
 *      pairs, each capped by role.
 */
export async function effectiveSharedPermission(
  db: AccessDb,
  userId: string,
  resourceType: SharedResourceType,
  resourceId: string,
): Promise<SharePermission | null> {
  let best: SharePermission | null = null;

  // 1. Direct-to-user shares — the share's own permission, no role cap.
  const directRows = await db
    .select({ permission: ResourceShares.permission })
    .from(ResourceShares)
    .where(
      and(
        eq(ResourceShares.resourceType, resourceType),
        eq(ResourceShares.resourceId, resourceId),
        eq(ResourceShares.targetUserId, userId),
      ),
    );

  for (const row of directRows) {
    const perm = row.permission as SharePermission;
    best = best === null ? perm : strongerPermission(best, perm);
  }

  // 2. Workspace shares — capped by the caller's role in that workspace.
  const workspaceRows = await db
    .select({
      permission: ResourceShares.permission,
      role: WorkspaceMembers.role,
    })
    .from(ResourceShares)
    .innerJoin(
      WorkspaceMembers,
      eq(WorkspaceMembers.workspaceId, ResourceShares.workspaceId),
    )
    .where(
      and(
        eq(ResourceShares.resourceType, resourceType),
        eq(ResourceShares.resourceId, resourceId),
        eq(WorkspaceMembers.userId, userId),
      ),
    );

  for (const row of workspaceRows) {
    const capped = capPermission(
      row.permission as SharePermission,
      row.role as WorkspaceRole,
    );
    best = best === null ? capped : strongerPermission(best, capped);
  }

  return best;
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/**
 * assertCanAccess — the W5 access gate. Resolves (returns void) when the caller
 * may access `resourceType`/`resourceId` at `need`, else throws AccessError.
 *
 * Order: OWNER FIRST (the unchanged user_id path — cheapest and always
 * sufficient), then the share-widened path. Owner access short-circuits before
 * any share query runs.
 *
 * This is the ONLY entry point a procedure uses to gate a SHAREABLE resource.
 * For resources not yet wired for sharing, keep using the owner-only assert*
 * from ownership.ts.
 */
export async function assertCanAccess(
  db: AccessDb,
  userId: string,
  resourceType: SharedResourceType,
  resourceId: string,
  need: AccessNeed,
): Promise<void> {
  // (a) Owner path — unchanged; unconditionally sufficient for view AND edit.
  const owner = await resolveResourceOwner(db, resourceType, resourceId);
  if (owner !== null && owner === userId) return;

  // (b) Share-widened path — additive; can only grant, never revoke owner.
  const shared = await effectiveSharedPermission(
    db,
    userId,
    resourceType,
    resourceId,
  );
  if (shared !== null && permissionSatisfies(shared, need)) return;

  throw new AccessError(resourceType, resourceId, need);
}

// ---------------------------------------------------------------------------
// Membership RBAC (used by the workspaces router)
// ---------------------------------------------------------------------------

/**
 * Thrown when the caller lacks the required role in a workspace (or is not a
 * member at all). Fail-closed like AccessError.
 */
export class WorkspaceRoleError extends Error {
  readonly workspaceId: string;
  readonly required: WorkspaceRole;

  constructor(workspaceId: string, required: WorkspaceRole) {
    super(`Requires ${required} on workspace ${workspaceId}`);
    this.name = "WorkspaceRoleError";
    this.workspaceId = workspaceId;
    this.required = required;
  }
}

/**
 * getWorkspaceRole — the caller's role in a workspace, or null when they are
 * not a member. The owner is always a member row (seeded at create), so no
 * special-casing.
 */
export async function getWorkspaceRole(
  db: AccessDb,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const rows = await db
    .select({ role: WorkspaceMembers.role })
    .from(WorkspaceMembers)
    .where(
      and(
        eq(WorkspaceMembers.workspaceId, workspaceId),
        eq(WorkspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  return (rows[0]?.role as WorkspaceRole | undefined) ?? null;
}

/**
 * assertWorkspaceRole — resolves when the caller's role in the workspace ranks
 * >= `min`; throws WorkspaceRoleError otherwise (including non-members).
 * Returns the caller's actual role on success (callers use it to forbid
 * escalation past their own authority).
 */
export async function assertWorkspaceRole(
  db: AccessDb,
  workspaceId: string,
  userId: string,
  min: WorkspaceRole,
): Promise<WorkspaceRole> {
  const role = await getWorkspaceRole(db, workspaceId, userId);
  if (role === null || roleRank(role) < roleRank(min)) {
    throw new WorkspaceRoleError(workspaceId, min);
  }
  return role;
}
