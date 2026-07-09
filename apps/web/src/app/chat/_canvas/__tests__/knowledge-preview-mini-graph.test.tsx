/**
 * knowledge-preview-mini-graph.test.tsx — KnowledgePreviewMiniGraph (PREV-01,
 * 41-UI-SPEC.md sections 2/4/5): all 5 render-state branches (loading, error,
 * empty-not-found, empty-no-connections, success), href computation via
 * `hrefFor`, over-cap trim, tier encoding parity with `/knowledge`, and focus
 * emphasis.
 *
 * Mounts the REAL component — mirrors this repo's createRoot-in-jsdom + `act`
 * convention (provenance-link.test.tsx, interactive-widget-canvas.test.tsx).
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { hrefFor } from "~/components/provenance-link";

import {
  KnowledgePreviewMiniGraph,
  type PreviewSourceEdge,
  type PreviewSourceNode,
} from "../knowledge-preview-mini-graph";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FOCUS_ID = "00000000-0000-0000-0000-000000000001";

function node(id: string, label: string): PreviewSourceNode {
  return { id, type: "knowledge_node", label } as PreviewSourceNode;
}

function edge(
  id: string,
  source: string,
  target: string,
  tier?: string,
): PreviewSourceEdge {
  return { id, source, target, relationType: "related", tier } as PreviewSourceEdge;
}

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

afterEach(() => {
  for (const c of containers) {
    document.body.removeChild(c);
  }
  containers = [];
});

describe("KnowledgePreviewMiniGraph", () => {
  // Test 1
  it("loading: renders role=status + aria-label, exactly 3 Skeleton circles, no svg/EmptyState", async () => {
    const container = await mount(
      <KnowledgePreviewMiniGraph
        focusNodeId={FOCUS_ID}
        nodes={[]}
        edges={[]}
        isLoading
        isError={false}
        onRetry={vi.fn()}
      />,
    );

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.getAttribute("aria-label")).toBe("Loading knowledge preview");
    expect(status?.querySelectorAll(".rounded-full").length).toBe(3);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector(".text-base.font-semibold")).toBeNull();
  });

  // Test 2
  it("error: renders EmptyState with Retry button calling onRetry exactly once", async () => {
    const onRetry = vi.fn();
    const container = await mount(
      <KnowledgePreviewMiniGraph
        focusNodeId={FOCUS_ID}
        nodes={[]}
        edges={[]}
        isLoading={false}
        isError
        onRetry={onRetry}
      />,
    );

    expect(container.textContent).toContain("Couldn't load this preview.");
    expect(container.textContent).toContain("Try again, or open the full graph.");
    const retryButton = container.querySelector("button");
    expect(retryButton).not.toBeNull();
    expect(retryButton?.textContent).toContain("Retry");

    await act(async () => {
      retryButton!.click();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // Test 3
  it("empty (not found): renders vague copy, no action button", async () => {
    const container = await mount(
      <KnowledgePreviewMiniGraph
        focusNodeId={FOCUS_ID}
        nodes={[]}
        edges={[]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );

    expect(container.textContent).toContain("This preview is unavailable.");
    expect(container.textContent).toContain(
      "The knowledge node may have been removed or is no longer accessible.",
    );
    expect(container.querySelector("button")).toBeNull();
  });

  // Test 4
  it("empty (no connections): renders no-connections copy, no action button", async () => {
    const container = await mount(
      <KnowledgePreviewMiniGraph
        focusNodeId={FOCUS_ID}
        nodes={[node(FOCUS_ID, "Focus")]}
        edges={[]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );

    expect(container.textContent).toContain("No connections yet.");
    expect(container.textContent).toContain("This knowledge node isn't linked to others yet.");
    expect(container.querySelector("button")).toBeNull();
  });

  // Test 5
  it("success: renders role=group with exactly nodes.length <a> dots + exactly one svg, no EmptyState/Skeleton", async () => {
    const nodes = [
      node(FOCUS_ID, "Focus"),
      node("a", "Node A"),
      node("b", "Node B"),
      node("c", "Node C"),
    ];
    const edges = [
      edge("e1", FOCUS_ID, "a"),
      edge("e2", FOCUS_ID, "b"),
      edge("e3", FOCUS_ID, "c"),
    ];
    const container = await mount(
      <KnowledgePreviewMiniGraph
        focusNodeId={FOCUS_ID}
        nodes={nodes}
        edges={edges}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );

    const group = container.querySelector('[role="group"][aria-label="Related knowledge nodes"]');
    expect(group).not.toBeNull();
    expect(group?.querySelectorAll("a").length).toBe(nodes.length);
    // Exactly ONE graph-canvas svg layer (the 280x140 edges svg) — icon svgs
    // (e.g. the focus dot's Share2 glyph) render elsewhere and are not this
    // layer, so this is scoped by the edges svg's own fixed dimensions
    // rather than a raw document-wide `<svg>` count.
    expect(container.querySelectorAll('svg[width="280"][height="140"]').length).toBe(1);
    expect(container.querySelector(".text-base.font-semibold")).toBeNull();
    expect(container.querySelector(".motion-safe\\:animate-pulse")).toBeNull();
  });

  // Test 6
  it("success: every node dot's href/aria-label are computed via hrefFor + the node's own full label", async () => {
    const longLabel = "A Really Long Full Label Name";
    const nodes = [node(FOCUS_ID, "Focus"), node("a", longLabel)];
    const edges = [edge("e1", FOCUS_ID, "a")];
    const container = await mount(
      <KnowledgePreviewMiniGraph
        focusNodeId={FOCUS_ID}
        nodes={nodes}
        edges={edges}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );

    const anchor = container.querySelector(`a[href="${hrefFor("knowledge", "a")}"]`);
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("aria-label")).toBe(`Open ${longLabel} in Knowledge graph`);
  });

  // Test 7
  it("success: a 30-node input renders AT MOST MAX_PREVIEW_NODES (25) dots — proves trimPreviewGraph runs", async () => {
    const neighbours = Array.from({ length: 29 }, (_, i) => node(`n${i}`, `N${i}`));
    const nodes = [node(FOCUS_ID, "Focus"), ...neighbours];
    const edges = neighbours.map((n) => edge(`e-${n.id}`, FOCUS_ID, n.id));

    const container = await mount(
      <KnowledgePreviewMiniGraph
        focusNodeId={FOCUS_ID}
        nodes={nodes}
        edges={edges}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );

    const group = container.querySelector('[role="group"][aria-label="Related knowledge nodes"]');
    expect(group).not.toBeNull();
    expect(group!.querySelectorAll("a").length).toBeLessThanOrEqual(25);
  });

  // Test 8
  it("success: tier encoding matches /knowledge exactly — INFERRED dashed, AMBIGUOUS faint, undefined solid", async () => {
    const nodes = [
      node(FOCUS_ID, "Focus"),
      node("a", "Node A"),
      node("b", "Node B"),
      node("c", "Node C"),
    ];
    const edges = [
      edge("e1", FOCUS_ID, "a", "INFERRED"),
      edge("e2", FOCUS_ID, "b", "AMBIGUOUS"),
      edge("e3", FOCUS_ID, "c", undefined),
    ];
    const container = await mount(
      <KnowledgePreviewMiniGraph
        focusNodeId={FOCUS_ID}
        nodes={nodes}
        edges={edges}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );

    // Scoped to the graph-canvas svg specifically — the focus dot's Share2
    // icon is itself an svg composed of internal <line> elements, which a
    // document-wide `svg line` query would also (incorrectly) pick up.
    const graphSvg = container.querySelector('svg[width="280"][height="140"]');
    expect(graphSvg).not.toBeNull();
    const lines = graphSvg!.querySelectorAll("line");
    expect(lines.length).toBe(3);

    const inferredLine = lines[0]!;
    expect(inferredLine.getAttribute("stroke-dasharray")).toBe("5 3");

    const ambiguousLine = lines[1]!;
    expect(ambiguousLine.getAttribute("opacity")).toBe("0.45");

    const extractedLine = lines[2]!;
    expect(extractedLine.getAttribute("stroke-dasharray")).toBeNull();
    expect(extractedLine.getAttribute("opacity")).toBe("1");
  });

  // Test 9
  it("success: only the focus node's dot carries a Share2-icon child", async () => {
    const nodes = [
      node(FOCUS_ID, "Focus"),
      node("a", "Node A"),
      node("b", "Node B"),
    ];
    const edges = [edge("e1", FOCUS_ID, "a"), edge("e2", FOCUS_ID, "b")];
    const container = await mount(
      <KnowledgePreviewMiniGraph
        focusNodeId={FOCUS_ID}
        nodes={nodes}
        edges={edges}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );

    const focusAnchor = container.querySelector(`a[href="${hrefFor("knowledge", FOCUS_ID)}"]`);
    const oneHopAnchorA = container.querySelector(`a[href="${hrefFor("knowledge", "a")}"]`);
    const oneHopAnchorB = container.querySelector(`a[href="${hrefFor("knowledge", "b")}"]`);

    expect(focusAnchor?.querySelector("svg")).not.toBeNull();
    expect(oneHopAnchorA?.querySelector("svg")).toBeNull();
    expect(oneHopAnchorB?.querySelector("svg")).toBeNull();
  });
});
