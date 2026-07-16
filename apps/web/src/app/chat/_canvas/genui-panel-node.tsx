"use client";

/**
 * genui-panel-node.tsx — GenuiPanelNode: the canvas's genui-panel custom
 * React Flow node (CANVAS-03, CANVAS-04, D-07, D-09).
 *
 * Renders a genui spec by provenance through the UNMODIFIED SpecRenderer via
 * the existing GenuiPartBoundary — never patched, forked, or reimplemented.
 * `node.data` carries ONLY the provenance ref (`GenuiPanelNodeData`); the
 * volatile spec content is read from `CanvasSpecContext` via `useCanvasSpec`,
 * never lifted into the React Flow `nodes` array (D-07: a streamed token must
 * never force a full-array `setNodes` identity change).
 *
 * CHROME (61-06, on 58-IDENTITY.md's locked laws — supersedes 23-UI-SPEC.md
 * and 26-UI-SPEC.md FIX-04's chrome clauses). This is criterion 1's fourth
 * named component.
 *
 * The shell is the sketch's flat `.card` via `canvasNodeShellClass`, exactly as
 * every other node kind wears it. This node's kind reads from the WEIGHT of its
 * left rule — `CANVAS_NODE_KIND_GEOMETRY["genui-panel"]`, the lightest of the
 * three ruled kinds, because a generated panel carries none of the user's own
 * words: it is polytoken's rendering OF material that lives elsewhere (law 3:
 * kind is shape, never hue). FIX-04's claim that "the outer shell carries no
 * left-edge accent (that stripe is ChatNode-only)" is superseded — the stripe
 * was never an accent, and the axis it belongs to is now named in the
 * vocabulary rather than special-cased per file.
 *
 * The `h-9` header row is still the ONLY drag handle (`.node-drag-handle` —
 * 23-03 sets `dragHandle=".node-drag-handle"` on the mounted `<ReactFlow>`).
 * Its `bg-muted/40` fill is gone with `ChatNode`'s `bg-muted/60`: those two
 * shades of one grey were FIX-04's way of separating two node kinds before the
 * system had geometry to do it with. The row is now the sketch's `.ch` — a
 * `--hair` bottom rule on the card's own ground, a `--faded` icon, and the
 * provenance caption ("From turn {n}") on the sketch's `.cap` register
 * (`--pencil`, micro step, sans — it is polytoken's caption, not the mail's
 * words). While streaming, an ink pulsing dot keeps its `aria-label="Streaming"`
 * and its `motion-safe:` guard.
 *
 * The body is a fixed-min-dimension (320x272) `ScrollArea` with inner scroll
 * only — the node's own dimensions never change while its spec streams, so the
 * graph never relayouts mid-stream (D-07).
 *
 * STATE-01 (23-05): the panel's own `panels.{id}.*` canvas-store slice feeds
 * into the UNMODIFIED `SpecRenderer` via `GenuiPartBoundary`'s `data` prop —
 * the node's own React Flow `id` IS its store panelId (stable across
 * reload, mirrors `use-canvas-persistence.ts`'s `genuiPanelNodeId`).
 *
 * BIND-01 (Phase 33): `useDataBindings` resolves the panel's `spec.bindings`
 * (ABOVE the locked renderer chain, never inside it) into live tRPC query
 * data, merged over `panelData` as `{ ...panelData, ...liveBindingData }`
 * before reaching `GenuiPartBoundary`'s `data` prop — live binding values win
 * on key collision (the freshest source). Applies only to the genui_spec
 * branch below; the InteractiveWidgetBoundary branch is a separate D-08
 * surface, out of this phase's scope.
 *
 * PANL-01 (52-02-PLAN.md Task 3): a second `h-8` non-drag toolbar row
 * (`PanelActionsToolbar`) mounts directly below the `h-9` drag-handle row
 * and above the `ScrollArea` body — ONLY for the genui_spec branch (an
 * interactive_widget panel keeps its current chrome, no toolbar, out of
 * this phase's scope, mirrors BIND-01's own scoping above). The panel's
 * ACTUAL rendered content resolves through its overlay via
 * `resolveActivePanel` (an active version's spec if any, else the base
 * spec — streaming always forces the base spec verbatim) and is themed by
 * the resolved pack via `PanelThemeScope`, wrapping only that genui_spec
 * content inside `ScrollArea`. The outer shell wraps its content in
 * `<GeneratingRing>` (Judgment Call #5, 52-UI-SPEC.md) driven by the
 * toolbar's own `onGeneratingChange` signal — never the sole signal that
 * generation is in progress (the busy control's own aria-label/spinner is
 * the independent accessible signal).
 */

// Explicit React import (not just named hook imports) — this file's JSX
// compiles fine under Next.js's SWC automatic JSX runtime, but vitest's
// plain esbuild transform defaults to the classic runtime
// (React.createElement) and needs `React` in scope whenever a test mounts
// this component directly (mirrors canvas-store-context.tsx's identical
// note — found live, 52-02-PLAN.md Task 3, genui-panel-node-toolbar.test.tsx).
import * as React from "react";
import { memo, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { PanelsTopLeft } from "lucide-react";

import { ScrollArea } from "@polytoken/ui/scroll-area";

import { GeneratingRing } from "~/components/generating-ring";

import { GenuiPartBoundary } from "../_components/genui-part-boundary";
import {
  InteractiveWidgetBoundary,
  type InteractiveWidgetPart,
} from "../_components/interactive-widget-boundary";
import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";
import { usePanelData, useIncomingEdgesForPanel } from "./canvas-store-context";
import { usePanelActionRegistry } from "./panel-action-bridge";
import { useCanvasPart, useCanvasSpec } from "./canvas-spec-context";
import { useOptionalChatController } from "./chat-node";
import { useDataBindings } from "./use-data-bindings";
import { PanelActionsToolbar } from "./panel-actions-toolbar";
import { PanelThemeScope } from "./panel-theme-scope";
import { resolveActivePanel } from "./panel-overlay";
import { usePanelOverlay } from "./panel-overlay-context";
import type { GenuiPanelNodeData } from "./node-data-schemas";

export type GenuiPanelNodeType = Node<GenuiPanelNodeData, "genui-panel">;

/**
 * GenuiPanelNodeBody — heavy content (spec render) split from the node shell:
 * React Flow's per-drag-tick position props defeat the node component's memo,
 * but this body's props (provenance ref + turnIndex) are stable, so the
 * SpecRenderer tree never re-renders mid-drag (CANVAS-04; found live
 * 2026-07-04).
 */
const GenuiPanelNodeBody = memo(function GenuiPanelNodeBody({
  panelId,
  provenance,
  turnIndex,
  onGeneratingChange,
}: {
  readonly panelId: string;
  readonly provenance: GenuiPanelNodeData["provenance"];
  readonly turnIndex: number;
  /** Forwarded to `PanelActionsToolbar` so the outer shell's
   * `<GeneratingRing>` can react to a regenerate/re-theme in flight
   * (52-02-PLAN.md Task 3) — stable across renders (the outer `useState`
   * setter), so this prop never defeats this component's own memo (see
   * file header). */
  readonly onGeneratingChange: (on: boolean) => void;
}) {
  const { specJson, isStreaming } = useCanvasSpec(provenance);
  const part = useCanvasPart(provenance);
  const controller = useOptionalChatController();
  const incomingEdges = useIncomingEdgesForPanel(panelId);
  const { data: panelData, dispatch } = usePanelData(panelId, incomingEdges);
  const actions = usePanelActionRegistry(dispatch);
  const liveBindingData = useDataBindings({ specJson, isStreaming, panelData });

  // PANL-01..04 (52-02-PLAN.md Task 3): the panel's ACTUAL rendered content
  // resolves through its overlay — an active version's spec (if any) and/or
  // an overlay pack override win over the raw base spec/pack, EXCEPT while
  // still streaming (resolveActivePanel forces the base spec verbatim then).
  const { overlay } = usePanelOverlay(panelId);
  const resolved = resolveActivePanel(overlay, specJson, isStreaming);

  // D-08: an interactive_widget part renders the SAME InteractiveWidgetBoundary
  // as the transcript, fed by the SAME controller-derived widget surface — a
  // click in either surface updates both (one message-part source of truth).
  // Rendered variant="bare" so the node shell stays the only bordering layer.
  const isInteractiveWidget = part?.type === "interactive_widget";

  return (
    <>
      {/* The sketch's `.ch` — a --hair rule, a --faded icon, no fill. */}
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-hair px-3 active:cursor-grabbing">
        <span className="flex min-w-0 items-center gap-2">
          <PanelsTopLeft className="size-3 shrink-0 text-faded" aria-hidden />
          {/* The sketch's `.cap` — polytoken's own caption for where this panel
              came from, so: sans, --pencil, micro step. */}
          <span className="truncate text-2xs font-normal text-pencil">
            From turn {turnIndex}
          </span>
        </span>
        {isStreaming && (
          <span
            className="text-ink motion-safe:animate-pulse"
            aria-label="Streaming"
          >
            ●
          </span>
        )}
      </div>

      {!isInteractiveWidget && (
        <PanelActionsToolbar
          panelId={panelId}
          provenance={provenance}
          activeSpecJson={resolved.specJson}
          resolvedPackId={resolved.packId}
          isStreaming={isStreaming}
          onGeneratingChange={onGeneratingChange}
        />
      )}

      <ScrollArea className="min-h-0 flex-1">
        {/* The sketch's `.cbody` rhythm (padding:10px 12px 11px) on Phase 59's
            named step — `p-4`'s 16px was an inherited default, never a chosen
            density. `w-full` is D-61-06's obligation, not decoration: Radix's
            Viewport wraps children in an inline {min-width:100%;display:table}
            div that shrink-wraps to CONTENT, so a body that does not claim the
            full width lets a wide spec de-bound every descendant inside it. */}
        <div className="w-full p-row-y">
          {isInteractiveWidget ? (
            <InteractiveWidgetBoundary
              part={part as unknown as InteractiveWidgetPart}
              displayState={
                controller?.widgets.states[
                  (part as unknown as InteractiveWidgetPart).interactionId
                ] ?? "pending"
              }
              submittedValue={
                controller?.widgets.submittedValues[
                  (part as unknown as InteractiveWidgetPart).interactionId
                ]
              }
              errorMessage={
                controller?.widgets.errorMessages[
                  (part as unknown as InteractiveWidgetPart).interactionId
                ] ?? null
              }
              onSubmitResult={(result) =>
                controller?.widgets.onSubmitResult(
                  (part as unknown as InteractiveWidgetPart).interactionId,
                  result,
                )
              }
              variant="bare"
              data={panelData}
            />
          ) : (
            <PanelThemeScope packId={resolved.packId} tokenOverrides={resolved.tokenOverrides}>
              <GenuiPartBoundary
                specJson={resolved.specJson}
                isStreaming={isStreaming}
                data={{ ...panelData, ...liveBindingData }}
                actions={actions}
                variant="bare"
              />
            </PanelThemeScope>
          )}
        </div>
      </ScrollArea>
    </>
  );
});

export const GenuiPanelNode = memo(function GenuiPanelNode({
  id,
  data,
  selected,
}: NodeProps<GenuiPanelNodeType>) {
  const [generating, setGenerating] = useState(false);

  return (
    <div
      className={`h-full min-h-[272px] w-full min-w-[320px] animate-in fade-in-0 zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none ${canvasNodeShellClass(CANVAS_NODE_KIND_GEOMETRY["genui-panel"], selected === true)}`}
    >
      <Handle type="target" position={Position.Left} />
      <GeneratingRing active={generating} className="flex min-h-0 w-full flex-1 flex-col rounded-card">
        <GenuiPanelNodeBody
          panelId={id}
          provenance={data.provenance}
          turnIndex={data.turnIndex}
          onGeneratingChange={setGenerating}
        />
      </GeneratingRing>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
