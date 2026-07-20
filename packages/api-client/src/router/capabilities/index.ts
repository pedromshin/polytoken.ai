/**
 * capabilities/index.ts — capabilitiesRouter (v2.0 tool-registry allowlist panel).
 *
 * The user-facing "what can my agent do" read surface. One procedure today:
 *
 *   - `manifest` — the describable projection (`CapabilityManifestEntry` + `origin`) of every
 *     builtin capability, served from the static mirror module (`builtin-manifest.ts`). It is a
 *     protectedProcedure not because the data is secret (it is the same manifest the LLM sees)
 *     but because the panel is a signed-in surface and every sibling router here follows the
 *     same session discipline.
 *
 * ## SEAM — server-persisted allowlist (deliberately NOT here yet)
 *
 * The slice calls for `capabilities.allowlist` get/set persisted per-user. There is NO per-user
 * settings table in `@polytoken/db` today (verified: no *settings*/*preferences* schema exists),
 * and inventing one requires a migration this wave cannot run. Shipping a get/set pair that
 * pretends to persist would be dishonest, so the allowlist is CLIENT-persisted for now
 * (localStorage, `apps/web/src/app/capabilities/_lib/allowlist.ts` — storage key
 * `polytoken.capability-allowlist.v1`, missing id ⇒ allowed). When a per-user settings table
 * lands, add here:
 *
 *   allowlist: { get: protectedProcedure.query(...), set: protectedProcedure.mutation(...) }
 *
 * keyed on `ctx.user.id` (never client input), value shape `Record<capabilityId, boolean>` —
 * then swap the web hook's storage backend for these procedures. The hook's surface
 * (`isAllowed`/`setAllowed`) was shaped so that swap touches only the hook.
 *
 * ## SEAM — live daemon manifest
 *
 * `manifest` returns the static mirror. When the daemon's own `registry.list()` is reachable
 * from the web tier, fetch it here and merge (id-keyed, daemon wins for daemon-origin entries).
 * The output type is already the honest projection, so the panel does not change.
 */
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { BUILTIN_CAPABILITY_MANIFEST } from "./builtin-manifest";

export const capabilitiesRouter = createTRPCRouter({
  /**
   * manifest — every capability the agent can wield, with honest
   * id/describe/risk/cost/source/trust (+ origin). No input: there is nothing
   * for a caller to supply, and nothing here can execute (INV-1's outward
   * projection — `CapabilityManifestEntry` carries no `execute`).
   */
  manifest: protectedProcedure.query(() => BUILTIN_CAPABILITY_MANIFEST),
});
