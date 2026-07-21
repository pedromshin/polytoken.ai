"use client";

/**
 * directory-node.tsx — DirectoryNode: the canvas's `directory` custom React
 * Flow node (v2.0 canvas panels) — a WATCHED FOLDER as a first-class node.
 *
 * A STUB in the same sense document-node.tsx declares itself one: it makes a
 * daemon-watched folder placeable on the canvas, anchored on `data.path`. It
 * fetches NOTHING (no trpc import — mirrors SourceNode): node.data carries a
 * bounded immutable tree-preview snapshot (`entries`, panel-node-schemas.ts),
 * and the LIVE tree arrives later through the daemon's `fs.list` capability —
 * referenced by ID STRING ONLY (`DIRECTORY_PANEL_CAPABILITY_IDS`); this file
 * imports nothing from the daemon.
 *
 * LAW 2 on this card: entry NAMES are the user's own material (their real
 * files on their real disk), so each row's name span is SERIF + data-evidence
 * — marked on the SPAN, never on the row (a serif container would hand the
 * font to the sans depth-guides by inheritance, which no className gate can
 * see). The path caption and row counts are polytoken's summary chrome: SANS.
 *
 * Kind geometry: `CANVAS_NODE_KIND_GEOMETRY.directory` — weight-2 solid ink
 * rule: the user's own files, raw and present in full (email-thread's claim),
 * plus the panels' shared RIGHT SEAM RULE: a live, daemon-backed surface
 * (see the vocabulary's axis doc).
 *
 * ATTACH-CHAT AFFORDANCE STUB: the footer renders the same "Attach chat"
 * affordance EmailThreadNode wires for real, DISABLED with honest copy — the
 * seam is `chat.createConversation` + a future attachConversationToDirectory
 * procedure, which does not exist yet. A disabled labelled control that states
 * why beats dead-looking chrome or a silent no-op (taste checklist item 4's
 * spirit: teach, don't test memory).
 *
 * Remove mirrors the sibling nodes byte-for-byte: `deleteElements` drops only
 * the placement; the watched folder and its daemon watch survive (ink, not
 * madder — T-61-19).
 */

import * as React from "react";
import { memo } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { File, Folder, FolderOpen, MessageSquarePlus, RefreshCw, X } from "lucide-react";

import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { useDaemonTool } from "./_lib/use-daemon-tool";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";
import type { DirectoryEntry, DirectoryNodeData } from "./panel-node-schemas";

export type DirectoryNodeType = Node<DirectoryNodeData, "directory">;

/**
 * DIRECTORY_PANEL_CAPABILITY_IDS — the daemon capabilities this panel is
 * ABOUT, by id string only (INV-2: the id is THE resolution key; the web app
 * never imports daemon code). The wiring seam resolves these against the
 * daemon registry's allowlist when it threads live data into this panel.
 */
export const DIRECTORY_PANEL_CAPABILITY_IDS = {
  list: "fs.list",
  read: "fs.read",
} as const;

/**
 * resolveDirectoryLabel — mirrors DocumentNode's resolveHeaderLabel order:
 * explicit `label` wins -> the path's last segment -> the whole path ->
 * the fallback literal. Pure, exported for the test.
 */
export function resolveDirectoryLabel(
  label: string | undefined,
  path: string,
): string {
  if (label !== undefined && label.length > 0) return label;
  const segments = path.split(/[\\/]+/).filter((s) => s.length > 0);
  const last = segments[segments.length - 1];
  if (last !== undefined && last.length > 0) return last;
  return "Watched folder";
}

/**
 * clampDirectoryEntries — the render-time half of the schema's bounds
 * (defense in depth, T-61-04: node.data arrives from a user-writable row and
 * the restore path validates only the generic snapshot schema). Re-caps rows
 * at 50 and depth at 6 so a tampered row can neither flood the card nor
 * indent off it.
 */
export function clampDirectoryEntries(
  entries: readonly DirectoryEntry[] | undefined,
): readonly DirectoryEntry[] {
  if (entries === undefined) return [];
  return entries.slice(0, 50).map((entry) => ({
    ...entry,
    depth: Math.max(0, Math.min(6, entry.depth)),
  }));
}

export const DirectoryNode = memo(function DirectoryNode({
  id,
  data,
  selected,
}: NodeProps<DirectoryNodeType>) {
  const { deleteElements } = useReactFlow();
  const daemon = useDaemonTool();

  const headerLabel = resolveDirectoryLabel(data.label, data.path);
  const [liveEntries, setLiveEntries] = React.useState<ReturnType<typeof clampDirectoryEntries> | null>(null);
  const entries = liveEntries ?? clampDirectoryEntries(data.entries);

  function handleRefresh(): void {
    if (daemon.status === "no-daemon" || daemon.status === "error") return;
    void (async () => {
      const r = await daemon.call("dir.list_tree", { path: data.path, maxDepth: 3 });
      if (r.ok && Array.isArray(r.output.entries)) {
        const mapped = (r.output.entries as Array<{ path: string; kind: "file" | "dir" | "other"; depth: number }>).map((e) => ({
          name: e.path.split(/[\\/]/).pop() ?? e.path,
          kind: e.kind === "dir" ? ("dir" as const) : ("file" as const),
          depth: Math.max(0, e.depth - 1),
        }));
        setLiveEntries(clampDirectoryEntries(mapped));
      }
    })();
  }

  return (
    <div
      className={`h-[240px] w-[300px] animate-in fade-in-0 zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none ${canvasNodeShellClass(CANVAS_NODE_KIND_GEOMETRY.directory, selected === true)}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-hair px-3 active:cursor-grabbing">
        <span className="flex min-w-0 items-center gap-2">
          <FolderOpen className="size-3 shrink-0 text-faded" aria-hidden />
          {/* The folder's NAME is the user's own path segment — SERIF +
              data-evidence on the SPAN (law 2; see header). */}
          <span
            className="truncate font-serif text-xs font-semibold text-ink"
            data-evidence
          >
            {headerLabel}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {daemon.status !== "no-daemon" && daemon.status !== "error" ? (
            <button
              type="button"
              aria-label="Refresh folder from the daemon"
              className="flex size-6 shrink-0 items-center justify-center rounded-sm text-pencil transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
              onClick={(event) => {
                event.stopPropagation();
                handleRefresh();
              }}
            >
              <RefreshCw className="size-3.5" aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Remove folder"
            className="flex size-6 shrink-0 items-center justify-center rounded-sm text-pencil transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
            onClick={(event) => {
              event.stopPropagation();
              void deleteElements({ nodes: [{ id }] });
            }}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </span>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col gap-1 px-3 py-2">
        {/* SANS: the path is polytoken's caption OF the folder (law 2 — same
            call source-node.tsx makes on its domain line). Display text only:
            never joined or fetched on the web side. */}
        <div className="flex min-w-0 items-center gap-2 text-2xs text-faded">
          <span className="truncate" title={data.path}>
            {data.path}
          </span>
        </div>
        {entries.length > 0 ? (
          <ul
            aria-label="Folder preview"
            className="mt-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden"
          >
            {entries.map((entry, index) => (
              <li
                key={`${entry.depth}:${entry.name}:${index}`}
                className="flex min-w-0 items-center gap-1.5 text-xs text-ink"
                style={{ paddingLeft: `${entry.depth * 12}px` }}
              >
                {entry.kind === "dir" ? (
                  <Folder className="size-3 shrink-0 text-faded" aria-hidden />
                ) : (
                  <File className="size-3 shrink-0 text-faded" aria-hidden />
                )}
                {/* The entry NAME is the user's real file — serif + evidence
                    on the span, never the row (law 2). */}
                <span className="truncate font-serif" data-evidence>
                  {entry.name}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-faded">
            No preview captured yet — the daemon&apos;s folder listing lands
            here as it watches.
          </p>
        )}
      </div>
      <div className="flex h-9 shrink-0 items-center justify-end gap-1 border-t border-hair px-2">
        {/* ATTACH-CHAT AFFORDANCE STUB (see header): the affordance
            EmailThreadNode wires for real, disabled until the directory
            attach procedure exists. The seam threads through
            chat.createConversation exactly as email-thread-node.tsx does. */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Attach chat — wiring lands with the directory attach seam"
          className="flex h-7 shrink-0 cursor-not-allowed items-center gap-1 rounded-sm px-2 text-xs text-faded opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:h-11"
        >
          <MessageSquarePlus className="size-3.5" aria-hidden />
          Attach chat
        </button>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
