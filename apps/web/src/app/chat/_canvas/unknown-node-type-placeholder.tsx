"use client";

/**
 * unknown-node-type-placeholder.tsx — inert degrade-gracefully card for a
 * persisted node type this session's NODE_TYPE_REGISTRY doesn't recognize
 * (CANVAS-03, D-04, T-23-05).
 *
 * Position/size come from the persisted layout's Node object itself (React
 * Flow applies those independent of the custom node component) — this
 * component only fills its container, so the canvas's overall spatial
 * arrangement is undisturbed by a registry miss. No action button, no
 * interactive content: an unrecognized node type is TAMPERING-class
 * untrusted input and must never execute or render anything beyond this
 * static card (never a crash, never a blank canvas).
 *
 * ────────────────────────────────────────────────────────────────────────
 * 61-06 — THE MADDER FRAME IS GONE. It was a live law-1 violation.
 * ────────────────────────────────────────────────────────────────────────
 *
 * 23-UI-SPEC.md's Color table framed this card in the irreversible colour and
 * tinted its icon to match. **An unrecognized node type is a STATE, not an
 * irreversible action** — nothing here can be undone because nothing here has
 * happened. Law 1 is unconditional: madder is "destructive buttons only, never
 * errors, never warnings". This is the same violation class 60-06 found in
 * `pdf-preview-pane`'s "Preview failed" badge — a status talking in the colour
 * reserved for actions that cannot be taken back.
 *
 * The honest reframe, per brand-guide §3: this is not even an error. It is
 * CANVAS-03's degrade-gracefully case — closer to "uncertain" than to
 * "danger" — so it wears the kind vocabulary's `unknown` geometry: a DOTTED
 * `--rule` frame with no left rule, which is 61-02's way of saying "this card
 * claims nothing at all". The heading is ink; the caption is quiet.
 *
 * T-61-18 — THE PLACEHOLDER ITSELF STAYS, and must. It IS the mitigation for
 * an unrecognized persisted `node.type` (CANVAS-03's contract, and a
 * versioned-registry hedge). A node the user saved must still be visibly
 * accounted for, so this restyle must never turn it into a throw, remove it,
 * or make it silently invisible. Only its madder went.
 *
 * The outer card chrome stays local to this component — it's a
 * bounded-node-card affordance, not part of the shared EmptyState primitive.
 * Only the inner icon+text row + caption is delegated to EmptyState's
 * inline/compact variant (FIX-11, 26-UI-SPEC.md § "FIX-11").
 */

// Explicit React import (not just the named `memo`) — this file's JSX compiles
// fine under Next's SWC automatic runtime, but vitest's plain esbuild transform
// defaults to the CLASSIC runtime (React.createElement) and needs `React` in
// scope whenever a test mounts this component directly. Every sibling shell
// carries this import and says so; this one did not, and the reason is telling:
// until 61-06's `canvas-node-law.test.tsx` **no test had ever mounted this
// placeholder**, so nothing had forced the gap into the open. The first mount
// threw `ReferenceError: React is not defined` immediately. (Same note as
// canvas-store-context.tsx / genui-panel-node.tsx.)
import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";

import { EmptyState } from "~/components/empty-state";

import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";

export type UnknownNodeTypeNodeData = { readonly nodeType: string } & Record<
  string,
  unknown
>;
export type UnknownNodeTypeNodeType = Node<
  UnknownNodeTypeNodeData,
  "unknown-node-type"
>;

export const UnknownNodeTypePlaceholder = memo(function UnknownNodeTypePlaceholder({
  data,
}: NodeProps<UnknownNodeTypeNodeType>) {
  return (
    <div
      className={`h-full min-h-[240px] w-full min-w-[320px] gap-2 p-row-y ${canvasNodeShellClass(CANVAS_NODE_KIND_GEOMETRY.unknown, false)}`}
    >
      {/* tone="muted" renders the icon on the same --faded step every other
          card's `.ch` icon wears (the sketch's own rule), and — the point —
          carries no madder. A `pencil` tone is NOT added to EmptyState for
          this one call site: that primitive is shared with /knowledge,
          /studio and entities-gallery (Phase 62's surfaces) and D-61-07
          already has an open cross-surface question about its `action`
          weight. Same call, same reason, as 61-05 declined on
          CanvasEmptyState. */}
      <EmptyState
        icon={AlertTriangle}
        heading="This panel type isn't supported in this version."
        body=""
        layout="inline"
        tone="muted"
        size="compact"
        caption={`Type: ${data.nodeType} · The canvas layout is unaffected — this panel is skipped safely.`}
      />
    </div>
  );
});
