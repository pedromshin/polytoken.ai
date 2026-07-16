"use client";

// Explicit React import — Next.js's SWC automatic JSX runtime tolerates its
// absence, but vitest's classic-runtime esbuild JSX transform needs `React`
// in scope for any suite that mounts this file directly (documented gotcha,
// see genui-panel-node.tsx / 53-03 / 53-04's identical fix).
import * as React from "react";
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

/** The `chat.listConversations` row shape. `updatedAt` is deliberately still
 * here though 61-03 stopped RENDERING it (see below) — it describes the API
 * row, and the list's order depends on it. */
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
 * ConversationRow (D-11 rail row) — the sketch's `.citem`
 * (direction-final.html:403): a single-line, truncated conversation TITLE and
 * an always-rendered `MoreHorizontal` overflow menu (never hover-only, per the
 * UI-SPEC accessibility section — keyboard/touch users need a persistent
 * affordance).
 *
 * SELECTION IS FILL AND WEIGHT, NEVER A HUE (law 1: "selected states carry no
 * hue"). `.citem.on` is `--shade` fill + ink text + `font-semibold`; at rest a
 * row is `--faded`; hover is `--ink-05`. This shipped as
 * `bg-primary/10 text-primary`, which was ALREADY hueless — but only by
 * accident of an indirection (`--primary: var(--ink)`), and it stated selection
 * with fill alone. The weight is the half that was missing, and it is the half
 * that survives greyscale AND a fill too faint to see on a bright rail.
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
  return (
    <div
      data-field="conversation-row"
      data-active={isActive ? "true" : "false"}
      className={cn(
        // `rounded-md` IS the sketch's 6px (calc(--radius 8px - 2px)).
        "group flex items-center gap-0.5 rounded-md transition-colors",
        isActive
          ? // `.citem.on` — fill + weight, no hue. `font-semibold` is set here
            // on the row so the weight covers the title wherever it renders.
            "bg-shade font-semibold text-ink"
          : // `.citem` at rest + `.citem:hover{background:var(--ink-05)}`.
            // --ink-05 has no registered utility (61-03-PLAN §E), and `bg-ink/5`
            // is not an approximation of it — it is the SAME colour by
            // construction: --ink-05 is declared as --ink's own oklch at /0.05
            // in BOTH themes (globals.css:516, :639), and `bg-ink/5` emits
            // color-mix(in oklab, var(--ink) 5%, transparent). Preferred over
            // `bg-shade` at a lower emphasis because shade is what SELECTION
            // uses — a hover that borrowed the selected fill would say "chosen"
            // on mouseover. 61-05 may register the token; this call site does
            // not need it to be correct.
            "text-faded hover:bg-ink/5 hover:text-ink",
      )}
    >
      {isRenaming ? (
        <div className="min-w-0 flex-1 px-2.5 py-control-y">
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
          // `.citem`: `padding:7px 9px`. `py-control-y` IS the 7px named step
          // (--spacing-control-y, measured off the sketch's own .btn); `px-2.5`
          // is 10px on Tailwind's scale — the sketch's 9px is not a step in
          // either system, and 10px squares the row's gutter with the rail's own
          // `px-2.5`. `text-xs` is 12px against `.citem`'s 12.5px.
          //
          // Law 2: this is a CONVERSATION TITLE — polytoken's own auto-generated
          // chrome label, renamable at will, not a line quoted from the user's
          // mail. It stays sans, and it carries no `chip`/`pmark` (both imply
          // font-serif) and no `data-evidence`.
          className="min-w-0 flex-1 truncate rounded-md px-2.5 py-control-y text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1"
        >
          {/* T-61-07: a plain React text node. Never interpolated into a class
              string, a style, or dangerouslySetInnerHTML. */}
          {conversation.title}
        </button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`More actions for ${conversation.title}`}
            // size-11 (44px) is the project's committed touch floor (D-48-07)
            // and it, not the text, sets this row's height. The sketch's
            // `.citem` has no overflow control at all and stands 32px tall;
            // where the sketch and an accessibility floor disagree, the floor
            // wins — recorded in 61-03-SUMMARY.md alongside the composer's.
            className="size-11 shrink-0 text-faded hover:bg-shade hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1"
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onRequestRename(conversation.id)}>
            <Pencil className="mr-2 size-4" aria-hidden />
            Rename
          </DropdownMenuItem>
          {/* This item is INK, not madder — see 61-03-SUMMARY.md.
              Law 1 spends madder on "irreversible — this cannot be undone", and
              this item is not that: it opens the rail's confirm dialog, which is
              cancellable. The irreversible control is that dialog's own Delete,
              and it already wears madder as a FILL
              (delete-conversation-dialog.tsx:60) — the treatment law 1 earns.
              Wearing madder here spent the identity's loudest colour on merely
              ASKING, which also teaches the eye that madder means "delete-ish"
              rather than "no way back". */}
          <DropdownMenuItem onClick={() => onRequestDelete(conversation)}>
            <Trash2 className="mr-2 size-4" aria-hidden />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
