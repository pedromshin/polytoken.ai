"use client";

// Explicit React import — Next.js's SWC automatic JSX runtime tolerates its
// absence, but vitest's classic-runtime esbuild JSX transform needs `React`
// in scope for any suite that mounts this file directly (documented gotcha —
// see message-list.tsx / genui-panel-node.tsx / 53-03 / 53-04's identical
// fix). message-stream-law.test.tsx (61-04) mounts MessageTurn across every
// part type and status, which reaches this file for the first time.
import * as React from "react";

import { Badge } from "@polytoken/ui/badge";

export type TurnStatusBadgeStatus =
  | "stopped"
  | "interrupted"
  | "cost_capped"
  | "completed"
  | "failed"
  | "cost_capped_pre_turn"
  | "streaming";

export interface TurnStatusBadgeProps {
  readonly status: TurnStatusBadgeStatus;
}

/**
 * TurnStatusBadge (D-15/D-21) — one neutral marker Badge, mutually
 * exclusive: "Stopped by user" for stopped/interrupted, "Cost-capped ·
 * partial response" for a mid-stream cost-cap breach. Every other status
 * renders nothing (no marker needed for a normal completed turn).
 */
export function TurnStatusBadge({
  status,
}: TurnStatusBadgeProps): React.ReactElement | null {
  if (status === "stopped" || status === "interrupted") {
    return (
      <Badge variant="secondary" className="text-xs">
        Stopped by user
      </Badge>
    );
  }
  if (status === "cost_capped") {
    return (
      <Badge variant="secondary" className="text-xs">
        Cost-capped · partial response
      </Badge>
    );
  }
  return null;
}
