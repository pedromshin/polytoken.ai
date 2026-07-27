"use client";

import * as React from "react";
import { useMemo, useState } from "react";

import type { MessagePart } from "../_hooks/use-chat-stream";
import { GeneratingRing } from "~/components/generating-ring";
import { PanelActionsToolbar } from "../_canvas/panel-actions-toolbar";
import { resolveActivePanel } from "../_canvas/panel-overlay";
import { useOptionalPanelOverlay } from "../_canvas/panel-overlay-context";
import { PanelThemeScope } from "../_canvas/panel-theme-scope";
import { useIsTranscriptPanelHost } from "../_canvas/transcript-panel-host";
import { genuiPanelNodeId } from "../_canvas/use-canvas-persistence";
import { CapabilityBindingBoundary, extractCapabilityBinding } from "./capability-binding-boundary";
import { CompactInteractionEntry } from "./compact-interaction-entry";
import { CostCapBlockedCard } from "./cost-cap-blocked-card";
import { GenuiPartBoundary } from "./genui-part-boundary";
import { InlineErrorCard } from "./inline-error-card";
import {
  InteractiveWidgetBoundary,
  type InteractiveWidgetPart,
  type WidgetDisplayState,
} from "./interactive-widget-boundary";
import { MarkdownRenderer } from "./markdown-renderer";
import { ToolInvocationResultRow } from "./tool-invocation-result-row";
import { ToolRoundActivityRow } from "./tool-round-activity-row";
import { TurnActionRow } from "./turn-action-row";
import { TurnStatusBadge } from "./turn-status-badge";
import { USER_BUBBLE_CLASS } from "./user-bubble-class";

/** The widget render surface a turn's interactive_widget parts consume,
 * keyed by interactionId — threaded verbatim from the controller (Task 4).
 * Structural (not the controller's own type) so message-turn has no import
 * cycle back into the hooks-layer controller module. */
export interface MessageTurnWidgets {
  readonly states: Readonly<Record<string, WidgetDisplayState>>;
  /** The raw submitted_value payload (opaque per widgetKind) — proposal_cards
   * carries `{optionId}`, clarify_widget carries `{values}` (24-04). */
  readonly submittedValues: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly errorMessages: Readonly<Record<string, string | null>>;
  /** Fires with the schema-conforming result body the 24-02 submit endpoint
   * expects opaquely — generalized over widgetKind (24-04 Task 3). */
  readonly onSubmitResult: (interactionId: string, result: Readonly<Record<string, unknown>>) => void;
}

/**
 * TranscriptGenuiPanel — ONE genui part, rendered as the panel the user
 * actually has rather than the one the model first emitted (61-07, SURF-07,
 * criterion 4 — backlog 999.17's read half), and EDITABLE wherever it is
 * docked (61-08, criterion 3 — 999.17's write half).
 *
 * WHY THIS IS ITS OWN COMPONENT AND NOT THREE LINES IN THE BRANCH: the genui
 * branches live inside `parts.map(...)`, and `useOptionalPanelOverlay` is a
 * hook. A hook called inside a map is a conditional hook call — a runtime
 * error, not a lint opinion. One child component per genui part gives each its
 * own render, so each may hold its own subscription.
 *
 * It mirrors `genui-panel-node.tsx`'s chain EXACTLY (overlay ->
 * `resolveActivePanel` -> toolbar -> `PanelThemeScope` -> `GenuiPartBoundary`),
 * and that is the whole point: if the canvas and the transcript resolved a panel
 * differently, the bug shipped would be the bug this was written to fix. Do not
 * grow a second resolution path here — grow the shared one.
 *
 * `isStreaming` is THREADED, never assumed (T-61-24). `resolveActivePanel`
 * forces the base spec verbatim while a part is still streaming, which is a
 * safety property and not only a correctness one: it stops a stored overlay
 * from swapping a turn's content out from under a generation still in flight.
 * The resolver is told the truth and decides; this component does not decide
 * for it.
 *
 * ────────────────────────────────────────────────────────────────────────
 * 61-08 — THE TOOLBAR MOUNTS ON A MARKER. NOT ON STORE PRESENCE. NOT ON A
 * VIEWPORT CHECK. THIS IS THE WHOLE DESIGN DECISION.
 * ────────────────────────────────────────────────────────────────────────
 *
 * `PANL-01..04` shipped four real editing controls and mounted every one of
 * them inside `GenuiPanelNode` — a React Flow node. `page.tsx`'s
 * `effectiveViewMode = isMobile ? "chat" : viewMode` means the canvas NEVER
 * mounts below `md`, so on a phone those four controls did not exist at all.
 * That is 999.17's write half. 61-07 built the seam; this renders into it.
 *
 * THE THREE TREES this component renders in (61-07 §D), and what each gets:
 *   1. DOCKED, inside `TranscriptPanelHost`   -> toolbar. This is criterion 3.
 *   2. ON CANVAS, inside a `ChatNode`         -> NO toolbar: the real
 *      `GenuiPanelNode` beside it on the same board already has one, and two
 *      toolbars editing one overlay is a bug, not a feature.
 *   3. BARE (tests), no providers             -> NO toolbar, and no throw.
 *
 * **Store presence cannot tell tree 1 from tree 2** — the canvas's own ChatNode
 * transcript sits inside `chat-canvas.tsx`'s providers, so it has the store AND
 * the persistence context, and `useOptionalPanelOverlay` resolves happily there.
 * A naive `if (overlay !== undefined)` grows a second toolbar on the board.
 * `useIsTranscriptPanelHost()` is provided by that host and nothing else, so it
 * is false on the canvas BY CONSTRUCTION.
 *
 * It is NOT `useIsMobileViewport()` either: criterion 3 says the user "can
 * reach" the controls on a mobile viewport — not "only on mobile". The marker
 * satisfies mobile AND hands the desktop docked view the same editing at zero
 * extra cost, out of one seam.
 *
 * AND IT PREVENTS A REAL CRASH, which is why the gate is a conditional RENDER
 * and the hooks live in the child: `TranscriptPanelHost` renders its children
 * before its providers exist (the transcript must never block on a canvas-layout
 * query), and the controls write through the THROWING `usePanelOverlay` — a
 * write with no persistence wired IS a wiring bug and should throw. Since
 * `layoutQuery.isPending` starts true on EVERY mount, an ungated control dies on
 * every first render. 61-07 found this by writing the T-61-21 test. The marker
 * is false until the store and the persistence context are both real, so the
 * controls simply do not exist until they would work.
 *
 * ONE SHAPE, ALWAYS — 61-07's D-61-07-2, one level down. The card, the toolbar
 * SLOT and the themed content render in the same positions in every tree and in
 * both marker states; only the toolbar's own presence flips. `{cond && <X/>}`
 * keeps its slot when falsy, so `PanelThemeScope` never changes position or
 * type and the rendered spec is NEVER remounted when the layout query settles.
 * That matters here for the same reason it mattered there: a remount would
 * discard whatever the user had typed into a genui form mid-edit, on every
 * mount, for a query whose whole purpose is to be invisible.
 *
 * THE TOOLBAR IS OUTSIDE `PanelThemeScope`, DELIBERATELY, and this mirrors
 * `GenuiPanelNode` exactly. The scope injects the PACK's `--card`/`--border`/
 * `--background` as inline vars, and packs have no dark variants (D-61-07-A), so
 * anything inside it is light in both themes. The toolbar is polytoken's own
 * chrome, not the panel's content: law 1 puts it on the APP's ink. Putting it
 * inside the scope would smuggle a pack's light palette onto chrome — the exact
 * inversion of law 2's `pmark` trap, one axis over.
 */
function TranscriptGenuiPanel({
  messageId,
  partIndex,
  specJson,
  isStreaming,
}: {
  readonly messageId: string;
  readonly partIndex: number;
  readonly specJson: string;
  readonly isStreaming: boolean;
}): React.ReactElement {
  // The SAME pure function `reconcileNodesFromHistory` builds the canvas node's
  // id with, so both surfaces address one panel by construction (61-07).
  const panelId = genuiPanelNodeId(messageId, partIndex);

  // Non-throwing by contract — this same component renders inside
  // TranscriptPanelHost (docked), inside the canvas's own providers (a ChatNode
  // on the board), and bare with no providers at all (tests). See
  // useOptionalPanelOverlay's doc for the three trees.
  const overlay = useOptionalPanelOverlay(panelId);
  const resolved = resolveActivePanel(overlay, specJson, isStreaming);

  const isDockedPanelHost = useIsTranscriptPanelHost();

  // 52-UI-SPEC Judgment Call #5: the ring is driven by the toolbar's own signal
  // and is NEVER the sole signal — each busy control keeps its own
  // aria-label/spinner as the independent accessible one.
  const [generating, setGenerating] = useState(false);

  // The IDENTICAL shape `reconcileNodesFromHistory` puts in the canvas node's
  // `data.provenance` (use-canvas-persistence.ts), `runId: null` included — so
  // an edit made here and an edit made on the board address the same panel with
  // the same ref. Memoized for the same reason the canvas's is stable: it is a
  // prop on five controls.
  const provenance = useMemo(
    () => ({ messageId, partIndex, runId: null }),
    [messageId, partIndex],
  );

  return (
    <GeneratingRing active={isStreaming || generating} className="rounded-card">
      {/* The sketch's `.card`, as every canvas node shell wears it — but spelled
          out rather than reached for via `canvasNodeShellClass`, whose base
          carries a hover rule and a kind's left rule. Neither belongs on a panel
          sitting INSIDE a reading column: there is no board to lift off, and the
          kind axis distinguishes nodes from each other on a canvas, which is not
          a question this surface asks. `border-rule`/`bg-bright` are the app's
          own ink — see the header for why chrome must not sit inside the pack. */}
      <div className="overflow-hidden rounded-card border border-rule bg-bright">
        {isDockedPanelHost && (
          <PanelActionsToolbar
            panelId={panelId}
            provenance={provenance}
            activeSpecJson={resolved.specJson}
            resolvedPackId={resolved.packId}
            isStreaming={isStreaming}
            onGeneratingChange={setGenerating}
          />
        )}
        {/* `p-row-y`, matching `GenuiPanelNode`'s body — 61-06 chose that step
            over the `p-4` this call site inherited, and two surfaces rendering
            one panel should not disagree about its padding. */}
        <div className="p-row-y">
          <PanelThemeScope packId={resolved.packId} tokenOverrides={resolved.tokenOverrides}>
            {/* `variant="bare"`: the card above IS the panel's bordering layer
                now, so `GenuiCard` would be a second border inside it — the
                triple-nesting 23-UI-REVIEW Top Fix #1 removed on the canvas and
                left standing here only because nothing had ever framed a docked
                panel. */}
            <GenuiPartBoundary
              specJson={resolved.specJson}
              isStreaming={isStreaming}
              variant="bare"
            />
          </PanelThemeScope>
        </div>
      </div>
    </GeneratingRing>
  );
}

/** Terminal turn status (mirrors chat_messages.status, D-15/D-19/D-21/D-25)
 * plus a client-only sentinel: 'cost_capped_pre_turn' marks the LIVE
 * streaming pseudo-turn when the pre-turn fail-closed gate blocked the turn
 * before any content ever streamed (zero parts) — this status never comes
 * from a persisted row (a pre-turn block never inserts a chat_messages row
 * at all), so it only ever appears on the transient in-flight turn. */
export type TurnStatus =
  | "streaming"
  | "completed"
  | "stopped"
  | "failed"
  | "cost_capped"
  | "cost_capped_pre_turn"
  | "interrupted";

export interface MessageTurnProps {
  /**
   * This turn's chat_messages id (`MessageListItem.id`). REQUIRED, and
   * deliberately not optional (61-07): it is half of a genui part's panel
   * identity — `genuiPanelNodeId(messageId, partIndex)` is the SAME pure
   * function `reconcileNodesFromHistory` uses to build the canvas node's id, so
   * the two surfaces agree on which panel is which by CONSTRUCTION rather than
   * by a matching convention someone has to remember.
   *
   * Optional would have been cheaper here and wrong: a caller that forgot to
   * pass it would silently stop resolving overlays — criterion 4 regressing
   * with every test green, which is the exact failure class this phase keeps
   * finding. Required makes that a compile error instead.
   */
  readonly messageId: string;
  readonly role: "user" | "assistant" | "system";
  readonly parts: readonly MessagePart[];
  /** True only for the single, currently-streaming turn (drives the
   * blinking tail caret — 22-UI-SPEC.md generating indicator). */
  readonly isStreamingTurn?: boolean;
  /** Terminal status for a settled assistant turn — undefined for a user
   * turn or a still-streaming/completed-with-no-marker assistant turn. */
  readonly status?: TurnStatus;
  /** Sibling message ids for this turn's regenerate group, version order
   * (D-16) — omitted/length<=1 hides SiblingNav. */
  readonly siblings?: readonly string[];
  readonly activeSiblingIndex?: number;
  /** Regenerate AND inline-error Retry both resolve to the same operation —
   * re-running the turn as a new sibling version (CHAT-04/CHAT-05). */
  readonly onRegenerate?: () => void;
  readonly regenerateDisabled?: boolean;
  readonly onNavigateSibling?: (index: number) => void;
  /** Widget render surface (keyed by interactionId) for this turn's
   * interactive_widget parts (Task 4, D-08) — omitted when the turn has no
   * widgets or its host doesn't wire them. */
  readonly widgets?: MessageTurnWidgets;
}

/**
 * MessageTurn (D-18) — renders one turn's canonical interleaved parts
 * (text | genui_spec | genui_spec_streaming) in emission order, no per-part
 * bubble; all parts share the turn's outer spacing (22-UI-SPEC.md
 * Interleaved typed parts). Both genui part types route through
 * GenuiPartBoundary — schema-validated (finalized) or progressively
 * partial-tree rendered (still streaming), D-17/STREAM-02 — which wraps the
 * UNMODIFIED SpecRenderer.
 *
 * Assistant turns get a TurnActionRow (copy/regenerate/SiblingNav, CHAT-04)
 * — always-visible per the UI-SPEC's no-hover-only-affordances rule.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THE ROLES ARE TOLD APART BY HIERARCHY, NOT BY A RAIL (61-04, D-58-01).
 * ────────────────────────────────────────────────────────────────────────
 *
 * Every assistant turn used to wear `border-l-2 border-l-border/60 pl-3` —
 * v1.4's "assistant role rail", added when the two roles needed telling apart
 * and the system had nothing else to say it with. The sketch's `.aturn`
 * (direction-final.html:420) has NO rail, no card and no border: the user's
 * turn is a right-aligned `--shade` bubble and the assistant's is simply the
 * page. That IS the differentiation, and it is the stronger one — the answer
 * becomes the surface rather than a thing sitting on it.
 *
 * THIS COMPONENT'S ROOT IS A FLEX-COLUMN CHILD BY CONTRACT. `message-list.tsx`
 * renders the sketch's `.turns` (`flex flex-col gap-4`), so a user turn
 * right-aligns with `self-end` and an assistant turn stretches, exactly as
 * `.uturn`/`.aturn` are siblings in `.turns`. The old per-turn wrapper div
 * (`flex justify-end|justify-start`) existed only to re-create that one level
 * deeper, against a `space-y` parent.
 *
 * LAW 2 — BOTH ROLES' PROSE IS SANS, AND THAT IS DELIBERATE. The serif marks
 * the USER'S OWN MATERIAL (mail, saved sources, values pulled out of them),
 * never a voice. An assistant answer is polytoken speaking, so it is sans; a
 * user's typed message is the user speaking TO polytoken — not material quoted
 * from their mail — so it is sans too. 58-IDENTITY audited this exact
 * temptation and set the sketch's OWN manifesto lede back to sans to prove the
 * rule obeys itself: "Nothing polytoken says in its own voice wears the serif
 * — not even a manifesto." The serif enters this surface only through
 * `ProvenanceLink`'s evidence branch and cited values. If you are unsure which
 * side a string is on, ask where the WORDS came from, not which element holds
 * them.
 */
export function MessageTurn({
  messageId,
  role,
  parts,
  isStreamingTurn = false,
  status,
  siblings,
  activeSiblingIndex,
  onRegenerate,
  regenerateDisabled = false,
  onNavigateSibling,
  widgets,
}: MessageTurnProps): React.ReactElement {
  const isUser = role === "user";
  const isAssistant = role === "assistant";
  const lastIndex = parts.length - 1;

  // D-19/CHAT-05: a failed turn's content is fully REPLACED by the inline
  // retryable error card — same position, same turn, draft untouched.
  const isFailed = isAssistant && status === "failed";
  // D-21: the pre-turn fail-closed block never streamed any content — its
  // own dedicated no-retry card replaces the (empty) turn content entirely.
  const isCostCapBlocked = isAssistant && status === "cost_capped_pre_turn";
  // The action row only makes sense once a turn has settled with real
  // content — never mid-stream, and never for the two dedicated cards above
  // (nothing to copy/regenerate/navigate there — Retry already covers it).
  const showActionRow =
    isAssistant &&
    status !== undefined &&
    status !== "streaming" &&
    !isFailed &&
    !isCostCapBlocked;
  // D-15/D-21: mutually exclusive neutral marker — one slot, never both.
  const showStatusBadge =
    isAssistant && (status === "stopped" || status === "interrupted" || status === "cost_capped");

  // SKELETON TERMINAL FALLBACK ("LOOK AT CHAT MINOR BUGS") — a `*_streaming`
  // part renders SkeletonBars while it waits for the rest of its spec. If the
  // LIVE stream dies (stopped / interrupted / cost_capped) BEFORE the finalized
  // part ever lands, that skeleton would shimmer forever, because
  // GenuiPartBoundary only reaches the SAFE_FALLBACK_SPEC gate once
  // `isStreaming` is false. Only the genuine live-failure statuses count as
  // terminal here — the SAME set the status badge uses above (`failed` never
  // reaches the parts map; InlineErrorCard replaces the whole turn).
  //   CRUCIALLY not "any non-streaming status": a PERSISTED turn that carries a
  //   still-`*_streaming` part (D-01 async-resume) has a settled turn status
  //   ("complete"/undefined) yet its part legitimately keeps streaming until
  //   the finalized row lands via chat.getHistory — treating that as terminal
  //   would prematurely swap in the fallback AND unlock the panel toolbar
  //   mid-generation (transcript-panel-toolbar force-lock contract).
  const isTurnStreamTerminal =
    isAssistant &&
    (status === "stopped" || status === "interrupted" || status === "cost_capped");

  return (
    // `.uturn` / `.aturn` — flex-column siblings, told apart by hierarchy,
    // not by a rail (see this component's header). `min-w-0` on the assistant
    // turn is the D-61-06 guard: it lets a wide child (a table, a code fence)
    // shrink rather than demand width from the ScrollArea's `display:table`
    // content wrapper and scroll the whole transcript sideways (the user
    // bubble's half of that guard is `wrap-break-word`, see
    // user-bubble-class.ts).
    <div className={isUser ? `self-end ${USER_BUBBLE_CLASS}` : "w-full min-w-0"}>
      {isCostCapBlocked ? (
        <CostCapBlockedCard />
      ) : isFailed ? (
        <InlineErrorCard onRetry={onRegenerate ?? (() => {})} />
      ) : (
        // 8px between a turn's own parts — the sketch's `.aturn p + p`
        // (direction-final.html:421), which this already matched.
        <div className="space-y-2">
          {parts.map((part, index) => {
            const isLastPart = index === lastIndex;

            // CRITERION 4 (61-07): a settled genui panel renders through its
            // OVERLAY — the version the user regenerated, under the pack they
            // re-themed it to — resolved against the same persisted store the
            // canvas writes. It used to render `JSON.stringify(part.spec)`
            // straight into the boundary: the raw base spec, no panel identity,
            // no overlay, no theme scope. That was the whole of 999.17's read
            // half. `index` IS the `partIndex` the canvas's own node id is
            // built from.
            if (part.type === "genui_spec") {
              // REG-04: a finalized spec may NAME a registry capability via a
              // top-level `capability` binding descriptor (the agent-emits-
              // binding-spec path). Split it off so the confirm affordance can
              // mount and the panel still receives a `.strict()`-valid spec.
              const { binding, spec } = extractCapabilityBinding(part.spec);
              // No binding ⇒ byte-identical to the pre-REG-04 path: the panel
              // is returned DIRECTLY with `key={index}` (no wrapping Fragment,
              // so this branch never remounts the panel and loses in-progress
              // form state), and `spec` is the SAME object reference as
              // `part.spec` when there was no `capability` key.
              if (binding === null) {
                return (
                  <TranscriptGenuiPanel
                    key={index}
                    messageId={messageId}
                    partIndex={index}
                    specJson={JSON.stringify(spec)}
                    isStreaming={false}
                  />
                );
              }
              return (
                <React.Fragment key={index}>
                  <CapabilityBindingBoundary binding={binding} />
                  <TranscriptGenuiPanel
                    messageId={messageId}
                    partIndex={index}
                    specJson={JSON.stringify(spec)}
                    isStreaming={false}
                  />
                </React.Fragment>
              );
            }

            if (part.type === "genui_spec_streaming") {
              // Routed through the SAME resolver with `isStreaming` told
              // truthfully (T-61-24) rather than skipped because a streaming
              // part "cannot have an overlay". It can: a regenerate targets a
              // panel id that may already carry one. `resolveActivePanel` forces
              // the base spec verbatim while streaming, so a stored overlay can
              // never swap this turn's content mid-generation — and that
              // guarantee only holds if the flag actually reaches the resolver.
              //
              // The `<GeneratingRing>` that used to wrap this call site now
              // lives INSIDE the component (61-08), driven by
              // `isStreaming || generating`: the panel is a card now, and the
              // ring's CSS inherits its border-radius from the caller, so a ring
              // out here would paint `rounded-lg` around a `rounded-card` edge.
              // One ring, on the element that owns the radius.
              return (
                <TranscriptGenuiPanel
                  key={index}
                  messageId={messageId}
                  partIndex={index}
                  specJson={part.partialJson}
                  // Terminal stream => fall through to the finalized
                  // SAFE_FALLBACK_SPEC gate instead of an eternal skeleton.
                  isStreaming={!isTurnStreamTerminal}
                />
              );
            }

            // Phase 24 interactive-widget parts (Task 4, D-08).
            if (part.type === "interactive_widget") {
              const widgetPart = part as unknown as InteractiveWidgetPart;
              const displayState: WidgetDisplayState =
                widgets?.states[widgetPart.interactionId] ?? "pending";
              return (
                <InteractiveWidgetBoundary
                  key={index}
                  part={widgetPart}
                  displayState={displayState}
                  submittedValue={widgets?.submittedValues[widgetPart.interactionId]}
                  errorMessage={widgets?.errorMessages[widgetPart.interactionId] ?? null}
                  onSubmitResult={(result) =>
                    widgets?.onSubmitResult(widgetPart.interactionId, result)
                  }
                />
              );
            }

            if (part.type === "interaction_result") {
              return (
                <CompactInteractionEntry
                  key={index}
                  widgetKind={part.widgetKind}
                  summary={part.summary}
                />
              );
            }

            if (part.type === "interactive_widget_streaming") {
              // A still-streaming widget tool call — render the generic
              // skeleton placeholder (GenuiPartBoundary renders SkeletonBars
              // for unparseable content) until the finalized part lands via
              // chat.getHistory (D-01 async-resume).
              return (
                <GeneratingRing
                  key={index}
                  active={!isTurnStreamTerminal}
                  className="rounded-lg"
                >
                  <GenuiPartBoundary
                    specJson={part.partialJson}
                    // Terminal stream => finalized fallback, not eternal
                    // skeleton (see isTurnStreamTerminal).
                    isStreaming={!isTurnStreamTerminal}
                  />
                </GeneratingRing>
              );
            }

            // Phase 39 (TUI-01/TUI-02) server-tool round parts. Deliberately
            // NOT wrapped in <GeneratingRing> — a bare status line, not
            // bounded panel content (39-UI-SPEC.md Component 1 rationale).
            if (part.type === "tool_invocation_streaming") {
              return <ToolRoundActivityRow key={index} toolName={part.toolName} />;
            }

            if (part.type === "tool_invocation") {
              // No visible row — the paired tool_invocation_result row
              // already narrates the round (39-UI-SPEC.md DO-NOT 7).
              return null;
            }

            if (part.type === "tool_invocation_result") {
              return (
                <ToolInvocationResultRow
                  key={index}
                  toolName={part.toolName}
                  content={part.content}
                  isError={part.isError}
                />
              );
            }

            // Phase 73 (LCAN-01) — the agent-authored canvas parts are
            // CANVAS-only intent (materialized by the canvas reconcile pass),
            // never transcript content. No row in the chat thread.
            if (part.type === "canvas_add_node" || part.type === "canvas_connect") {
              return null;
            }

            // THE DEFAULT (text) BRANCH — polytoken's voice on an assistant
            // turn, the user's own typed words on a user turn. SANS on both
            // (law 2, see the header). `MarkdownRenderer` is left exactly as
            // it is: its sanitization posture is load-bearing — it renders LLM
            // output derived from attacker-authored mail (T-61-10).
            return (
              <div key={index}>
                <MarkdownRenderer content={part.text} />
                {isStreamingTurn && isLastPart && (
                  <span
                    aria-hidden
                    // Ink, stated. It resolved to ink already through
                    // `--primary: var(--ink)` — i.e. law 1 held here by
                    // accident of an indirection rather than by design.
                    className="ml-0.5 inline-block align-middle text-ink motion-safe:animate-pulse"
                  >
                    ▍
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {showStatusBadge && status && (
        <div className="mt-1">
          <TurnStatusBadge status={status} />
        </div>
      )}
      {showActionRow && (
        <TurnActionRow
          parts={parts}
          onRegenerate={onRegenerate}
          regenerateDisabled={regenerateDisabled}
          siblings={siblings}
          activeSiblingIndex={activeSiblingIndex ?? 0}
          onNavigateSibling={onNavigateSibling}
        />
      )}
    </div>
  );
}
