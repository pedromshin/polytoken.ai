/**
 * dir.* capabilities — bounded directory reads (v2.0). Two `defineCapability` registry entries,
 * resolved by id, broker-gated (risk: read), roots-bounded. The daemon-side twins of the frozen
 * `dir.list_tree` / `dir.sync_manifest` protocol shapes.
 *
 * The bounds (maxDepth ≤ 8, maxEntries ≤ 1000) are enforced at BOTH the schema (T-65-02) and here:
 * a vast or hostile tree can neither be requested nor walked without limit. Symlinks are NOT
 * followed — a link that points outside roots is exactly the escape the roots boundary exists to
 * stop, so the walk records the link entry (as "other") but never descends through it.
 */
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { DIR_TOOL_BOUNDS } from "@polytoken/daemon-protocol";

import { canonicalizePath, isInsideRoots, type CanonicalPath } from "../permissions/paths.js";
import { defineCapability, type CapabilityDescriptor } from "./registry.js";

const { MAX_DEPTH, MAX_ENTRIES } = DIR_TOOL_BOUNDS;

const mustCanonicalize = (raw: string): string => {
  const result = canonicalizePath(raw);
  if (!result.ok) throw new Error(`invalid path: ${result.reason}`);
  return result.path;
};

const kindOf = (d: { isFile(): boolean; isDirectory(): boolean }): "file" | "dir" | "other" =>
  d.isFile() ? "file" : d.isDirectory() ? "dir" : "other";

// ── dir.list_tree ────────────────────────────────────────────────────────────────────────────────

const listTreeInput = z
  .object({
    path: z.string().min(1),
    maxDepth: z.number().int().min(1).max(MAX_DEPTH).optional(),
    maxEntries: z.number().int().min(1).max(MAX_ENTRIES).optional(),
  })
  .strict();

export const dirListTreeCapability = defineCapability({
  id: "dir.list_tree",
  input: listTreeInput,
  output: z
    .object({
      kind: z.literal("dir.list_tree"),
      root: z.string(),
      entries: z.array(
        z.object({ path: z.string(), kind: z.enum(["file", "dir", "other"]), depth: z.number().int().min(0) }).strict(),
      ),
      truncated: z.boolean(),
    })
    .strict(),
  risk: "read",
  cost: "cheap",
  describe: "List a directory tree (bounded depth and entry count) inside a configured root.",
  source: "builtin",
  trust: "first-party",
  scope: (input) => ({ scope: input.path, pathsToCheck: [input.path] }),
  execute: async (input) => {
    const root = mustCanonicalize(input.path);
    const maxDepth = input.maxDepth ?? MAX_DEPTH;
    const maxEntries = input.maxEntries ?? MAX_ENTRIES;

    const entries: Array<{ path: string; kind: "file" | "dir" | "other"; depth: number }> = [];
    let truncated = false;

    // Iterative BFS with an explicit queue — no recursion depth surprise on a deep tree.
    const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
    while (queue.length > 0) {
      const { dir, depth } = queue.shift()!;
      let dirents: Dirent[];
      try {
        dirents = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue; // an unreadable subdir is skipped, not fatal
      }
      for (const dirent of dirents) {
        if (entries.length >= maxEntries) {
          truncated = true;
          return { kind: "dir.list_tree" as const, root, entries, truncated };
        }
        const childPath = path.win32.join(dir, dirent.name);
        const isSymlink = dirent.isSymbolicLink();
        const kind = isSymlink ? "other" : kindOf(dirent);
        entries.push({ path: childPath, kind, depth: depth + 1 });
        // Descend only into REAL directories inside roots, never through a symlink (escape guard).
        if (kind === "dir" && !isSymlink && depth + 1 < maxDepth && isInsideRoots(childPath as CanonicalPath, [root as CanonicalPath])) {
          queue.push({ dir: childPath, depth: depth + 1 });
        }
      }
    }
    return { kind: "dir.list_tree" as const, root, entries, truncated };
  },
});

// ── dir.sync_manifest ────────────────────────────────────────────────────────────────────────────

const manifestInput = z
  .object({ path: z.string().min(1), maxEntries: z.number().int().min(1).max(MAX_ENTRIES).optional() })
  .strict();

export const dirSyncManifestCapability = defineCapability({
  id: "dir.sync_manifest",
  input: manifestInput,
  output: z
    .object({
      kind: z.literal("dir.sync_manifest"),
      root: z.string(),
      files: z.array(z.object({ path: z.string(), size: z.number().int().min(0), sha256: z.string() }).strict()),
      truncated: z.boolean(),
    })
    .strict(),
  risk: "read",
  cost: "moderate",
  describe: "A stable content-hash manifest (path/size/sha256) of a bounded folder — the watched-folder sync seam.",
  source: "builtin",
  trust: "first-party",
  scope: (input) => ({ scope: input.path, pathsToCheck: [input.path] }),
  execute: async (input) => {
    const root = mustCanonicalize(input.path);
    const maxEntries = input.maxEntries ?? MAX_ENTRIES;
    const files: Array<{ path: string; size: number; sha256: string }> = [];
    let truncated = false;

    const queue: string[] = [root];
    while (queue.length > 0) {
      const dir = queue.shift()!;
      let dirents: Dirent[];
      try {
        dirents = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const dirent of dirents) {
        if (dirent.isSymbolicLink()) continue; // never hash through a link
        const childPath = path.win32.join(dir, dirent.name);
        if (dirent.isDirectory()) {
          if (isInsideRoots(childPath as CanonicalPath, [root as CanonicalPath])) queue.push(childPath);
          continue;
        }
        if (!dirent.isFile()) continue;
        if (files.length >= maxEntries) {
          truncated = true;
          return { kind: "dir.sync_manifest" as const, root, files, truncated };
        }
        try {
          const buf = await fsp.readFile(childPath);
          files.push({ path: childPath, size: buf.byteLength, sha256: createHash("sha256").update(buf).digest("hex") });
        } catch {
          // vanished/unreadable between readdir and read — omit, do not crash the manifest
        }
      }
    }
    return { kind: "dir.sync_manifest" as const, root, files, truncated };
  },
});

/** The dir capability set — folded into builtinRegistry alongside the fs/terminal/git + browser ones. */
export const DIR_CAPABILITIES: readonly CapabilityDescriptor<never, never>[] = [
  dirListTreeCapability,
  dirSyncManifestCapability,
] as unknown as readonly CapabilityDescriptor<never, never>[];
