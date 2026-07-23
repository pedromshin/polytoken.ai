"use client";

/**
 * canvas-context-menu.tsx — the four canvas context menus (CI-01): pane, node,
 * edge, and multi-selection. Built on the vendored `@polytoken/ui/context-menu`
 * (Radix). React Flow owns the native `contextmenu` event and reports WHAT was
 * right-clicked via `onPaneContextMenu`/`onNodeContextMenu`/…; the host stores
 * that as `target` and passes it here, and this component renders the matching
 * menu body. The whole flow surface is the single `ContextMenuTrigger`, so
 * Radix positions the menu at the pointer for free.
 *
 * The pane "Add node ▸" submenu is GENERATED from `NODE_TYPE_REGISTRY` via
 * `addNodeMenuItems` (never hand-listed); node/edge verbs come from the same
 * `canvas-menu-model.ts` data. INV-4: a verb's `confirm` copy is read from the
 * descriptor, so a future irreversible verb gates itself with no new branch
 * here.
 */

import * as React from "react";
import type { Edge as FlowEdge, Node as FlowNode } from "@xyflow/react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@polytoken/ui/context-menu";

import {
  addNodeMenuItems,
  EDGE_VERBS,
  GENERIC_NODE_VERBS,
  humanizeNodeType,
} from "./canvas-menu-model";

export type CanvasContextTarget =
  | { readonly kind: "pane" }
  | { readonly kind: "node"; readonly node: FlowNode }
  | { readonly kind: "edge"; readonly edge: FlowEdge }
  | { readonly kind: "selection"; readonly nodeIds: readonly string[] };

export interface CanvasContextMenuHandlers {
  readonly onAddNode: (nodeType: string) => void;
  readonly onPaste: () => void;
  readonly onFitView: () => void;
  readonly onDuplicateNode: (nodeId: string) => void;
  readonly onRemoveNode: (nodeId: string) => void;
  readonly onConnectNodes: (sourceId: string, targetId: string) => void;
  /** Present only for node kinds that map to a sendable object (email-thread,
   * knowledge-preview, document, source); absent hides the verb. */
  readonly onSendNodeToChat?: (node: FlowNode) => void;
  /** Per-node gate: return false to hide "Send to chat" for kinds with no AI-04 SendableObject. */
  readonly isNodeSendableToChat?: (node: FlowNode) => boolean;
  readonly onEditEdgeLabel: (edge: FlowEdge) => void;
  readonly onReverseEdge: (edge: FlowEdge) => void;
  readonly onDeleteEdge: (edge: FlowEdge) => void;
  readonly onBulkDuplicate: () => void;
  readonly onBulkDelete: () => void;
}

export interface CanvasContextMenuProps {
  readonly target: CanvasContextTarget | null;
  readonly nodes: readonly FlowNode[];
  /** Node types the pane can actually create today (the rest render disabled). */
  readonly supportedAddTypes: ReadonlySet<string>;
  readonly canPaste: boolean;
  readonly handlers: CanvasContextMenuHandlers;
  readonly children: React.ReactNode;
}

/** Short human handle for a node in the "Connect to…" list — its humanized
 * type plus a truncated id tail so two same-type nodes are distinguishable. */
function nodeMenuLabel(node: FlowNode): string {
  const type = humanizeNodeType(node.type ?? "node");
  const tail = node.id.slice(-4);
  return `${type} · ${tail}`;
}

export function CanvasContextMenu({
  target,
  nodes,
  supportedAddTypes,
  canPaste,
  handlers,
  children,
}: CanvasContextMenuProps): React.ReactElement {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-48">
        {target?.kind === "pane" && (
          <PaneMenu
            supportedAddTypes={supportedAddTypes}
            canPaste={canPaste}
            handlers={handlers}
          />
        )}
        {target?.kind === "node" && (
          <NodeMenu node={target.node} nodes={nodes} handlers={handlers} />
        )}
        {target?.kind === "edge" && (
          <EdgeMenu edge={target.edge} handlers={handlers} />
        )}
        {target?.kind === "selection" && (
          <SelectionMenu count={target.nodeIds.length} handlers={handlers} />
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function PaneMenu({
  supportedAddTypes,
  canPaste,
  handlers,
}: {
  readonly supportedAddTypes: ReadonlySet<string>;
  readonly canPaste: boolean;
  readonly handlers: CanvasContextMenuHandlers;
}): React.ReactElement {
  const items = addNodeMenuItems(supportedAddTypes);
  return (
    <>
      <ContextMenuSub>
        <ContextMenuSubTrigger>Add node</ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-72 overflow-y-auto">
          {items.map((item) => (
            <ContextMenuItem
              key={item.nodeType}
              disabled={!item.addable}
              onSelect={() => handlers.onAddNode(item.nodeType)}
            >
              {item.label}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem disabled={!canPaste} onSelect={() => handlers.onPaste()}>
        Paste
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => handlers.onFitView()}>
        Fit view
      </ContextMenuItem>
    </>
  );
}

function NodeMenu({
  node,
  nodes,
  handlers,
}: {
  readonly node: FlowNode;
  readonly nodes: readonly FlowNode[];
  readonly handlers: CanvasContextMenuHandlers;
}): React.ReactElement {
  const connectTargets = nodes.filter((candidate) => candidate.id !== node.id);
  return (
    <>
      {GENERIC_NODE_VERBS.map((verb) => {
        if (
          verb.id === "sendToChat" &&
          (handlers.onSendNodeToChat === undefined ||
            handlers.isNodeSendableToChat?.(node) === false)
        ) {
          // Hide the verb on node kinds that have no AI-04 SendableObject
          // (it would otherwise render everywhere and silently no-op).
          return null;
        }
        if (verb.id === "connect") {
          return (
            <ContextMenuSub key={verb.id}>
              <ContextMenuSubTrigger disabled={connectTargets.length === 0}>
                {verb.label}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="max-h-72 overflow-y-auto">
                {connectTargets.map((candidate) => (
                  <ContextMenuItem
                    key={candidate.id}
                    onSelect={() =>
                      handlers.onConnectNodes(node.id, candidate.id)
                    }
                  >
                    {nodeMenuLabel(candidate)}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          );
        }
        return (
          <ContextMenuItem
            key={verb.id}
            onSelect={() => {
              if (verb.confirm && !window.confirm(verb.confirm)) return;
              if (verb.id === "duplicate") handlers.onDuplicateNode(node.id);
              else if (verb.id === "remove") handlers.onRemoveNode(node.id);
              else if (verb.id === "sendToChat")
                handlers.onSendNodeToChat?.(node);
            }}
          >
            {verb.label}
          </ContextMenuItem>
        );
      })}
    </>
  );
}

function EdgeMenu({
  edge,
  handlers,
}: {
  readonly edge: FlowEdge;
  readonly handlers: CanvasContextMenuHandlers;
}): React.ReactElement {
  return (
    <>
      {EDGE_VERBS.map((verb) => (
        <ContextMenuItem
          key={verb.id}
          onSelect={() => {
            if (verb.confirm && !window.confirm(verb.confirm)) return;
            if (verb.id === "editLabel") handlers.onEditEdgeLabel(edge);
            else if (verb.id === "reverse") handlers.onReverseEdge(edge);
            else if (verb.id === "delete") handlers.onDeleteEdge(edge);
          }}
        >
          {verb.label}
        </ContextMenuItem>
      ))}
    </>
  );
}

function SelectionMenu({
  count,
  handlers,
}: {
  readonly count: number;
  readonly handlers: CanvasContextMenuHandlers;
}): React.ReactElement {
  return (
    <>
      <ContextMenuLabel>{count} selected</ContextMenuLabel>
      <ContextMenuItem onSelect={() => handlers.onBulkDuplicate()}>
        Duplicate
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => handlers.onBulkDelete()}>
        Delete
      </ContextMenuItem>
    </>
  );
}
