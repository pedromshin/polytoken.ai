/**
 * roles.ts — client-side mirror of the workspace RBAC ladder (Stream B).
 *
 * The authoritative rank + rules live server-side in
 * `@polytoken/db/access-control` (`roleRank`, `assertWorkspaceRole`) and are
 * re-enforced on every mutation in `router/workspaces/index.ts`. This module
 * is a PRESENTATIONAL mirror only: it lets the UI honestly disable/hide the
 * actions a caller's role cannot perform, so the surface never dangles a
 * control the server will only reject. It grants nothing — the server is still
 * the sole authority (ownership-first; identity is always `ctx.user.id`).
 *
 * Kept as a plain TS map (not a `@polytoken/db` import) so a client component
 * never drags server-only db code into the browser bundle.
 */

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

/** viewer < member < admin < owner — mirrors `roleRank` in access-control.ts. */
const RANK: Record<WorkspaceRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export function roleRank(role: WorkspaceRole): number {
  return RANK[role];
}

/** Human labels for chrome (sans, monochrome — role is NEVER a hue, law 1). */
export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

/** Every role, weakest-first — the order a role <select> should offer. */
export const ALL_ROLES: readonly WorkspaceRole[] = [
  "viewer",
  "member",
  "admin",
  "owner",
];

/**
 * Membership mutations (addMember / changeRole / removeMember) require the
 * caller to be admin or owner — mirrors `assertWorkspaceRole(..., "admin")`.
 */
export function canManageMembers(callerRole: WorkspaceRole): boolean {
  return roleRank(callerRole) >= roleRank("admin");
}

/**
 * The roles a caller may GRANT: never one outranking their own — mirrors
 * `assertNotOutranking` (an admin cannot mint an owner).
 */
export function grantableRoles(
  callerRole: WorkspaceRole,
): readonly WorkspaceRole[] {
  return ALL_ROLES.filter((r) => roleRank(r) <= roleRank(callerRole));
}
