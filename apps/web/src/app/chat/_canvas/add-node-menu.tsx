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
  Activity,
  Bookmark,
  Box,
  Boxes,
  CircleDashed,
  FileText,
  Files,
  Gauge,
  GitMerge,
  HardDrive,
  LayoutDashboard,
  ListChecks,
  Mail,
  MessagesSquare,
  Network,
  Newspaper,
  Plus,
  Search,
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

/** The five direct-place surface kinds — their data is a bare `{}` (an optional
 * label only), so they place with no picker. Typed as a closed union so a caller
 * cannot pass an unregistered kind. */
export type SimpleNodeKind =
  | "knowledge-search"
  | "review-queue"
  | "rule-suggestions"
  | "pipeline-health"
  | "brief"
  | "usage"
  | "documents"
  | "references"
  | "search-all"
  | "conversations";

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
  /** Place one of the five direct-place surface nodes (data `{}`). */
  readonly onAddSimpleNode: (kind: SimpleNodeKind) => void;
  /** Open the entity search picker (places an entity node on select). */
  readonly onAddEntity: () => void;
  /** Open the "Your tools" picker (places a code-island node for a saved tool). */
  readonly onAddCodeIsland: () => void;
  /** Phase 74 MVP — drops a pre-arranged starter board (brief + merge review +
   * spend meter) in one action; the user-triggered self-assembling board. */
  readonly onAssembleBoard: () => void;
  /** Phase 76 / 76-04 — the summon loop: mint one bespoke code-island tool from
   * the currently-selected data nodes. Enabled only when ≥2 eligible sources
   * are selected. */
  readonly onBuildTool: () => void;
  /** How many currently-selected nodes are eligible tool SOURCES (not the chat
   * singleton, not another tool) — gates the "Build a tool from these" item. */
  readonly buildToolSourceCount: number;
  /** True while a summon is mid-flight (generate → create) — keeps the item
   * from firing a second overlapping build. */
  readonly buildToolPending: boolean;
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
  onAddSimpleNode,
  onAddEntity,
  onAddCodeIsland,
  onAssembleBoard,
  onBuildTool,
  buildToolSourceCount,
  buildToolPending,
}: AddNodeMenuProps): React.ReactElement {
  // The summon loop needs ≥2 selected data sources; disable (with a hint) until
  // then so the affordance is always discoverable but only fires when it can.
  const canBuildTool = buildToolSourceCount >= 2 && !buildToolPending;
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
        <DropdownMenuItem onSelect={onAssembleBoard}>
          <LayoutDashboard className="size-4 shrink-0 text-faded" aria-hidden />
          Assemble board
        </DropdownMenuItem>
        {/* Phase 76 summon loop — mint a bespoke tool from the selected data
            nodes. Disabled with an inline hint until ≥2 sources are selected, so
            the affordance is always visible but only fires when it can. */}
        <DropdownMenuItem
          disabled={!canBuildTool}
          onSelect={onBuildTool}
        >
          <Boxes className="size-4 shrink-0 text-faded" aria-hidden />
          <span className="flex min-w-0 flex-col">
            <span>Build a tool from these</span>
            {!canBuildTool ? (
              <span className="text-2xs text-faded">
                {buildToolPending
                  ? "Building…"
                  : "Select 2+ data nodes first"}
              </span>
            ) : null}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onAddCodeIsland}>
          <Boxes className="size-4 shrink-0 text-faded" aria-hidden />
          Your tools…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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
        <DropdownMenuItem onSelect={onAddEntity}>
          <Box className="size-4 shrink-0 text-faded" aria-hidden />
          Entity…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onAddSimpleNode("knowledge-search")}>
          <Search className="size-4 shrink-0 text-faded" aria-hidden />
          Knowledge search
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAddSimpleNode("review-queue")}>
          <GitMerge className="size-4 shrink-0 text-faded" aria-hidden />
          Merge review
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAddSimpleNode("rule-suggestions")}>
          <ListChecks className="size-4 shrink-0 text-faded" aria-hidden />
          Rule suggestions
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAddSimpleNode("pipeline-health")}>
          <Activity className="size-4 shrink-0 text-faded" aria-hidden />
          Pipeline health
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAddSimpleNode("brief")}>
          <Newspaper className="size-4 shrink-0 text-faded" aria-hidden />
          Daily brief
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAddSimpleNode("usage")}>
          <Gauge className="size-4 shrink-0 text-faded" aria-hidden />
          Spend meter
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAddSimpleNode("documents")}>
          <Files className="size-4 shrink-0 text-faded" aria-hidden />
          Recent documents
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAddSimpleNode("references")}>
          <Bookmark className="size-4 shrink-0 text-faded" aria-hidden />
          References
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAddSimpleNode("search-all")}>
          <Search className="size-4 shrink-0 text-faded" aria-hidden />
          Search everything
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAddSimpleNode("conversations")}>
          <MessagesSquare className="size-4 shrink-0 text-faded" aria-hidden />
          Recent chats
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
