/**
 * tool.request / tool.result payloads — the ToolExecutor's wire vocabulary.
 *
 * The contract froze `tool.request` as `{ tool, args }` and `tool.result` as
 * `{ requestId, ok, output }`, leaving the internals to C:
 * - R-05: `tool.request` is a discriminated union on `tool`; every `args` object is `.strict()`
 *   (T-65-01 — a `shell: true` key cannot ride along).
 * - R-05: `tool.result.output` is a `kind`-discriminated union including
 *   `{ kind: "error", code, message }`.
 * - R-04: `risk` is the closed enum "read" | "write" | "exec".
 *
 * Bounds (T-65-02) are deliberate: a hostile frame must not allocate unbounded structures
 * through the parser.
 */
import { z } from "zod";

/** R-04. fs.read/fs.list/git-read = read; fs.write/git add|commit = write; terminal.exec = exec. */
export const riskSchema = z.enum(["read", "write", "exec"]);
export type Risk = z.infer<typeof riskSchema>;

/** Closed set — `push` is deliberately NOT in tonight's slice. */
export const gitSubcommandSchema = z.enum(["status", "log", "diff", "branch", "add", "commit"]);
export type GitSubcommand = z.infer<typeof gitSubcommandSchema>;

/** The tool names the executor dispatches on. Shared with the permission store's rule scope. */
export const toolNameSchema = z.enum(["fs.read", "fs.write", "fs.list", "terminal.exec", "git"]);
export type ToolName = z.infer<typeof toolNameSchema>;

/**
 * R-01/R-05: answered by a `tool.result` envelope (fresh id) whose payload `requestId` is THIS
 * request envelope's `id`.
 */
export const toolRequestSchema = z.discriminatedUnion("tool", [
  z
    .object({
      tool: z.literal("fs.read"),
      args: z.object({ path: z.string().min(1) }).strict(),
    })
    .strict(),
  z
    .object({
      tool: z.literal("fs.write"),
      args: z.object({ path: z.string().min(1), content: z.string() }).strict(),
    })
    .strict(),
  z
    .object({
      tool: z.literal("fs.list"),
      args: z.object({ path: z.string().min(1) }).strict(),
    })
    .strict(),
  z
    .object({
      tool: z.literal("terminal.exec"),
      args: z
        .object({
          cwd: z.string().min(1),
          command: z.string().min(1),
          /** argv entries — NEVER a command string. There is no shell to inject into. */
          args: z.array(z.string()).max(64).default([]),
          timeoutMs: z.number().int().min(1).max(600_000).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      tool: z.literal("git"),
      args: z
        .object({
          cwd: z.string().min(1),
          subcommand: gitSubcommandSchema,
          paths: z.array(z.string()).max(256).optional(),
          message: z.string().max(10_000).optional(),
          maxCount: z.number().int().min(1).max(500).optional(),
        })
        .strict(),
    })
    .strict(),
]);

export type ToolRequestPayload = z.infer<typeof toolRequestSchema>;

export const toolErrorCodeSchema = z.enum([
  "outside_roots",
  "permission_denied",
  "permission_timeout",
  "not_implemented",
  "protocol_error",
  "exec_failure",
  "io_failure",
  "invalid_path",
  "invalid_args",
]);
export type ToolErrorCode = z.infer<typeof toolErrorCodeSchema>;

export const fsListEntrySchema = z
  .object({
    name: z.string(),
    kind: z.enum(["file", "dir", "other"]),
    size: z.number().int().min(0).nullable(),
  })
  .strict();
export type FsListEntry = z.infer<typeof fsListEntrySchema>;

/** R-05: the `kind`-discriminated output union the contract left `unknown`. */
export const toolOutputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("fs.read"),
      content: z.string(),
      bytes: z.number().int().min(0),
      truncated: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("fs.write"),
      path: z.string(),
      bytes: z.number().int().min(0),
    })
    .strict(),
  z
    .object({ kind: z.literal("fs.list"), entries: z.array(fsListEntrySchema) })
    .strict(),
  z
    .object({
      kind: z.literal("terminal.exec"),
      exitCode: z.number().int().nullable(),
      stdout: z.string(),
      stderr: z.string(),
      timedOut: z.boolean(),
      durationMs: z.number().int().min(0),
      truncated: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("git"),
      exitCode: z.number().int(),
      stdout: z.string(),
      stderr: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("error"),
      code: toolErrorCodeSchema,
      message: z.string(),
    })
    .strict(),
]);

export type ToolOutput = z.infer<typeof toolOutputSchema>;

/**
 * `ok` and `output.kind` cannot disagree: ok is true IFF the output is not an error. A result that
 * claims success while carrying an error (or vice versa) is a daemon bug surfaced at the parser.
 */
export const toolResultSchema = z
  .object({
    requestId: z.string().min(1),
    ok: z.boolean(),
    output: toolOutputSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.ok === (v.output.kind === "error")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ok must be true iff output.kind is not 'error'",
      });
    }
  });

export type ToolResultPayload = z.infer<typeof toolResultSchema>;
