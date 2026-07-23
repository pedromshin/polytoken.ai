/**
 * use-canvas-history.test.tsx — the React shell over the undo/redo stack
 * (CI-06): a record → mutate → undo restores the prior nodes/edges through the
 * host setters, redo re-applies, `onAfterApply` fires on each restore, and
 * canUndo/canRedo track the stack. createRoot-in-jsdom + `act` per this repo's
 * convention (no @testing-library/react dep).
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Edge as FlowEdge, Node as FlowNode } from "@xyflow/react";

import { useCanvasHistory, type UseCanvasHistoryResult } from "../use-canvas-history";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function node(id: string): FlowNode {
  return { id, type: "email-thread", position: { x: 0, y: 0 }, data: {} };
}

interface Captured {
  nodes: readonly FlowNode[];
  setNodes: React.Dispatch<React.SetStateAction<FlowNode[]>>;
  history: UseCanvasHistoryResult;
  afterApplyCount: number;
}

let captured: Captured;

function Harness(): null {
  const [nodes, setNodes] = React.useState<FlowNode[]>([node("a")]);
  const [edges, setEdges] = React.useState<FlowEdge[]>([]);
  const afterApplyRef = React.useRef(0);
  const history = useCanvasHistory({
    nodes,
    edges,
    setNodes,
    setEdges,
    onAfterApply: () => {
      afterApplyRef.current += 1;
    },
  });
  captured = { nodes, setNodes, history, afterApplyCount: afterApplyRef.current };
  return null;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<Harness />);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("useCanvasHistory", () => {
  it("starts with an empty stack", () => {
    expect(captured.history.canUndo).toBe(false);
    expect(captured.history.canRedo).toBe(false);
  });

  it("record → mutate → undo restores the prior nodes; redo re-applies", () => {
    // Record the pre-mutation state, then mutate.
    act(() => {
      captured.history.record("Add node");
    });
    act(() => {
      captured.setNodes((prev) => [...prev, node("b")]);
    });
    expect(captured.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(captured.history.canUndo).toBe(true);

    // Undo restores [a].
    let undoLabel: string | null = null;
    act(() => {
      undoLabel = captured.history.undo();
    });
    expect(undoLabel).toBe("Add node");
    expect(captured.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(captured.history.canRedo).toBe(true);

    // Redo re-applies [a, b].
    let redoLabel: string | null = null;
    act(() => {
      redoLabel = captured.history.redo();
    });
    expect(redoLabel).toBe("Add node");
    expect(captured.nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("fires onAfterApply on each restore (undo + redo)", () => {
    act(() => {
      captured.history.record("Add node");
    });
    act(() => {
      captured.setNodes((prev) => [...prev, node("b")]);
    });
    const before = captured.afterApplyCount;
    act(() => {
      captured.history.undo();
    });
    act(() => {
      captured.history.redo();
    });
    expect(captured.afterApplyCount).toBe(before + 2);
  });

  it("undo on an empty stack is a no-op returning null", () => {
    let label: string | null = "x";
    act(() => {
      label = captured.history.undo();
    });
    expect(label).toBeNull();
    expect(captured.nodes.map((n) => n.id)).toEqual(["a"]);
  });
});
