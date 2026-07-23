"use client";

/**
 * file-node.tsx — FileNode: the canvas's `file` custom React Flow node
 * (FEATURE-CATALOG DR-03 — a vault file as a first-class canvas node,
 * alongside chat/genui-panel/knowledge-preview/email-thread/document/…).
 *
 * DELIBERATELY FETCHES NOTHING (the source-node posture, not the document-node
 * one). A vault object has no per-file `byId` read procedure — it is addressed
 * by tenant-relative LOCATION (path segments + basename), and the files router
 * exposes only folder `list` + `requestDownload`, both of which re-resolve the
 * key against `ctx.user.id`. So node.data carries the tiny immutable display
 * payload itself (name + folder path + optional label) and the node renders
 * SYNCHRONOUSLY: N file nodes must not cost N storage round-trips for a name the
 * layout row already holds. Download is a deliberate SEAM here — wiring the
 * "Download" action to `files.requestDownload` is b5-drive-ops' vault-api call
 * to make; this node's job is to make the file placeable and legible.
 *
 * LAW 2 on this card: a file NAME is METADATA/chrome, not the file's own words
 * (the vault itself renders names SANS — vault-types.ts D-66-05). So nothing
 * here is serif and nothing carries `data-evidence`; the whole card is chrome
 * describing where a blob lives. This mirrors ChatNode's title decision (a
 * conversation title is chrome → sans), NOT EmailThreadNode's (mail body →
 * serif).
 *
 * Kind geometry: `CANVAS_NODE_KIND_GEOMETRY["file"]` — a LEFT rule at evidence
 * weight (2, the user's own material, raw) plus a BOTTOM rule (the "shelf" a
 * stored file rests on), SOLID (a real artifact at rest, never a guess or a
 * view). No other kind rules its bottom edge, so this is distinct from every
 * sibling without spending a hue (law 3). Remove drops only the placement; the
 * vault object is untouched (mirrors the sibling nodes byte-for-byte).
 */

import * as React from "react";
import { memo } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { File as FileIcon, X } from "lucide-react";

import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";
import type { FileNodeData } from "./node-data-schemas";

export type FileNodeType = Node<FileNodeData, "file">;

/**
 * resolveFileLabel — an explicit `label` always wins; otherwise the file's own
 * basename. Never empty (the schema guarantees `name` is a non-empty segment).
 */
export function resolveFileLabel(
  customLabel: string | undefined,
  name: string,
): string {
  if (customLabel !== undefined && customLabel.length > 0) return customLabel;
  return name;
}

/**
 * formatFolder — the human folder line under the name. Root ("[]") reads
 * "Vault root"; a nested path reads "invoices / 2026". Pure display; the
 * segments are already schema-validated (no traversal), so this only joins.
 */
export function formatFolder(path: readonly string[]): string {
  return path.length === 0 ? "Vault root" : path.join(" / ");
}

export const FileNode = memo(function FileNode({
  id,
  data,
  selected,
}: NodeProps<FileNodeType>) {
  const { deleteElements } = useReactFlow();
  const headerLabel = resolveFileLabel(data.label, data.name);

  return (
    <div
      className={`h-[120px] w-[280px] animate-in fade-in-0 zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none ${canvasNodeShellClass(CANVAS_NODE_KIND_GEOMETRY.file, selected === true)}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-hair px-3 active:cursor-grabbing">
        <span className="flex min-w-0 items-center gap-2">
          <FileIcon className="size-3 shrink-0 text-faded" aria-hidden />
          {/* A file name is chrome (SANS), not the file's own words (see header). */}
          <span className="truncate text-xs font-semibold text-ink">
            {headerLabel}
          </span>
        </span>
        <button
          type="button"
          aria-label="Remove file"
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-pencil transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
          onClick={(event) => {
            event.stopPropagation();
            void deleteElements({ nodes: [{ id }] });
          }}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-1 px-3 py-2">
        <span className="truncate text-2xs text-faded">
          {formatFolder(data.path)}
        </span>
        {data.name !== headerLabel ? (
          <span className="truncate text-2xs text-pencil">{data.name}</span>
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
