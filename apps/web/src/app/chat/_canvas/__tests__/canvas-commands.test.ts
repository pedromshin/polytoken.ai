/**
 * canvas-commands.test.ts — the ONE declared canvas command table (CI-02):
 * every key maps to the right command, `run` dispatches to the right operation,
 * ⌘/Ctrl equivalence, shift-discrimination (undo vs redo), bare keys ignoring
 * shift, and the hint items being derived from the same table.
 */

import { describe, expect, it, vi } from "vitest";

import {
  CANVAS_COMMANDS,
  canvasHintItems,
  matchCommand,
  type CanvasCommandContext,
  type CanvasKeyEvent,
} from "../canvas-commands";

function key(partial: Partial<CanvasKeyEvent> & { key: string }): CanvasKeyEvent {
  return { metaKey: false, ctrlKey: false, shiftKey: false, ...partial };
}

function spyContext(): CanvasCommandContext {
  return {
    panBy: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    fitView: vi.fn(),
    deselectAll: vi.fn(),
    selectAll: vi.fn(),
    duplicateSelection: vi.fn(),
    deleteSelection: vi.fn(),
    copySelection: vi.fn(),
    cutSelection: vi.fn(),
    paste: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
  };
}

describe("matchCommand — key → command id", () => {
  const cases: ReadonlyArray<[CanvasKeyEvent, string]> = [
    [key({ key: "ArrowUp" }), "pan-up"],
    [key({ key: "ArrowDown" }), "pan-down"],
    [key({ key: "ArrowLeft" }), "pan-left"],
    [key({ key: "ArrowRight" }), "pan-right"],
    [key({ key: "+" }), "zoom-in"],
    [key({ key: "=" }), "zoom-in"],
    [key({ key: "-" }), "zoom-out"],
    [key({ key: "0" }), "fit-view"],
    [key({ key: "a", metaKey: true }), "select-all"],
    [key({ key: "a", ctrlKey: true }), "select-all"],
    [key({ key: "d", metaKey: true }), "duplicate"],
    [key({ key: "Delete" }), "delete"],
    [key({ key: "Backspace" }), "delete"],
    [key({ key: "c", metaKey: true }), "copy"],
    [key({ key: "x", metaKey: true }), "cut"],
    [key({ key: "v", metaKey: true }), "paste"],
    [key({ key: "z", metaKey: true }), "undo"],
    [key({ key: "z", metaKey: true, shiftKey: true }), "redo"],
    [key({ key: "Escape" }), "deselect"],
  ];

  it.each(cases)("%o -> %s", (event, expectedId) => {
    expect(matchCommand(event)?.id).toBe(expectedId);
  });

  it("undo (⌘Z) and redo (⌘⇧Z) are distinguished by shift", () => {
    expect(matchCommand(key({ key: "z", metaKey: true }))?.id).toBe("undo");
    expect(matchCommand(key({ key: "z", metaKey: true, shiftKey: true }))?.id).toBe("redo");
  });

  it("meta commands enforce shift: ⌘A selects all, ⌘⇧A does not", () => {
    // For a primary-modifier command shift is significant, so an unintended
    // ⌘⇧A never fires select-all — only the exact ⌘A binding does.
    expect(matchCommand(key({ key: "a", metaKey: true }))?.id).toBe("select-all");
    expect(matchCommand(key({ key: "A", metaKey: true, shiftKey: true }))).toBeNull();
  });

  it("a bare letter (no primary modifier) matches no command", () => {
    expect(matchCommand(key({ key: "a" }))).toBeNull();
    expect(matchCommand(key({ key: "z" }))).toBeNull();
  });

  it("a modified arrow (with ⌘) does NOT match the bare pan command", () => {
    expect(matchCommand(key({ key: "ArrowUp", metaKey: true }))).toBeNull();
  });

  it("an unknown key matches nothing", () => {
    expect(matchCommand(key({ key: "q" }))).toBeNull();
  });
});

describe("command.run dispatches to the right operation", () => {
  it("each command calls exactly its context method", () => {
    const expectedCall: Record<string, keyof CanvasCommandContext> = {
      "pan-up": "panBy",
      "pan-down": "panBy",
      "pan-left": "panBy",
      "pan-right": "panBy",
      "zoom-in": "zoomIn",
      "zoom-out": "zoomOut",
      "fit-view": "fitView",
      "select-all": "selectAll",
      duplicate: "duplicateSelection",
      delete: "deleteSelection",
      copy: "copySelection",
      cut: "cutSelection",
      paste: "paste",
      undo: "undo",
      redo: "redo",
      deselect: "deselectAll",
    };
    for (const command of CANVAS_COMMANDS) {
      const ctx = spyContext();
      command.run(ctx);
      const method = expectedCall[command.id];
      expect(method, `no expectation for ${command.id}`).toBeDefined();
      expect(ctx[method!]).toHaveBeenCalledTimes(1);
    }
  });

  it("pan commands pass a sign-correct delta", () => {
    const ctx = spyContext();
    CANVAS_COMMANDS.find((c) => c.id === "pan-up")!.run(ctx);
    expect(ctx.panBy).toHaveBeenCalledWith(0, 50);
    const ctx2 = spyContext();
    CANVAS_COMMANDS.find((c) => c.id === "pan-down")!.run(ctx2);
    expect(ctx2.panBy).toHaveBeenCalledWith(0, -50);
  });
});

describe("canvasHintItems", () => {
  it("is derived from the table and lists labelled keycaps", () => {
    const items = canvasHintItems();
    expect(items.length).toBeGreaterThan(0);
    const undo = items.find((i) => i.label === "Undo");
    expect(undo?.keys).toEqual(["⌘Z"]);
    const pan = items.find((i) => i.label === "Pan");
    expect(pan?.keys).toEqual(["↑", "↓", "←", "→"]);
  });
});
