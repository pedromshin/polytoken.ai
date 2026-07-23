"use client";

/**
 * selection-toolbar.tsx — SelectionToolbar: the floating bulk-action bar for a
 * GENERAL multi-selection of ANY node type (CI-05). It is the generalization
 * of `canon-toolbar.tsx`: the same one-card chrome (`--bright` fill, `--rule`
 * hairline, zero shadow), the same live-region-outlives-the-selection posture,
 * but its selection substrate is React Flow's `selected` flag across every
 * node type — not source nodes alone.
 *
 * CANON IS A MODE, NOT A PARALLEL SYSTEM. When the general selection contains
 * promotable SOURCE nodes, the "Add N to canon" segment appears INSIDE this
 * one bar, calling the EXISTING promotion gate (`promoteSourcesToCanon` +
 * `markSourcesConfirmed`, unchanged from canon-toolbar). So source curation is
 * one facet of the general mechanism, and there is never a second toolbar
 * fighting this one for the bottom-center slot.
 *
 * Structural verbs (Duplicate / Delete) are delegated UP to the host so they
 * route through the CI-06 undo stack + the existing debounced save — this bar
 * owns no node mutation of its own except the canon tier flip (which is the
 * gate's settled result, persisted via `onPromotionSettled`).
 */

import * as React from "react";
import { useCallback, useState } from "react";
import type { Node as FlowNode } from "@xyflow/react";
import { BookMarked, Copy, Trash2, X } from "lucide-react";

import { Button } from "@polytoken/ui/button";

import {
  clearCanonSelection,
  markSourcesConfirmed,
  promotableCanonEntries,
} from "./canon-selection";
import {
  DEFAULT_CANON_IMPORTER_ID,
  promoteSourcesToCanon,
  type CanonNodesUpdater,
} from "./canon-toolbar";
import { selectedNodes } from "./canvas-selection";

export interface SelectionToolbarProps {
  readonly nodes: readonly FlowNode[];
  readonly setNodes: CanonNodesUpdater;
  /** Bulk-duplicate the current selection — host routes it through undo+save. */
  readonly onBulkDuplicate: () => void;
  /** Bulk-delete the current selection — host routes it through undo+save. */
  readonly onBulkDelete: () => void;
  /** Deselect everything (the general form of canon's clear). */
  readonly onClearSelection: () => void;
  /** Forwarded to the promotion proxy; defaults to the documented importer id. */
  readonly importerId?: string;
  /** Fired after a settled promotion changed ≥1 node's tier (host schedules
   * its existing debounced save). */
  readonly onPromotionSettled?: () => void;
}

export function SelectionToolbar({
  nodes,
  setNodes,
  onBulkDuplicate,
  onBulkDelete,
  onClearSelection,
  importerId = DEFAULT_CANON_IMPORTER_ID,
  onPromotionSettled,
}: SelectionToolbarProps): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const selected = selectedNodes(nodes);
  const promotable = promotableCanonEntries(nodes);

  const handlePromote = useCallback(async () => {
    if (busy || promotable.length === 0) return;
    setBusy(true);
    try {
      const outcome = await promoteSourcesToCanon(promotable, importerId);
      if (outcome.promotedNodeIds.length > 0) {
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

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
      {selected.length > 0 && (
        <div
          role="toolbar"
          aria-label="Selection actions"
          className="pointer-events-auto flex items-center overflow-hidden rounded-card border border-rule bg-bright"
        >
          <span className="px-3 text-xs text-faded">
            {selected.length} selected
          </span>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            aria-label="Duplicate selection"
            className="h-11 gap-1.5 rounded-none px-3 text-xs text-ink"
            onClick={onBulkDuplicate}
          >
            <Copy className="size-4" aria-hidden />
            Duplicate
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            aria-label="Delete selection"
            className="h-11 gap-1.5 rounded-none px-3 text-xs text-ink"
            onClick={onBulkDelete}
          >
            <Trash2 className="size-4" aria-hidden />
            Delete
          </Button>
          {promotable.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              aria-busy={busy}
              className="h-11 gap-1.5 rounded-none px-3 text-xs text-ink"
              onClick={() => {
                void handlePromote();
              }}
            >
              <BookMarked className="size-4" aria-hidden />
              {busy ? "Adding to canon…" : `Add ${promotable.length} to canon`}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Clear selection"
            disabled={busy}
            className="size-11 rounded-none text-ink"
            onClick={onClearSelection}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}
