"use client";

// Explicit React import — Next.js's SWC automatic JSX runtime tolerates its
// absence, but vitest's classic-runtime esbuild JSX transform needs `React`
// in scope for any suite that mounts this file directly (documented gotcha,
// see genui-panel-node.tsx / 53-03 / 53-04's identical fix).
import * as React from "react";
import { useState } from "react";
import { Copy, Cpu, Gauge, MessageSquarePlus, Pencil, SlidersHorizontal, Zap } from "lucide-react";

import { cn } from "@polytoken/ui";
import { Button } from "@polytoken/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@polytoken/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@polytoken/ui/dropdown-menu";
import { Input } from "@polytoken/ui/input";

import { api } from "~/trpc/react";

import { ModelPickerPanel } from "./model-picker-panel";
import { type WebllmEntryState } from "./model-picker-entry";
import {
  MODEL_MODE_OPTIONS,
  REASONING_EFFORT_OPTIONS,
  type ModelMode,
  type ModelSettings,
  type ReasoningEffort,
} from "../_hooks/use-model-settings";

export interface ChatQuickActionsFabProps {
  /** The open conversation, or null on the empty-state branch — the
   * conversation-scoped items (Model/Rename/Duplicate) disable on null. */
  readonly selectedConversation: {
    readonly id: string;
    readonly title: string;
    readonly modelId: string;
  } | null;
  /** ChatPage's existing handleNewChat (chat.createConversation + select). */
  readonly onNewChat: () => void;
  /** ChatPage's handleOpenConversation — invalidates listConversations and
   * selects; Duplicate routes its fresh copy's id through this. */
  readonly onOpenConversation: (conversationId: string) => void;
  /** 22-11 browser-locus gate for the model panel (page-level
   * webllm.ensureLoaded — the same thing useConversationController's
   * handleSelectBrowserModel does). */
  readonly onSelectBrowserModel?: (modelId: string) => Promise<void>;
  /** Visual state for the model panel's browser rows (D-08). */
  readonly webllm?: WebllmEntryState;
  /** The open conversation's reasoning dials — the SAME object ChatPage hands
   * ConversationView's controller, so the menu's checkmarks reflect exactly
   * what the next model call will send (write-through, single source of
   * truth). */
  readonly modelSettings: ModelSettings;
  /** Write the reasoning MODE for the open conversation (use-model-settings). */
  readonly onSetMode: (mode: ModelMode) => void;
  /** Write the reasoning EFFORT for the open conversation (use-model-settings). */
  readonly onSetEffort: (effort: ReasoningEffort) => void;
}

/**
 * ChatQuickActionsFab — floating quick-actions menu for /chat, rendered on
 * BOTH main-column branches (conversation open + empty state) so "New chat"
 * is always one tap away. Flat circular trigger per the identity: --bright
 * surface + hairline border, NO shadow (design law "zero shadow anywhere" —
 * deliberately NOT jump-to-bottom-button's shadow-md).
 *
 * Hosts its own two Dialogs (model + rename) OUTSIDE the DropdownMenu
 * subtree — same portal/focus-conflict avoidance as the rail's
 * DeleteConversationDialog (delete-conversation-dialog.tsx:31-34).
 */
export function ChatQuickActionsFab({
  selectedConversation,
  onNewChat,
  onOpenConversation,
  onSelectBrowserModel,
  webllm,
  modelSettings,
  onSetMode,
  onSetEffort,
}: ChatQuickActionsFabProps): React.ReactElement {
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");

  const utils = api.useUtils();

  const renameConversation = api.chat.renameConversation.useMutation({
    onSuccess: async () => {
      await utils.chat.listConversations.invalidate();
    },
  });

  const duplicateConversation = api.chat.duplicateConversation.useMutation({
    onSuccess: async (result: { id: string }) => {
      await utils.chat.listConversations.invalidate();
      onOpenConversation(result.id);
    },
  });

  const hasConversation = selectedConversation !== null;

  function handleRenameSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (!selectedConversation) return;
    const trimmed = renameTitle.trim();
    // Mirrors renameConversationInputSchema's title.min(1) — an empty title
    // is a no-op close, never a mutation (same posture as InlineRenameField).
    if (trimmed.length > 0) {
      renameConversation.mutate({
        id: selectedConversation.id,
        title: trimmed,
      });
    }
    setRenameDialogOpen(false);
  }

  return (
    // FAB-OVERLAP ("CHAT BUTTONS ARE OVERLAPPING") — the FAB is anchored to the
    // main column, whose bottom edge IS the composer dock when a conversation is
    // open (composer.tsx). At `bottom-4` the 44px trigger paints straight over
    // the composer's Send button. Lift it clear of the dock (`bottom-24`)
    // whenever a conversation is present; keep `bottom-4` on the empty state,
    // which renders no composer. Same condition the page uses to mount a
    // composer (a live `selectedConversation`).
    <div
      className={cn(
        "absolute right-4 z-20",
        hasConversation ? "bottom-24" : "bottom-4",
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Chat quick actions"
            // Flat per the identity: --bright surface, hairline border, ink
            // glyph, NO shadow (do not copy jump-to-bottom-button's shadow-md).
            className="size-11 rounded-full border border-rule bg-bright text-ink hover:bg-shade hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1"
          >
            <Zap className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top">
          <DropdownMenuItem onClick={onNewChat}>
            <MessageSquarePlus className="mr-2 size-4" aria-hidden />
            New chat
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!hasConversation}
            onClick={() => setModelDialogOpen(true)}
          >
            <Cpu className="mr-2 size-4" aria-hidden />
            Model…
          </DropdownMenuItem>
          {/* Model mode + Effort — the reasoning dials. These write through
              onSetMode/onSetEffort to the SAME per-conversation store the send
              path reads (use-model-settings.ts), so a change here rides the
              next model call's request body. Radio groups reflect the current
              value with a checkmark; Radix keeps them arrow-key navigable and
              submenu-openable from the keyboard on desktop. */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!hasConversation}>
              <SlidersHorizontal className="mr-2 size-4" aria-hidden />
              Model mode
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={modelSettings.mode}
                onValueChange={(value) => onSetMode(value as ModelMode)}
              >
                {MODEL_MODE_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem key={option.value} value={option.value}>
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!hasConversation}>
              <Gauge className="mr-2 size-4" aria-hidden />
              Effort
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={modelSettings.effort}
                onValueChange={(value) => onSetEffort(value as ReasoningEffort)}
              >
                {REASONING_EFFORT_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem key={option.value} value={option.value}>
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            disabled={!hasConversation}
            onClick={() => {
              setRenameTitle(selectedConversation?.title ?? "");
              setRenameDialogOpen(true);
            }}
          >
            <Pencil className="mr-2 size-4" aria-hidden />
            Rename…
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!hasConversation || duplicateConversation.isPending}
            onClick={() => {
              if (!selectedConversation) return;
              duplicateConversation.mutate({ id: selectedConversation.id });
            }}
          >
            <Copy className="mr-2 size-4" aria-hidden />
            Duplicate
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Model dialog — hosts the SAME ModelPickerPanel the header's Popover
          trigger uses (model-picker.tsx); persistence is the panel's own
          chat.setModel, unchanged. */}
      <Dialog open={modelDialogOpen} onOpenChange={setModelDialogOpen}>
        <DialogContent className="p-0 sm:max-w-md">
          <DialogHeader className="sr-only">
            <DialogTitle>Choose model</DialogTitle>
          </DialogHeader>
          {selectedConversation !== null && (
            <ModelPickerPanel
              conversationId={selectedConversation.id}
              currentModelId={selectedConversation.modelId}
              onSelectBrowserModel={onSelectBrowserModel}
              webllm={webllm}
              onClose={() => setModelDialogOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Rename dialog — a minimal explicit form rather than a re-hosted
          InlineRenameField: that field commits on BLUR (right for in-place
          rail rows), which inside a dialog would turn every overlay click /
          close-X into an accidental commit. Same mutation + 200-char cap. */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRenameSubmit} className="flex flex-col gap-4">
            <Input
              value={renameTitle}
              maxLength={200}
              aria-label="Conversation title"
              onChange={(event) => setRenameTitle(event.target.value)}
            />
            <DialogFooter>
              <Button
                type="submit"
                disabled={
                  renameTitle.trim().length === 0 ||
                  renameConversation.isPending
                }
              >
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
