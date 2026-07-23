/**
 * file-versions-schema.test.ts — DR-02 schema-shape guard for `file_versions`.
 *
 * The migration itself is verified to parse by `drizzle-kit check` (0045). This
 * is the belt-and-suspenders schema-shape unit test the migration workflow
 * calls for when a live DB isn't available: it pins the table's public shape
 * (columns, types, the direct user_id ownership anchor, the version | trashed
 * state enum, the key-suffix + retention columns) so a schema edit that would
 * silently diverge from the migration trips here.
 *
 * Lives in `packages/db/src/` (NOT `src/schema/`) on purpose — a test file
 * under `src/schema` is picked up by `drizzle-kit generate`'s schema glob and
 * breaks generation.
 */
import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";

import { FileVersions, fileVersionStateEnum } from "./schema/file-versions";

describe("file_versions table shape (DR-02)", () => {
  it("is named 'file_versions'", () => {
    expect(getTableName(FileVersions)).toBe("file_versions");
  });

  it("declares exactly the DR-02 columns", () => {
    const cols = getTableColumns(FileVersions);
    expect(Object.keys(cols).sort()).toEqual(
      [
        "contentType",
        "createdAt",
        "expiresAt",
        "id",
        "isFolder",
        "objectPath",
        "sizeBytes",
        "state",
        "userId",
        "versionKey",
      ].sort(),
    );
  });

  it("anchors ownership directly on a NOT NULL user_id (INV-8/9)", () => {
    const cols = getTableColumns(FileVersions);
    expect(cols.userId.name).toBe("user_id");
    expect(cols.userId.notNull).toBe(true);
  });

  it("keys each snapshot on the vault object path and its park suffix", () => {
    const cols = getTableColumns(FileVersions);
    expect(cols.objectPath.name).toBe("object_path");
    expect(cols.objectPath.notNull).toBe(true);
    expect(cols.versionKey.name).toBe("version_key");
    expect(cols.versionKey.notNull).toBe(true);
  });

  it("discriminates version vs trashed via the file_version_state enum", () => {
    const cols = getTableColumns(FileVersions);
    expect(cols.state.notNull).toBe(true);
    expect(cols.state.enumValues).toEqual(["version", "trashed"]);
    expect(fileVersionStateEnum.enumName).toBe("file_version_state");
  });

  it("carries the retention + rollup columns (size, expiry, is_folder)", () => {
    const cols = getTableColumns(FileVersions);
    expect(cols.sizeBytes.name).toBe("size_bytes");
    expect(cols.sizeBytes.notNull).toBe(true);
    // Retention is nullable — a version is kept until superseded, not on a clock.
    expect(cols.expiresAt.name).toBe("expires_at");
    expect(cols.expiresAt.notNull).toBe(false);
    expect(cols.isFolder.name).toBe("is_folder");
    expect(cols.isFolder.notNull).toBe(true);
  });
});
