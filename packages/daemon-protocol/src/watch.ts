/**
 * fs.watch.event payload — FROZEN 2026-07-16 (LANE-CONTRACTS.md): `{ root, path, kind }`.
 *
 * R-08 (paths): `root` is the ABSOLUTE configured root; `path` is root-relative with FORWARD
 * slashes. The daemon normalizes Windows backslashes at the boundary so every client — Windows or
 * not — reads one path shape.
 */
import { z } from "zod";

/** 1:1 with the chokidar events the daemon subscribes to. A 6th kind cannot parse. */
export const fsWatchKindSchema = z.enum(["add", "change", "unlink", "addDir", "unlinkDir"]);
export type FsWatchKind = z.infer<typeof fsWatchKindSchema>;

export const fsWatchEventSchema = z
  .object({
    root: z.string().min(1),
    /** Root-relative, forward slashes (R-08). Empty string = the root itself. */
    path: z.string(),
    kind: fsWatchKindSchema,
  })
  .strict();

export type FsWatchEventPayload = z.infer<typeof fsWatchEventSchema>;
