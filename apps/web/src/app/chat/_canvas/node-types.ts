/**
 * node-types.ts — the module-level React Flow `nodeTypes` map (D-04/D-07:
 * defined ONCE at module scope, never inline in render — a fresh object
 * identity on every render would force React Flow to remount every node,
 * matching `/knowledge`'s established `graph-nodes.tsx` pattern).
 *
 * `resolveNodeComponent` is the companion lookup `ChatCanvas` (Task 3) uses
 * when it needs a component reference OUTSIDE the `nodeTypes` prop itself
 * (e.g. measuring/pre-checking a persisted node's type before render) — it
 * mirrors `resolveNodeType`'s (23-02) never-throws contract: an unregistered
 * type resolves to `UnknownNodeTypePlaceholder` rather than `undefined`
 * (CANVAS-03, T-23-05).
 */

import type { NodeTypes } from "@xyflow/react";

import { resolveNodeType } from "./node-type-registry";
import { BrowserNode } from "./browser-node";
import { ChatNode } from "./chat-node";
import { CirclePackNode } from "./circle-pack-node";
import { DesktopNode } from "./desktop-node";
import { DirectoryNode } from "./directory-node";
import { DocumentNode } from "./document-node";
import { EditorNode } from "./editor-node";
import { EmailThreadNode } from "./email-thread-node";
import { FileNode } from "./file-node";
import { GenuiPanelNode } from "./genui-panel-node";
import { KnowledgePreviewNode } from "./knowledge-preview-node";
import { SourceNode } from "./source-node";
import { SpreadsheetNode } from "./spreadsheet-node";
import { UnknownNodeTypePlaceholder } from "./unknown-node-type-placeholder";

export const nodeTypes: NodeTypes = {
  chat: ChatNode,
  "genui-panel": GenuiPanelNode,
  "knowledge-preview": KnowledgePreviewNode,
  "email-thread": EmailThreadNode,
  document: DocumentNode,
  source: SourceNode,
  directory: DirectoryNode,
  browser: BrowserNode,
  editor: EditorNode,
  desktop: DesktopNode,
  "circle-pack": CirclePackNode,
  spreadsheet: SpreadsheetNode,
  file: FileNode,
  // Plan 23-04 (restore + degrade, T-23-09/CANVAS-03): a node reconciled from
  // a persisted layout whose type this session's registry doesn't recognize
  // is rewritten to this fixed key (original type preserved in
  // data.nodeType) — it MUST be a real entry here or React Flow falls back
  // to its own default node renderer instead of the inert placeholder card.
  "unknown-node-type": UnknownNodeTypePlaceholder,
};

/**
 * resolveNodeComponent — looks up the React Flow component for a node
 * `type`. Never throws: an unregistered/legacy type resolves to
 * `UnknownNodeTypePlaceholder`, the same degrade-gracefully signal
 * `resolveNodeType` (23-02) already gives the data layer.
 */
export function resolveNodeComponent(type: string): NodeTypes[string] {
  const resolved = resolveNodeType(type);
  if (resolved.kind === "unknown") {
    return UnknownNodeTypePlaceholder;
  }
  return nodeTypes[resolved.entry.id] ?? UnknownNodeTypePlaceholder;
}
