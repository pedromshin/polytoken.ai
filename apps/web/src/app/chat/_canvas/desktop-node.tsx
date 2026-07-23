"use client";

/**
 * desktop-node.tsx — DesktopNode: the canvas's `desktop` custom React Flow
 * node (Cloud Desktop epoch, VISION E5 / RFC §4) — a live remote-desktop panel
 * SHELL. RENDER-ONLY: no networking, no stream, no iframe mounted yet.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THE JAIL (browser-node's discipline, one machine wider)
 * ────────────────────────────────────────────────────────────────────────
 * A remote desktop is a WHOLE untrusted computer — the user will run arbitrary
 * software on it (RFC §6: "the desktop is untrusted, always"). So the same jail
 * the browser panel wears applies here, harder: the stream will mount LATER as
 * a sandboxed iframe — `sandbox="allow-scripts allow-same-origin
 * allow-pointer-lock"`, `frame-src` pinned to the session's per-session gateway
 * origin (RFC §4.2) — served from a per-session origin that NEVER shares the app
 * origin. That iframe is NOT built here: this shell mounts NO iframe and NO
 * remote src at all, only a teaching placeholder. When the streaming surface
 * lands (Phase CD-3) it replaces the placeholder under the exact §4.2 grant set.
 *
 * CAPABILITY WIRING IS BY ID STRING ONLY (INV-2): this file names the four
 * daemon/control-plane desktop capabilities through `DESKTOP_PANEL_CAPABILITY_IDS`
 * and imports nothing from the control plane or the daemon. The id is the
 * resolution key the registry allowlist and the ONE permission model act on
 * (INV-4: risk is data; `desktop.spawn`/`desktop.destroy` are irreversible and
 * always confirm-gated) — never resolved here.
 *
 * REF-ONLY DATA, harder than the siblings (panel-node-schemas.ts): node.data
 * carries an OPAQUE `sessionId` and display-only chrome (status/region/shape).
 * It NEVER carries a gateway URL or a stream token — those are minted
 * server-side per session at `desktop.attach` time (RFC §4.3: short-lived,
 * audience-scoped, delivered in the URL fragment, never persisted into a
 * layout row).
 *
 * LAW 2: a remote machine's screen pixels are NOT the user's authored words —
 * this card is a VIEW, exactly as the browser panel is (a viewport, not an
 * artifact). Everything on it — label, status line, uptime, burn rate,
 * placeholder copy — is polytoken's chrome, SANS throughout. No
 * `font-serif`/`data-evidence` anywhere (that pairing is only for the user's
 * own authored material; a streamed desktop is neither).
 *
 * Kind geometry: `CANVAS_NODE_KIND_GEOMETRY.desktop` — weight-2 DOTTED ink rule
 * + the panels' shared RIGHT SEAM RULE: the user's own whole machine (rule 2,
 * substantial — like the watched folder / knowledge preview) seen as a live
 * streamed VIEW with no words of its own (dotted, like the browser panel),
 * reached through the control plane (right seam). See the vocabulary's axis doc.
 *
 * Remove mirrors the siblings: `deleteElements` drops only the placement; the
 * cloud VM (if any) survives — tearing it down is `desktop.destroy`'s job, a
 * deliberate irreversible permissioned act, never a side effect of tidying the
 * canvas (ink, not madder — T-61-19).
 */

import * as React from "react";
import { memo } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { Expand, Monitor, X } from "lucide-react";

import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";
import { DesktopNodeCostTicker } from "./desktop-cost-ticker";
import type { DesktopNodeData } from "./panel-node-schemas";

export type DesktopNodeType = Node<DesktopNodeData, "desktop">;

/**
 * DESKTOP_PANEL_CAPABILITY_IDS — the four desktop lifecycle capabilities this
 * panel keys on, by id string only (RFC §5.1 is the descriptor truth; this map
 * is the outward-pointing reference the canvas consumer of INV-1 reads). The
 * desktop-node test pins these literals so a registry rename breaks a web gate
 * instead of silently orphaning the panel. spawn/destroy are irreversible and
 * always confirm-gated; attach/hibernate are reversible (INV-4: risk is data).
 */
export const DESKTOP_PANEL_CAPABILITY_IDS = {
  spawn: "desktop.spawn",
  attach: "desktop.attach",
  hibernate: "desktop.hibernate",
  destroy: "desktop.destroy",
} as const;

/**
 * resolveDesktopLabel — explicit `label` wins -> the fallback literal (mirrors
 * resolveEditorLabel/resolveDirectoryLabel's order; a desktop has no path to
 * take a last segment from, so it goes straight to the literal). Pure,
 * exported for the test.
 */
export function resolveDesktopLabel(label: string | undefined): string {
  if (label !== undefined && label.length > 0) return label;
  return "Cloud desktop";
}

/**
 * Status-aware placeholder copy — the teaching state for each lifecycle phase
 * the node chrome can be in (RFC §5.3). Pure chrome; the control plane is the
 * authority on the real machine's state (a tampered row cannot change it).
 */
function desktopPlaceholderCopy(status: DesktopNodeData["status"]): string {
  switch (status) {
    case "provisioning":
      return "Provisioning a cloud desktop — its live screen streams here once the machine is up.";
    case "running":
      return "This desktop is running — its live screen streams here as a jailed iframe when the streaming surface lands (CD-3).";
    case "hibernated":
      return "This desktop is hibernated — resume it to stream its screen here again.";
    case "destroyed":
      return "This desktop was destroyed — its VM and disk are gone.";
    default:
      return "No desktop session yet — spawn one to stream a whole cloud machine here.";
  }
}

/** The footer's short session-state word for each lifecycle phase. */
function desktopStatusLabel(status: DesktopNodeData["status"]): string {
  switch (status) {
    case "provisioning":
      return "provisioning";
    case "running":
      return "running";
    case "hibernated":
      return "hibernated";
    case "destroyed":
      return "destroyed";
    default:
      return "no session";
  }
}

export const DesktopNode = memo(function DesktopNode({
  id,
  data,
  selected,
}: NodeProps<DesktopNodeType>) {
  const { deleteElements } = useReactFlow();

  const headerLabel = resolveDesktopLabel(data.label);
  const status = data.status;
  const statusLabel = desktopStatusLabel(status);

  return (
    <div
      className={`h-[300px] w-[400px] animate-in fade-in-0 zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none ${canvasNodeShellClass(CANVAS_NODE_KIND_GEOMETRY.desktop, selected === true)}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-hair px-3 active:cursor-grabbing">
        <span className="flex min-w-0 items-center gap-2">
          <Monitor className="size-3 shrink-0 text-faded" aria-hidden />
          {/* Chrome, not evidence: a desktop panel label is polytoken's word —
              SANS (the same call browser-node.tsx makes; a machine's remote
              pixels are a VIEW, never the user's own authored words, law 2). */}
          <span className="truncate text-xs font-semibold text-ink">
            {headerLabel}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {/* EXPAND-TO-FULLSCREEN STUB (RFC §4.1: the dedicated surface is the
              node's expand state). Rendered as an honest disabled affordance —
              the overlay wiring that MOVES (never remounts) the WebRTC session
              lands with the streaming surface (Phase CD-3). A labelled control
              that states why beats dead-looking chrome or a silent no-op. */}
          <button
            type="button"
            disabled
            aria-disabled="true"
            aria-label="Fullscreen"
            title="Fullscreen — lands with the streaming surface, CD-3"
            className="flex size-6 shrink-0 cursor-not-allowed items-center justify-center rounded-sm text-faded opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
          >
            <Expand className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Remove desktop panel"
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
      {/* STREAM PLACEHOLDER — the ONLY surface this shell has today (see THE
          JAIL, header). No iframe, no img src to a remote origin: the live
          screen mounts LATER as a §4.2-sandboxed iframe pinned to the session
          gateway. role="img" is the teaching state, status-aware. */}
      <div
        role="img"
        aria-label="Remote desktop viewport placeholder"
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 bg-shade px-4 text-center"
      >
        <Monitor className="size-5 shrink-0 text-faded" aria-hidden />
        <p className="text-xs text-faded">{desktopPlaceholderCopy(status)}</p>
      </div>
      <div className="flex h-9 shrink-0 items-center justify-between gap-1 border-t border-hair px-3">
        {/* SANS state chrome (RFC §5.3): session status + the LIVE burn. The
            rate + start time ride the owner-scoped row (never node.data — a
            layout row is not a money source); the ticker animates the accrued
            total client-side. A running desktop burns continuously, so the
            chrome shows the burn rather than hiding it. */}
        <span className="flex min-w-0 items-center gap-1 truncate text-2xs text-faded">
          <span className="shrink-0">{statusLabel}</span>
          <span aria-hidden>·</span>
          <DesktopNodeCostTicker sessionId={data.sessionId} status={status} />
        </span>
        <span className="shrink-0 text-2xs text-faded">
          via {DESKTOP_PANEL_CAPABILITY_IDS.attach}
        </span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
