/**
 * dir.* capabilities — bounded tree + content-hash manifest, with `node:fs/promises` mocked to a
 * deterministic win32-keyed tree (so the assertions are exact and platform-independent; the daemon
 * uses win32 path semantics throughout). Proves the bounds (maxEntries → truncated), that symlinks
 * are recorded but never descended (the escape guard), and that the manifest hashes real bytes.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

type Ent = { name: string; t: "file" | "dir" | "link" };
const dirent = (e: Ent) => ({
  name: e.name,
  isFile: () => e.t === "file",
  isDirectory: () => e.t === "dir",
  isSymbolicLink: () => e.t === "link",
});

// A fake filesystem keyed by win32 paths (canonicalizePath yields these).
const TREE: Record<string, Ent[]> = {
  "C:\\root": [
    { name: "sub", t: "dir" },
    { name: "a.txt", t: "file" },
    { name: "link", t: "link" },
  ],
  "C:\\root\\sub": [{ name: "b.txt", t: "file" }],
};
const FILES: Record<string, string> = {
  "C:\\root\\a.txt": "alpha",
  "C:\\root\\sub\\b.txt": "beta",
};

vi.mock("node:fs/promises", () => ({
  default: {
    readdir: async (dir: string) => {
      const entries = TREE[dir];
      if (!entries) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return entries.map(dirent);
    },
    readFile: async (p: string) => {
      const content = FILES[p];
      if (content === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return Buffer.from(content, "utf8");
    },
  },
}));

const { dirListTreeCapability, dirSyncManifestCapability, DIR_CAPABILITIES } = await import("../tools/dir.js");

const ctx = { maxOutputBytes: 1_000_000, defaultTimeoutMs: 10_000 };

describe("dir.list_tree", () => {
  it("walks the tree with correct kinds and depths; records the symlink but does NOT descend it", async () => {
    const out = await dirListTreeCapability.execute({ path: "C:\\root" } as never, ctx);
    expect(out.kind).toBe("dir.list_tree");
    const byPath = Object.fromEntries(out.entries.map((e) => [e.path, e]));
    expect(byPath["C:\\root\\sub"]).toMatchObject({ kind: "dir", depth: 1 });
    expect(byPath["C:\\root\\a.txt"]).toMatchObject({ kind: "file", depth: 1 });
    expect(byPath["C:\\root\\link"]).toMatchObject({ kind: "other", depth: 1 }); // symlink → "other"
    expect(byPath["C:\\root\\sub\\b.txt"]).toMatchObject({ kind: "file", depth: 2 }); // descended a REAL dir
    expect(out.truncated).toBe(false);
  });

  it("respects maxEntries and reports truncated", async () => {
    const out = await dirListTreeCapability.execute({ path: "C:\\root", maxEntries: 2 } as never, ctx);
    expect(out.entries.length).toBe(2);
    expect(out.truncated).toBe(true);
  });

  it("maxDepth 1 lists only the immediate children (never descends)", async () => {
    const out = await dirListTreeCapability.execute({ path: "C:\\root", maxDepth: 1 } as never, ctx);
    expect(out.entries.every((e) => e.depth === 1)).toBe(true);
    expect(out.entries.find((e) => e.path === "C:\\root\\sub\\b.txt")).toBeUndefined();
  });

  it("declares read risk + the frozen metadata (INV-1/INV-4)", () => {
    expect(dirListTreeCapability.risk).toBe("read");
    expect(dirListTreeCapability.source).toBe("builtin");
    expect(dirListTreeCapability.scope({ path: "C:\\root" } as never)).toEqual({
      scope: "C:\\root",
      pathsToCheck: ["C:\\root"],
    });
  });
});

describe("dir.sync_manifest", () => {
  it("hashes every real file (recursing real dirs), skips the symlink, and matches sha256", async () => {
    const out = await dirSyncManifestCapability.execute({ path: "C:\\root" } as never, ctx);
    expect(out.kind).toBe("dir.sync_manifest");
    const byPath = Object.fromEntries(out.files.map((f) => [f.path, f]));
    expect(Object.keys(byPath).sort()).toEqual(["C:\\root\\a.txt", "C:\\root\\sub\\b.txt"]);
    expect(byPath["C:\\root\\a.txt"].sha256).toBe(createHash("sha256").update("alpha").digest("hex"));
    expect(byPath["C:\\root\\a.txt"].size).toBe(5);
    expect(out.truncated).toBe(false);
  });

  it("respects maxEntries and reports truncated", async () => {
    const out = await dirSyncManifestCapability.execute({ path: "C:\\root", maxEntries: 1 } as never, ctx);
    expect(out.files.length).toBe(1);
    expect(out.truncated).toBe(true);
  });
});

describe("registry wiring", () => {
  it("DIR_CAPABILITIES exposes exactly the two implemented ids", () => {
    expect(DIR_CAPABILITIES.map((c) => c.id).sort()).toEqual(["dir.list_tree", "dir.sync_manifest"]);
  });
});
