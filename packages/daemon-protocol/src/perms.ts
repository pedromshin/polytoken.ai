/**
 * perm.request / perm.decision — the ONE permission model on the wire.
 *
 * R-03 (correlation): `perm.request`'s payload is FROZEN as `{ tool, args, risk }` with no id
 * field — so `perm.decision.requestId` correlates to the perm.request ENVELOPE's `id`. The daemon
 * maps that back to the pending tool request internally. First decision wins; duplicates are
 * ignored, so an old approval cannot be replayed into a new ask (T-65-14).
 *
 * Direction matters here more than anywhere: `perm.request` is daemon→client ONLY and
 * `perm.decision` is client→daemon ONLY (see direction.ts). A client cannot forge a prompt.
 */
import { z } from "zod";
import { riskSchema } from "./tools.js";

/**
 * `args` is `unknown` by the frozen contract: the prompt echoes whatever the requested tool
 * carried. Clients render it; they must not trust its shape without parsing it themselves.
 */
export const permRequestSchema = z
  .object({
    tool: z.string().min(1),
    args: z.unknown(),
    risk: riskSchema,
  })
  .strict();

export type PermRequestPayload = z.infer<typeof permRequestSchema>;

/** `remember: true` persists the decision to the allowlist — a click tonight is a standing grant. */
export const permDecisionSchema = z
  .object({
    requestId: z.string().min(1),
    allow: z.boolean(),
    remember: z.boolean(),
  })
  .strict();

export type PermDecisionPayload = z.infer<typeof permDecisionSchema>;
