"use client";

/**
 * editor-node.tsx — EditorNode: the canvas's `editor` custom React Flow node
 * (v2.0 canvas panels) — a JAILED, Monaco-less editor shell anchored on a
 * file path.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THE JAIL, and the code-server seam
 * ────────────────────────────────────────────────────────────────────────
 * This shell is a plain `<textarea>`. Deliberately: no Monaco bundle, no
 * eval/Function, no dangerouslySetInnerHTML, no syntax-highlighting pass
 * over untrusted file content — text in, text out, nothing executes
 * (Phase 20's jailed-eval posture, satisfied here by having nothing to
 * jail). SEAM NOTE for the real editor: when code-server (or Monaco) lands,
 * it mounts as a SEPARATE-ORIGIN `<iframe sandbox>` following
 * `code-island-frame.tsx`'s exact discipline (sandbox="allow-scripts", no
 * allow-same-origin, srcdoc/remote-origin CSP, postMessage authenticated by
 * source + origin + nonce) — it must NEVER be inlined into this component's
 * origin. This textarea is the honest v2.0 floor, not a placeholder lie.
 *
 * REF-ONLY DATA (panel-node-schemas.ts): node.data carries `filePath`, never
 * content. The draft below is LOCAL component state — it is deliberately
 * NOT persisted into node.data (a layout row must not become a shadow copy
 * of the file). Load/save travel through the daemon's `fs.read`/`fs.write`
 * capabilities — named by ID STRING ONLY via `EDITOR_PANEL_CAPABILITY_IDS`
 * (INV-2) and emitted as pure intents (`editorSaveIntent`); until the
 * orchestrator threads the daemon bridge, Save parks the intent and the
 * status line states it.
 *
 * LAW 2: the FILE PATH names the user's own file — SERIF + data-evidence on
 * the header span (the same claim directory-node.tsx makes on entry names).
 * The draft textarea holds the user's own words too, so it carries the same
 * serif + data-evidence pair; the status line and buttons are polytoken's
 * chrome, SANS.
 *
 * Kind geometry: `CANVAS_NODE_KIND_GEOMETRY.editor` — weight-2 DOUBLE ink
 * rule: an artifact being AUTHORED — the user's own material (2) composed
 * toward a bound standalone piece (double; document's claim, in progress),
 * plus the panels' shared RIGHT SEAM RULE: a live, daemon-backed surface
 * (see the vocabulary's axis doc).
 *
 * Remove mirrors the siblings: `deleteElements` drops only the placement;
 * the file on disk survives untouched (ink, not madder — T-61-19).
 */

import * as React from "react";
import { memo, useState } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { FileCode, X } from "lucide-react";

import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { useDaemonTool } from "./_lib/use-daemon-tool";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";
import type { EditorNodeData } from "./panel-node-schemas";

export type EditorNodeType = Node<EditorNodeData, "editor">;

/**
 * EDITOR_PANEL_CAPABILITY_IDS — the daemon capabilities this panel keys on,
 * by id string only (apps/daemon/src/tools/*.ts is the executable truth; the
 * id is the resolution key the allowlist and the ONE permission model act
 * on). Pinned by the panel-nodes test.
 */
export const EDITOR_PANEL_CAPABILITY_IDS = {
  read: "fs.read",
  write: "fs.write",
} as const;

/** A pure capability-call intent — id string + input, nothing executable. */
export interface EditorCapabilityIntent {
  readonly capabilityId: string;
  readonly input: Readonly<Record<string, unknown>>;
}

/**
 * editorSaveIntent — Save, as data: an `fs.write` intent for the daemon
 * bridge. The web side never touches the filesystem; the daemon broker
 * (canonicalizePath + roots) decides whether `filePath` is even reachable,
 * and `fs.write`'s declared risk ("write") drives the permission prompt
 * (INV-4). Pure, exported for the test.
 */
export function editorSaveIntent(
  filePath: string,
  content: string,
): EditorCapabilityIntent {
  return {
    capabilityId: EDITOR_PANEL_CAPABILITY_IDS.write,
    input: { path: filePath, content },
  };
}

/**
 * resolveEditorLabel — explicit `label` wins -> the path's last segment ->
 * the fallback literal (resolveDirectoryLabel's exact order, restated for a
 * file). Pure, exported for the test.
 */
export function resolveEditorLabel(
  label: string | undefined,
  filePath: string,
): string {
  if (label !== undefined && label.length > 0) return label;
  const segments = filePath.split(/[\\/]+/).filter((s) => s.length > 0);
  const last = segments[segments.length - 1];
  if (last !== undefined && last.length > 0) return last;
  return "Untitled file";
}

export const EditorNode = memo(function EditorNode({
  id,
  data,
  selected,
}: NodeProps<EditorNodeType>) {
  const { deleteElements } = useReactFlow();
  const daemon = useDaemonTool();

  const headerLabel = resolveEditorLabel(data.label, data.filePath);

  /** LOCAL draft only — never written into node.data (see header). */
  const [draft, setDraft] = useState<string>("");
  const [dirty, setDirty] = useState<boolean>(false);
  /** The last Save, parked as an intent when there is no daemon; sent live when there is. */
  const [pendingIntent, setPendingIntent] = useState<EditorCapabilityIntent | null>(
    null,
  );
  const [status, setStatus] = useState<string | null>(null);

  const live = daemon.status === "ready" || daemon.status === "connecting";

  function handleSave(): void {
    setPendingIntent(editorSaveIntent(data.filePath, draft));
    if (!live) return;
    setStatus("Saving…");
    void (async () => {
      // fs.write's declared risk is "write" → the daemon's ONE permission model prompts.
      const r = await daemon.call("fs.write", { path: data.filePath, content: draft });
      if (r.ok) {
        setDirty(false);
        setPendingIntent(null);
        setStatus("Saved");
      } else setStatus(`Refused: ${r.error}`);
    })();
  }

  function handleLoad(): void {
    if (!live) return;
    setStatus("Loading…");
    void (async () => {
      const r = await daemon.call("fs.read", { path: data.filePath });
      if (r.ok && typeof r.output.content === "string") {
        setDraft(r.output.content);
        setDirty(false);
        setStatus(null);
      } else if (!r.ok) setStatus(`Refused: ${r.error}`);
    })();
  }

  return (
    <div
      className={`h-[300px] w-[380px] animate-in fade-in-0 zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none ${canvasNodeShellClass(CANVAS_NODE_KIND_GEOMETRY.editor, selected === true)}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-hair px-3 active:cursor-grabbing">
        <span className="flex min-w-0 items-center gap-2">
          <FileCode className="size-3 shrink-0 text-faded" aria-hidden />
          {/* The file's NAME is the user's own material — SERIF +
              data-evidence on the SPAN (law 2; see header). */}
          <span
            className="truncate font-serif text-xs font-semibold text-ink"
            data-evidence
          >
            {headerLabel}
          </span>
          {data.language !== undefined && data.language.length > 0 ? (
            /* SANS chrome: a language tag is polytoken's classification. */
            <span className="shrink-0 rounded-sm border border-hair px-1 text-2xs text-faded">
              {data.language}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          aria-label="Remove editor"
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-pencil transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
          onClick={(event) => {
            event.stopPropagation();
            void deleteElements({ nodes: [{ id }] });
          }}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-3 py-2">
        {/* The draft is the user's own words — serif + data-evidence, padded
            so it reads as part of the paper, never a black rectangle punched
            into a card (anti-generic tell 6). nodrag/nopan/nowheel: typing
            and scrolling must not fight the canvas. */}
        <textarea
          aria-label={`Edit ${headerLabel}`}
          value={draft}
          spellCheck={false}
          placeholder="File content loads here through the daemon (fs.read) — start typing to draft."
          onChange={(event) => {
            setDraft(event.target.value);
            setDirty(true);
          }}
          className="nodrag nopan nowheel min-h-0 flex-1 resize-none rounded-sm border border-hair bg-shade px-2 py-1.5 font-serif text-xs leading-relaxed text-ink placeholder:font-sans placeholder:text-faded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-evidence
        />
      </div>
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-t border-hair px-3">
        {/* SANS status chrome. States live status, or the parked intent honestly. */}
        <span className="truncate text-2xs text-faded" title={data.filePath}>
          {status !== null
            ? status
            : pendingIntent !== null
              ? `Save parked as a ${EDITOR_PANEL_CAPABILITY_IDS.write} intent`
              : dirty
                ? "Unsaved draft"
                : data.filePath}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {live ? (
            <button
              type="button"
              onClick={handleLoad}
              className="nodrag flex h-7 shrink-0 items-center rounded-sm px-2 text-xs text-faded transition-colors hover:bg-ink-05 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:h-11"
            >
              Load
            </button>
          ) : null}
          <button
            type="button"
            disabled={!dirty}
            onClick={handleSave}
            className="nodrag flex h-7 shrink-0 items-center rounded-sm px-2 text-xs text-faded transition-colors hover:bg-ink-05 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-11"
          >
            Save
          </button>
        </span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
