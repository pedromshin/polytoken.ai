/**
 * workspaces/index.ts — workspacesRouter (FEATURE-CATALOG W5, multiuser/teams).
 *
 * The server side of the greenfield tenancy-widening layer: workspaces,
 * RBAC membership, and generic resource sharing. It is ADDITIVE to the
 * single-user model — nothing here touches an existing table's `user_id`
 * anchor; a share only ever WIDENS access beyond the owner (access-control.ts).
 *
 * ## Tenancy + RBAC (all server-enforced)
 *   - Every procedure is `protectedProcedure`; the acting identity is ALWAYS
 *     `ctx.user.id`, never a client field.
 *   - Membership MUTATIONS (addMember/changeRole/removeMember) require the
 *     caller to be `admin` or `owner` (`assertWorkspaceRole`, min admin) and may
 *     never grant/leave a role OUTRANKING the caller — a non-admin cannot add
 *     members and an admin cannot mint an owner (RBAC, server-side).
 *   - The workspace OWNER's membership row is sacred: it cannot be
 *     demoted/removed by anyone (only deleting the workspace removes it).
 *   - SHARING a resource requires the caller can EDIT it (owner or edit-shared,
 *     `assertCanAccess` at `edit`) — you cannot share what you cannot write.
 *     REVOKING requires the caller be the grantor or the resource owner.
 *
 * Insufficient-role → FORBIDDEN (the caller legitimately knows the workspace);
 * resource-access failures → NOT_FOUND (fail-closed, no existence oracle).
 */

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  ResourceShares,
  Workspaces,
  WorkspaceMembers,
} from "@polytoken/db/schema";
import {
  assertCanAccess,
  assertWorkspaceRole,
  getWorkspaceRole,
  resolveResourceOwner,
  roleRank,
  WorkspaceRoleError,
  type SharedResourceType,
  type WorkspaceRole,
} from "@polytoken/db/access-control";

import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { assertAccessOrNotFound, assertRoleOrForbidden } from "../_ownership";

// ---------------------------------------------------------------------------
// Shared input schemas
// ---------------------------------------------------------------------------
const workspaceIdInput = z.object({ workspaceId: z.string().uuid() });
const roleSchema = z.enum(["owner", "admin", "member", "viewer"]);
const resourceTypeSchema = z.enum([
  "document",
  "entity",
  "file",
  "conversation",
]);
const permissionSchema = z.enum(["view", "edit"]);

// A share targets EXACTLY ONE grantee — a workspace OR a user (mirrors the
// resource_shares CHECK constraint). Zod enforces the XOR before any write.
const shareTargetSchema = z
  .object({
    workspaceId: z.string().uuid().optional(),
    targetUserId: z.string().uuid().optional(),
  })
  .refine(
    (t) =>
      (t.workspaceId === undefined) !== (t.targetUserId === undefined),
    { message: "Provide exactly one of workspaceId or targetUserId" },
  );

export const workspacesRouter = createTRPCRouter({
  /**
   * create — a new workspace with the caller seeded as its `owner` member, so
   * every membership query treats the owner uniformly (no special-casing). The
   * owner_user_id column is the durable delete-authority record.
   */
  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(200).default("Untitled workspace") }))
    .mutation(async ({ ctx, input }) => {
      const inserted = await ctx.db
        .insert(Workspaces)
        .values({ ownerUserId: ctx.user.id, name: input.name })
        .returning({ id: Workspaces.id });

      const workspaceId = inserted[0]?.id;
      if (!workspaceId) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "workspace insert returned no id",
        });
      }

      await ctx.db.insert(WorkspaceMembers).values({
        workspaceId,
        userId: ctx.user.id,
        role: "owner",
      });

      return { workspaceId };
    }),

  /**
   * list — workspaces the caller owns or is a member of (owner is a member row,
   * so a single membership scan suffices), newest first.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: Workspaces.id,
        name: Workspaces.name,
        ownerUserId: Workspaces.ownerUserId,
        role: WorkspaceMembers.role,
        createdAt: Workspaces.createdAt,
      })
      .from(WorkspaceMembers)
      .innerJoin(Workspaces, eq(Workspaces.id, WorkspaceMembers.workspaceId))
      .where(eq(WorkspaceMembers.userId, ctx.user.id))
      .orderBy(desc(Workspaces.createdAt));

    return rows;
  }),

  /**
   * members — the roster of a workspace. The caller must be a member (any role)
   * to read it; a non-member gets FORBIDDEN.
   */
  members: protectedProcedure
    .input(workspaceIdInput)
    .query(async ({ ctx, input }) => {
      await assertRoleOrForbidden(() =>
        assertWorkspaceRole(ctx.db, input.workspaceId, ctx.user.id, "viewer"),
      );

      return ctx.db
        .select({
          id: WorkspaceMembers.id,
          userId: WorkspaceMembers.userId,
          role: WorkspaceMembers.role,
          createdAt: WorkspaceMembers.createdAt,
        })
        .from(WorkspaceMembers)
        .where(eq(WorkspaceMembers.workspaceId, input.workspaceId))
        .orderBy(desc(WorkspaceMembers.createdAt));
    }),

  /**
   * addMember — invite/add a user at a role. RBAC: caller must be admin+; the
   * granted role may not OUTRANK the caller (an admin cannot mint an owner).
   */
  addMember: protectedProcedure
    .input(
      workspaceIdInput.extend({
        userId: z.string().uuid(),
        role: roleSchema.default("member"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actorRole = await callerRoleOrForbidden(
        ctx.db,
        input.workspaceId,
        ctx.user.id,
        "admin",
      );
      assertNotOutranking(actorRole, input.role);

      await ctx.db.insert(WorkspaceMembers).values({
        workspaceId: input.workspaceId,
        userId: input.userId,
        role: input.role,
      });

      return { added: true };
    }),

  /**
   * changeRole — update a member's role. RBAC: caller must be admin+; the new
   * role may not outrank the caller; the workspace OWNER's role is immutable.
   */
  changeRole: protectedProcedure
    .input(
      workspaceIdInput.extend({
        userId: z.string().uuid(),
        role: roleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actorRole = await callerRoleOrForbidden(
        ctx.db,
        input.workspaceId,
        ctx.user.id,
        "admin",
      );
      assertNotOutranking(actorRole, input.role);

      // The owner's role is sacred — never demotable via changeRole.
      const targetRole = await getWorkspaceRole(
        ctx.db,
        input.workspaceId,
        input.userId,
      );
      if (targetRole === "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "the workspace owner's role is immutable",
        });
      }

      await ctx.db
        .update(WorkspaceMembers)
        .set({ role: input.role })
        .where(
          and(
            eq(WorkspaceMembers.workspaceId, input.workspaceId),
            eq(WorkspaceMembers.userId, input.userId),
          ),
        );

      return { updated: true };
    }),

  /**
   * removeMember — drop a member. RBAC: caller must be admin+; the owner can
   * never be removed (delete the workspace instead).
   */
  removeMember: protectedProcedure
    .input(workspaceIdInput.extend({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await callerRoleOrForbidden(ctx.db, input.workspaceId, ctx.user.id, "admin");

      const targetRole = await getWorkspaceRole(
        ctx.db,
        input.workspaceId,
        input.userId,
      );
      if (targetRole === "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "the workspace owner cannot be removed",
        });
      }

      await ctx.db
        .delete(WorkspaceMembers)
        .where(
          and(
            eq(WorkspaceMembers.workspaceId, input.workspaceId),
            eq(WorkspaceMembers.userId, input.userId),
          ),
        );

      return { removed: true };
    }),

  /**
   * leave — the caller removes their OWN membership. The owner cannot leave
   * (they must delete the workspace); any other member may.
   */
  leave: protectedProcedure
    .input(workspaceIdInput)
    .mutation(async ({ ctx, input }) => {
      const role = await getWorkspaceRole(ctx.db, input.workspaceId, ctx.user.id);
      if (role === null) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (role === "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "the owner cannot leave; delete the workspace instead",
        });
      }

      await ctx.db
        .delete(WorkspaceMembers)
        .where(
          and(
            eq(WorkspaceMembers.workspaceId, input.workspaceId),
            eq(WorkspaceMembers.userId, ctx.user.id),
          ),
        );

      return { left: true };
    }),

  // -------------------------------------------------------------------------
  // Sharing surface
  // -------------------------------------------------------------------------

  /**
   * shareResource — grant a workspace or a user view/edit on a resource. The
   * caller must be able to EDIT the resource (owner or edit-shared) — you
   * cannot share what you cannot write. When targeting a workspace, the caller
   * must also be a member of it (a share into a workspace you don't belong to
   * is FORBIDDEN).
   */
  shareResource: protectedProcedure
    .input(
      z.object({
        resourceType: resourceTypeSchema,
        resourceId: z.string().uuid(),
        permission: permissionSchema.default("view"),
        target: shareTargetSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertAccessOrNotFound(() =>
        assertCanAccess(
          ctx.db,
          ctx.user.id,
          input.resourceType,
          input.resourceId,
          "edit",
        ),
      );

      if (input.target.workspaceId !== undefined) {
        await assertRoleOrForbidden(() =>
          assertWorkspaceRole(
            ctx.db,
            input.target.workspaceId as string,
            ctx.user.id,
            "viewer",
          ),
        );
      }

      const inserted = await ctx.db
        .insert(ResourceShares)
        .values({
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          workspaceId: input.target.workspaceId ?? null,
          targetUserId: input.target.targetUserId ?? null,
          permission: input.permission,
          grantedBy: ctx.user.id,
        })
        .returning({ id: ResourceShares.id });

      return { shareId: inserted[0]?.id ?? null };
    }),

  /**
   * listShares — every active grant on a resource. The caller must be able to
   * VIEW the resource to see who it is shared with.
   */
  listShares: protectedProcedure
    .input(
      z.object({
        resourceType: resourceTypeSchema,
        resourceId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertAccessOrNotFound(() =>
        assertCanAccess(
          ctx.db,
          ctx.user.id,
          input.resourceType,
          input.resourceId,
          "view",
        ),
      );

      return ctx.db
        .select({
          id: ResourceShares.id,
          workspaceId: ResourceShares.workspaceId,
          targetUserId: ResourceShares.targetUserId,
          permission: ResourceShares.permission,
          grantedBy: ResourceShares.grantedBy,
          createdAt: ResourceShares.createdAt,
        })
        .from(ResourceShares)
        .where(
          and(
            eq(ResourceShares.resourceType, input.resourceType),
            eq(ResourceShares.resourceId, input.resourceId),
          ),
        )
        .orderBy(desc(ResourceShares.createdAt));
    }),

  /**
   * revokeShare — delete a grant. Authority: the grantor OR the resource owner
   * may revoke; anyone else gets NOT_FOUND (fail-closed).
   */
  revokeShare: protectedProcedure
    .input(z.object({ shareId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          resourceType: ResourceShares.resourceType,
          resourceId: ResourceShares.resourceId,
          grantedBy: ResourceShares.grantedBy,
        })
        .from(ResourceShares)
        .where(eq(ResourceShares.id, input.shareId))
        .limit(1);

      const share = rows[0];
      if (!share) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const isGrantor = share.grantedBy === ctx.user.id;
      let isOwner = false;
      if (!isGrantor) {
        const owner = await resolveResourceOwner(
          ctx.db,
          share.resourceType as SharedResourceType,
          share.resourceId,
        );
        isOwner = owner !== null && owner === ctx.user.id;
      }
      if (!isGrantor && !isOwner) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      await ctx.db
        .delete(ResourceShares)
        .where(eq(ResourceShares.id, input.shareId));

      return { revoked: true };
    }),
});

// ---------------------------------------------------------------------------
// Local RBAC helpers
// ---------------------------------------------------------------------------

/**
 * callerRoleOrForbidden — asserts the caller ranks >= `min` and returns their
 * actual role (used to forbid granting/escalating past their own authority).
 * A too-low role or a non-member both surface as FORBIDDEN.
 */
async function callerRoleOrForbidden(
  db: Parameters<typeof assertWorkspaceRole>[0],
  workspaceId: string,
  userId: string,
  min: WorkspaceRole,
): Promise<WorkspaceRole> {
  try {
    return await assertWorkspaceRole(db, workspaceId, userId, min);
  } catch (error) {
    // WorkspaceRoleError -> FORBIDDEN; anything else (e.g. a real DB failure)
    // propagates unchanged.
    if (error instanceof WorkspaceRoleError) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    throw error;
  }
}

/**
 * assertNotOutranking — a caller may never grant a role that outranks their
 * own (an admin cannot mint an owner). Equal rank is allowed (an admin may add
 * another admin).
 */
function assertNotOutranking(
  actorRole: WorkspaceRole,
  grantedRole: WorkspaceRole,
): void {
  if (roleRank(grantedRole) > roleRank(actorRole)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "cannot grant a role outranking your own",
    });
  }
}
