/**
 * capability-binding-boundary.test.tsx — the LIVE D2 mount, tested (REG-04).
 *
 * Proves the whole path this wave wires:
 *   - extractCapabilityBinding: a spec that NAMES a capability yields the
 *     validated binding + a spec stripped of the `capability` key; a spec that
 *     names none returns the SAME reference + null (the byte-identical additive
 *     guarantee); a malformed field fails closed (stripped, null binding).
 *   - CapabilityBindingBoundary mounts the confirm card ONLY behind a wired
 *     invoker and a RESOLVING id, and an approve runs the REAL capability
 *     through the resolver's Zod-fenced invoker (INV-1) — not a hand-rolled
 *     execute.
 *   - FAIL CLOSED (INV-5): no invoker provider, or an unregistered id, renders
 *     nothing at all — no confirm for something that could never run.
 *   - a refused invocation (execute throws) surfaces inline, ink-only.
 *
 * Mounts the REAL components against a REAL `createCapabilityRegistry` (mirrors
 * bind-capability.test.ts's in-test registry) + this repo's createRoot-in-jsdom
 * + `act` convention (capability-confirm-card.test.tsx).
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  createCapabilityRegistry,
  defineCapability,
  type Capability,
} from "@polytoken/capabilities";

import {
  CapabilityBindingBoundary,
  CapabilityInvokerProvider,
  extractCapabilityBinding,
  type CapabilityInvoker,
} from "../capability-binding-boundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// In-test executable registry — a write capability (a real mutation, gated by
// INV-4) and a read capability (no confirm). Mirrors bind-capability.test.ts.
// ---------------------------------------------------------------------------

type TestCtx = { readonly tenant: string };
type TestScope = { readonly touches: readonly string[] };

const writeExecute = vi.fn(async (_input: { path: string }, ctx: TestCtx) => ({
  written: `${ctx.tenant}:ok`,
}));

const fsWrite = defineCapability<{ path: string }, { written: string }, TestCtx, TestScope>({
  id: "fs.write",
  input: z.object({ path: z.string().min(1) }).strict(),
  output: z.object({ written: z.string() }).strict(),
  risk: "write",
  cost: "cheap",
  describe: "Write a file inside the granted directory.",
  source: "builtin",
  trust: "first-party",
  scope: (input) => ({ touches: [input.path] }),
  execute: writeExecute,
});

const fsRead = defineCapability<{ path: string }, { body: string }, TestCtx, TestScope>({
  id: "fs.read",
  input: z.object({ path: z.string().min(1) }).strict(),
  output: z.object({ body: z.string() }).strict(),
  risk: "read",
  cost: "cheap",
  describe: "Read a file inside the granted directory.",
  source: "builtin",
  trust: "first-party",
  scope: (input) => ({ touches: [input.path] }),
  execute: async () => ({ body: "hello" }),
});

const throwingWrite = defineCapability<{ path: string }, { written: string }, TestCtx, TestScope>({
  id: "fs.write",
  input: z.object({ path: z.string().min(1) }).strict(),
  output: z.object({ written: z.string() }).strict(),
  risk: "write",
  cost: "cheap",
  describe: "Write a file inside the granted directory.",
  source: "builtin",
  trust: "first-party",
  scope: (input) => ({ touches: [input.path] }),
  execute: async () => {
    throw new Error("daemon offline");
  },
});

const caps = [fsWrite, fsRead] as unknown as readonly Capability<never, never, TestCtx, TestScope>[];
const registry = createCapabilityRegistry<TestCtx, TestScope>(caps);
const invoker: CapabilityInvoker = { registry, ctx: { tenant: "acme" } as TestCtx };

// ---------------------------------------------------------------------------
// jsdom mount harness
// ---------------------------------------------------------------------------

let containers: HTMLDivElement[] = [];

async function mount(element: React.ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return container;
}

async function click(button: Element): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

const approveButton = (c: HTMLElement): HTMLButtonElement | null =>
  c.querySelector<HTMLButtonElement>('button[aria-label^="Approve"]');

afterEach(() => {
  for (const c of containers) document.body.removeChild(c);
  containers = [];
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// extractCapabilityBinding — the emit-path parse
// ---------------------------------------------------------------------------

describe("extractCapabilityBinding", () => {
  it("returns the SAME spec reference + null binding when no capability field (additive path)", () => {
    const spec = { v: 1, root: { type: "text", text: "hi" } } as const;
    const result = extractCapabilityBinding(spec);
    expect(result.binding).toBeNull();
    // Same reference — JSON.stringify is byte-identical downstream.
    expect(result.spec).toBe(spec);
  });

  it("splits a valid capability binding off and strips the key from the spec", () => {
    const spec = {
      v: 1,
      capability: { capabilityId: "fs.write", args: { path: "/notes.md" } },
      root: { type: "text", text: "hi" },
    };
    const result = extractCapabilityBinding(spec);
    expect(result.binding).toEqual({ capabilityId: "fs.write", args: { path: "/notes.md" } });
    // The renderable spec no longer carries `capability` — a .strict() SpecRoot parses it.
    expect("capability" in result.spec).toBe(false);
    expect(result.spec).toMatchObject({ v: 1, root: { type: "text", text: "hi" } });
  });

  it("fails closed on a malformed capability field: null binding, field stripped", () => {
    const spec = { v: 1, capability: { notAnId: true }, root: { type: "text", text: "hi" } };
    const result = extractCapabilityBinding(spec);
    expect(result.binding).toBeNull();
    expect("capability" in result.spec).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CapabilityBindingBoundary — mount + resolver invocation
// ---------------------------------------------------------------------------

describe("CapabilityBindingBoundary", () => {
  it("mounts the confirm card for a resolving write binding and runs approve through the resolver", async () => {
    const container = await mount(
      <CapabilityInvokerProvider value={invoker}>
        <CapabilityBindingBoundary binding={{ capabilityId: "fs.write", args: { path: "/notes.md" } }} />
      </CapabilityInvokerProvider>,
    );

    // Card mounted with the write tier's own vocabulary (source-of-truth risk
    // projected from the SAME registry the resolver binds against).
    const card = container.querySelector('[role="group"]');
    expect(card).not.toBeNull();
    expect(container.textContent).toContain("fs.write");
    expect(container.textContent).toContain("Changes data");

    await click(approveButton(container)!);

    // The resolver's Zod-fenced invoker ran the REAL execute (INV-1) with the
    // parsed args + the injected ctx.
    expect(writeExecute).toHaveBeenCalledTimes(1);
    expect(writeExecute).toHaveBeenCalledWith({ path: "/notes.md" }, { tenant: "acme" });
    // No error row on success.
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("FAILS CLOSED (INV-5): an unregistered id renders nothing at all", async () => {
    const container = await mount(
      <CapabilityInvokerProvider value={invoker}>
        <CapabilityBindingBoundary binding={{ capabilityId: "not.registered" }} />
      </CapabilityInvokerProvider>,
    );
    expect(container.querySelector('[role="group"]')).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("FAILS CLOSED: no invoker provider wired renders nothing (never a confirm for a runtime that can't run)", async () => {
    const container = await mount(
      <CapabilityBindingBoundary binding={{ capabilityId: "fs.write", args: { path: "/notes.md" } }} />,
    );
    expect(container.querySelector('[role="group"]')).toBeNull();
    expect(container.textContent).toBe("");
    expect(writeExecute).not.toHaveBeenCalled();
  });

  it("renders NOTHING for a read-tier binding (the card's one risk gate — no confirm, no auto-invoke on render)", async () => {
    const container = await mount(
      <CapabilityInvokerProvider value={invoker}>
        <CapabilityBindingBoundary binding={{ capabilityId: "fs.read", args: { path: "/notes.md" } }} />
      </CapabilityInvokerProvider>,
    );
    // read never confirms — the card renders null, so there is no approve
    // affordance and nothing can run on render.
    expect(container.querySelector('[role="group"]')).toBeNull();
    expect(approveButton(container)).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("surfaces a refused invocation inline (execute throws → resolver returns not-ok)", async () => {
    const throwingRegistry = createCapabilityRegistry<TestCtx, TestScope>([
      throwingWrite,
    ] as unknown as readonly Capability<never, never, TestCtx, TestScope>[]);
    const container = await mount(
      <CapabilityInvokerProvider value={{ registry: throwingRegistry, ctx: { tenant: "acme" } }}>
        <CapabilityBindingBoundary binding={{ capabilityId: "fs.write", args: { path: "/notes.md" } }} />
      </CapabilityInvokerProvider>,
    );

    await click(approveButton(container)!);

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    // Ink-only (law 1) — the row carries no accent/destructive palette class.
    expect(alert!.querySelector("span")!.className).toContain("text-ink");
  });
});
