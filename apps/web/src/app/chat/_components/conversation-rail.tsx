"use client";

// Explicit React import — Next.js's SWC automatic JSX runtime tolerates its
// absence, but vitest's classic-runtime esbuild JSX transform needs `React`
// in scope for any suite that mounts this file directly (documented gotcha,
// see genui-panel-node.tsx / 53-03 / 53-04's identical fix).
import * as React from "react";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { cn } from "@polytoken/ui";
import { Button } from "@polytoken/ui/button";
import { Collapsible, CollapsibleContent } from "@polytoken/ui/collapsible";
import { ScrollArea } from "@polytoken/ui/scroll-area";
import { Sheet, SheetContent, SheetTitle } from "@polytoken/ui/sheet";
import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";

import { ConversationRow, type ConversationSummary } from "./conversation-row";
import { DeleteConversationDialog } from "./delete-conversation-dialog";

const COLLAPSE_STORAGE_KEY = "chat:rail:collapsed";

interface ConversationRailProps {
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onDeleted: (deletedId: string) => void;
  readonly collapsed: boolean;
  readonly onCollapsedChange: (collapsed: boolean) => void;
  /** MOBL-01 (53-UI-SPEC.md Judgment Call #3) — below `md` the rail renders
   * inside a left overlay `Sheet` instead of the desktop inline `Collapsible`.
   * A SEPARATE boolean from `collapsed` (which defaults to rail-VISIBLE) —
   * this one defaults CLOSED, lifted to `page.tsx`'s `ChatPage` so the
   * existing top-bar rail-toggle button can drive it. */
  readonly mobileOpen: boolean;
  readonly onMobileOpenChange: (open: boolean) => void;
  readonly onNewChat: () => void;
  readonly creatingConversation: boolean;
}

/**
 * The rail's realized width — the sketch's `.convrail` at 208px
 * (direction-final.html:393), against the 280px this rail shipped at until
 * 61-03. `w-52` IS 208px (13rem) on Tailwind's own scale, so this is a named
 * step rather than an arbitrary value.
 *
 * The narrowing is a content decision, not a cosmetic one: the rail lists
 * conversation TITLES, and a title-only registry does not need 280px. It is
 * declared once because THREE places must agree on it or the collapse animation
 * tears — the sizing wrapper, the CollapsibleContent, and the body — which is
 * exactly the kind of triplicated literal that drifts.
 */
const RAIL_WIDTH = "w-52";

function RailSkeleton(): React.ReactElement {
  return (
    <div
      aria-busy="true"
      aria-label="Loading conversations…"
      // `h-8` mirrors the real row's height (a single-line `.citem`, not the
      // pre-61-03 two-line row), so the loading state is not a taller ghost of
      // the list it stands in for. The screenshot harness settles on
      // [aria-busy=true] (61-01/999.24) — these attributes are load-bearing for
      // the capture pipeline, not decoration.
      className="space-y-0.5"
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full rounded-md" />
      ))}
    </div>
  );
}

/**
 * ConversationRail (D-11) — own collapsible rail nested inside /chat, built
 * from @polytoken/ui/collapsible (Radix Collapsible) rather than a second
 * app-shell-style sidebar provider — reusing that provider would collide
 * with the app shell's shared `sidebar:state` cookie. Collapse state persists
 * to `localStorage["chat:rail:collapsed"]`, independent of that cookie; the
 * boolean itself is controlled by the parent (/chat/page.tsx) so a top-bar
 * toggle can reach it even while the rail is visually 0px wide.
 *
 * Owns the inline-rename (D-12) and hard-delete-confirm (D-14) interaction
 * state for its rows: which row is currently renaming, and which
 * conversation the single `DeleteConversationDialog` instance targets.
 */
export function ConversationRail({
  selectedId,
  onSelect,
  onDeleted,
  collapsed,
  onCollapsedChange,
  mobileOpen,
  onMobileOpenChange,
  onNewChat,
  creatingConversation,
}: ConversationRailProps): React.ReactElement {
  // Hydrate the persisted collapse preference once on mount.
  useEffect(() => {
    const stored = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
    if (stored === "true") {
      onCollapsedChange(true);
    }
    // Intentionally run once on mount only — hydration read, not a sync loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist every change back to the same key.
  useEffect(() => {
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  const utils = api.useUtils();
  const { data: conversations, isLoading } =
    api.chat.listConversations.useQuery({});

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deletingConversation, setDeletingConversation] =
    useState<ConversationSummary | null>(null);

  const renameConversation = api.chat.renameConversation.useMutation({
    onSuccess: async () => {
      await utils.chat.listConversations.invalidate();
      setRenamingId(null);
    },
  });

  const deleteConversation = api.chat.deleteConversation.useMutation({
    onSuccess: async (_result, variables) => {
      await utils.chat.listConversations.invalidate();
      onDeleted(variables.id);
      setDeletingConversation(null);
    },
  });

  // Shared rail body (New-chat button + conversation list) — reused by BOTH
  // the desktop inline Collapsible and the mobile overlay Sheet below `md`
  // (MOBL-01, 53-UI-SPEC.md Judgment Call #3). `handleSelect` differs per
  // caller: the mobile Sheet's row-select ALSO closes the Sheet (a
  // full-overlay Sheet left open would hide the very conversation the user
  // just chose), the desktop tree just calls `onSelect` directly.
  function renderRailBody(
    handleSelect: (id: string) => void,
    wrapperClassName: string,
  ): React.ReactElement {
    return (
      // `.convrail` (direction-final.html:393): `padding:14px 10px`. `py-3.5`
      // IS 14px and `px-2.5` IS 10px on Tailwind's own scale — the sketch's
      // measurement, reached through named steps. NOT `p-panel` (20px): that
      // step was measured off the 236-280px wide panels it landed on
      // (inbox-entities-rail, kdetail) and would spend 40 of this rail's 208px
      // on air. Reaching for a named step is the rule; reaching for the WRONG
      // named step because it is named is not.
      <div className={cn(wrapperClassName, "px-2.5 py-3.5")}>
        {/* THE HIERARCHY CORRECTION. This shipped as `variant="default"` — a
            FILLED INK block, the single loudest control on the surface, spent on
            the least consequential action on it (a new chat is free and
            undoable; the rail's genuinely irreversible control, Delete, is a
            menu item). The sketch's `.newchat` (line 397) is OUTLINED:
            `--bright` fill, `--rule` border, ink text, `--shade`/`--rule-hi` on
            hover. A re-token cannot make this change — both are "ink" — which is
            precisely why Phase 51's re-token left it standing. */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            // `mb-2.5` IS `.newchat`'s `margin-bottom:10px`. `justify-start` +
            // `gap-2` is its `text-align:left` + `gap:7px` — a control whose
            // label starts where the rows' labels start. `size="sm"` gives the
            // right box (h-8 = the sketch's 7px+13px+7px) but the wrong type
            // (`text-xs`/`font-normal`); `.newchat` is 13px/600, i.e.
            // `text-sm font-semibold`. It is the only semibold control in the
            // rail besides the SELECTED row — which is the intended reading.
            "mb-2.5 w-full shrink-0 justify-start gap-2 text-sm font-semibold",
            // `variant="outline"` already gives `border-input` (= --rule) and
            // the --shade hover well through --accent. Said outright, plus the
            // two things the variant gets wrong for this identity: it fills with
            // `bg-background` (the page ground) where the sketch fills with
            // `--bright`, and it carries `shadow-sm` where the identity's own
            // note is "flat surfaces, hairline rules, zero shadow anywhere".
            "bg-bright text-ink shadow-none hover:bg-shade hover:text-ink",
            // --rule-hi is declared in globals.css for both themes but not
            // registered in @theme, so no `border-rule-hi` utility exists;
            // 61-05 owns registration. var() at the call site is the
            // sanctioned interim (61-03-PLAN §E).
            //
            // SYNTAX, and it is not a style preference: this is v4's
            // `(--custom-property)` form, NOT v3's `[--rule-hi]`. v3 syntax
            // surviving into v4 emits nothing and fails SILENTLY — it is what
            // shipped the sidebar at half width through 730 green tests
            // (`w-[--sidebar-width]` needed `w-(--sidebar-width)`). `border-(…)`
            // resolves in the COLOUR namespace, so no `color:` type hint is
            // needed here. The emitted CSS is grepped in 61-03-SUMMARY.md
            // rather than assumed.
            "hover:border-(--rule-hi)",
            "focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1",
          )}
          onClick={onNewChat}
          disabled={creatingConversation}
        >
          <Plus className="size-4" aria-hidden />
          New chat
        </Button>

        <ScrollArea className="-mx-2.5 min-h-0 flex-1">
          {/* `-mx-2.5` above + `px-2.5` here: the scrollbar rides the rail's
              true edge while the rows keep the rail's own 10px gutter, so a
              scrolling list does not sit visibly inboard of a non-scrolling
              one. `gap-0.5` is `.convrail`'s `gap:2px` (line 394). */}
          <div className="flex flex-col gap-0.5 px-2.5">
            {isLoading ? (
              <RailSkeleton />
            ) : conversations && conversations.length > 0 ? (
              conversations.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  isActive={conversation.id === selectedId}
                  isRenaming={renamingId === conversation.id}
                  onSelect={handleSelect}
                  onRequestRename={setRenamingId}
                  onRequestDelete={setDeletingConversation}
                  onRenameCommit={(id, title) =>
                    renameConversation.mutate({ id, title })
                  }
                  onRenameCancel={() => setRenamingId(null)}
                />
              ))
            ) : (
              <p className="px-2.5 py-4 text-center text-xs text-faded">
                No conversations yet.
              </p>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  }

  const handleMobileSelect = (id: string): void => {
    onSelect(id);
    onMobileOpenChange(false);
  };

  return (
    <>
      {/* Desktop (>=md) — the inline Collapsible. The height chain here is
          UNCHANGED by 61-03 and deliberately so: only the width, the rule and
          the ground moved. */}
      <div className="hidden md:block h-full">
        {/* `h-full` is load-bearing: Radix renders this root as a bare <div> with no
         * class of its own, so without it the height chain breaks here — the div grows
         * to fit every conversation, CollapsibleContent's `h-full` resolves against
         * *that* instead of the 856px wrapper, and the page scrolls to ~11,000px
         * instead of the rail scrolling inside itself (e2a2abf). This is 61-01's
         * negative proof: `npm run test:geometry` measures 11,296px against a 900px
         * viewport with this one class removed. Do not remove it. */}
        <Collapsible
          className="h-full"
          open={!collapsed}
          onOpenChange={(open) => onCollapsedChange(!open)}
        >
          <div
            className={cn(
              // `--hair` right rule, not `border-border/50` — a hairline is a
              // token in this identity, not an opacity trick on a heavier rule.
              // `bg-shelf` is the page ground, stated: the reading column beside
              // it lifts to `--bright` (page.tsx), and that tone step is what
              // makes this read as a registry BESIDE a column rather than as
              // more chrome. It shipped as `bg-background/95` — the same colour
              // as the column, at 95% of it, for no stated reason.
              "h-full shrink-0 overflow-hidden border-r border-hair bg-shelf",
              "t-panel-reveal",
              collapsed ? "w-0" : RAIL_WIDTH,
            )}
          >
            <CollapsibleContent forceMount className={cn("h-full", RAIL_WIDTH)}>
              {renderRailBody(onSelect, cn("flex h-full flex-col", RAIL_WIDTH))}
            </CollapsibleContent>
          </div>
        </Collapsible>
      </div>

      {/* Mobile (<md) — left overlay Sheet (MOBL-01, Judgment Call #3),
       * closed by default; opened by page.tsx's lifted `mobileOpen` state via
       * the existing top-bar rail-toggle button. `md:hidden` on SheetContent
       * itself is belt-and-suspenders (a Sheet left open across a resize past
       * `md` still collapses). */}
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent side="left" className="md:hidden p-0">
          <SheetTitle className="sr-only">Conversations</SheetTitle>
          {renderRailBody(handleMobileSelect, "flex h-full w-full flex-col")}
        </SheetContent>
      </Sheet>

      <DeleteConversationDialog
        conversationTitle={deletingConversation?.title ?? null}
        open={deletingConversation !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingConversation(null);
        }}
        onConfirm={() => {
          if (deletingConversation) {
            deleteConversation.mutate({ id: deletingConversation.id });
          }
        }}
        isDeleting={deleteConversation.isPending}
      />
    </>
  );
}
