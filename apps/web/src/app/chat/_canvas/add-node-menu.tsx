"use client";

/**
 * add-node-menu.tsx — AddNodeMenu: a tap-friendly "Add node" dropdown for the
 * canvas Panel ("i need to be able to add nodes of various types").
 *
 * The pane right-click "Add node ▸" submenu is desktop-only (a contextmenu
 * gesture), so a phone had NO way to place a node. This lives in the always-
 * visible top-right Panel and works on touch. It offers every type the canvas
 * can materialize today:
 *   - Email treemap / Drive treemap — the circle-pack landscape, placed
 *     directly (its data is a bare scope ref; the hierarchy rehydrates on the
 *     node), so no picker is needed.
 *   - Email thread… / Knowledge node… — open their existing search pickers
 *     (the host bumps each popover's requestOpenNonce).
 *
 * DESIGN: monochrome chrome, hairline, ink focus (58-IDENTITY law 1). A node
 * type is chrome → sans labels, never serif.
 */

import * as React from "react";
import { toast } from "sonner";
import {
  CircleDashed,
  FileText,
  HardDrive,
  Mail,
  Network,
  Plus,
  Table as TableIcon,
} from "lucide-react";

import { Button } from "@polytoken/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@polytoken/ui/dropdown-menu";

import { api } from "~/trpc/react";

import { CANVAS_PANEL_BUTTON_CLASS } from "./canvas-panel-button-class";

export interface AddNodeMenuProps {
  /** Place a circle-pack landscape of the given scope (no picker needed). */
  readonly onAddCirclePack: (scope: "mailbox" | "drive") => void;
  /** Open the email-thread search picker. */
  readonly onAddEmailThread: () => void;
  /** Open the knowledge-node search picker. */
  readonly onAddKnowledge: () => void;
  /** Place a spreadsheet node for a freshly-created blank sheet. */
  readonly onAddSpreadsheet: (spreadsheetId: string) => void;
  /** Place a document node for a freshly-created blank document. */
  readonly onAddDocument: (documentId: string) => void;
}

/** A blank 3-column sheet — the starting point the agent (or the user) fills. */
const BLANK_SHEET = {
  title: "Untitled spreadsheet",
  columns: [
    { name: "Column 1", type: "text" as const },
    { name: "Column 2", type: "text" as const },
    { name: "Column 3", type: "text" as const },
  ],
};

/**
 * AddNodeMenu — the canvas's primary, touch-reachable "add a node" affordance.
 */
export function AddNodeMenu({
  onAddCirclePack,
  onAddEmailThread,
  onAddKnowledge,
  onAddSpreadsheet,
  onAddDocument,
}: AddNodeMenuProps): React.ReactElement {
  // The blank-sheet/blank-document creates live here (this component can reach
  // api) so the canvas host's add handlers stay sync — they just place the node
  // once the id is back.
  const createSpreadsheet = api.spreadsheets.create.useMutation();
  const createDocument = api.documents.create.useMutation();

  async function handleAddSpreadsheet(): Promise<void> {
    try {
      const { spreadsheetId } = await createSpreadsheet.mutateAsync(BLANK_SHEET);
      onAddSpreadsheet(spreadsheetId);
    } catch {
      toast.error("Couldn't create a spreadsheet. Try again.");
    }
  }

  async function handleAddDocument(): Promise<void> {
    try {
      // No input needed — a blank document defaults to "Untitled document".
      const { documentId } = await createDocument.mutateAsync({});
      onAddDocument(documentId);
    } catch {
      toast.error("Couldn't create a document. Try again.");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Add node"
          className={CANVAS_PANEL_BUTTON_CLASS}
        >
          <Plus className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Add node</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onAddCirclePack("mailbox")}>
          <CircleDashed className="size-4 shrink-0 text-faded" aria-hidden />
          Email treemap
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAddCirclePack("drive")}>
          <HardDrive className="size-4 shrink-0 text-faded" aria-hidden />
          Drive treemap
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            // Keep the menu's own close from racing the async create.
            e.preventDefault();
            void handleAddSpreadsheet();
          }}
        >
          <TableIcon className="size-4 shrink-0 text-faded" aria-hidden />
          Spreadsheet
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            // Keep the menu's own close from racing the async create.
            e.preventDefault();
            void handleAddDocument();
          }}
        >
          <FileText className="size-4 shrink-0 text-faded" aria-hidden />
          Document
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onAddEmailThread}>
          <Mail className="size-4 shrink-0 text-faded" aria-hidden />
          Email thread…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onAddKnowledge}>
          <Network className="size-4 shrink-0 text-faded" aria-hidden />
          Knowledge node…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
