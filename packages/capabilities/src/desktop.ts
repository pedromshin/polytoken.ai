/**
 * desktop.ts — the four Cloud Desktop lifecycle capabilities (E5 / RFC §5.1), declared ONCE as
 * `defineCapability()` descriptors so the LLM, genui, the /capabilities panel, and the canvas
 * `desktop` node all read the SAME declaration (INV-1). A cloud desktop is a
 * daemon-protocol-shaped job (VISION guardrail 2): these are the third proof of that guardrail,
 * after fs/terminal and browser.
 *
 * ## Why this lives in OSS substrate, and how it stays pure
 *
 * The package rule (capability.ts header): NO tenant logic, NO env coupling, NO Supabase. These
 * descriptors honour it by carrying ZERO provisioning code — the actual VM lifecycle is a
 * `DesktopProvider` PORT injected through the executor's context (`TCtx = DesktopExecCtx`),
 * exactly as the daemon injects its `ExecCtx`. The control plane (api-client) binds the real
 * provider (Hetzner, RFC §2.2) and closes over the owner principal / signing keys; substrate
 * never sees a credential. Until a provider is bound, {@link failClosedDesktopProvider} is the
 * default and every verb throws — the safe floor (INV-5: unregistered/unprovisioned fails closed).
 *
 * ## risk + reversibility are DATA (INV-4, §5.2)
 *
 * No verb implements its own confirm flow. `desktop.spawn` and `desktop.destroy` declare
 * `reversibility: "irreversible"` — the ONE permission model reads that field and drives the
 * confirm modal (spawn: it bills a VM; destroy: it deletes the disk). `attach`/`hibernate` are
 * reversible and prompt-light. Cost is declared from day one (spawn=expensive, the second
 * capability class after deep_research that burns real money on one action — RFC §5.3).
 */
import { z } from "zod";

import { defineCapability, type Capability } from "./capability.js";

/** The lifecycle state a desktop session can be in — the node chrome and the ledger both read it. */
export type DesktopStatus = "provisioning" | "running" | "hibernated" | "destroyed";

/** A desktop's requested machine shape — display text + the provider's sizing key. Opaque here. */
export const desktopShapeSchema = z
  .object({
    /** Provider key (RFC §2.2 recommends Hetzner). Data on the owned row, never parsed for authz. */
    provider: z.string().min(1),
    region: z.string().min(1),
    /** The provider's instance-type key (e.g. a Hetzner "cx"/"cpx" line). Opaque to substrate. */
    shape: z.string().min(1),
  })
  .strict();
export type DesktopShape = z.infer<typeof desktopShapeSchema>;

const sessionRefSchema = z.object({ sessionId: z.string().min(1) }).strict();

const spawnOutputSchema = z
  .object({ sessionId: z.string().min(1), status: z.enum(["provisioning", "running"]) })
  .strict();
const attachOutputSchema = z
  .object({
    sessionId: z.string().min(1),
    status: z.enum(["provisioning", "running", "hibernated"]),
    /**
     * The per-session gateway origin the jailed iframe will load (RFC §4.3). It is DATA on the
     * owned session row — never parsed for authorization (INV-11). The short-lived stream token is
     * minted separately by the control plane and rides the URL fragment; it is NOT part of this
     * substrate output (substrate holds no signing key).
     */
    gatewayUrl: z.string().url(),
  })
  .strict();
const lifecycleOutputSchema = z
  .object({ sessionId: z.string().min(1), status: z.enum(["hibernated", "destroyed", "running"]) })
  .strict();

/**
 * The provider PORT — the one seam substrate exposes for real provisioning. The control plane binds
 * a concrete implementation (Hetzner Cloud API + cloud-init, RFC §2.2); substrate defines only the
 * shape. Every method is the untrusted-machine boundary: the provider holds the credentials, the
 * substrate holds none.
 */
export interface DesktopProvider {
  spawn(input: DesktopShape): Promise<z.infer<typeof spawnOutputSchema>>;
  attach(input: z.infer<typeof sessionRefSchema>): Promise<z.infer<typeof attachOutputSchema>>;
  hibernate(input: z.infer<typeof sessionRefSchema>): Promise<z.infer<typeof lifecycleOutputSchema>>;
  destroy(input: z.infer<typeof sessionRefSchema>): Promise<z.infer<typeof lifecycleOutputSchema>>;
}

/** What the executor receives — the injected provider (and nothing tenant-shaped; the impl closes over the owner). */
export type DesktopExecCtx = { readonly provider: DesktopProvider };

/** The scope a permission decision is made against — the verb + its target (no filesystem here). */
export type DesktopScope = { readonly action: string; readonly sessionId?: string };

/**
 * The fails-closed default: no provider bound ⇒ every verb refuses. This is the honest floor a
 * desktop capability sits on until the control plane wires Hetzner — a spawn that silently did
 * nothing, or worse pretended to succeed, would be the dishonest alternative.
 */
export const failClosedDesktopProvider: DesktopProvider = Object.freeze({
  spawn: () => Promise.reject(new Error("[desktop] no provider configured — provisioning is unavailable")),
  attach: () => Promise.reject(new Error("[desktop] no provider configured — provisioning is unavailable")),
  hibernate: () => Promise.reject(new Error("[desktop] no provider configured — provisioning is unavailable")),
  destroy: () => Promise.reject(new Error("[desktop] no provider configured — provisioning is unavailable")),
});

// ── desktop.spawn ────────────────────────────────────────────────────────────────────────────────
export const desktopSpawnCapability = defineCapability<
  DesktopShape,
  z.infer<typeof spawnOutputSchema>,
  DesktopExecCtx,
  DesktopScope
>({
  id: "desktop.spawn",
  input: desktopShapeSchema,
  output: spawnOutputSchema,
  risk: "exec",
  reversibility: "irreversible", // creates a BILLED VM — always behind the confirm widget (§5.3)
  cost: "expensive",
  describe:
    "Provision a new cloud desktop: creates a billed virtual machine in the given provider/region " +
    "with the requested shape and streams its realtime desktop back into polytoken. Costs money " +
    "continuously while running.",
  source: "builtin",
  trust: "first-party",
  scope: (input) => ({ action: "desktop.spawn", sessionId: `${input.provider}/${input.region}/${input.shape}` }),
  execute: (input, ctx) => ctx.provider.spawn(input),
});

// ── desktop.attach ───────────────────────────────────────────────────────────────────────────────
export const desktopAttachCapability = defineCapability<
  z.infer<typeof sessionRefSchema>,
  z.infer<typeof attachOutputSchema>,
  DesktopExecCtx,
  DesktopScope
>({
  id: "desktop.attach",
  input: sessionRefSchema,
  output: attachOutputSchema,
  risk: "read",
  cost: "cheap",
  describe:
    "Open an existing cloud desktop session and return the gateway origin its live stream loads " +
    "from. No billing effect — it does not create or power on a machine.",
  source: "builtin",
  trust: "first-party",
  scope: (input) => ({ action: "desktop.attach", sessionId: input.sessionId }),
  execute: (input, ctx) => ctx.provider.attach(input),
});

// ── desktop.hibernate ────────────────────────────────────────────────────────────────────────────
export const desktopHibernateCapability = defineCapability<
  z.infer<typeof sessionRefSchema>,
  z.infer<typeof lifecycleOutputSchema>,
  DesktopExecCtx,
  DesktopScope
>({
  id: "desktop.hibernate",
  input: sessionRefSchema,
  output: lifecycleOutputSchema,
  risk: "write",
  cost: "cheap",
  describe:
    "Snapshot the desktop's disk and power it off — the \"close the lid\" verb. Billing drops to " +
    "storage-only; the machine, its files, and installed software return on the next attach.",
  source: "builtin",
  trust: "first-party",
  scope: (input) => ({ action: "desktop.hibernate", sessionId: input.sessionId }),
  execute: (input, ctx) => ctx.provider.hibernate(input),
});

// ── desktop.destroy ──────────────────────────────────────────────────────────────────────────────
export const desktopDestroyCapability = defineCapability<
  z.infer<typeof sessionRefSchema>,
  z.infer<typeof lifecycleOutputSchema>,
  DesktopExecCtx,
  DesktopScope
>({
  id: "desktop.destroy",
  input: sessionRefSchema,
  output: lifecycleOutputSchema,
  risk: "exec",
  reversibility: "irreversible", // deletes the VM AND its disk permanently — confirm with data-loss language
  cost: "free", // saves money; the "cost" that matters is the data it destroys, stated by reversibility
  describe:
    "Delete a cloud desktop and its disk permanently. Everything on the machine is lost — this is " +
    "the only verb that destroys desktop data, and it cannot be undone.",
  source: "builtin",
  trust: "first-party",
  scope: (input) => ({ action: "desktop.destroy", sessionId: input.sessionId }),
  execute: (input, ctx) => ctx.provider.destroy(input),
});

/**
 * The four desktop capabilities as one array — the control plane folds this into its registry
 * (INV-1: one declaration, many consumers). Ordered highest-consequence first, mirroring the panel.
 */
export const DESKTOP_CAPABILITIES: readonly Capability<
  never,
  never,
  DesktopExecCtx,
  DesktopScope
>[] = Object.freeze([
  desktopSpawnCapability,
  desktopDestroyCapability,
  desktopHibernateCapability,
  desktopAttachCapability,
] as unknown as readonly Capability<never, never, DesktopExecCtx, DesktopScope>[]);
