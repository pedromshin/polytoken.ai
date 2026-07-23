/**
 * canvas-commands.ts — the ONE declared canvas command table (CI-02),
 * rendered three ways from a single source:
 *   1. HANDLER — `matchCommand(event)` maps a keydown to a command, whose
 *      `run(ctx)` calls into the host's operation bundle (`CanvasCommandContext`).
 *   2. HINT CARD — `CANVAS_COMMANDS` feeds `canvas-keyboard-hint.tsx`'s copy,
 *      so the hint can never drift from the actual bindings.
 *   3. PALETTE-READY — each command carries a stable `id` + human `label` +
 *      display keycap(s), the exact shape a future Cmd/Ctrl+K palette (AI-05)
 *      renders; nothing else needs to change to list them.
 *
 * The table is PURE DATA + pure predicates. `run` receives a
 * `CanvasCommandContext` — the host (chat-canvas.tsx) supplies the concrete
 * operations (pan/zoom/fit/select-all/duplicate/delete/undo/redo/deselect), so
 * this module has zero React or React Flow imports and is unit-testable by
 * feeding it a synthetic key event + a spy context.
 *
 * KEY MATCHING. `metaOrCtrl` treats ⌘ (mac) and Ctrl (win/linux) as the same
 * "primary modifier" — the platform-correct convention. For a modified
 * command, `shift` is significant (⌘Z vs ⌘⇧Z); for a bare command (arrows,
 * +/-/0, Escape, Delete) shift is ignored so a stray shift never suppresses a
 * pan. Letter keys compare case-insensitively (Shift makes `event.key` upper).
 */

export interface CanvasCommandContext {
  /** Pan the viewport by a screen-space delta (already sign-correct for the
   * requested direction). */
  readonly panBy: (dx: number, dy: number) => void;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly fitView: () => void;
  readonly deselectAll: () => void;
  readonly selectAll: () => void;
  readonly duplicateSelection: () => void;
  readonly deleteSelection: () => void;
  readonly copySelection: () => void;
  readonly cutSelection: () => void;
  readonly paste: () => void;
  readonly undo: () => void;
  readonly redo: () => void;
}

/** A single key binding. `key` is compared against `event.key`
 * (case-insensitively). `meta`/`shift` are the required modifier states —
 * absent means "not required" for `meta`, and for `shift` see the matching
 * rules in the module header. `display` is the human keycap for the hint/palette. */
export interface CanvasCommandKeyBinding {
  readonly key: string;
  readonly meta?: boolean;
  readonly shift?: boolean;
  readonly display: string;
}

export interface CanvasCommand {
  readonly id: string;
  /** Palette + hint label. */
  readonly label: string;
  readonly keys: readonly CanvasCommandKeyBinding[];
  readonly run: (ctx: CanvasCommandContext) => void;
}

/** Pan step in screen px — preserves the pre-CI-02 arrow-pan feel exactly. */
export const PAN_STEP_PX = 50;

export const CANVAS_COMMANDS: readonly CanvasCommand[] = [
  {
    id: "pan-up",
    label: "Pan up",
    keys: [{ key: "ArrowUp", display: "↑" }],
    run: (ctx) => ctx.panBy(0, PAN_STEP_PX),
  },
  {
    id: "pan-down",
    label: "Pan down",
    keys: [{ key: "ArrowDown", display: "↓" }],
    run: (ctx) => ctx.panBy(0, -PAN_STEP_PX),
  },
  {
    id: "pan-left",
    label: "Pan left",
    keys: [{ key: "ArrowLeft", display: "←" }],
    run: (ctx) => ctx.panBy(PAN_STEP_PX, 0),
  },
  {
    id: "pan-right",
    label: "Pan right",
    keys: [{ key: "ArrowRight", display: "→" }],
    run: (ctx) => ctx.panBy(-PAN_STEP_PX, 0),
  },
  {
    id: "zoom-in",
    label: "Zoom in",
    keys: [
      { key: "+", display: "+" },
      { key: "=", display: "=" },
    ],
    run: (ctx) => ctx.zoomIn(),
  },
  {
    id: "zoom-out",
    label: "Zoom out",
    keys: [{ key: "-", display: "−" }],
    run: (ctx) => ctx.zoomOut(),
  },
  {
    id: "fit-view",
    label: "Fit view",
    keys: [{ key: "0", display: "0" }],
    run: (ctx) => ctx.fitView(),
  },
  {
    id: "select-all",
    label: "Select all nodes",
    keys: [{ key: "a", meta: true, display: "⌘A" }],
    run: (ctx) => ctx.selectAll(),
  },
  {
    id: "duplicate",
    label: "Duplicate selection",
    keys: [{ key: "d", meta: true, display: "⌘D" }],
    run: (ctx) => ctx.duplicateSelection(),
  },
  {
    id: "delete",
    label: "Delete selection",
    keys: [
      { key: "Delete", display: "Delete" },
      { key: "Backspace", display: "Backspace" },
    ],
    run: (ctx) => ctx.deleteSelection(),
  },
  {
    id: "copy",
    label: "Copy selection",
    keys: [{ key: "c", meta: true, display: "⌘C" }],
    run: (ctx) => ctx.copySelection(),
  },
  {
    id: "cut",
    label: "Cut selection",
    keys: [{ key: "x", meta: true, display: "⌘X" }],
    run: (ctx) => ctx.cutSelection(),
  },
  {
    id: "paste",
    label: "Paste",
    keys: [{ key: "v", meta: true, display: "⌘V" }],
    run: (ctx) => ctx.paste(),
  },
  {
    id: "undo",
    label: "Undo",
    keys: [{ key: "z", meta: true, display: "⌘Z" }],
    run: (ctx) => ctx.undo(),
  },
  {
    id: "redo",
    label: "Redo",
    keys: [{ key: "z", meta: true, shift: true, display: "⌘⇧Z" }],
    run: (ctx) => ctx.redo(),
  },
  {
    id: "deselect",
    label: "Deselect all",
    keys: [{ key: "Escape", display: "Esc" }],
    run: (ctx) => ctx.deselectAll(),
  },
];

/** Minimal shape of the keydown event `matchCommand` reads — a real
 * `KeyboardEvent` or React's `React.KeyboardEvent` both satisfy it, and a test
 * can pass a plain object. */
export interface CanvasKeyEvent {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
}

function bindingMatches(
  binding: CanvasCommandKeyBinding,
  event: CanvasKeyEvent,
): boolean {
  const metaOrCtrl = event.metaKey || event.ctrlKey;
  if (Boolean(binding.meta) !== metaOrCtrl) return false;
  // Shift is significant for modifier combos (⌘Z vs ⌘⇧Z) and whenever a
  // binding pins it explicitly; otherwise a bare key ignores shift.
  if (binding.meta || binding.shift !== undefined) {
    if (Boolean(binding.shift) !== event.shiftKey) return false;
  }
  return binding.key.toLowerCase() === event.key.toLowerCase();
}

/**
 * matchCommand — the FIRST command whose any binding matches the event, or
 * `null`. Order in `CANVAS_COMMANDS` is the tiebreaker; `undo` precedes `redo`
 * but their shift-discrimination makes them unambiguous regardless.
 */
export function matchCommand(event: CanvasKeyEvent): CanvasCommand | null {
  for (const command of CANVAS_COMMANDS) {
    if (command.keys.some((binding) => bindingMatches(binding, event))) {
      return command;
    }
  }
  return null;
}

/** The keycaps to show for a command (every binding's `display`). */
export function commandKeycaps(command: CanvasCommand): readonly string[] {
  return command.keys.map((binding) => binding.display);
}

/** Curated subset + copy for the dismissible hint card — the SAME table, so
 * the hint can never advertise a binding that isn't wired. */
export interface CanvasHintItem {
  readonly label: string;
  readonly keys: readonly string[];
}

const HINT_COMMAND_IDS: readonly string[] = [
  "pan-up",
  "zoom-in",
  "select-all",
  "duplicate",
  "delete",
  "undo",
];

export function canvasHintItems(): readonly CanvasHintItem[] {
  return HINT_COMMAND_IDS.flatMap((id) => {
    const command = CANVAS_COMMANDS.find((c) => c.id === id);
    if (command === undefined) return [];
    // Pan shows the whole arrow cluster rather than just "↑".
    if (id === "pan-up") {
      return [{ label: "Pan", keys: ["↑", "↓", "←", "→"] }];
    }
    if (id === "zoom-in") {
      return [{ label: "Zoom / fit", keys: ["+", "−", "0"] }];
    }
    return [{ label: command.label, keys: commandKeycaps(command) }];
  });
}
