/**
 * recipe-overlay.test.tsx — the on-canvas recipe badge (Phase 73 Wave C,
 * LCAN-07). Two layers:
 *
 *   1. `computeRecipeGroups` PURE geometry — bounding-box math over member
 *      nodes, and the omit-when-no-member contract.
 *   2. `RecipeOverlay` RENDERED contract — a mocked `canvasRecipes.list` draws
 *      each recipe's name over its member group; an empty list (or a recipe
 *      whose members are off-canvas) renders nothing.
 *
 * `~/trpc/react` is mocked as a plain object (mirrors add-email-thread-popover.
 * test.tsx). `@xyflow/react`'s `ViewportPortal` is mocked via a PARTIAL factory
 * to render its children inline — jsdom has no React Flow store, and the portal
 * target is irrelevant to what this gate checks (that the NAME renders). Mount
 * is createRoot-in-jsdom + `act` (mirrors panel-nodes.test.tsx).
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Node as FlowNode } from "@xyflow/react";

let listData: Array<{
  id: string;
  name: string;
  nodeKeys: string[];
  edgeKeys: string[];
}> = [];
const useListQueryMock = vi.fn((..._args: unknown[]) => ({ data: listData }));

vi.mock("~/trpc/react", () => ({
  api: {
    canvasRecipes: {
      list: {
        useQuery: (...args: unknown[]) => useListQueryMock(...args),
      },
    },
  },
}));

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>(
    "@xyflow/react",
  );
  return {
    ...actual,
    ViewportPortal: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="viewport-portal">{children}</div>
    ),
  };
});

import {
  computeRecipeGroups,
  RecipeOverlay,
  type RecipeLike,
} from "../recipe-overlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function node(id: string, type: string, x: number, y: number): FlowNode {
  return { id, type, position: { x, y }, data: {} } as FlowNode;
}

// email-thread is 320×220 (CANVAS_NODE_DIMENSIONS); genui-panel is 320×240.
const NODE_A = node("email-thread:aaa", "email-thread", 100, 100);
const NODE_B = node("genui-panel:bbb:0", "genui-panel", 500, 300);

// ---------------------------------------------------------------------------
// computeRecipeGroups — pure geometry
// ---------------------------------------------------------------------------

describe("computeRecipeGroups", () => {
  it("computes the padded bounding box over the member nodes", () => {
    const recipe: RecipeLike = {
      id: "r1",
      name: "Rent board",
      nodeKeys: [NODE_A.id, NODE_B.id],
    };

    const [group] = computeRecipeGroups([recipe], [NODE_A, NODE_B]);

    expect(group).toBeDefined();
    expect(group?.name).toBe("Rent board");
    expect(group?.memberCount).toBe(2);
    // tight box: x[100..820], y[100..540]; padded by 14 on every side.
    expect(group?.x).toBe(100 - 14);
    expect(group?.y).toBe(100 - 14);
    expect(group?.width).toBe(820 - 100 + 28);
    expect(group?.height).toBe(540 - 100 + 28);
  });

  it("omits a recipe with no member on the canvas", () => {
    const recipe: RecipeLike = {
      id: "r2",
      name: "Ghost",
      nodeKeys: ["not-on-canvas:x"],
    };
    expect(computeRecipeGroups([recipe], [NODE_A, NODE_B])).toEqual([]);
  });

  it("returns one group per recipe that has at least one member", () => {
    const groups = computeRecipeGroups(
      [
        { id: "r1", name: "Has A", nodeKeys: [NODE_A.id] },
        { id: "r2", name: "Ghost", nodeKeys: ["missing:1"] },
        { id: "r3", name: "Has B", nodeKeys: [NODE_B.id, "missing:2"] },
      ],
      [NODE_A, NODE_B],
    );
    expect(groups.map((g) => g.name)).toEqual(["Has A", "Has B"]);
  });

  it("prefers a node's measured size over the fixed dimensions", () => {
    const measured = {
      id: "email-thread:aaa",
      type: "email-thread",
      position: { x: 0, y: 0 },
      measured: { width: 1000, height: 800 },
      data: {},
    } as FlowNode;
    const [group] = computeRecipeGroups(
      [{ id: "r1", name: "Big", nodeKeys: [measured.id] }],
      [measured],
    );
    // padded box uses 1000×800, not the 320×220 default.
    expect(group?.width).toBe(1000 + 28);
    expect(group?.height).toBe(800 + 28);
  });
});

// ---------------------------------------------------------------------------
// RecipeOverlay — rendered contract
// ---------------------------------------------------------------------------

describe("RecipeOverlay", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    listData = [];
    useListQueryMock.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(nodes: FlowNode[]): void {
    act(() => {
      root.render(
        <RecipeOverlay conversationId="conv-1" nodes={nodes} />,
      );
    });
  }

  it("renders the recipe name over its member group", () => {
    listData = [
      {
        id: "r1",
        name: "Rent board",
        nodeKeys: [NODE_A.id, NODE_B.id],
        edgeKeys: [],
      },
    ];
    render([NODE_A, NODE_B]);

    expect(container.textContent).toContain("Rent board");
    const badge = container.querySelector('[data-recipe-id="r1"]');
    expect(badge).not.toBeNull();
    // Neutral chrome: a rule outline, no tier/role hue, no shadow.
    expect(badge?.className).toContain("border-rule");
    expect(badge?.className).not.toMatch(/shadow/);
  });

  it("queries the list for the current conversation", () => {
    render([NODE_A]);
    expect(useListQueryMock).toHaveBeenCalledWith({ conversationId: "conv-1" });
  });

  it("renders nothing when there are no recipes", () => {
    listData = [];
    render([NODE_A, NODE_B]);
    expect(container.querySelector("[data-recipe-id]")).toBeNull();
    expect(container.querySelector('[data-testid="viewport-portal"]')).toBeNull();
  });

  it("renders nothing when a recipe's members are not on the canvas", () => {
    listData = [
      { id: "r9", name: "Ghost", nodeKeys: ["off-canvas:1"], edgeKeys: [] },
    ];
    render([NODE_A, NODE_B]);
    expect(container.textContent).not.toContain("Ghost");
    expect(container.querySelector("[data-recipe-id]")).toBeNull();
  });
});
