/**
 * canon-toolbar.test.tsx — CanonToolbar (RCNV-03 / Phase 63): the floating
 * curation bar's rendered contract (appears only with a canon selection,
 * "Add N to canon" counts promotable cards only, clear-selection wiring)
 * plus `promoteSourcesToCanon`'s sequencing/partial-failure contract
 * (standalone, mirrors knowledge-graph.tsx's promoteEdge test posture).
 *
 * Mounts the REAL component (createRoot-in-jsdom + `act`, mirrors
 * source-node.test.tsx). No trpc/sonner mocks needed — the toolbar imports
 * neither; the promotion gate is reached through a plain fetch to the
 * server-side-keyed proxy route, stubbed per test via the injectable
 * `fetchImpl` / a global fetch stub.
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Node as FlowNode } from "@xyflow/react";

import {
  CanonToolbar,
  DEFAULT_CANON_IMPORTER_ID,
  promoteSourcesToCanon,
} from "../canon-toolbar";
import type { CanonEntry } from "../canon-selection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const LEDGER_A = "550e8400-e29b-41d4-a716-446655440000";
const LEDGER_B = "550e8400-e29b-41d4-a716-446655440001";

function sourceNode(
  ledgerId: string,
  overrides: Partial<FlowNode> = {},
): FlowNode {
  return {
    id: `source:${ledgerId}`,
    type: "source",
    position: { x: 0, y: 0 },
    data: {
      sourceLedgerId: ledgerId,
      url: "https://example.com/a",
      title: "A source",
      tier: "suggested",
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// promoteSourcesToCanon — standalone contract
// ---------------------------------------------------------------------------

function entry(ledgerId: string): CanonEntry {
  return {
    nodeId: `source:${ledgerId}`,
    sourceLedgerId: ledgerId,
    tier: "suggested",
  };
}

function okResponse(): Response {
  return new Response(JSON.stringify({ status: "captured" }), { status: 200 });
}

function errorResponse(status: number, error?: string): Response {
  return new Response(JSON.stringify(error !== undefined ? { error } : {}), {
    status,
  });
}

describe("promoteSourcesToCanon", () => {
  it("POSTs each ledger id to the promotion proxy with the importer id", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const outcome = await promoteSourcesToCanon(
      [entry(LEDGER_A), entry(LEDGER_B)],
      DEFAULT_CANON_IMPORTER_ID,
      fetchImpl as unknown as typeof fetch,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      `/api/chat/sources/${LEDGER_A}/promote`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importerId: DEFAULT_CANON_IMPORTER_ID }),
      },
    );
    expect(outcome.promotedNodeIds).toEqual([
      `source:${LEDGER_A}`,
      `source:${LEDGER_B}`,
    ]);
    expect(outcome.failures).toEqual([]);
  });

  it("partial failure: promoted ids and failures are attributed per node", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes(LEDGER_A)
        ? okResponse()
        : errorResponse(409, "This suggestion can no longer be promoted."),
    );
    const outcome = await promoteSourcesToCanon(
      [entry(LEDGER_A), entry(LEDGER_B)],
      DEFAULT_CANON_IMPORTER_ID,
      fetchImpl as unknown as typeof fetch,
    );

    expect(outcome.promotedNodeIds).toEqual([`source:${LEDGER_A}`]);
    expect(outcome.failures).toEqual([
      {
        nodeId: `source:${LEDGER_B}`,
        errorMessage: "This suggestion can no longer be promoted.",
      },
    ]);
  });

  it("a network throw degrades to a friendly failure, never an unhandled rejection", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("boom");
    });
    const outcome = await promoteSourcesToCanon(
      [entry(LEDGER_A)],
      DEFAULT_CANON_IMPORTER_ID,
      fetchImpl as unknown as typeof fetch,
    );
    expect(outcome.promotedNodeIds).toEqual([]);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]?.errorMessage).toContain("could not be added");
  });

  it("a non-ok response without a JSON error body still fails cleanly", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const outcome = await promoteSourcesToCanon(
      [entry(LEDGER_A)],
      DEFAULT_CANON_IMPORTER_ID,
      fetchImpl as unknown as typeof fetch,
    );
    expect(outcome.failures).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// CanonToolbar — rendered contract
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

function findButton(
  container: HTMLElement,
  match: (b: HTMLButtonElement) => boolean,
): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find(match);
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  for (const c of containers) c.remove();
  containers = [];
  globalThis.fetch = realFetch;
});

describe("CanonToolbar", () => {
  it("renders NO toolbar when no source node is selected (a selected chat node does not count)", async () => {
    const nodes: FlowNode[] = [
      sourceNode(LEDGER_A),
      {
        id: "chat:conv-1",
        type: "chat",
        position: { x: 0, y: 0 },
        data: {},
        selected: true,
      },
    ];
    const container = await mount(
      <CanonToolbar nodes={nodes} setNodes={vi.fn()} />,
    );
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
  });

  it("appears with >=1 selected source: count, 'Add N to canon', and clear — one card, zero shadow", async () => {
    const nodes = [
      sourceNode(LEDGER_A, { selected: true }),
      sourceNode(LEDGER_B, { selected: true }),
    ];
    const container = await mount(
      <CanonToolbar nodes={nodes} setNodes={vi.fn()} />,
    );

    const toolbar = container.querySelector('[role="toolbar"]');
    expect(toolbar).not.toBeNull();
    expect(toolbar!.getAttribute("aria-label")).toBe("Canon curation");
    // The canvas's one chrome language: bright card, rule hairline, no shadow.
    const toolbarClass = toolbar!.getAttribute("class") ?? "";
    expect(toolbarClass).toContain("bg-bright");
    expect(toolbarClass).toContain("border-rule");
    expect(toolbarClass).not.toMatch(/\bshadow-/);

    expect(container.textContent).toContain("2 sources selected");
    expect(
      findButton(container, (b) => (b.textContent ?? "").includes("Add 2 to canon")),
    ).toBeDefined();
    expect(
      findButton(container, (b) => b.getAttribute("aria-label") === "Clear selection"),
    ).toBeDefined();
  });

  it("N counts only PROMOTABLE cards: an already-confirmed selection disables the action", async () => {
    const nodes = [
      sourceNode(LEDGER_A, {
        selected: true,
        data: { sourceLedgerId: LEDGER_A, tier: "confirmed" },
      }),
    ];
    const container = await mount(
      <CanonToolbar nodes={nodes} setNodes={vi.fn()} />,
    );
    const button = findButton(container, (b) =>
      (b.textContent ?? "").includes("Already in canon"),
    );
    expect(button).toBeDefined();
    expect(button!.disabled).toBe(true);
  });

  it("mixed selection: N counts the suggested card only", async () => {
    const nodes = [
      sourceNode(LEDGER_A, { selected: true }),
      sourceNode(LEDGER_B, {
        selected: true,
        data: { sourceLedgerId: LEDGER_B, tier: "confirmed" },
      }),
    ];
    const container = await mount(
      <CanonToolbar nodes={nodes} setNodes={vi.fn()} />,
    );
    expect(container.textContent).toContain("2 sources selected");
    expect(
      findButton(container, (b) => (b.textContent ?? "").includes("Add 1 to canon")),
    ).toBeDefined();
  });

  it("clear-selection deselects the source nodes through setNodes", async () => {
    const nodes = [
      sourceNode(LEDGER_A, { selected: true }),
      sourceNode(LEDGER_B, { selected: true }),
    ];
    const setNodes = vi.fn();
    const container = await mount(
      <CanonToolbar nodes={nodes} setNodes={setNodes} />,
    );

    await act(async () => {
      findButton(
        container,
        (b) => b.getAttribute("aria-label") === "Clear selection",
      )!.click();
    });

    expect(setNodes).toHaveBeenCalledTimes(1);
    const updater = setNodes.mock.calls[0]?.[0] as (
      prev: FlowNode[],
    ) => FlowNode[];
    const next = updater(nodes);
    expect(next.every((n) => n.selected !== true)).toBe(true);
  });

  it("Add-to-canon: a successful promotion flips tier to confirmed, deselects the promoted card, and fires onPromotionSettled", async () => {
    const nodes = [sourceNode(LEDGER_A, { selected: true })];
    const setNodes = vi.fn();
    const onPromotionSettled = vi.fn();
    globalThis.fetch = vi.fn(async () => okResponse()) as unknown as typeof fetch;

    const container = await mount(
      <CanonToolbar
        nodes={nodes}
        setNodes={setNodes}
        onPromotionSettled={onPromotionSettled}
      />,
    );

    await act(async () => {
      findButton(container, (b) =>
        (b.textContent ?? "").includes("Add 1 to canon"),
      )!.click();
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `/api/chat/sources/${LEDGER_A}/promote`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(onPromotionSettled).toHaveBeenCalledTimes(1);

    expect(setNodes).toHaveBeenCalledTimes(1);
    const updater = setNodes.mock.calls[0]?.[0] as (
      prev: FlowNode[],
    ) => FlowNode[];
    const next = updater(nodes);
    const promoted = next.find((n) => n.id === `source:${LEDGER_A}`);
    expect((promoted?.data as { tier?: string }).tier).toBe("confirmed");
    expect(promoted?.selected).toBe(false);

    // ...and the polite live region announced the result.
    expect(container.textContent).toContain("Added 1 source to canon");
  });

  it("a failed promotion NEVER flips the tier (no fabricated confirmation) and keeps the card selected for retry", async () => {
    const nodes = [sourceNode(LEDGER_A, { selected: true })];
    const setNodes = vi.fn();
    const onPromotionSettled = vi.fn();
    globalThis.fetch = vi.fn(async () =>
      errorResponse(409, "This suggestion can no longer be promoted."),
    ) as unknown as typeof fetch;

    const container = await mount(
      <CanonToolbar
        nodes={nodes}
        setNodes={setNodes}
        onPromotionSettled={onPromotionSettled}
      />,
    );

    await act(async () => {
      findButton(container, (b) =>
        (b.textContent ?? "").includes("Add 1 to canon"),
      )!.click();
    });

    // Nothing succeeded → no node update, no save, selection intact.
    expect(setNodes).not.toHaveBeenCalled();
    expect(onPromotionSettled).not.toHaveBeenCalled();
    expect(container.textContent).toContain("1 failed");
  });

  it("partial failure: only the confirmed card flips + deselects; the failed one stays selected", async () => {
    const nodes = [
      sourceNode(LEDGER_A, { selected: true }),
      sourceNode(LEDGER_B, { selected: true }),
    ];
    const setNodes = vi.fn();
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes(LEDGER_A) ? okResponse() : errorResponse(500),
    ) as unknown as typeof fetch;

    const container = await mount(
      <CanonToolbar nodes={nodes} setNodes={setNodes} />,
    );

    await act(async () => {
      findButton(container, (b) =>
        (b.textContent ?? "").includes("Add 2 to canon"),
      )!.click();
    });

    const updater = setNodes.mock.calls[0]?.[0] as (
      prev: FlowNode[],
    ) => FlowNode[];
    const next = updater(nodes);
    const promoted = next.find((n) => n.id === `source:${LEDGER_A}`);
    const failed = next.find((n) => n.id === `source:${LEDGER_B}`);
    expect((promoted?.data as { tier?: string }).tier).toBe("confirmed");
    expect(promoted?.selected).toBe(false);
    expect((failed?.data as { tier?: string }).tier).toBe("suggested");
    expect(failed?.selected).toBe(true);
  });
});
