/**
 * desktop.test.ts — the four E5 Cloud Desktop capabilities (RFC §5.1) as registry data.
 *
 * Pins the safety-load-bearing facts: the id set, risk/reversibility/cost declared as DATA
 * (INV-4/§5.2), the fails-closed provider floor (INV-5), and that execute() is a pure delegation
 * to the injected provider port (no provisioning code in substrate).
 */
import { describe, expect, it, vi } from "vitest";

import {
  createCapabilityRegistry,
  type Capability,
} from "../capability.js";
import {
  DESKTOP_CAPABILITIES,
  desktopSpawnCapability,
  desktopAttachCapability,
  desktopHibernateCapability,
  desktopDestroyCapability,
  failClosedDesktopProvider,
  type DesktopExecCtx,
  type DesktopScope,
  type DesktopProvider,
} from "../desktop.js";

describe("desktop capabilities — the E5 lifecycle spine (RFC §5.1)", () => {
  it("declares exactly the four lifecycle ids", () => {
    expect([...DESKTOP_CAPABILITIES].map((c) => c.id).sort()).toEqual([
      "desktop.attach",
      "desktop.destroy",
      "desktop.hibernate",
      "desktop.spawn",
    ]);
  });

  it("declares risk + reversibility as DATA — spawn/destroy are the irreversible confirm class (INV-4/§5.2)", () => {
    expect(desktopSpawnCapability).toMatchObject({ risk: "exec", reversibility: "irreversible", cost: "expensive" });
    expect(desktopDestroyCapability).toMatchObject({ risk: "exec", reversibility: "irreversible" });
    // The reversible verbs declare no reversibility (absent ⇒ reversible) — prompt-light.
    expect(desktopAttachCapability.reversibility).toBeUndefined();
    expect(desktopHibernateCapability.reversibility).toBeUndefined();
    expect(desktopAttachCapability.risk).toBe("read");
    expect(desktopHibernateCapability.risk).toBe("write");
  });

  it("the fails-closed provider refuses every verb (INV-5: no provider ⇒ nothing provisions)", async () => {
    await expect(failClosedDesktopProvider.spawn({ provider: "hetzner", region: "nbg1", shape: "cx" })).rejects.toThrow(
      /no provider configured/,
    );
    await expect(failClosedDesktopProvider.attach({ sessionId: "s1" })).rejects.toThrow(/no provider configured/);
    await expect(failClosedDesktopProvider.hibernate({ sessionId: "s1" })).rejects.toThrow(/no provider configured/);
    await expect(failClosedDesktopProvider.destroy({ sessionId: "s1" })).rejects.toThrow(/no provider configured/);
  });

  it("execute() is a pure delegation to the injected provider port — no provisioning in substrate", async () => {
    const provider: DesktopProvider = {
      spawn: vi.fn(async () => ({ sessionId: "s-new", status: "provisioning" as const })),
      attach: vi.fn(async () => ({ sessionId: "s1", status: "running" as const, gatewayUrl: "https://gw.example.com" })),
      hibernate: vi.fn(async () => ({ sessionId: "s1", status: "hibernated" as const })),
      destroy: vi.fn(async () => ({ sessionId: "s1", status: "destroyed" as const })),
    };
    const ctx: DesktopExecCtx = { provider };
    expect(await desktopSpawnCapability.execute({ provider: "hetzner", region: "nbg1", shape: "cx" }, ctx)).toEqual({
      sessionId: "s-new",
      status: "provisioning",
    });
    expect(provider.spawn).toHaveBeenCalledOnce();
    expect(await desktopDestroyCapability.execute({ sessionId: "s1" }, ctx)).toMatchObject({ status: "destroyed" });
    expect(provider.destroy).toHaveBeenCalledWith({ sessionId: "s1" });
  });

  it("scope names the verb + target, never a filesystem path (INV-11: opaque, not parsed for authz)", () => {
    expect(desktopAttachCapability.scope({ sessionId: "opaque-123" })).toEqual({
      action: "desktop.attach",
      sessionId: "opaque-123",
    });
  });

  it("folds into a registry and projects an outward manifest (INV-1: one declaration, many consumers)", () => {
    const registry = createCapabilityRegistry<DesktopExecCtx, DesktopScope>(DESKTOP_CAPABILITIES);
    const manifest = registry.list();
    const spawn = manifest.find((e) => e.id === "desktop.spawn");
    expect(spawn).toHaveProperty("reversibility", "irreversible");
    // The reversible verb carries no reversibility key in the outward projection (§5.2).
    expect(manifest.find((e) => e.id === "desktop.attach")).not.toHaveProperty("reversibility");
  });
});

// Silence unused-type lint by asserting the array's element type is a real Capability.
const _typecheck: readonly Capability<never, never, DesktopExecCtx, DesktopScope>[] = DESKTOP_CAPABILITIES;
void _typecheck;
