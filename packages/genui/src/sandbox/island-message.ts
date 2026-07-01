/**
 * island-message.ts — the postMessage contract between a code-island frame and its host.
 *
 * The frame runs at an opaque ("null") origin, so `event.origin` is useless as identity
 * (any two opaque origins both serialize to "null"). The host MUST validate:
 *   1. object identity — `event.source === frame.contentWindow`
 *   2. `event.origin === "null"` (our frame is opaque-origin)
 *   3. a per-render `nonce` carried in the payload (replay protection)
 *   4. the payload SHAPE (Zod), before trusting any field.
 * Never eval/innerHTML a payload. (See 20-RESEARCH.md §2, §5.)
 */

import { z } from "zod";

export const IslandReadyMessageSchema = z.object({
  type: z.literal("island-ready"),
  nonce: z.string().min(1),
});

export const IslandRuntimeErrorMessageSchema = z.object({
  type: z.literal("island-runtime-error"),
  nonce: z.string().min(1),
  source: z.enum(["onerror", "unhandledrejection"]),
  message: z.string(),
  stack: z.string().nullable().optional(),
});

export const IslandA11yViolationSchema = z.object({
  id: z.string(),
  impact: z.string().nullable().optional(),
  help: z.string().optional().default(""),
  helpUrl: z.string().optional().default(""),
  nodes: z
    .array(z.object({ target: z.array(z.string()), html: z.string() }))
    .default([]),
});

export const IslandA11yMessageSchema = z.object({
  type: z.literal("island-a11y"),
  nonce: z.string().min(1),
  violations: z.array(IslandA11yViolationSchema),
});

export const IslandMessageSchema = z.discriminatedUnion("type", [
  IslandReadyMessageSchema,
  IslandRuntimeErrorMessageSchema,
  IslandA11yMessageSchema,
]);

export type IslandMessage = z.infer<typeof IslandMessageSchema>;
export type IslandA11yViolation = z.infer<typeof IslandA11yViolationSchema>;

/** safeParse an untrusted `event.data` into a typed IslandMessage, or null. */
export function parseIslandMessage(data: unknown): IslandMessage | null {
  const result = IslandMessageSchema.safeParse(data);
  return result.success ? result.data : null;
}

/** The minimal event shape the host needs to authenticate a frame message. */
export interface IncomingMessageEvent {
  readonly source: unknown;
  readonly origin: string;
}

/**
 * True only when the event provably came from OUR opaque-origin frame and carries the
 * expected nonce. Combines object identity + null-origin + nonce (never origin alone).
 */
export function isTrustedIslandMessage(
  event: IncomingMessageEvent,
  frameWindow: unknown,
  expectedNonce: string,
  message: IslandMessage,
): boolean {
  return (
    frameWindow != null &&
    event.source === frameWindow &&
    event.origin === "null" &&
    message.nonce === expectedNonce
  );
}
