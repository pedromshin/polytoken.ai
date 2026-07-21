"use client";

/**
 * browser-node.tsx — BrowserNode: the canvas's `browser` custom React Flow
 * node (v2.0 canvas panels) — a live browser panel SHELL.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THE JAIL (Phase 20's discipline, applied harder)
 * ────────────────────────────────────────────────────────────────────────
 * Phase 20's code-island jails arbitrary code in `<iframe sandbox=
 * "allow-scripts">` with a srcdoc CSP. This panel goes one step further:
 * it mounts NO iframe and NO remote src AT ALL. The live view is a
 * screenshot STREAM — PNG frames produced by the daemon's `browser.screenshot`
 * capability, arriving as data through the wiring seam — so remote content
 * never executes, navigates, or even renders in the web app's origin. The
 * url in node.data is display text for the url bar; it is never mounted as
 * an href or a src (and it is double-gated to http(s) anyway:
 * BrowserNodeDataSchema at write time, `safeBrowserUrl` here at render time,
 * T-61-04's defense-in-depth posture).
 *
 * CAPABILITY WIRING IS BY ID STRING ONLY (INV-2): this file names the six
 * daemon browser capabilities through `BROWSER_PANEL_CAPABILITY_IDS` and
 * emits pure INTENT objects (`browserNavigateIntent`) keyed on those ids.
 * It imports nothing from apps/daemon; the id is the resolution key the
 * daemon allowlist and permission model (INV-4: risk is data) act on. Until
 * the orchestrator threads the daemon bridge, submitting the url bar parks
 * the intent in local state and the panel says so honestly.
 *
 * LAW 2: everything on this card is polytoken's chrome (url bar, status
 * line, placeholder copy) — SANS throughout. A web page's own words never
 * appear here as text, only as pixels inside a daemon screenshot.
 *
 * Kind geometry: `CANVAS_NODE_KIND_GEOMETRY.browser` — weight-1 DOTTED ink
 * rule: a live viewport with no words of its own, a VIEW rather than an
 * artifact (source's claim), plus the panels' shared RIGHT SEAM RULE: a
 * live, daemon-backed surface (see the vocabulary's axis doc).
 *
 * Remove mirrors the siblings: `deleteElements` drops only the placement;
 * the daemon's browser session (if any) survives — closing it is
 * `browser.close`'s job, a deliberate permissioned act, never a side effect
 * of tidying the canvas.
 */

import * as React from "react";
import { memo, useState } from "react";
import { useDaemonTool } from "./_lib/use-daemon-tool";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { AppWindow, Camera, X } from "lucide-react";

import { canvasNodeShellClass } from "./canvas-node-shell-class";
import { CANVAS_NODE_KIND_GEOMETRY } from "./canvas-vocabulary";
import { isHttpPanelUrl } from "./panel-node-schemas";
import type { BrowserNodeData } from "./panel-node-schemas";

export type BrowserNodeType = Node<BrowserNodeData, "browser">;

/**
 * BROWSER_PANEL_CAPABILITY_IDS — the daemon's six browser.* capabilities, by
 * id string only (apps/daemon/src/tools/browser.ts is the executable truth;
 * this map is the outward-pointing reference the canvas consumer of INV-1
 * reads). The panel-nodes test pins these literals so a daemon rename breaks
 * a web gate instead of silently orphaning the panel.
 */
export const BROWSER_PANEL_CAPABILITY_IDS = {
  open: "browser.open",
  navigate: "browser.navigate",
  screenshot: "browser.screenshot",
  click: "browser.click",
  type: "browser.type",
  close: "browser.close",
} as const;

/** A pure capability-call intent — id string + input, nothing executable. */
export interface BrowserCapabilityIntent {
  readonly capabilityId: string;
  readonly input: Readonly<Record<string, unknown>>;
}

/**
 * safeBrowserUrl — render-time http(s) re-gate (defense in depth; the same
 * shape as source-node.tsx's safeSourceHref). A tampered layout row degrades
 * to an empty url bar, never a mounted scheme.
 */
export function safeBrowserUrl(url: string | undefined): string | null {
  if (url === undefined) return null;
  return isHttpPanelUrl(url) ? url : null;
}

/**
 * browserNavigateIntent — the url bar's submit, as data. Normalizes a bare
 * domain to https:// first (a url bar that rejects "example.com" is broken
 * chrome), then gates to http(s) — mirroring the daemon navigateInput's own
 * refine ("file:// would be a filesystem read wearing a browser costume").
 * Returns null for anything that fails the gate; the caller renders the
 * refusal, never forwards it.
 */
export function browserNavigateIntent(raw: string): BrowserCapabilityIntent | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  if (!isHttpPanelUrl(candidate)) return null;
  return {
    capabilityId: BROWSER_PANEL_CAPABILITY_IDS.navigate,
    input: { url: candidate },
  };
}

export const BrowserNode = memo(function BrowserNode({
  id,
  data,
  selected,
}: NodeProps<BrowserNodeType>) {
  const { deleteElements } = useReactFlow();

  const daemon = useDaemonTool();
  const persistedUrl = safeBrowserUrl(data.url);
  const [urlDraft, setUrlDraft] = useState<string>(persistedUrl ?? "");
  /** The last submitted intent — parked when there is no daemon; live when there is. */
  const [pendingIntent, setPendingIntent] = useState<BrowserCapabilityIntent | null>(
    null,
  );
  const [rejected, setRejected] = useState<boolean>(false);
  /** The last daemon screenshot as a base64 PNG — the ONLY live surface (rendered as a data: URI). */
  const [shot, setShot] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const intent = browserNavigateIntent(urlDraft);
    if (intent === null) {
      setRejected(true);
      setPendingIntent(null);
      return;
    }
    setRejected(false);
    setPendingIntent(intent);
    setLiveError(null);
    // LIVE when a daemon is present: navigate, then pull a screenshot frame. The daemon's ONE
    // permission model reads each capability's declared risk (navigate=write) and prompts; a
    // returned browser.screenshot base64 renders below as a data: PNG — remote pages never run here.
    // With no daemon, the intent simply parks (the status line says so).
    if (daemon.status === "ready" || daemon.status === "connecting") {
      void (async () => {
        const nav = await daemon.call("browser.navigate", { url: intent.input.url });
        if (!nav.ok) {
          setLiveError(nav.error);
          return;
        }
        const frame = await daemon.call("browser.screenshot", {});
        if (frame.ok && typeof frame.output.base64 === "string") {
          setShot(frame.output.base64);
          setPendingIntent(null);
        } else if (!frame.ok) {
          setLiveError(frame.error);
        }
      })();
    }
  }

  const headerLabel =
    data.label !== undefined && data.label.length > 0 ? data.label : "Browser";

  return (
    <div
      className={`h-[300px] w-[400px] animate-in fade-in-0 zoom-in-95 [animation-duration:250ms] motion-reduce:animate-none ${canvasNodeShellClass(CANVAS_NODE_KIND_GEOMETRY.browser, selected === true)}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="node-drag-handle flex h-9 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-hair px-3 active:cursor-grabbing">
        <span className="flex min-w-0 items-center gap-2">
          <AppWindow className="size-3 shrink-0 text-faded" aria-hidden />
          {/* Chrome, not evidence: a panel label is polytoken's word — SANS
              (the same call chat-node.tsx makes on a conversation title). */}
          <span className="truncate text-xs font-semibold text-ink">
            {headerLabel}
          </span>
        </span>
        <button
          type="button"
          aria-label="Remove browser panel"
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-pencil transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
          onClick={(event) => {
            event.stopPropagation();
            void deleteElements({ nodes: [{ id }] });
          }}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      {/* URL BAR — display + intent only. Submitting emits a browser.navigate
          intent by id string; nothing here fetches, mounts, or executes. */}
      <form
        onSubmit={handleSubmit}
        className="flex h-9 shrink-0 items-center gap-2 border-b border-hair px-3"
      >
        <input
          type="text"
          inputMode="url"
          aria-label="Address"
          aria-invalid={rejected}
          placeholder="example.com"
          value={urlDraft}
          onChange={(event) => setUrlDraft(event.target.value)}
          className="nodrag nopan h-6 min-w-0 flex-1 rounded-sm border border-hair bg-shade px-2 text-xs text-ink placeholder:text-faded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="submit"
          className="nodrag flex h-6 shrink-0 items-center rounded-sm px-2 text-xs text-faded transition-colors hover:bg-ink-05 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:h-11"
        >
          Go
        </button>
      </form>
      {/* SCREENSHOT-STREAM PLACEHOLDER — the ONLY live surface this panel
          will ever have (see THE JAIL, header). No iframe, no img src to a
          remote origin: frames arrive as daemon `browser.screenshot` data
          through the seam and render here as data: PNGs. */}
      {shot !== null ? (
        // THE ONE LIVE SURFACE: a daemon screenshot as a data: PNG. Not a remote src, not an
        // iframe — a static image of pixels the daemon captured. The jail holds.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`data:image/png;base64,${shot}`}
          alt="Live browser view (daemon screenshot)"
          className="min-h-0 w-full flex-1 bg-shade object-contain object-top"
        />
      ) : (
        <div
          role="img"
          aria-label="Browser viewport placeholder"
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 bg-shade px-4 text-center"
        >
          <Camera className="size-5 shrink-0 text-faded" aria-hidden />
          {rejected ? (
            <p className="text-xs text-faded">
              Only http(s) addresses can be opened here.
            </p>
          ) : liveError !== null ? (
            <p className="text-xs text-faded">The daemon refused: {liveError}</p>
          ) : pendingIntent !== null ? (
            <p className="text-xs text-faded">
              {daemon.status === "no-daemon" || daemon.status === "error" ? "Parked" : "Loading"} —{" "}
              <span className="tabular">{String(pendingIntent.input.url)}</span>{" "}
              via {BROWSER_PANEL_CAPABILITY_IDS.navigate}.
            </p>
          ) : (
            <p className="text-xs text-faded">
              The live view streams here as screenshots from the daemon&apos;s
              browser — remote pages never run inside polytoken.
            </p>
          )}
        </div>
      )}
      <div className="flex h-9 shrink-0 items-center justify-between gap-1 border-t border-hair px-3">
        {/* SANS status chrome: which session capability this panel keys on. */}
        <span className="truncate text-2xs text-faded">
          {persistedUrl ?? "No page open"}
        </span>
        <span className="shrink-0 text-2xs text-faded">
          via {BROWSER_PANEL_CAPABILITY_IDS.screenshot}
        </span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
