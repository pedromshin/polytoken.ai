/**
 * Browser tool payloads (v2.0, CDP-first browser control) — an ADDITIVE schema module.
 *
 * The frozen 5 (`fs.read`/`fs.write`/`fs.list`/`terminal.exec`/`git`) live in `tools.ts` and are
 * NOT touched: `toolNameSchema`, `toolRequestSchema`, `toolOutputSchema`, and `toolResultSchema`
 * keep their exact shapes for every existing consumer. This module declares the six browser tool
 * names and the EXTENDED unions that are strict supersets of the frozen ones — a frame legal
 * yesterday is byte-for-byte legal today.
 *
 * The invariants carry over from tools.ts:
 * - every `args` object is `.strict()` (T-65-01 — no rider keys),
 * - bounds on every string/array (T-65-02 — a hostile frame cannot allocate unbounded structures),
 * - `browser.navigate` accepts ONLY http/https URLs at the SCHEMA level: `file://` would be a
 *   filesystem read that bypasses the roots boundary, so it is rejected before any handler runs.
 */
import { z } from "zod";

import { toolErrorCodeSchema, toolOutputSchema, toolRequestSchema } from "./tools.js";
import { dirToolOutputSchema, dirToolRequestSchema } from "./dir.js";

/** The six browser tool names. Additive — deliberately NOT merged into the frozen `toolNameSchema`. */
export const browserToolNameSchema = z.enum([
  "browser.open",
  "browser.navigate",
  "browser.screenshot",
  "browser.click",
  "browser.type",
  "browser.close",
]);
export type BrowserToolName = z.infer<typeof browserToolNameSchema>;

/** Only web origins. A `file://` or `chrome://` navigation is a boundary escape, not a browse. */
const httpUrlSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine((u) => /^https?:\/\//i.test(u), {
    message: "only http:// and https:// URLs are permitted",
  });

/** CSS/text selector handed to the page. Bounded — a selector is short by nature. */
const selectorSchema = z.string().min(1).max(1_024);

export const browserToolRequestSchema = z.discriminatedUnion("tool", [
  z
    .object({
      tool: z.literal("browser.open"),
      args: z
        .object({
          /** The browser profile directory — the permission SCOPE for every browser tool. */
          profileDir: z.string().min(1).max(4_096),
          headless: z.boolean().optional(),
          /** Attach to an already-running chromium over CDP instead of launching one. */
          cdpUrl: z.string().min(1).max(4_096).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      tool: z.literal("browser.navigate"),
      args: z.object({ url: httpUrlSchema }).strict(),
    })
    .strict(),
  z
    .object({
      tool: z.literal("browser.screenshot"),
      args: z.object({ fullPage: z.boolean().optional() }).strict(),
    })
    .strict(),
  z
    .object({
      tool: z.literal("browser.click"),
      args: z.object({ selector: selectorSchema }).strict(),
    })
    .strict(),
  z
    .object({
      tool: z.literal("browser.type"),
      args: z
        .object({ selector: selectorSchema, text: z.string().max(10_000) })
        .strict(),
    })
    .strict(),
  z
    .object({
      tool: z.literal("browser.close"),
      args: z.object({}).strict(),
    })
    .strict(),
]);
export type BrowserToolRequestPayload = z.infer<typeof browserToolRequestSchema>;

export const browserToolOutputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("browser.open"),
      profileDir: z.string(),
      /** true when attached over CDP, false when this daemon launched the browser. */
      attached: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("browser.navigate"),
      url: z.string(),
      title: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("browser.screenshot"),
      /** PNG bytes, base64-encoded. Capped at the daemon's output limit BEFORE encoding. */
      base64: z.string(),
      bytes: z.number().int().min(0),
      truncated: z.boolean(),
    })
    .strict(),
  z
    .object({ kind: z.literal("browser.click"), selector: z.string() })
    .strict(),
  z
    .object({
      kind: z.literal("browser.type"),
      selector: z.string(),
      chars: z.number().int().min(0),
    })
    .strict(),
  z
    .object({ kind: z.literal("browser.close"), closed: z.boolean() })
    .strict(),
]);
export type BrowserToolOutput = z.infer<typeof browserToolOutputSchema>;

/**
 * The EXTENDED request union: the frozen 5 first (so their parse behavior is untouched), the six
 * browser tools after. This is what a v2.0 wire surface validates against.
 */
export const extendedToolRequestSchema = z.union([
  toolRequestSchema,
  browserToolRequestSchema,
  dirToolRequestSchema,
]);
export type ExtendedToolRequestPayload = z.infer<typeof extendedToolRequestSchema>;

/** The EXTENDED output union — every frozen kind plus the browser + dir kinds, one discriminator. */
export const extendedToolOutputSchema = z.discriminatedUnion("kind", [
  ...toolOutputSchema.options,
  ...browserToolOutputSchema.options,
  ...dirToolOutputSchema.options,
]);
export type ExtendedToolOutput = z.infer<typeof extendedToolOutputSchema>;

/**
 * Extended tool.result — same `ok` iff not-error refinement as the frozen `toolResultSchema`
 * (which still validates every frozen-kind result unchanged).
 */
export const extendedToolResultSchema = z
  .object({
    requestId: z.string().min(1),
    ok: z.boolean(),
    output: extendedToolOutputSchema,
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
export type ExtendedToolResultPayload = z.infer<typeof extendedToolResultSchema>;

// Re-exported so a browser-tool consumer has one import surface for error codes too.
export { toolErrorCodeSchema };
