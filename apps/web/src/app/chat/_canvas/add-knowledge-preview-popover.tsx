"use client";

/**
 * add-knowledge-preview-popover.tsx — AddKnowledgePreviewPopover: the
 * toolbar creation affordance for a `knowledge-preview` canvas node
 * (PREV-01, 41-UI-SPEC.md section 6).
 *
 * Upgraded from Phase 41's manual paste-an-ID-only form (its explicit scope
 * cut) after Phase 54 (CLUS-04): captured web sources land as
 * knowledge_nodes, and a user who just confirmed a capture must be able to
 * put it on the canvas without fishing a UUID off /knowledge. The popover
 * now lists the most recent knowledge nodes (`knowledge.list`, newest
 * first) as one-click rows; the manual ID input stays below as the
 * fallback for chat-citation-chip pastes. `z.string().uuid().safeParse`
 * still gates the manual path (T-41-07): an invalid/empty value never calls
 * `onAdd`, never creates a node — the popover stays open with inline error
 * copy instead. Controlled `open` state so a successful add can close
 * itself programmatically.
 */

import * as React from "react";
import { useState } from "react";
import { Share2 } from "lucide-react";
import { z } from "zod";

import { Button } from "@polytoken/ui/button";

import { CANVAS_PANEL_BUTTON_CLASS } from "./canvas-panel-button-class";
import { Input } from "@polytoken/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@polytoken/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@polytoken/ui/tooltip";

import { api } from "~/trpc/react";

const NODE_ID_SCHEMA = z.string().uuid();

export interface AddKnowledgePreviewPopoverProps {
  readonly onAdd: (focusNodeId: string, label: string | undefined) => void;
  /** A monotonically-changing nonce the pane context menu bumps to open this
   * popover programmatically (CI-01 "Add node ▸ Knowledge preview"); the
   * initial value never auto-opens. */
  readonly requestOpenNonce?: number;
}

/** Short human label for a knowledge node's origin (list row subtitle). */
function sourceLabel(source: string | null, scopeRefType: string | null): string {
  if (source === "web_search_capture" || scopeRefType === "web_source") {
    return "captured web source";
  }
  return source ?? "knowledge";
}

export function AddKnowledgePreviewPopover({
  onAdd,
  requestOpenNonce,
}: AddKnowledgePreviewPopoverProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  // Open when the host bumps the nonce (skip the initial mount value).
  const lastNonceRef = React.useRef(requestOpenNonce);
  React.useEffect(() => {
    if (requestOpenNonce !== undefined && requestOpenNonce !== lastNonceRef.current) {
      lastNonceRef.current = requestOpenNonce;
      setOpen(true);
    }
  }, [requestOpenNonce]);
  const [nodeIdInput, setNodeIdInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const { data } = api.knowledge.list.useQuery({ limit: 8 }, { enabled: open });
  const recentNodes = data?.items ?? [];

  function resetForm(): void {
    setNodeIdInput("");
    setLabelInput("");
    setValidationError(null);
  }

  function handleSelectRecent(nodeId: string, title: string | null): void {
    onAdd(nodeId, title ?? undefined);
    resetForm();
    setOpen(false);
  }

  function handleAddClick(): void {
    const result = NODE_ID_SCHEMA.safeParse(nodeIdInput.trim());
    if (!result.success) {
      setValidationError("Enter a valid knowledge node ID.");
      return; // keeps the popover open — onAdd never called on an invalid id
    }
    onAdd(result.data, labelInput.trim() || undefined);
    resetForm();
    setOpen(false);
  }

  function handleCancel(): void {
    resetForm();
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Add knowledge preview"
                className={CANVAS_PANEL_BUTTON_CLASS}
              >
                <Share2 className="size-4" aria-hidden />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Add knowledge preview</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent align="end" className="w-72 space-y-3">
        <p className="text-sm font-normal text-foreground">Add knowledge preview</p>
        {recentNodes.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Recent knowledge</p>
            <ul className="max-h-48 space-y-0.5 overflow-y-auto">
              {recentNodes.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                    onClick={() => handleSelectRecent(node.id, node.title)}
                  >
                    <span className="block truncate text-xs font-normal text-foreground">
                      {node.title ?? "Untitled knowledge"}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {sourceLabel(node.source, node.scopeRefType)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor="kp-node-id" className="text-xs text-muted-foreground">
            Or paste a knowledge node ID
          </label>
          <Input
            id="kp-node-id"
            placeholder="Paste a node ID…"
            value={nodeIdInput}
            onChange={(event) => setNodeIdInput(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Find an ID on the /knowledge graph, or paste one from a chat citation chip.
          </p>
          {validationError && <p className="text-xs font-medium text-ink">{validationError}</p>}
        </div>
        <div className="space-y-1">
          <label htmlFor="kp-label" className="text-xs text-muted-foreground">
            Label (optional)
          </label>
          <Input
            id="kp-label"
            placeholder="Custom name for this preview"
            value={labelInput}
            onChange={(event) => setLabelInput(event.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={!nodeIdInput.trim()}
            onClick={handleAddClick}
          >
            Add preview
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
