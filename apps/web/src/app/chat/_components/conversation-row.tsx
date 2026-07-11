"use client";

import { formatDistanceToNow } from "date-fns";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { cn } from "@polytoken/ui";
import { Button } from "@polytoken/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@polytoken/ui/dropdown-menu";

import { InlineRenameField } from "./inline-rename-field";

export interface ConversationSummary {
  readonly id: string;
  readonly title: string;
  readonly modelId: string;
  readonly updatedAt: string | Date;
}

interface ConversationRowProps {
  readonly conversation: ConversationSummary;
  readonly isActive: boolean;
  readonly isRenaming: boolean;
  readonly onSelect: (id: string) => void;
  readonly onRequestRename: (id: string) => void;
  readonly onRequestDelete: (conversation: ConversationSummary) => void;
  readonly onRenameCommit: (id: string, title: string) => void;
  readonly onRenameCancel: () => void;
}

/**
 * ConversationRow (D-11 rail row) — title snippet (truncate) + relative
 * timestamp + an always-rendered `MoreHorizontal` overflow menu (never
 * hover-only, per the UI-SPEC accessibility section — keyboard/touch users
 * need a persistent affordance). Active row gets the shared
 * `bg-primary/10 text-primary` treatment (D-20 continuity with AppSidebar).
 *
 * Rename is inline-only (D-12): click the title, press Enter/F2 on the
 * focused row, or use the overflow menu's Rename item — all swap the title
 * for an `InlineRenameField`. Delete opens the rail's single
 * `DeleteConversationDialog` (never nested inside this row's DropdownMenu).
 */
export function ConversationRow({
  conversation,
  isActive,
  isRenaming,
  onSelect,
  onRequestRename,
  onRequestDelete,
  onRenameCommit,
  onRenameCancel,
}: ConversationRowProps): React.ReactElement {
  const updatedAt =
    conversation.updatedAt instanceof Date
      ? conversation.updatedAt
      : new Date(conversation.updatedAt);

  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md px-1 py-1 transition-colors",
        isActive
          ? "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary"
          : "text-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {isRenaming ? (
        <div className="min-w-0 flex-1 px-1 py-1">
          <InlineRenameField
            initialValue={conversation.title}
            onCommit={(title) => onRenameCommit(conversation.id, title)}
            onCancel={onRenameCancel}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onSelect(conversation.id)}
          onKeyDown={(event) => {
            if (event.key === "F2") {
              event.preventDefault();
              onRequestRename(conversation.id);
            }
          }}
          className="flex min-w-0 flex-1 flex-col items-start rounded-md px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          <span className="w-full truncate text-sm">{conversation.title}</span>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(updatedAt, { addSuffix: true })}
          </span>
        </button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`More actions for ${conversation.title}`}
            className="size-11 shrink-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onRequestRename(conversation.id)}>
            <Pencil className="mr-2 size-4" aria-hidden />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onRequestDelete(conversation)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 size-4" aria-hidden />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
