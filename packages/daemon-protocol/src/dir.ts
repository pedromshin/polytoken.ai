/**
 * dir.* tool schemas — a v2.0 ADDITIVE extension, same discipline as browser.ts.
 *
 * NOT touched: the frozen `toolNameSchema`, `toolRequestSchema`, `toolOutputSchema`,
 * `toolResultSchema`. These are new `tool.request`/`tool.result` kinds folded into the extended
 * unions (see browser.ts) so a client that only knew the frozen five keeps working byte-for-byte.
 *
 * All three are filesystem READS (directory tree, watch registration, content-hash manifest) — the
 * same risk class as fs.read/fs.list, broker-gated, roots-bounded.
 */
import { z } from "zod";

/**
 * `dir.watch` is deliberately NOT here: a folder subscription is a stream, not a request/response,
 * and a capability's `execute()` has no client to stream to — shipping it as a capability would be
 * a fake. The daemon already streams `fs.watch.event` for its one configured watch root; a future
 * multi-folder watch rides THAT transport (the registry seam), not this request/response surface.
 */
export const dirToolNameSchema = z.enum(["dir.list_tree", "dir.sync_manifest"]);
export type DirToolName = z.infer<typeof dirToolNameSchema>;

/** Bounds keep a hostile or vast tree from allocating unbounded structures (T-65-02). */
const MAX_DEPTH = 8;
const MAX_ENTRIES = 1000;

export const dirToolRequestSchema = z.discriminatedUnion("tool", [
  z
    .object({
      tool: z.literal("dir.list_tree"),
      args: z
        .object({
          path: z.string().min(1),
          maxDepth: z.number().int().min(1).max(MAX_DEPTH).optional(),
          maxEntries: z.number().int().min(1).max(MAX_ENTRIES).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      tool: z.literal("dir.sync_manifest"),
      args: z
        .object({
          path: z.string().min(1),
          maxEntries: z.number().int().min(1).max(MAX_ENTRIES).optional(),
        })
        .strict(),
    })
    .strict(),
]);
export type DirToolRequestPayload = z.infer<typeof dirToolRequestSchema>;

export const dirTreeEntrySchema = z
  .object({
    path: z.string(),
    kind: z.enum(["file", "dir", "other"]),
    depth: z.number().int().min(0),
  })
  .strict();

export const dirManifestFileSchema = z
  .object({ path: z.string(), size: z.number().int().min(0), sha256: z.string() })
  .strict();

export const dirToolOutputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("dir.list_tree"),
      root: z.string(),
      entries: z.array(dirTreeEntrySchema),
      truncated: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("dir.sync_manifest"),
      root: z.string(),
      files: z.array(dirManifestFileSchema),
      truncated: z.boolean(),
    })
    .strict(),
]);
export type DirToolOutput = z.infer<typeof dirToolOutputSchema>;

export const DIR_TOOL_BOUNDS = { MAX_DEPTH, MAX_ENTRIES } as const;
