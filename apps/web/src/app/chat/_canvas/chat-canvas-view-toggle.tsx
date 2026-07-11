"use client";

/**
 * chat-canvas-view-toggle.tsx — ChatCanvasViewToggle: segmented Chat/Canvas
 * mode selector (D-02), leftmost in ConversationView's h-11 toolbar.
 *
 * Controlled component — the PARENT (page.tsx's ConversationView) owns
 * `value` (single source of truth, since it also decides whether to render
 * the docked view or the canvas island) via `useState(() =>
 * readStoredViewMode(conversationId))`; this component persists a NEW
 * selection to localStorage (T-23-07: coerced to a known mode only, tamper-
 * safe) as a side effect of `onValueChange`, then reports it up.
 */

import { Tabs, TabsList, TabsTrigger } from "@polytoken/ui/tabs";

export type ChatCanvasViewMode = "chat" | "canvas";

const VALID_VIEW_MODES: ReadonlySet<string> = new Set<ChatCanvasViewMode>([
  "chat",
  "canvas",
]);

function storageKeyFor(conversationId: string): string {
  return `nauta.chat.canvas-view:${conversationId}`;
}

/**
 * readStoredViewMode — T-23-07: coerces an arbitrary localStorage value to a
 * known `ChatCanvasViewMode`, falling back to the D-02 default ("chat") for
 * anything else (missing key, tampered value, a future/legacy mode string).
 * Never throws.
 */
export function readStoredViewMode(conversationId: string): ChatCanvasViewMode {
  if (typeof window === "undefined") return "chat";
  const raw = window.localStorage.getItem(storageKeyFor(conversationId));
  return raw !== null && VALID_VIEW_MODES.has(raw)
    ? (raw as ChatCanvasViewMode)
    : "chat";
}

export function writeStoredViewMode(
  conversationId: string,
  mode: ChatCanvasViewMode,
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKeyFor(conversationId), mode);
}

export interface ChatCanvasViewToggleProps {
  readonly conversationId: string;
  readonly value: ChatCanvasViewMode;
  readonly onChange: (mode: ChatCanvasViewMode) => void;
}

export function ChatCanvasViewToggle({
  conversationId,
  value,
  onChange,
}: ChatCanvasViewToggleProps): React.ReactElement {
  const handleValueChange = (next: string): void => {
    if (!VALID_VIEW_MODES.has(next)) return; // defensive — Tabs only ever emits a registered value
    const mode = next as ChatCanvasViewMode;
    writeStoredViewMode(conversationId, mode);
    onChange(mode);
  };

  return (
    <Tabs value={value} onValueChange={handleValueChange}>
      <TabsList aria-label="View" className="h-8 p-0.5">
        <TabsTrigger
          value="chat"
          aria-label="Chat view"
          className="h-7 px-3 text-xs data-[state=inactive]:hover:bg-accent data-[state=inactive]:hover:text-accent-foreground"
        >
          Chat
        </TabsTrigger>
        <TabsTrigger
          value="canvas"
          aria-label="Canvas view"
          className="h-7 px-3 text-xs data-[state=inactive]:hover:bg-accent data-[state=inactive]:hover:text-accent-foreground"
        >
          Canvas
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
