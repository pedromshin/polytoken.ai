"use client";

/**
 * canon-toolbar.tsx — CanonToolbar: the floating curation bar that appears
 * when ≥1 SOURCE node is selected on the canvas (RCNV-03 / Phase 63).
 *
 * WHAT IT IS: the deliberate half of "arrival is free, promotion is
 * deliberate" (taste-references.md §3). Sources land on the canvas with zero
 * ceremony (RCNV-02's wiring seam materializes them from the ledger without
 * the user asking); THIS bar is the one place a human turns that gathered
 * pile into canon — one explicit click on "Add N to canon".
 *
 * WHAT IT IS NOT (the CLUS-04 anti-goal, restated so nobody regresses it):
 * NEVER a per-turn chat widget. No confirm card ever appears in the
 * transcript for these sources; the bar exists only while a selection
 * exists, canvas-level, and disappears the moment the selection clears.
 *
 * THE GATE IT CALLS IS THE EXISTING ONE — this file adds ZERO promotion
 * machinery. `promoteSourcesToCanon` POSTs each selected ledger row to the
 * server-side-keyed proxy route (`/api/chat/sources/{ledgerId}/promote`,
 * the exact `/api/knowledge/edges/{edgeId}/promote` idiom — see
 * knowledge-graph.tsx's `promoteEdge`), behind which the Phase 56-05 reuse
 * seam (`PromoteSourceLedgerEntryUseCase`) reshapes the row onto the
 * UNCHANGED `SourceCaptureHandler` + `PromoteEdgeUseCase`: an INFERRED node/
 * edge upsert whose edge tier flips to EXTRACTED. Suggest-only, end to end —
 * nothing here (and nothing upstream of the click) ever promotes
 * automatically.
 *
 * WHAT SUCCESS LOOKS LIKE ON THE BOARD: the settled promotion is mirrored
 * back onto node.data via `markSourcesConfirmed`, which is precisely what
 * flips each card's pmark from dashed pencil-amber (suggested) to solid
 * verdigris (confirmed) — source-node.tsx already renders both tiers from
 * `data.tier`, so the tier flip IS the UI update. Promoted cards leave the
 * selection; failed ones stay selected for a no-re-gather retry. The host
 * then persists the flipped tier through its EXISTING debounced save
 * (`onPromotionSettled` → `persistence.scheduleSave`), never a new save path.
 *
 * CHROME: the same one-card language as the canvas's top-right Panel cluster
 * and the Controls card (61-05) — container carries the `--bright` fill and
 * `--rule` hairline, segments sit transparent inside it, zero shadow. All
 * text here is polytoken's own chrome, so it stays sans (law 2 — no source
 * words are quoted in this bar). Count/N are stated in ink; the bar announces
 * results through its own polite live region.
 *
 * DEFAULT_CANON_IMPORTER_ID duplicates knowledge-graph.tsx's documented
 * constant (23-04 precedent: importing the server constant drags server env
 * reads into client code) — same value, same reasoning, documented not
 * accidental.
 */

import * as React from "react";
import { useCallback, useState } from "react";
import type { Node as FlowNode } from "@xyflow/react";
import { BookMarked, X } from "lucide-react";

import { Button } from "@polytoken/ui/button";

import {
  clearCanonSelection,
  markSourcesConfirmed,
  promotableCanonEntries,
  selectedSourceNodes,
  type CanonEntry,
} from "./canon-selection";

// Mirrors knowledge-graph.tsx's DEFAULT_IMPORTER_ID (deliberate duplicate —
// see this file's header).
export const DEFAULT_CANON_IMPORTER_ID =
  "00000000-0000-0000-0000-000000000001";

// ---------------------------------------------------------------------------
// promoteSourcesToCanon — the fetch orchestration for "Add N to canon",
// extracted as a standalone async function (knowledge-graph.tsx's
// `promoteEdge` convention) so the sequencing + partial-failure contract is
// unit-testable without mounting the toolbar. Sequential on purpose: the
// gate's uuid5 upsert makes each call idempotent, but error ATTRIBUTION
// (which card failed) only stays simple when calls don't race, and a canon
// batch is small (a handful of cards, not a bulk import).
// ---------------------------------------------------------------------------

export interface CanonPromotionOutcome {
  /** Canvas node ids the gate actually confirmed — the ONLY ids
   * `markSourcesConfirmed` may ever be fed. */
  readonly promotedNodeIds: readonly string[];
  readonly failures: readonly {
    readonly nodeId: string;
    readonly errorMessage: string;
  }[];
}

export async function promoteSourcesToCanon(
  entries: readonly CanonEntry[],
  importerId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CanonPromotionOutcome> {
  const promotedNodeIds: string[] = [];
  const failures: { nodeId: string; errorMessage: string }[] = [];

  for (const entry of entries) {
    // entry.sourceLedgerId is UUID-gated by readCanonEntry before it can
    // reach this interpolation (canon-selection.tsx's untrusted-data posture).
    let ok = false;
    let errorMessage = "This source could not be added to the canon.";
    try {
      const response = await fetchImpl(
        `/api/chat/sources/${entry.sourceLedgerId}/promote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ importerId }),
        },
      );
      if (response.ok) {
        ok = true;
      } else {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (typeof body?.error === "string" && body.error.length > 0) {
          errorMessage = body.error;
        }
      }
    } catch {
      // Network-level failure — keep the friendly default message (the
      // detailed error is the server's to log, CLAUDE.md guardrail).
    }
    if (ok) {
      promotedNodeIds.push(entry.nodeId);
    } else {
      failures.push({ nodeId: entry.nodeId, errorMessage });
    }
  }

  return { promotedNodeIds, failures };
}

// ---------------------------------------------------------------------------
// CanonToolbar
// ---------------------------------------------------------------------------

/** setNodes-compatible updater signature — the host passes its React Flow
 * `setNodes` straight through (the ONE selection substrate; see
 * canon-selection.tsx's header). */
export type CanonNodesUpdater = (
  updater: (prev: FlowNode[]) => FlowNode[],
) => void;

export interface CanonToolbarProps {
  readonly nodes: readonly FlowNode[];
  readonly setNodes: CanonNodesUpdater;
  /** Forwarded to the promotion proxy; defaults to the documented
   * single-tenant importer id (knowledge-graph.tsx's own default). */
  readonly importerId?: string;
  /** Fired after a settled promotion changed at least one node's tier — the
   * host schedules its EXISTING debounced layout save here so the flipped
   * tier persists (never a new save path). */
  readonly onPromotionSettled?: () => void;
}

export function CanonToolbar({
  nodes,
  setNodes,
  importerId = DEFAULT_CANON_IMPORTER_ID,
  onPromotionSettled,
}: CanonToolbarProps): React.ReactElement | null {
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const selected = selectedSourceNodes(nodes);
  const promotable = promotableCanonEntries(nodes);

  const handlePromote = useCallback(async () => {
    if (busy || promotable.length === 0) return;
    setBusy(true);
    try {
      const outcome = await promoteSourcesToCanon(promotable, importerId);

      if (outcome.promotedNodeIds.length > 0) {
        // Tier flip (the pmark goes solid) + promoted cards leave the
        // selection; failed cards STAY selected for a no-re-gather retry.
        setNodes((prev) => [
          ...clearCanonSelection(
            markSourcesConfirmed(prev, outcome.promotedNodeIds),
            outcome.promotedNodeIds,
          ),
        ]);
        onPromotionSettled?.();
      }

      const added = outcome.promotedNodeIds.length;
      const failed = outcome.failures.length;
      setAnnouncement(
        failed === 0
          ? `Added ${added} ${added === 1 ? "source" : "sources"} to canon`
          : `Added ${added} to canon; ${failed} failed — still selected, try again`,
      );
    } finally {
      setBusy(false);
    }
  }, [busy, promotable, importerId, setNodes, onPromotionSettled]);

  const handleClear = useCallback(() => {
    setNodes((prev) => [...clearCanonSelection(prev)]);
    setAnnouncement("Selection cleared");
  }, [setNodes]);

  // The bar exists only while a canon selection exists — but the live region
  // must outlive the promotion that clears the selection, or the success
  // announcement unmounts mid-sentence. So the region always renders; only
  // the card is conditional.
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
      {selected.length > 0 && (
        <div
          role="toolbar"
          aria-label="Canon curation"
          className="pointer-events-auto flex items-center overflow-hidden rounded-card border border-rule bg-bright"
        >
          {/* Chrome, so sans + ink (law 2) — this bar quotes no source. */}
          <span className="px-3 text-xs text-faded">
            {selected.length} {selected.length === 1 ? "source" : "sources"}{" "}
            selected
          </span>
          <Button
            type="button"
            variant="ghost"
            disabled={busy || promotable.length === 0}
            aria-busy={busy}
            className="h-11 gap-1.5 rounded-none px-3 text-xs text-ink"
            onClick={() => {
              void handlePromote();
            }}
          >
            <BookMarked className="size-4" aria-hidden />
            {busy
              ? "Adding to canon…"
              : promotable.length === 0
                ? "Already in canon"
                : `Add ${promotable.length} to canon`}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Clear selection"
            disabled={busy}
            className="size-11 rounded-none text-ink"
            onClick={handleClear}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}
