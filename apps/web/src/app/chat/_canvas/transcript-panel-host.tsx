"use client";

/**
 * transcript-panel-host.tsx — the provider seam that lets the DOCKED/MOBILE
 * transcript see panel overlays without mounting React Flow (61-07, SURF-07,
 * ROADMAP criterion 4 — backlog 999.17's read half).
 *
 * THE PROBLEM IT SOLVES. `usePanelOverlay` needs `CanvasStoreProvider` AND
 * `CanvasPersistenceProvider`, and until now only `chat-canvas.tsx` provided
 * them — so the docked transcript was architecturally BLIND to the overlay
 * store. A user re-themed a panel on the canvas, switched to Chat, and saw the
 * original: two views of one conversation disagreeing about what a panel looks
 * like. Everything else was already in place (`genuiPanelNodeId` and
 * `resolveActivePanel` are pure, `chat.getCanvasLayout` is a plain query,
 * `PanelThemeScope` is a component). This file is the missing seam, and
 * nothing more.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NEVER NEST THIS INSIDE THE CANVAS. It is mounted by `page.tsx` on the DOCKED
 * branch ONLY. The canvas branch already has the real host's providers, and a
 * ChatNode's own transcript (a node on the board whose body is a `MessageList`)
 * therefore resolves overlays through the CANVAS's live store, for free — see
 * `useOptionalPanelOverlay`. Two stores for one conversation is precisely the
 * drift this file exists to end.
 *
 * The invariant is STRUCTURAL, not a matter of discipline: `page.tsx`'s
 * `effectiveViewMode === "canvas" ? <ChatCanvasIsland/> : <TranscriptPanelHost/>`
 * branches are MUTUALLY EXCLUSIVE, so "never two hosts at once" is true by
 * construction. That is the sentence that should stop anyone from ever
 * "fixing" a hydration hiccup by wrapping the whole view in this.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ────────────────────────────────────────────────────────────────────────────
 * T-61-21 — WHY THIS IS NOT A TWENTY-LINE WRAPPER. READ BEFORE EDITING.
 *
 * `scheduleSave` snapshots `latestStateRef.{nodes,edges,viewport}` at fire time
 * and `chat.saveCanvasLayout` UPSERTS THE WHOLE ROW — `CanvasSnapshotSchema`
 * requires `nodes` and `edges`, and there is NO partial-save path.
 *
 * So the obvious wiring —
 *     useCanvasPersistence({ conversationId, nodes: [], edges: [], viewport: null })
 * — is a data-loss bug. The first time a panel writes an overlay from this
 * host (a re-theme, from a phone, where the canvas cannot even be reached), the
 * debounced save persists an EMPTY node list, silently deleting every node and
 * edge the user ever placed on that conversation's canvas. It passes every
 * existing test, because nothing in the suite asserted that a save preserves
 * the layout. `__tests__/transcript-overlay.test.tsx` now does, and it was
 * red-proven against exactly that naive version.
 *
 * THE MECHANISM: this host feeds the RESTORED layout back in as the LIVE state.
 * `useCanvasPersistence` hands us `initialNodes`/`initialEdges`/
 * `initialViewport` on the restore side; we convert them (via the SAME
 * `toFlowNode` the real canvas uses — one definition, no second copy) and pass
 * them straight back as its `nodes`/`edges`/`viewport`. A save scheduled from
 * the transcript therefore writes back exactly what it read, plus the new
 * `sharedState`. That round-trip IS the mitigation.
 *
 * AND THE WINDOW IS CLOSED STRUCTURALLY, not with an `isRestoring` check: an
 * overlay written before the layout has restored is the same bug wearing a
 * race. This host provides NO persistence context until the restored layout is
 * already the live state it hands the hook — `canvasStore === null` until then,
 * and `useCanvasStoreInstance`'s own `ready` gate (which exists for the exact
 * same reason: an eagerly-created store would permanently bake in an empty
 * seed) is the discipline being mirrored, not a second one being invented.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * WHAT IT DELIBERATELY DOES NOT PROVIDE:
 *   - React Flow. Nothing here renders a board.
 *   - `CanvasEdgesProvider` — data-carrying edges are drawn ON the board; a
 *     transcript has none. `useIncomingEdgesForPanel` already degrades to an
 *     empty list without it, so adding one "just in case" would be inventing a
 *     capability rather than wiring an existing one.
 *   - `CanvasSpecProvider` — the transcript already HAS its spec: it is reading
 *     the message part. The canvas needs that provider precisely because a node
 *     only carries a provenance ref (D-05).
 *   - `onOpenConversation` — that exists for `EmailThreadNode`'s "Attach chat"
 *     action (CLUS-01/CLUS-02), which is a canvas node. It is optional on the
 *     context and every consumer already treats it as an optional no-op.
 */

// Explicit React import — Next.js's SWC automatic JSX runtime tolerates its
// absence, but vitest's classic-runtime esbuild JSX transform needs `React` in
// scope for any suite that mounts this file directly (the documented gotcha
// every provider module in this directory carries; see canvas-store-context.tsx).
import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import type { Edge as FlowEdge, Node as FlowNode, Viewport } from "@xyflow/react";

import {
  CanvasStoreProvider,
  toCanvasStoreSeed,
  useCanvasStoreInstance,
} from "./canvas-store-context";
import {
  CanvasPersistenceProvider,
  type CanvasPersistenceContextValue,
} from "./panel-overlay-context";
import {
  toFlowNode,
  useCanvasPersistence,
  type PersistedCanvasEdge,
} from "./use-canvas-persistence";

// ---------------------------------------------------------------------------
// Reference-stable pre-restore state
//
// These are named constants and not inline literals for the reason §F of
// 61-07-PLAN records twice, both found LIVE: an inline `[]` allocates a new
// array on every render, and an unstable value handed to a hook whose effects
// depend on it re-fires those effects forever ("Maximum update depth
// exceeded" — `EMPTY_PERSISTED_EDGES` in use-canvas-persistence.ts exists for
// exactly this, found 2026-07-06).
//
// They are the LIVE state only in the window before the restore resolves — and
// in that window this host provides no persistence context at all, so nothing
// can schedule a save against them. See the T-61-21 block in the header.
// ---------------------------------------------------------------------------

const PRE_RESTORE_NODES: readonly FlowNode[] = [];
const PRE_RESTORE_EDGES: readonly FlowEdge[] = [];

/**
 * A persisted edge, projected back to the React Flow edge shape for the sole
 * purpose of being handed back to `buildSnapshot` unchanged.
 *
 * A SPREAD, deliberately — not `chat-canvas.tsx`'s `toFlowEdge`, and not a
 * field-by-field copy of it. Two reasons, and both are about this file's one
 * job:
 *   1. `buildSnapshot` reads only `{id, source, target, data.sourcePath,
 *      data.targetKey}` off an edge; `toFlowEdge`'s other fields (`type`,
 *      `animated`, `markerEnd`) are pure React Flow presentation and are never
 *      persisted. Importing it would drag `MarkerType` — a RUNTIME import from
 *      `@xyflow/react` — onto the docked chat route for nothing.
 *   2. A spread round-trips fields this function has never heard of. If the
 *      persisted edge schema ever grows one, an enumerating copy would silently
 *      DROP it on the next transcript-side save; the spread carries it through.
 *      For a function whose entire purpose is "change nothing", enumerating the
 *      fields is the more fragile choice.
 */
function toRoundTripFlowEdge(edge: PersistedCanvasEdge): FlowEdge {
  return { ...edge, data: { ...edge.data } };
}

/** The restored layout, tagged with the conversation it belongs to so a
 * conversation switch can never hand the new conversation's save the OLD
 * conversation's nodes (page.tsx remounts this via `key={selectedId}` today,
 * but a save that writes one conversation's layout into another's row is not a
 * failure mode to leave resting on a parent's key). */
interface RestoredLayout {
  readonly conversationId: string;
  readonly nodes: readonly FlowNode[];
  readonly edges: readonly FlowEdge[];
  readonly viewport: Viewport | null;
}

export interface TranscriptPanelHostProps {
  readonly conversationId: string;
  readonly children: React.ReactNode;
}

/**
 * TranscriptPanelHost — provides `CanvasStoreProvider` + `CanvasPersistenceProvider`
 * around a docked transcript so its genui panels resolve their overlays against
 * the same persisted `sharedState` the canvas writes.
 *
 * Renders `children` UNWRAPPED until the layout has restored. That is a
 * contract, not an optimization: the transcript must NEVER block on a
 * canvas-layout query. A conversation with no canvas row at all is the common
 * case — the overwhelming majority of conversations have never been opened on
 * the board — and its transcript must render immediately, with no overlays,
 * degrading to the base spec. Never skeleton a conversation waiting for a
 * layout that may not exist.
 */
export function TranscriptPanelHost({
  conversationId,
  children,
}: TranscriptPanelHostProps): React.ReactElement {
  const [restored, setRestored] = useState<RestoredLayout | null>(null);

  // Only ever the CURRENT conversation's restored layout — a stale one from a
  // previous conversation is treated as "not restored yet", never as live state.
  const live = restored?.conversationId === conversationId ? restored : null;

  // T-61-21: the live state IS the restored layout (see the header). Before the
  // restore lands, `live` is null and the stable pre-restore pair stands in —
  // a window in which no persistence context is provided, so no save exists to
  // read them.
  const persistence = useCanvasPersistence({
    conversationId,
    nodes: live?.nodes ?? PRE_RESTORE_NODES,
    edges: live?.edges ?? PRE_RESTORE_EDGES,
    viewport: live?.viewport ?? null,
  });

  const {
    initialNodes,
    initialEdges,
    initialViewport,
    initialSharedState,
    isRestoring,
    scheduleSave,
  } = persistence;

  // Feed the restore back in as the live state — the same shape of
  // seed-once-restore-resolves loop `chat-canvas.tsx` runs (which is what makes
  // the two surfaces produce the SAME snapshot from the same row). The
  // functional update's identity guard makes this idempotent: a re-run for an
  // already-restored conversation returns the current state reference
  // untouched, so it can never loop through `setRestored` -> render -> effect.
  useEffect(() => {
    if (isRestoring) return;
    setRestored((current) =>
      current?.conversationId === conversationId
        ? current
        : {
            conversationId,
            nodes: initialNodes.map(toFlowNode),
            edges: initialEdges.map(toRoundTripFlowEdge),
            viewport: initialViewport ?? null,
          },
    );
  }, [conversationId, isRestoring, initialNodes, initialEdges, initialViewport]);

  // ONE store per conversation, built ONLY once the restored layout is the live
  // state (`live !== null`) — strictly later than chat-canvas's `!isRestoring`,
  // and deliberately so: it makes the store and the persistence context appear
  // together, in the same commit, both already backed by a real snapshot. See
  // `useCanvasStoreInstance`'s own doc for why an eager store bakes in an empty
  // seed forever.
  const canvasStore = useCanvasStoreInstance(
    conversationId,
    toCanvasStoreSeed(initialSharedState),
    live !== null,
  );

  // `useMemo`, never an inline object literal — this value is the context's
  // identity, and a fresh one per render re-renders every panel consuming it
  // (§F). Mirrors `chat-canvas.tsx`'s `canvasPersistenceValue` exactly, down to
  // threading `onError` into the SAME real `chat.saveCanvasLayout` failure
  // signal rather than a parallel one (52-UI-REVIEW.md finding #1).
  const persistenceValue = useMemo<CanvasPersistenceContextValue>(
    () => ({
      scheduleSave: (onError) => scheduleSave(canvasStore, onError),
      conversationId,
    }),
    [scheduleSave, canvasStore, conversationId],
  );

  // Not ready — the transcript renders anyway, with no overlays. This is the
  // no-canvas-row case (the common one) as well as the pre-restore instant.
  if (canvasStore === null) {
    return <>{children}</>;
  }

  return (
    <CanvasStoreProvider store={canvasStore}>
      <CanvasPersistenceProvider value={persistenceValue}>{children}</CanvasPersistenceProvider>
    </CanvasStoreProvider>
  );
}
