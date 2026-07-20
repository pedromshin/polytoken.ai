"use client";

/**
 * use-canvas-persistence.ts — useCanvasPersistence: exact restore + reconcile-
 * from-history + unknown-type degrade (CANVAS-02, CANVAS-03, D-05/D-06/D-07,
 * T-23-09).
 *
 * Three pieces:
 *   - `reconcileNodesFromHistory(savedNodes, historyRows)` — a PURE function.
 *     Every saved node is restored at its EXACT saved position (D-06); a type
 *     this session's NODE_TYPE_REGISTRY doesn't recognize degrades to the
 *     inert `unknown-node-type` placeholder marker but keeps its saved
 *     position (never throws, never blanks the canvas — CANVAS-03/T-23-09).
 *     Any `genui_spec` message part in `historyRows` with NO matching saved
 *     node (a turn that completed since the last save) gets a fresh
 *     dagre-seeded position nudged clear of every already-placed node via
 *     `offsetCascadePosition` (D-03) — it never touches an already-restored
 *     node's position. This same function reconciles BOTH the initial restore
 *     (called with the persisted row's nodes) AND any live `historyRows`
 *     delta while the canvas stays mounted (called again with the CURRENT
 *     `nodes` state as `savedNodes` — its positions are then the "saved"
 *     ones to preserve).
 *   - `buildSnapshot(nodes, edges, viewport)` — a PURE function producing a
 *     `CanvasSnapshotSchema`-valid object stamped with `NODE_REGISTRY_VERSION`
 *     (D-04) and containing NO spec content (D-05) — reconstructs a degraded
 *     node's ORIGINAL type/data (dropping the synthetic `nodeType` marker)
 *     so a future registry addition can still "heal" a previously-unknown
 *     type back to normal instead of the placeholder identity being baked in
 *     forever.
 *   - `useCanvasPersistence({ conversationId, nodes, edges, viewport })` — on
 *     mount, reads `chat.getCanvasLayout`, re-validates the row against
 *     `CanvasSnapshotSchema` on the READ side too (T-23-09 — a tampered/
 *     legacy row degrades to an empty canvas rather than being trusted
 *     as-is), and returns the restored `{ initialNodes, initialEdges,
 *     initialViewport, isRestoring }`. `nodes`/`edges`/`viewport` are the
 *     LIVE React Flow state — kept in a ref for plan 23-04 Task 2's debounced
 *     `chat.saveCanvasLayout` save to read at save time.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Edge as FlowEdge, Node as FlowNode, Viewport } from "@xyflow/react";

import type { RouterOutputs } from "@polytoken/api-client";
import { CanvasSnapshotSchema, type CanvasSnapshot } from "@polytoken/api-client/chat-canvas";

import { api } from "~/trpc/react";

import type { MessagePart } from "../_hooks/use-chat-stream";
import type { ChatHistoryRow } from "../_hooks/use-conversation-controller";
import {
  CANVAS_NODE_DIMENSIONS,
  DEFAULT_CANVAS_NODE_DIMENSIONS,
  layoutCanvasNodes,
  offsetCascadePosition,
  type CanvasRect,
} from "./canvas-layout";
import type { CanvasStore } from "./canvas-store";
import { NODE_REGISTRY_VERSION } from "./node-registry-version";
import { resolveNodeType } from "./node-type-registry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PersistedCanvasNode = CanvasSnapshot["nodes"][number];
export type PersistedCanvasEdge = CanvasSnapshot["edges"][number];
export type PersistedCanvasViewport = NonNullable<CanvasSnapshot["viewport"]>;

export interface ReconciledNode {
  readonly id: string;
  readonly type: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly data: Record<string, unknown>;
  /** True only for a node Pass 2 just placed (a genui_spec part with no
   * saved/existing node yet) — the caller uses this to gate the one-time
   * fade-in entrance class (D-03) without replaying it on restored nodes. */
  readonly isNew: boolean;
}

// ---------------------------------------------------------------------------
// Node id helpers — the canonical `type:messageId:partIndex`-style ids every
// canvas node carries. Exported so chat-canvas.tsx never re-derives its own.
// ---------------------------------------------------------------------------

export function chatNodeId(conversationId: string): string {
  return `chat:${conversationId}`;
}

export function genuiPanelNodeId(messageId: string, partIndex: number): string {
  return `genui-panel:${messageId}:${partIndex}`;
}

/**
 * sourceNodeId — the canonical id for an auto-collected source node
 * (RCNV-02/RSRCH-03), keyed on the chat_source_ledger row's id. THE WIRING
 * SEAM anchors here: the reconcile step that materializes ledger rows as
 * canvas nodes (the source counterpart of `buildExpectedGenuiPanelSpecs`'s
 * Pass-2 auto-placement — sources appear WITHOUT the user asking) must derive
 * node ids through this function so a row is placed exactly once and a saved
 * placement is recognized on restore, never re-derived ad hoc.
 */
export function sourceNodeId(sourceLedgerId: string): string {
  return `source:${sourceLedgerId}`;
}

// ---------------------------------------------------------------------------
// reconcileNodesFromHistory — Pass 1 (restore + degrade) + Pass 2 (place new)
// ---------------------------------------------------------------------------

function dimensionsForType(type: string): { readonly width: number; readonly height: number } {
  return CANVAS_NODE_DIMENSIONS[type] ?? DEFAULT_CANVAS_NODE_DIMENSIONS;
}

function rectFor(position: { readonly x: number; readonly y: number }, type: string): CanvasRect {
  const dims = dimensionsForType(type);
  return { x: position.x, y: position.y, width: dims.width, height: dims.height };
}

interface ExpectedGenuiPanelSpec {
  readonly id: string;
  readonly data: Record<string, unknown>;
}

/** Every ACTIVE turn's genui_spec OR interactive_widget part (D-16: only the
 * currently-displayed sibling materializes a panel; D-08: an interactive
 * widget renders on the canvas exactly like a genui_spec, same provenance id
 * scheme) — the "what SHOULD exist" set reconcile checks saved/current nodes
 * against. interaction_result parts are transcript entries, never panels. */
function buildExpectedGenuiPanelSpecs(
  historyRows: readonly ChatHistoryRow[],
): ExpectedGenuiPanelSpec[] {
  const specs: ExpectedGenuiPanelSpec[] = [];
  for (const row of historyRows) {
    if (!row.isActive) continue;
    const parts = (row.parts as MessagePart[] | null) ?? [];
    parts.forEach((part, partIndex) => {
      if (part.type !== "genui_spec" && part.type !== "interactive_widget") return;
      specs.push({
        id: genuiPanelNodeId(row.id, partIndex),
        data: {
          provenance: { messageId: row.id, partIndex, runId: null },
          turnIndex: row.turnIndex,
        },
      });
    });
  }
  return specs;
}

/**
 * reconcileNodesFromHistory — see module doc. Pure; never mutates its inputs.
 */
export function reconcileNodesFromHistory(
  savedNodes: readonly PersistedCanvasNode[],
  historyRows: readonly ChatHistoryRow[],
): ReconciledNode[] {
  const reconciled: ReconciledNode[] = [];
  const placedRects: CanvasRect[] = [];
  const savedIds = new Set<string>();

  // Pass 1 — every saved node is restored EXACTLY (position honored, D-06);
  // a type unrecognized by the CURRENT registry degrades to the inert
  // placeholder instead of throwing or blanking the canvas (CANVAS-03,
  // T-23-09) — a stale/mismatched node_registry_version never throws here,
  // since resolution is per-node, not gated on the row's version field.
  for (const saved of savedNodes) {
    savedIds.add(saved.id);
    const resolved = resolveNodeType(saved.type);
    const degraded = resolved.kind === "unknown";
    const type = degraded ? "unknown-node-type" : saved.type;
    const data = degraded ? { ...saved.data, nodeType: saved.type } : saved.data;
    reconciled.push({ id: saved.id, type, position: saved.position, data, isNew: false });
    placedRects.push(rectFor(saved.position, type));
  }

  // Pass 2 — any genui_spec part CURRENT history expects with no saved/
  // existing node yet (a turn completed since the last save) gets a fresh
  // dagre-seeded position, nudged clear of every already-placed rect via
  // offsetCascadePosition (D-03) — never touches an already-restored node.
  const newSpecs = buildExpectedGenuiPanelSpecs(historyRows).filter(
    (spec) => !savedIds.has(spec.id),
  );
  if (newSpecs.length > 0) {
    const dagreSeed: FlowNode[] = newSpecs.map((spec) => ({
      id: spec.id,
      type: "genui-panel",
      position: { x: 0, y: 0 },
      data: spec.data,
    }));
    const laidOut = layoutCanvasNodes(dagreSeed, []);
    const dims = dimensionsForType("genui-panel");
    for (const node of laidOut) {
      const desired: CanvasRect = { x: node.position.x, y: node.position.y, ...dims };
      const finalPosition = offsetCascadePosition(desired, placedRects);
      reconciled.push({
        id: node.id,
        type: "genui-panel",
        position: finalPosition,
        data: node.data as Record<string, unknown>,
        isNew: true,
      });
      placedRects.push({ ...finalPosition, ...dims });
    }
  }

  return reconciled;
}

/**
 * withDefaultChatNode — CANVAS-01/D-02: the chat node is always present once
 * a conversation exists. If `nodes` (the reconciled restore result) has no
 * node id-matching `chatNodeId(conversationId)` yet (first-ever canvas visit
 * for this conversation — no saved row exists), synthesize the D-02 default:
 * one chat node centered at (0,0). Pure; never mutates `nodes`.
 */
export function withDefaultChatNode(
  nodes: readonly ReconciledNode[],
  conversationId: string,
): ReconciledNode[] {
  const id = chatNodeId(conversationId);
  if (nodes.some((node) => node.id === id)) {
    return [...nodes];
  }
  const defaultChatNode: ReconciledNode = {
    id,
    type: "chat",
    position: { x: 0, y: 0 },
    data: { conversationId },
    isNew: false,
  };
  return [defaultChatNode, ...nodes];
}

// ---------------------------------------------------------------------------
// toFlowNode — ReconciledNode -> the React Flow node shape
//
// MOVED HERE FROM chat-canvas.tsx (61-07). It lives beside `ReconciledNode`,
// the type it converts, because it now has TWO callers: `chat-canvas.tsx` (the
// real board) and `transcript-panel-host.tsx` (the docked transcript's overlay
// seam, which feeds the restored layout straight back as its live state so a
// transcript-scheduled save round-trips it — T-61-21).
//
// It is deliberately ONE function rather than a copy per caller: the two
// surfaces share one `chat_canvas_layouts` row and `saveCanvasLayout` UPSERTS
// it whole, so any drift between two conversions is a silent layout rewrite
// the next time the quieter surface saves.
//
// It is HERE and not imported from `chat-canvas.tsx` for a bundling reason
// that is load-bearing, not cosmetic: `chat-canvas.tsx` is reached exclusively
// through `chat-canvas-island.tsx`'s `dynamic(ssr: false)` import, so React
// Flow's runtime AND `@xyflow/react/dist/style.css` are NOT part of the /chat
// route's static graph today. `page.tsx` statically imports the transcript
// host, so importing this one function from `chat-canvas.tsx` would drag the
// whole xyflow bundle — and its UNLAYERED stylesheet, which beats every
// layered utility in the app before specificity is even consulted (61-06's
// finding) — onto the docked chat route, for a 12-line conversion.
// ---------------------------------------------------------------------------

/** React Flow's `dragHandle` selector — a node is dragged by its header row
 * only, never by its body (whose content is interactive). */
export const DRAG_HANDLE_SELECTOR = ".node-drag-handle";

/** New-panel materialization fade (23-UI-SPEC.md Interaction Contracts) —
 * `motion-safe:` gates it out entirely under prefers-reduced-motion. Applied
 * ONLY to a node `reconcileNodesFromHistory` just marked `isNew` — a node
 * restored from a saved layout must NOT replay this entrance on every reload. */
export const GENUI_PANEL_CLASS_NAME = "motion-safe:animate-in fade-in duration-200";

export function toFlowNode(reconciled: ReconciledNode): FlowNode {
  return {
    id: reconciled.id,
    type: reconciled.type,
    position: reconciled.position,
    dragHandle: DRAG_HANDLE_SELECTOR,
    className:
      reconciled.isNew && reconciled.type === "genui-panel"
        ? GENUI_PANEL_CLASS_NAME
        : undefined,
    data: reconciled.data,
  };
}

// ---------------------------------------------------------------------------
// buildSnapshot — the CanvasSnapshotSchema-valid save payload (D-05/D-06)
// ---------------------------------------------------------------------------

/** Reconstructs the ORIGINAL type of a degraded (`unknown-node-type`) node
 * from its synthetic `nodeType` data marker, so re-saving a still-unknown
 * node never bakes the placeholder identity in permanently — a future
 * registry addition can still "heal" it back on the next restore. */
function originalTypeFor(node: FlowNode): string {
  if (node.type === "unknown-node-type") {
    const nodeType = (node.data as Record<string, unknown> | undefined)?.nodeType;
    if (typeof nodeType === "string" && nodeType.length > 0) {
      return nodeType;
    }
  }
  return node.type ?? "unknown-node-type";
}

/** Strips the synthetic `nodeType` marker back out before persisting — it
 * exists only for `UnknownNodeTypePlaceholder`'s render-time copy, never as
 * part of the real, potentially-healable node.data. */
function originalDataFor(node: FlowNode): Record<string, unknown> {
  const data = (node.data ?? {}) as Record<string, unknown>;
  if (node.type !== "unknown-node-type") return data;
  const { nodeType: _nodeType, ...rest } = data;
  return rest;
}

/**
 * buildSnapshot — produces a `CanvasSnapshotSchema`-valid object (throws via
 * `.parse()` if the constructed candidate is somehow invalid — an internal
 * invariant violation, not untrusted external input; callers wrap this in a
 * try/catch, see Task 2's debounced save). Stamped with
 * `NODE_REGISTRY_VERSION` (D-04); contains NO spec content (D-05) —
 * genui-panel node.data carries only the provenance ref, never re-derived
 * from anything spec-shaped.
 *
 * `sharedState` (default `{}`, backward-compatible with every pre-23-05
 * call site) is the canvas store's CURRENT `values` bag (`panels.*` +
 * `shared.*`) — persisted verbatim so cross-panel wiring survives reload
 * (D-10); streaming/derived values are never written into the store in the
 * first place, so there is nothing transient to strip here.
 */
export function buildSnapshot(
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
  viewport: Viewport | null | undefined,
  sharedState: Record<string, unknown> = {},
): CanvasSnapshot {
  const candidate = {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: originalTypeFor(node),
      position: { x: node.position.x, y: node.position.y },
      data: originalDataFor(node),
    })),
    edges: edges.map((edge) => {
      const edgeData = (edge.data ?? {}) as Record<string, unknown>;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        data: {
          sourcePath: typeof edgeData.sourcePath === "string" ? edgeData.sourcePath : "",
          targetKey: typeof edgeData.targetKey === "string" ? edgeData.targetKey : "",
        },
      };
    }),
    ...(viewport ? { viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom } } : {}),
    sharedState,
    nodeRegistryVersion: NODE_REGISTRY_VERSION,
  };

  return CanvasSnapshotSchema.parse(candidate);
}

// ---------------------------------------------------------------------------
// useCanvasPersistence
// ---------------------------------------------------------------------------

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseCanvasPersistenceOptions {
  readonly conversationId: string;
  /** LIVE React Flow state — read via a ref at debounced-save time (plan
   * 23-04 Task 2); unused by the restore side computed here. */
  readonly nodes: readonly FlowNode[];
  readonly edges: readonly FlowEdge[];
  readonly viewport: Viewport | null;
}

export interface UseCanvasPersistenceResult {
  readonly initialNodes: ReconciledNode[];
  readonly initialEdges: readonly PersistedCanvasEdge[];
  readonly initialViewport: PersistedCanvasViewport | undefined;
  /** The persisted `chat_canvas_layouts.sharedState` snapshot (STATE-01/
   * D-10) — `undefined` on a conversation's first-ever canvas visit (no row
   * yet). Feeds `CanvasStoreProvider`'s hydration-on-mount seam. */
  readonly initialSharedState: CanvasSnapshot["sharedState"] | undefined;
  readonly isRestoring: boolean;
  /** "idle" (nothing saved yet this session) | "saving" (mutation in
   * flight) | "saved" (last save succeeded — SaveStatusIndicator shows
   * "Saved" for ~2s) | "error" (last save failed — the debounce timer
   * auto-retries on the NEXT triggering event, no manual retry). */
  readonly saveStatus: SaveStatus;
  /** Schedules a debounced (~800ms) `chat.saveCanvasLayout` mutation — call
   * from `onNodeDragStop`, an edge add/remove, or `onMoveEnd` (D-06).
   * Coalesces rapid successive calls into ONE save via a single trailing
   * timer; always snapshots the LATEST `nodes`/`edges`/`viewport` at fire
   * time (via `latestStateRef`), never whatever was current when scheduled.
   * `canvasStore` (optional — omit when nothing has changed there) is read
   * via `.getState().values` AT FIRE TIME (not at schedule time) so the
   * persisted `sharedState` is always the freshest snapshot (D-10).
   *
   * `onError` (optional) — invoked ONLY when the underlying
   * `chat.saveCanvasLayout` mutation genuinely fails (its own `onError`,
   * never a synchronous throw) for the debounce cycle THIS call's timer
   * fires as part of. Every `onError` registered while calls are still
   * being coalesced into the SAME pending timer fires together on that
   * cycle's failure (each caller's optimistic write is equally unpersisted)
   * — 52-UI-REVIEW.md's #1 finding: this is the real failure signal
   * `usePanelOverlay.writeOverlay` threads through to panels like
   * `PackSwitcher`/`VersionHistoryControl` so they can revert + toast on an
   * ACTUAL persistence failure, not just their own synchronous-throw test
   * seam. Never called on success; never called for a cycle other than the
   * one this listener was registered against. */
  readonly scheduleSave: (canvasStore?: CanvasStore | null, onError?: () => void) => void;
}

/** Re-validates the persisted row against `CanvasSnapshotSchema` on the READ
 * side too (T-23-09) — a tampered/legacy row (e.g. hand-edited in the DB,
 * or written by a future/incompatible schema version) degrades to `null`
 * (an empty canvas restore) rather than being trusted as-is. Never throws. */
function validateSavedRow(
  row: RouterOutputs["chat"]["getCanvasLayout"],
): CanvasSnapshot | null {
  if (row === null) return null;
  const candidate = {
    nodes: row.nodes,
    edges: row.edges,
    viewport: row.viewport ?? undefined,
    sharedState: row.sharedState,
    nodeRegistryVersion: row.nodeRegistryVersion,
  };
  const parsed = CanvasSnapshotSchema.safeParse(candidate);
  if (!parsed.success) {
    console.error(
      "[useCanvasPersistence] persisted canvas layout failed schema validation — restoring an empty canvas instead of trusting it",
      parsed.error.flatten(),
    );
    return null;
  }
  return parsed.data;
}

/** Debounce window (23-UI-SPEC.md D-06): a single trailing timer coalesces
 * rapid successive {drag, edge add/remove, viewport settle} events into ONE
 * `chat.saveCanvasLayout` call. */
const SAVE_DEBOUNCE_MS = 800;

/** Reference-stable empty fallback for `initialEdges` (see its useMemo below) —
 * a bare `?? []` would allocate a new array every render and loop the reconcile
 * effect in chat-canvas.tsx. */
const EMPTY_PERSISTED_EDGES: readonly PersistedCanvasEdge[] = [];

/**
 * useCanvasPersistence — restore side: fetches `chat.getCanvasLayout`,
 * validates it, and returns the restored `{ initialNodes, initialEdges,
 * initialViewport, isRestoring }` (saved positions/viewport applied EXACTLY;
 * unknown types flagged for placeholder rendering via
 * `reconcileNodesFromHistory` called with empty `historyRows` — Pass 1 only,
 * no new-part placement at this layer). `chat-canvas.tsx` layers
 * `historyRows` reconciliation and the D-02 default-chat-node synthesis on
 * top of `initialNodes` itself (both need `conversationId`, which this
 * hook's restore step doesn't require).
 *
 * Save side (this task): `scheduleSave()` arms a single trailing ~800ms
 * timer (cleared on unmount); when it fires, it reads the LATEST
 * `nodes`/`edges`/`viewport` from `latestStateRef` (never a stale closure),
 * builds a snapshot via `buildSnapshot`, and calls `chat.saveCanvasLayout`.
 * `saveStatus` reflects the outcome for `SaveStatusIndicator`.
 */
export function useCanvasPersistence({
  conversationId,
  nodes,
  edges,
  viewport,
}: UseCanvasPersistenceOptions): UseCanvasPersistenceResult {
  const layoutQuery = api.chat.getCanvasLayout.useQuery({ conversationId });
  const saveMutation = api.chat.saveCanvasLayout.useMutation();

  const validatedRow = useMemo(
    () => (layoutQuery.data !== undefined ? validateSavedRow(layoutQuery.data) : null),
    [layoutQuery.data],
  );

  const initialNodes = useMemo(
    () => (validatedRow ? reconcileNodesFromHistory(validatedRow.nodes, []) : []),
    [validatedRow],
  );
  // MUST be reference-stable: `initialEdges` is a dependency of chat-canvas.tsx's
  // reconcile effect (which calls setNodes). A bare `validatedRow?.edges ?? []`
  // allocates a NEW `[]` every render whenever no saved layout exists (a fresh
  // conversation's first canvas visit) — that unstable dep re-fires the effect on
  // every render → setNodes → re-render → new `[]` → "Maximum update depth exceeded"
  // (found live 2026-07-06). Memoized on `validatedRow` with a stable empty fallback.
  const initialEdges = useMemo(
    () => validatedRow?.edges ?? EMPTY_PERSISTED_EDGES,
    [validatedRow],
  );
  const initialViewport = validatedRow?.viewport;
  const initialSharedState = validatedRow?.sharedState;
  const isRestoring = layoutQuery.isPending;

  // Kept fresh every render so the debounced save timer always reads the
  // LATEST live state, not whatever was current when it was scheduled.
  const latestStateRef = useRef({ nodes, edges, viewport });
  useEffect(() => {
    latestStateRef.current = { nodes, edges, viewport };
  }, [nodes, edges, viewport]);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasStoreRef = useRef<CanvasStore | null>(null);
  // Every onError listener registered by a scheduleSave call THIS pending
  // debounce cycle will coalesce into — flushed (called on failure, cleared
  // either way) exactly once when that cycle's real save settles. Cleared
  // whenever a NEW cycle's timer actually fires (never carries stale
  // listeners from an already-settled cycle into a later one).
  const pendingErrorListenersRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const scheduleSave = useCallback(
    (canvasStore?: CanvasStore | null, onError?: () => void) => {
      if (canvasStore !== undefined) canvasStoreRef.current = canvasStore;
      if (onError) pendingErrorListenersRef.current.push(onError);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        // Own this cycle's listeners now — anything scheduled AFTER this
        // point belongs to the NEXT cycle, never this one's outcome.
        const cycleErrorListeners = pendingErrorListenersRef.current;
        pendingErrorListenersRef.current = [];

        const current = latestStateRef.current;
        const sharedState = canvasStoreRef.current?.getState().values ?? {};

        let snapshot: CanvasSnapshot;
        try {
          snapshot = buildSnapshot(current.nodes, current.edges, current.viewport, sharedState);
        } catch (error) {
          // An internal invariant violation (not untrusted external input —
          // buildSnapshot only ever sees our own React Flow state) — never
          // crash the canvas over a failed save (CANVAS-03's ethos extended
          // to persistence failures). Still a genuine failure to persist —
          // fires this cycle's onError listeners same as a network failure.
          console.error("[useCanvasPersistence] buildSnapshot failed — skipping this save", error);
          setSaveStatus("error");
          for (const listener of cycleErrorListeners) listener();
          return;
        }

        setSaveStatus("saving");
        saveMutation.mutate(
          { conversationId, snapshot },
          {
            onSuccess: () => setSaveStatus("saved"),
            onError: (error) => {
              console.error("[useCanvasPersistence] saveCanvasLayout failed", error);
              setSaveStatus("error");
              for (const listener of cycleErrorListeners) listener();
            },
          },
        );
      }, SAVE_DEBOUNCE_MS);
    },
    [conversationId, saveMutation],
  );

  return {
    initialNodes,
    initialEdges,
    initialViewport,
    initialSharedState,
    isRestoring,
    saveStatus,
    scheduleSave,
  };
}
