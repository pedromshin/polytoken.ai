"use client";

// Explicit React import — Next.js's SWC automatic JSX runtime tolerates its
// absence, but vitest's classic-runtime esbuild JSX transform needs `React`
// in scope for any suite that mounts this file directly (documented gotcha,
// see genui-panel-node.tsx / 53-03 / 53-04's identical fix).
import * as React from "react";
import { useCallback, useRef, useState } from "react";
import { Send, Square } from "lucide-react";

import { cn } from "@polytoken/ui";
import { Button } from "@polytoken/ui/button";
import { Textarea } from "@polytoken/ui/textarea";

import { ComposerAttachments } from "./composer-attachments";

/**
 * max-h-52 (13 lines @ 16px line-height) — 22-UI-SPEC.md Spacing Scale.
 *
 * T-61-08 — THIS IS A LAYOUT GUARD, NOT A COSMETIC CAP. `resizeTextarea` clamps
 * the field's grown height to this number; without it a pasted novel grows the
 * composer past the viewport and pushes the transcript off-screen. A redesign
 * that "lets the composer breathe" by lifting the clamp reintroduces a
 * client-side layout DoS — one that `npm run test:geometry` would then catch as
 * a scrolling document. Do not make it find this one.
 */
const MAX_TEXTAREA_HEIGHT_PX = 208;

export interface ComposerProps {
  /** True exactly while the active turn is streaming (CHAT-06). */
  readonly isStreaming: boolean;
  /** Called with the trimmed, non-empty submitted text. */
  readonly onSubmit: (text: string) => void;
  readonly onStop: () => void;
  /**
   * The open conversation an attachment becomes context for (CH-01). When
   * present, the composer renders the attach affordance (upload / from-vault);
   * when absent — e.g. a preview mount with no live conversation — the
   * affordance is simply not rendered, so every existing call site stays
   * byte-for-byte unchanged.
   */
  readonly conversationId?: string;
}

/**
 * Composer (CHAT-03, CHAT-06) — multi-line textarea (44px min-height,
 * auto-grows to max-h-52 then scrolls internally), Enter submits /
 * Shift+Enter inserts a newline, disabled while the active turn streams.
 * The Send button morphs into Stop IN THE SAME SLOT while streaming (one
 * button element, icon/variant swap only — no layout-shifting branch),
 * per 22-UI-SPEC.md Interaction Contracts + Accessibility (focus stays on
 * one tab-stop across the morph).
 */
export function Composer({
  isStreaming,
  onSubmit,
  onStop,
  conversationId,
}: ComposerProps): React.ReactElement {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`;
  }, []);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(event.target.value);
      resizeTextarea();
    },
    [resizeTextarea],
  );

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    onSubmit(trimmed);
    setValue("");
    // Focus management (UI-SPEC Accessibility): submitting never moves
    // focus away from the composer.
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      resizeTextarea();
    });
  }, [value, isStreaming, onSubmit, resizeTextarea]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    },
    [submit],
  );

  return (
    // THE DOCK — the sketch's `.composer` (direction-final.html:431):
    // `border-top:1px solid var(--hair)`, `padding:14px 16px`, and NO shadow and
    // NO background of its own. It shipped with `shadow-elevation-2`, against an
    // identity whose own note is "flat surfaces, hairline rules, zero shadow
    // anywhere" — a hairline rule IS the separation. And it shipped with
    // `bg-background` (the page ground) while the transcript above it had none,
    // which drew a tone seam across a surface the sketch treats as ONE: the
    // composer is part of `.chatcol`, divided from the turns by a rule, not
    // docked below a different surface. It now inherits the column's `--bright`
    // (page.tsx). `border-border/60` -> `border-hair`: a hairline is a token
    // here, not 60% of a heavier rule.
    <div className="w-full shrink-0 border-t border-hair">
      {/* `max-w-3xl` is KEPT, and deliberately — see 61-03-SUMMARY.md. It is not
          this component's number: it is the TRANSCRIPT's reading column
          (message-list.tsx:124, `mx-auto max-w-3xl px-4`), and the composer's
          job is to line its field up with the text above it. Narrowing it here
          alone would misalign the pair; narrowing both means editing
          message-list.tsx, which is 61-04's file and 61-04's call to make with
          the turns in front of it. The sketch's 388px `.chatcol` is NOT the
          number to import: that is a chat column sharing a frame with a board,
          whereas this column owns the full width and the canvas is a TOGGLED
          view, not a sibling. `py-3.5 px-4` IS the sketch's 14px/16px. */}
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2 px-4 py-3.5">
        {/* CH-01 — the attach affordance. Only mounted when a live
            conversationId is present (a preview/empty mount renders nothing new,
            keeping existing composer geometry unchanged). It carries its own
            chip rail above the row via self-start alignment. */}
        {conversationId !== undefined ? (
          <ComposerAttachments
            conversationId={conversationId}
            disabled={isStreaming}
          />
        ) : null}
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
          // The placeholder is load-bearing beyond copy: 61-01's geometry gate
          // keys BOTH its hydration proof and its transcript-scroller locator on
          // `getByPlaceholder("Ask the agent anything…")` (surface-geometry.spec
          // .ts:250,280). Keyed on semantics so a restyle cannot repoint it —
          // but a re-word would break it, so a copy change belongs in a plan that
          // says so.
          placeholder="Ask the agent anything…"
          rows={1}
          className={cn(
            "max-h-52 min-h-[44px] resize-none overflow-y-auto scrollbar-token",
            // THE FIELD — `.composer input` (line 432): `--leaf` fill,
            // `--rule` border, `--pencil` placeholder. The vendored Textarea
            // gives `bg-transparent` and `placeholder:text-muted-foreground`;
            // `--muted-foreground` resolves to `--faded`, one step LOUDER than
            // the `--pencil` the sketch asks for. Both stated rather than
            // inherited. `shadow-none` kills the primitive's `shadow-sm` (zero
            // shadow anywhere).
            "bg-leaf border-rule text-ink placeholder:text-pencil shadow-none",
            // FOCUS IS AN INK OUTLINE, and it is stated: the sketch's
            // `outline:2px solid var(--ink); outline-offset:1px`. The primitive
            // ships `focus-visible:ring-1 ring-ring` and nothing explicit here;
            // `--ring` already resolves to `--ink`, so the surface was law-1
            // compliant BY ACCIDENT of an indirection rather than by design
            // (law 1: "focus rings carry NO hue"). Say ink where the sketch
            // says ink.
            //
            // `outline-solid` IS LOAD-BEARING AND IS NOT DECORATION. The
            // vendored Textarea's base carries `focus-visible:outline-none`, and
            // tailwind-merge does NOT drop it for `outline-2`: they are in
            // different groups (outline-STYLE vs outline-WIDTH), so both survive
            // the merge. `outline-none` emits
            // `{--tw-outline-style:none;outline-style:none}` AFTER
            // `outline-2`'s `{outline-style:var(--tw-outline-style)}` in the
            // built sheet — so it wins twice over: directly, and by poisoning
            // the very variable `outline-2` reads. The focus outline would have
            // been INVISIBLE while this class list read perfectly, and no unit
            // test can see it (jsdom runs no cascade). `outline-solid` is in the
            // outline-STYLE group, so twMerge evicts `outline-none` — verified,
            // with the emitted CSS, in 61-03-SUMMARY.md.
            //
            // This is also why focus here is an OUTLINE and not `ring-2
            // ring-ink ring-offset-1` (Phase 60's idiom): `--tw-ring-offset-
            // color` defaults to `#fff`, so a ring-offset on this surface paints
            // a 1px WHITE halo in dark mode. An outline-offset just reveals the
            // ground behind it, in both themes, which is what the sketch drew.
            "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink focus-visible:ring-0",
          )}
        />
        {/* THE ONE-BUTTON MORPH (T-61-09). Send and Stop are the SAME element:
            one tab stop across the morph (22-UI-SPEC Accessibility), and the
            `aria-label` swaps in the SAME expression as the `onClick` handler,
            so the accessible name can never disagree with the action it fires.
            Do not split this into two elements to make styling easier. */}
        <Button
          type="button"
          variant={isStreaming ? "secondary" : "default"}
          size="icon"
          className={cn(
            // 44px, not the sketch's 36px — D-48-07's committed touch floor.
            // Where the sketch and an accessibility floor disagree, the floor
            // wins; recorded in 61-03-SUMMARY.md.
            "size-11 shrink-0 shadow-none",
            // Focus is ink, stated — `ring-ring` resolves to it anyway (§E).
            "focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1",
            isStreaming
              ? // Stop is the quieter state: a `--shade` control on the same
                // geometry, so the morph changes tone and glyph without moving
                // anything. `variant="secondary"` already resolves here
                // (--secondary: var(--shade)) — stated, and its `shadow-sm` and
                // `hover:bg-secondary/80` opacity trick dropped. Stop is INK on
                // shade, never madder: stopping a generation is interrupting,
                // not destroying, and law 1 spends madder only on what cannot be
                // undone.
                "bg-shade text-ink hover:bg-(--rule-hi)"
              : // THE SEND CONTROL — `.send` (line 439): `--ink` fill,
                // `--on-fill` glyph, `--fill-hi` on hover. It resolved to ink
                // already, via variant=default -> bg-primary -> --ink, and
                // `hover:bg-primary/90` is stock shadcn's opacity trick wearing
                // ink's clothes — 90% of ink is not `--fill-hi`, which is a
                // DARKER ink in light mode and a BRIGHTER one in dark. Say ink.
                // --fill-hi is declared for both themes but not @theme-
                // registered (like --rule-hi; 61-05 owns registration), so v4's
                // (--custom-property) form at the call site — never v3's
                // [--fill-hi], which emits nothing and fails silently.
                "bg-ink text-on-fill hover:bg-(--fill-hi)",
          )}
          aria-label={isStreaming ? "Stop generating" : "Send message"}
          onClick={isStreaming ? onStop : submit}
          disabled={!isStreaming && value.trim().length === 0}
        >
          {isStreaming ? (
            <Square className="size-4" aria-hidden />
          ) : (
            <Send className="size-4" aria-hidden />
          )}
        </Button>
      </div>
    </div>
  );
}
