import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createCapabilityRegistry,
  defineCapability,
  type Capability,
} from "../capability.js";

/**
 * A minimal test context + scope shape standing in for a consumer's binding (the daemon binds
 * ExecCtx + a filesystem scope; here we bind trivial ones). The registry machinery is generic over
 * both, so these tests exercise the SAME code every consumer resolves through.
 */
type TestCtx = { readonly now: number };
type TestScope = { readonly touches: readonly string[] };

const echo = defineCapability<{ value: string }, { echoed: string }, TestCtx, TestScope>({
  id: "test.echo",
  input: z.object({ value: z.string() }).strict(),
  output: z.object({ echoed: z.string() }).strict(),
  risk: "read",
  cost: "free",
  describe: "Echoes its input value back — a trivial capability for exercising the registry.",
  source: "builtin",
  trust: "first-party",
  scope: (input) => ({ touches: [input.value] }),
  execute: async (input) => ({ echoed: input.value }),
});

const writer = defineCapability<{ path: string }, { bytes: number }, TestCtx, TestScope>({
  id: "test.write",
  input: z.object({ path: z.string() }).strict(),
  output: z.object({ bytes: z.number() }).strict(),
  risk: "write",
  cost: "cheap",
  describe: "Pretends to write a file, returning a byte count. Exercises a non-read risk tier.",
  source: "builtin",
  trust: "first-party",
  scope: (input) => ({ touches: [input.path] }),
  execute: async () => ({ bytes: 3 }),
});

describe("defineCapability", () => {
  it("freezes the descriptor so a consumer cannot mutate a shared capability", () => {
    expect(Object.isFrozen(echo)).toBe(true);
  });

  it("carries the INV-1 frozen field names (the four-consumer contract)", () => {
    for (const field of ["id", "input", "output", "risk", "cost", "describe", "source", "trust"]) {
      expect(echo).toHaveProperty(field);
    }
  });

  it("declares INV-3 source/trust constants", () => {
    expect(echo.source).toBe("builtin");
    expect(echo.trust).toBe("first-party");
  });
});

describe("createCapabilityRegistry", () => {
  const registry = createCapabilityRegistry<TestCtx, TestScope>([echo, writer]);

  it("resolves by id — a lookup, not a switch (INV-2)", () => {
    expect(registry.get("test.echo")?.id).toBe("test.echo");
    expect(registry.get("test.write")?.id).toBe("test.write");
  });

  it("enumerates its ids", () => {
    expect([...registry.ids].sort()).toEqual(["test.echo", "test.write"]);
  });

  it("throws on a duplicate id — ambiguity is a permission bug waiting to happen", () => {
    expect(() => createCapabilityRegistry<TestCtx, TestScope>([echo, echo])).toThrow(
      /duplicate capability id "test.echo"/,
    );
  });

  it("empty registry resolves nothing (no capabilities = no universe)", () => {
    const empty = createCapabilityRegistry<TestCtx, TestScope>([]);
    expect(empty.ids).toEqual([]);
    expect(empty.get("test.echo")).toBeUndefined();
  });

  describe("list() — the registry pointed outward (INV-1/INV-3)", () => {
    const manifest = registry.list();

    it("projects metadata for every capability", () => {
      expect(manifest.map((e) => e.id).sort()).toEqual(["test.echo", "test.write"]);
      const echoEntry = manifest.find((e) => e.id === "test.echo");
      expect(echoEntry).toMatchObject({
        describe: echo.describe,
        risk: "read",
        cost: "free",
        source: "builtin",
        trust: "first-party",
      });
    });

    it("carries NO executable coupling — an LLM/genui/canvas cannot run anything from the manifest", () => {
      for (const entry of manifest) {
        expect(entry).not.toHaveProperty("execute");
        expect(entry).not.toHaveProperty("scope");
        expect(entry).not.toHaveProperty("input");
      }
    });
  });

  describe("INV-5 — an unregistered capability fails closed from every consumer", () => {
    /**
     * The single most important invariant: a genui spec (or any consumer) naming a capability id
     * that is NOT in the registry must resolve to `undefined`, never a partial or a silent no-op.
     * Every consumer's contract is "if get() is undefined, refuse". This proves the registry side of
     * that contract — the id simply does not resolve — so a consumer that guards on it fails closed.
     */
    it("get() returns undefined for an id that was never registered", () => {
      expect(registry.get("test.delete_everything")).toBeUndefined();
      expect(registry.get("")).toBeUndefined();
      expect(registry.get("TEST.ECHO")).toBeUndefined(); // ids are exact, not case-folded
    });

    it("a consumer's fail-closed guard has something concrete to refuse on", () => {
      // Models the exact shape a genui binder / tool-loop resolver uses:
      const resolve = (id: string): Capability<never, never, TestCtx, TestScope> => {
        const cap = registry.get(id);
        if (!cap) throw new Error(`unregistered capability "${id}" — refused`);
        return cap;
      };
      expect(() => resolve("test.ghost")).toThrow(/unregistered capability "test.ghost" — refused/);
      expect(resolve("test.echo").id).toBe("test.echo");
    });
  });
});
