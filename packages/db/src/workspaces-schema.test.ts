/**
 * workspaces-schema.test.ts — W5 schema-shape guard for the three new tables
 * (workspaces / workspace_members / resource_shares) + a migration-0047
 * presence check.
 *
 * Lives in src/ (NOT src/schema/ — a *.test.ts under src/schema breaks
 * drizzle-kit generate). Pins the public shape (columns, ownership anchors,
 * the membership uniqueness, the share enums) so a schema edit that would
 * silently diverge from migration 0047 trips here (belt-and-suspenders to the
 * `drizzle-kit check` the migration workflow runs).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";

import { ResourceShares } from "./schema/resource-shares";
import { WorkspaceMembers } from "./schema/workspace-members";
import { Workspaces } from "./schema/workspaces";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(here, "..", "migrations", "0047_workspaces_teams_rbac.sql");

describe("workspaces table shape (W5)", () => {
  it("is named 'workspaces'", () => {
    expect(getTableName(Workspaces)).toBe("workspaces");
  });

  it("declares exactly the W5 columns", () => {
    expect(Object.keys(getTableColumns(Workspaces)).sort()).toEqual(
      ["createdAt", "id", "name", "ownerUserId"].sort(),
    );
  });

  it("anchors ownership on a NOT NULL owner_user_id (direct, additive to user_id model)", () => {
    const cols = getTableColumns(Workspaces);
    expect(cols.ownerUserId.name).toBe("owner_user_id");
    expect(cols.ownerUserId.notNull).toBe(true);
  });
});

describe("workspace_members table shape (W5)", () => {
  it("is named 'workspace_members'", () => {
    expect(getTableName(WorkspaceMembers)).toBe("workspace_members");
  });

  it("declares exactly the W5 columns", () => {
    expect(Object.keys(getTableColumns(WorkspaceMembers)).sort()).toEqual(
      ["createdAt", "id", "role", "userId", "workspaceId"].sort(),
    );
  });

  it("role is a NOT NULL enum defaulting to 'member'", () => {
    const cols = getTableColumns(WorkspaceMembers);
    expect(cols.role.notNull).toBe(true);
    expect(cols.role.enumValues).toEqual(["owner", "admin", "member", "viewer"]);
    expect(cols.role.default).toBe("member");
  });
});

describe("resource_shares table shape (W5)", () => {
  it("is named 'resource_shares'", () => {
    expect(getTableName(ResourceShares)).toBe("resource_shares");
  });

  it("declares exactly the W5 columns (generic grant, no per-resource FK)", () => {
    expect(Object.keys(getTableColumns(ResourceShares)).sort()).toEqual(
      [
        "createdAt",
        "grantedBy",
        "id",
        "permission",
        "resourceId",
        "resourceType",
        "targetUserId",
        "workspaceId",
      ].sort(),
    );
  });

  it("resource_type + permission are enums; grantee columns are nullable (XOR by CHECK)", () => {
    const cols = getTableColumns(ResourceShares);
    expect(cols.resourceType.enumValues).toEqual([
      "document",
      "entity",
      "file",
      "conversation",
    ]);
    expect(cols.permission.enumValues).toEqual(["view", "edit"]);
    expect(cols.permission.default).toBe("view");
    // Exactly one grantee is enforced by a CHECK constraint, so at the column
    // level both are nullable.
    expect(cols.workspaceId.notNull).toBe(false);
    expect(cols.targetUserId.notNull).toBe(false);
    expect(cols.grantedBy.notNull).toBe(true);
  });
});

describe("migration 0047 (W5)", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("creates the three tables and the three enums", () => {
    expect(sql).toContain('CREATE TABLE "workspaces"');
    expect(sql).toContain('CREATE TABLE "workspace_members"');
    expect(sql).toContain('CREATE TABLE "resource_shares"');
    expect(sql).toContain('CREATE TYPE "public"."workspace_role"');
    expect(sql).toContain('CREATE TYPE "public"."share_permission"');
    expect(sql).toContain('CREATE TYPE "public"."shared_resource_type"');
  });

  it("enforces the unique(workspace_id, user_id) membership constraint", () => {
    expect(sql).toContain("uq_workspace_members_workspace_user");
  });

  it("enforces the grantee-exclusivity CHECK (workspace XOR user)", () => {
    expect(sql).toContain("ck_resource_shares_one_grantee");
    expect(sql).toContain("num_nonnulls");
  });

  it("enables RLS + owner/member policies on all three tables (mirrors 0040)", () => {
    expect(sql).toContain('ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain(
      'ALTER TABLE "workspace_members" ENABLE ROW LEVEL SECURITY',
    );
    expect(sql).toContain(
      'ALTER TABLE "resource_shares" ENABLE ROW LEVEL SECURITY',
    );
    expect(sql).toContain("deny_all_workspaces_anon");
    expect(sql).toContain("workspaces_member_authenticated");
  });
});
