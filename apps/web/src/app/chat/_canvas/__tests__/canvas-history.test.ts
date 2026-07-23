/**
 * canvas-history.test.ts — the pure command-pattern undo/redo stack (CI-06):
 * record-before semantics, do→undo→redo round-trips, redo-clearing on a new
 * record, label round-tripping, the depth bound, and the empty no-ops.
 */

import { describe, expect, it } from "vitest";
import type { Edge as FlowEdge, Node as FlowNode } from "@xyflow/react";

import {
  canRedo,
  canUndo,
  CANVAS_HISTORY_LIMIT,
  EMPTY_CANVAS_HISTORY,
  recordHistory,
  reconcileServerOwnedData,
  redoHistory,
  undoHistory,
  type CanvasHistorySnapshot,
} from "../canvas-history";

function node(id: string, x = 0): FlowNode {
  return { id, type: "email-thread", position: { x, y: 0 }, data: {} };
}
function snap(nodes: FlowNode[], edges: FlowEdge[] = []): CanvasHistorySnapshot {
  return { nodes, edges };
}

describe("recordHistory", () => {
  it("pushes a restore point and clears the redo stack", () => {
    const withFuture = { past: [], future: [{ label: "x", snapshot: snap([]) }] };
    const next = recordHistory(withFuture, { label: "Add", snapshot: snap([node("a")]) });
    expect(next.past).toHaveLength(1);
    expect(next.past[0]?.label).toBe("Add");
    expect(next.future).toHaveLength(0);
  });

  it("bounds the stack to CANVAS_HISTORY_LIMIT, dropping the oldest", () => {
    let state = EMPTY_CANVAS_HISTORY;
    for (let i = 0; i < CANVAS_HISTORY_LIMIT + 10; i++) {
      state = recordHistory(state, { label: `edit-${i}`, snapshot: snap([]) });
    }
    expect(state.past).toHaveLength(CANVAS_HISTORY_LIMIT);
    // Oldest kept is edit-10 (0..9 dropped).
    expect(state.past[0]?.label).toBe("edit-10");
  });
});

describe("undo/redo round-trip", () => {
  it("do → undo restores the before-snapshot and reports the label", () => {
    const before = snap([node("a")]);
    const after = snap([node("a"), node("b")]);
    // Record the before state, labeled with the about-to-happen action.
    const recorded = recordHistory(EMPTY_CANVAS_HISTORY, { label: "Add node", snapshot: before });

    const undone = undoHistory(recorded, after);
    expect(undone).not.toBeNull();
    expect(undone?.label).toBe("Add node");
    expect(undone?.snapshot.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(canUndo(undone!.history)).toBe(false);
    expect(canRedo(undone!.history)).toBe(true);
  });

  it("undo → redo re-applies the after-snapshot (byte-for-byte round-trip)", () => {
    const before = snap([node("a")]);
    const after = snap([node("a"), node("b")]);
    const recorded = recordHistory(EMPTY_CANVAS_HISTORY, { label: "Add node", snapshot: before });

    const undone = undoHistory(recorded, after)!;
    const redone = redoHistory(undone.history, undone.snapshot);
    expect(redone).not.toBeNull();
    expect(redone?.label).toBe("Add node");
    expect(redone?.snapshot.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(canUndo(redone!.history)).toBe(true);
    expect(canRedo(redone!.history)).toBe(false);
  });

  it("supports multi-step undo/redo in order", () => {
    const s0 = snap([node("a")]);
    const s1 = snap([node("a"), node("b")]);
    const s2 = snap([node("a"), node("b"), node("c")]);
    let h = recordHistory(EMPTY_CANVAS_HISTORY, { label: "Add b", snapshot: s0 });
    h = recordHistory(h, { label: "Add c", snapshot: s1 });

    // live is s2; undo "Add c" -> s1
    const u1 = undoHistory(h, s2)!;
    expect(u1.label).toBe("Add c");
    expect(u1.snapshot.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    // undo "Add b" -> s0
    const u2 = undoHistory(u1.history, u1.snapshot)!;
    expect(u2.label).toBe("Add b");
    expect(u2.snapshot.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(canUndo(u2.history)).toBe(false);
    // redo "Add b" -> s1
    const r1 = redoHistory(u2.history, u2.snapshot)!;
    expect(r1.snapshot.nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("a new record after an undo discards the redo branch", () => {
    const s0 = snap([node("a")]);
    const s1 = snap([node("a"), node("b")]);
    const recorded = recordHistory(EMPTY_CANVAS_HISTORY, { label: "Add b", snapshot: s0 });
    const undone = undoHistory(recorded, s1)!;
    expect(canRedo(undone.history)).toBe(true);
    const rebranched = recordHistory(undone.history, { label: "Add c", snapshot: s0 });
    expect(canRedo(rebranched)).toBe(false);
  });
});

describe("empty no-ops", () => {
  it("undo/redo on an empty stack return null", () => {
    expect(undoHistory(EMPTY_CANVAS_HISTORY, snap([]))).toBeNull();
    expect(redoHistory(EMPTY_CANVAS_HISTORY, snap([]))).toBeNull();
    expect(canUndo(EMPTY_CANVAS_HISTORY)).toBe(false);
    expect(canRedo(EMPTY_CANVAS_HISTORY)).toBe(false);
  });
});


describe("reconcileServerOwnedData (canon-tier drift guard)", () => {
  function tierNode(id: string, tier: string): FlowNode {
    return { id, type: "knowledge-preview", position: { x: 0, y: 0 }, data: { tier } };
  }

  it("overlays the LIVE server-owned tier onto a restored (stale) node", () => {
    // Snapshot captured before a promote: tier 'suggested'. Live node was since
    // promoted to 'confirmed'. Undo must NOT revert the promotion.
    const restored = [tierNode("n1", "suggested")];
    const live = [tierNode("n1", "confirmed")];
    const out = reconcileServerOwnedData(restored, live);
    expect((out[0]?.data as { tier?: string }).tier).toBe("confirmed");
  });

  it("leaves structural fields from the snapshot intact", () => {
    const restored: FlowNode[] = [{ id: "n1", type: "knowledge-preview", position: { x: 5, y: 9 }, data: { tier: "suggested" } }];
    const live: FlowNode[] = [{ id: "n1", type: "knowledge-preview", position: { x: 99, y: 99 }, data: { tier: "confirmed" } }];
    const out = reconcileServerOwnedData(restored, live);
    expect(out[0]?.position).toEqual({ x: 5, y: 9 }); // structural stays from snapshot
    expect((out[0]?.data as { tier?: string }).tier).toBe("confirmed"); // server field from live
  });

  it("passes nodes through unchanged when live has no such node or no tier", () => {
    const restored = [tierNode("n1", "suggested")];
    expect(reconcileServerOwnedData(restored, [])[0]).toBe(restored[0]); // deleted-live node: identity
    const noTierLive: FlowNode[] = [{ id: "n1", type: "email-thread", position: { x: 0, y: 0 }, data: {} }];
    expect(reconcileServerOwnedData(restored, noTierLive)[0]?.data).toEqual({ tier: "suggested" });
  });
});
