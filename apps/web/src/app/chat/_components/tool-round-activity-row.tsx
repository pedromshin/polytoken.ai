"use client";

/**
 * tool-round-activity-row.tsx — ToolRoundActivityRow (TUI-01, 39-UI-SPEC.md
 * "Component 1"). Renders while a server-tool round is in flight (streamed
 * `server_tool_call` frame) — a bare status line, deliberately NOT wrapped
 * in `<GeneratingRing>` (no panel/card here, just a spinner + gerund label,
 * mirroring `interactive-widget-boundary.tsx`'s `SubmittingRow` /
 * `message-list.tsx`'s `GeneratingIndicator` idiom rather than reinventing
 * one). Unmounts the instant the round settles, replaced in-place by
 * `ToolInvocationResultRow` via the part-array swap (see the SSE contract in
 * `use-chat-stream.ts`'s `applyRunEvent`).
 */

import * as React from "react";
import { Loader2 } from "lucide-react";

export interface ToolRoundActivityRowProps {
  readonly toolName: string;
}

// 39-UI-SPEC.md Component 1 "Copy (label)" — tool-name -> human gerund label.
const LABEL_BY_TOOL_NAME: Readonly<Record<string, string>> = {
  lookup_entity: "Looking up an entity…",
  search_emails: "Searching emails…",
  search_knowledge: "Searching knowledge…",
};

const FALLBACK_LABEL = "Running a lookup…";

export function ToolRoundActivityRow({
  toolName,
}: ToolRoundActivityRowProps): React.ReactElement {
  const label = LABEL_BY_TOOL_NAME[toolName] ?? FALLBACK_LABEL;
  return (
    <div
      role="status"
      className="flex items-center gap-2 py-1 text-sm text-muted-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
    >
      <Loader2 className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
