/**
 * client-capability-registry.test.tsx — Stream #2 (REG-04): the web tier's
 * client-executable registry, tested end-to-end through the LIVE boundary.
 *
 * Proves the three things the wiring must guarantee:
 *   1. The registry wires ONLY the safe tRPC-backed control-plane capabilities —
 *      the canvas triple + the table pair — and NONE of the daemon-only ids
 *      (`fs.*` / `terminal.exec` / `git` / `browser.*` / `dir.*` / `desktop.*`).
 *   2. A canvas capability binding → confirm card → approve actually fires the
 *      right tRPC mutation (via `ChatCapabilityInvokerProvider`, which forwards to
 *      `api.useUtils().client.*.mutate`). Never on render — only from an approve.
 *   3. A daemon-only id stays DARK: the boundary renders nothing for it (fail
 *      closed, INV-5) even with a real invoker wired.
 *
 * The tRPC client is mocked at `~/trpc/react` (the same seam the app's provider
 * reads) so the executors' `api.*.mutate` calls are captured spies.
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CapabilityBindingBoundary,
  CapabilityInvokerProvider,
} from "../capability-binding-boundary";
import {
  buildClientCapabilityInvoker,
  createClientCapabilityRegistry,
  type ClientCapabilityMutations,
} from "../client-capability-registry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// tRPC client seam — captured spies for every wired mutation
// ---------------------------------------------------------------------------

const addCanvasNode = vi.fn(async (_input: unknown) => ({
  nodeId: "email-thread:11111111-1111-4111-8111-111111111111",
  nodeType: "email-thread",
  created: true,
}));
const connectCanvasNodes = vi.fn(async (_input: unknown) => ({ edgeId: "edge:x", created: true }));
const removeCanvasNode = vi.fn(async (_input: unknown) => ({
  removed: true,
  node: null,
  detachedEdges: [],
}));
const createTable = vi.fn(async (_input: unknown) => ({
  spreadsheetId: "22222222-2222-4222-8222-222222222222",
  created: true as const,
}));
const updateTable = vi.fn(async (_input: unknown) => ({
  spreadsheetId: "22222222-2222-4222-8222-222222222222",
  updated: true,
}));

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      client: {
        chat: {
          addCanvasNode: { mutate: addCanvasNode },
          connectCanvasNodes: { mutate: connectCanvasNodes },
          removeCanvasNode: { mutate: removeCanvasNode },
        },
        spreadsheets: {
          create: { mutate: createTable },
          update: { mutate: updateTable },
        },
      },
    }),
  },
}));

// Imported AFTER the mock is declared (vi.mock is hoisted, but keep it explicit).
import { ChatCapabilityInvokerProvider } from "../chat-capability-invoker-provider";

// ---------------------------------------------------------------------------
// jsdom mount harness (mirrors capability-binding-boundary.test.tsx)
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
  // Flush the resolver's async invoke → mutation round-trip → output parse.
  await act(async () => {
    await Promise.resolve();
  });
}

const approveButton = (c: HTMLElement): HTMLButtonElement | null =>
  c.querySelector<HTMLButtonElement>('button[aria-label^="Approve"]');

afterEach(() => {
  for (const c of containers) document.body.removeChild(c);
  containers = [];
  vi.clearAllMocks();
});

const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const SPREADSHEET_ID = "22222222-2222-4222-8222-222222222222";
// A canonical `type:ref` node id (canvas-mutations.ts's canonicalNodeId scheme).
const NODE_ID = "email-thread:44444444-4444-4444-8444-444444444444";

// ---------------------------------------------------------------------------
// The registry only contains the safe tRPC-backed ids
// ---------------------------------------------------------------------------

describe("createClientCapabilityRegistry", () => {
  it("registers ONLY the five safe control-plane capabilities", () => {
    const registry = createClientCapabilityRegistry();
    expect([...registry.ids].sort()).toEqual([
      "canvas.addNode",
      "canvas.connect",
      "canvas.removeNode",
      "table.create",
      "table.update",
    ]);
  });

  it("leaves every daemon-only capability UNREGISTERED (fail closed, INV-5)", () => {
    const registry = createClientCapabilityRegistry();
    for (const daemonId of [
      "fs.read",
      "fs.write",
      "fs.list",
      "terminal.exec",
      "git",
      "browser.open",
      "browser.navigate",
      "browser.screenshot",
      "dir.list_tree",
      "desktop.spawn",
      "desktop.destroy",
    ]) {
      expect(registry.get(daemonId)).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// binding → confirm card → approve fires the real tRPC mutation
// ---------------------------------------------------------------------------

describe("CapabilityBindingBoundary + ChatCapabilityInvokerProvider (live REG-04 path)", () => {
  it("a canvas.removeNode binding renders a confirm card whose approve fires api.chat.removeCanvasNode.mutate", async () => {
    // canvas.removeNode's input is FLAT (conversationId + nodeId strings), so it
    // is fully expressible as the primitive-only static args a binding carries —
    // the boundary invokes with `binding.args` alone.
    const container = await mount(
      <ChatCapabilityInvokerProvider>
        <CapabilityBindingBoundary
          binding={{
            capabilityId: "canvas.removeNode",
            args: { conversationId: CONVERSATION_ID, nodeId: NODE_ID },
          }}
        />
      </ChatCapabilityInvokerProvider>,
    );

    // Card mounted with the write tier's vocabulary; nothing fired on render.
    expect(container.querySelector('[role="group"]')).not.toBeNull();
    expect(container.textContent).toContain("canvas.removeNode");
    expect(container.textContent).toContain("Changes data");
    expect(removeCanvasNode).not.toHaveBeenCalled();

    await click(approveButton(container)!);

    // The resolver's Zod-fenced invoke ran the descriptor's execute, which
    // forwarded to the real tRPC mutation with the parsed input.
    expect(removeCanvasNode).toHaveBeenCalledTimes(1);
    expect(removeCanvasNode).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      nodeId: NODE_ID,
    });
    // Only the canvas mutation fired — not the table one.
    expect(updateTable).not.toHaveBeenCalled();
    // Output parsed clean against the descriptor's output schema — no error row.
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("a table.update binding's approve fires api.spreadsheets.update.mutate", async () => {
    // A title-only table.update is flat (spreadsheetId + title strings).
    const container = await mount(
      <ChatCapabilityInvokerProvider>
        <CapabilityBindingBoundary
          binding={{
            capabilityId: "table.update",
            args: { spreadsheetId: SPREADSHEET_ID, title: "Renamed" },
          }}
        />
      </ChatCapabilityInvokerProvider>,
    );

    await click(approveButton(container)!);

    expect(updateTable).toHaveBeenCalledTimes(1);
    expect(updateTable).toHaveBeenCalledWith({
      spreadsheetId: SPREADSHEET_ID,
      title: "Renamed",
    });
    expect(removeCanvasNode).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("a DAEMON-ONLY id stays dark: the boundary renders nothing and fires no mutation", async () => {
    const container = await mount(
      <ChatCapabilityInvokerProvider>
        <CapabilityBindingBoundary
          binding={{ capabilityId: "fs.write", args: { path: "/etc/passwd" } }}
        />
      </ChatCapabilityInvokerProvider>,
    );

    // Unregistered → no confirm affordance at all (fail closed).
    expect(container.querySelector('[role="group"]')).toBeNull();
    expect(container.textContent).toBe("");
    expect(addCanvasNode).not.toHaveBeenCalled();
    expect(createTable).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// buildClientCapabilityInvoker — the pure assembly (no React)
// ---------------------------------------------------------------------------

describe("buildClientCapabilityInvoker", () => {
  it("returns an invoker whose registry resolves a wired id and whose ctx carries the store", async () => {
    const mutations: ClientCapabilityMutations = {
      addCanvasNode,
      connectCanvasNodes,
      removeCanvasNode,
      createTable,
      updateTable,
    };
    const invoker = buildClientCapabilityInvoker(mutations);
    expect(invoker.registry.get("canvas.connect")).toBeDefined();
    expect(invoker.registry.get("terminal.exec")).toBeUndefined();
    // ctx carries the store the descriptors execute against.
    expect(invoker.ctx).toHaveProperty("store");
  });
});
