"use client";

/**
 * use-conversation-controller.ts — useConversationController: the LIFTED
 * streaming/turn/webllm state that used to live inline inside
 * ConversationView (page.tsx). Extracted (23-03 Task 1) so BOTH the docked
 * Chat view AND the canvas ChatNode (Task 2/3) read from ONE shared
 * controller instance — switching Chat <-> Canvas never interrupts an
 * in-flight generation (D-02).
 *
 * Every helper/handler below is a VERBATIM relocation of what previously
 * lived inline in ConversationView — no behavior change (see
 * 23-03-PLAN.md Task 1's acceptance criteria).
 */

import { useCallback, useMemo, useRef, useState } from "react";

import { api } from "~/trpc/react";

import type { MessageListItem } from "../_components/message-list";
import type { TurnStatus } from "../_components/message-turn";
import {
  deriveWidgetDisplayState,
  type WidgetDisplayState,
  type WidgetInteractionRow,
} from "../_components/widget-display-state";
import {
  useChatStream,
  type MessagePart,
  type StreamState,
  type StreamTerminalState,
} from "./use-chat-stream";
import type { UseWebllmEngineResult } from "./use-webllm-engine";

export const STREAMING_TURN_ID = "__streaming-turn__";
export const OPTIMISTIC_USER_TURN_ID = "__optimistic-user-turn__";

// ---------------------------------------------------------------------------
// Turn grouping — chat.getHistory returns EVERY sibling version row (D-16),
// not just the active one, so the regenerate SiblingNav has something to
// navigate. groupTurnsFromHistory folds those rows into one MessageListItem
// per logical turn (user row + the currently-selected assistant sibling).
// ---------------------------------------------------------------------------

export interface ChatHistoryRow {
  readonly id: string;
  readonly role: string;
  readonly parts: unknown;
  readonly status: string;
  readonly turnIndex: number;
  readonly siblingGroupId: string | null;
  readonly version: number;
  readonly isActive: boolean;
}

/** Stable key for a turn's regenerate/sibling group — falls back to the row's
 * own id for the (never-actually-null per 22-06, but typed nullable) case. */
export function siblingGroupKeyFor(row: ChatHistoryRow): string {
  return row.siblingGroupId ?? row.id;
}

/**
 * Folds raw chat.getHistory rows (ALL sibling versions) into render-ready
 * turns: one user MessageListItem plus one assistant MessageListItem per
 * turnIndex, the assistant item carrying the full siblings[] list (D-16) so
 * SiblingNav can navigate locally. `siblingOverrides` holds the user's local
 * (non-persisted) choice of which sibling to display; `regeneratingActiveId`
 * hides the stale cached row for a turn whose regenerate is in flight — the
 * live streaming pseudo-turn represents it instead (avoids a duplicate).
 */
export function groupTurnsFromHistory(
  rows: readonly ChatHistoryRow[],
  siblingOverrides: Readonly<Record<string, string>>,
  regeneratingActiveId: string | null,
): MessageListItem[] {
  const turnIndices = Array.from(new Set(rows.map((row) => row.turnIndex))).sort(
    (a, b) => a - b,
  );
  const items: MessageListItem[] = [];

  for (const turnIndex of turnIndices) {
    const rowsForTurn = rows.filter((row) => row.turnIndex === turnIndex);

    const userRow = rowsForTurn.find((row) => row.role === "user");
    if (userRow) {
      items.push({
        id: userRow.id,
        role: "user",
        parts: (userRow.parts as MessagePart[] | null) ?? [],
      });
    }

    const assistantRows = rowsForTurn
      .filter((row) => row.role === "assistant")
      .sort((a, b) => a.version - b.version);
    if (assistantRows.length === 0) continue;

    const activeRow =
      assistantRows.find((row) => row.isActive) ??
      assistantRows[assistantRows.length - 1]!;

    if (activeRow.id === regeneratingActiveId) {
      // Stale — a regenerate for this turn is streaming right now; the live
      // pseudo-turn (appended after history) stands in for it instead.
      continue;
    }

    const groupKey = siblingGroupKeyFor(activeRow);
    const overrideId = siblingOverrides[groupKey];
    const selectedRow =
      assistantRows.find((row) => row.id === overrideId) ?? activeRow;
    const siblingIds = assistantRows.map((row) => row.id);

    items.push({
      id: selectedRow.id,
      role: "assistant",
      parts: (selectedRow.parts as MessagePart[] | null) ?? [],
      status: selectedRow.status as TurnStatus,
      siblings: siblingIds.length > 1 ? siblingIds : undefined,
      activeSiblingIndex: siblingIds.indexOf(selectedRow.id),
      regenerateTargetId: activeRow.id,
    });
  }

  return items;
}

/**
 * toWebllmMessages — active-sibling chat.getHistory rows -> the plain
 * text-only {role, content} shape useWebllmEngine.generateStream() expects.
 * D-08: a browser-locus model never sees genui_spec parts (no tool was ever
 * offered to it), so a prior assistant turn's non-text parts are simply
 * skipped rather than replayed — this mirrors run_chat_turn.py's own
 * _provider_content_blocks stand-in posture for parts a given transport
 * can't represent, just applied to the OUTGOING side instead.
 */
export function toWebllmMessages(
  rows: readonly ChatHistoryRow[],
): ReadonlyArray<{ readonly role: "user" | "assistant"; readonly content: string }> {
  return rows
    .filter((row) => row.isActive && (row.role === "user" || row.role === "assistant"))
    .slice()
    .sort((a, b) => a.turnIndex - b.turnIndex)
    .map((row) => {
      const parts = (row.parts as MessagePart[] | null) ?? [];
      const content = parts
        .filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      return { role: row.role as "user" | "assistant", content };
    });
}

// Visually-hidden aria-live announcer copy (22-UI-SPEC.md Accessibility) —
// announces STATE TRANSITIONS only, never the growing delta text itself
// (that would spam screen readers on every streamed token).
export function liveAnnouncementFor(state: StreamState): string {
  switch (state) {
    case "streaming":
      return "Generating response";
    case "completed":
      return "Response complete";
    case "stopped":
      return "Response stopped by user";
    case "failed":
      return "Response failed";
    case "cost_capped":
      return "Cost limit reached";
    default:
      return "";
  }
}

export interface UseConversationControllerOptions {
  readonly conversationId: string;
  readonly modelId: string;
  /** Single top-level useWebllmEngine() instance (ChatPage) — threaded down
   * so switching conversations never re-instantiates or re-downloads the
   * WebLLM engine (D-08). */
  readonly webllm: UseWebllmEngineResult;
}

/**
 * ConversationController — the union of state/handlers BOTH the docked Chat
 * view and the canvas ChatNode need. Merges persisted history
 * (chat.getHistory) with the live streaming turn from EITHER useChatStream
 * (server-locus, SSE) or useWebllmEngine (browser-locus, local — D-08/D-09).
 */
export interface ConversationController {
  readonly turns: MessageListItem[];
  /** id of the single turn currently streaming (drives the tail caret) —
   * stable across the controller's lifetime. */
  readonly streamingTurnId: string;
  readonly activeStreamState: StreamState;
  readonly regenerateDisabled: boolean;
  readonly liveAnnouncement: string;
  /** Raw chat.getHistory rows (ALL sibling versions) — the canvas surface
   * (23-03 Task 3) derives its genui-panel nodes from these. */
  readonly historyRows: readonly ChatHistoryRow[];
  /** The already-materialized assistant message id currently being
   * regenerated, or null — the canvas surface (23-04 Task 3) uses this as
   * the STABLE provenance key to overlay the live streaming pseudo-turn's
   * partial genui content onto that EXISTING genui-panel node (never a new
   * one — a regenerate has no new messageId until it lands, D-07). */
  readonly regeneratingMessageId: string | null;
  readonly handleSubmit: (text: string) => void;
  readonly handleStop: () => void;
  readonly handleRegenerate: (assistantMessageId: string) => void;
  readonly handleLiveRetry: () => void;
  readonly handleNavigateSibling: (siblingMessageId: string) => void;
  readonly handleSelectBrowserModel: (modelId: string) => Promise<void>;
  /** MessageList's onRegenerate contract — routes the streaming pseudo-turn's
   * id to handleLiveRetry, any real message id to handleRegenerate. */
  readonly onRegenerateTurn: (assistantMessageId: string) => void;
  /** The authoritative widget-interaction rows for this conversation
   * (chat.getWidgetInteractions) — the canvas surface (Task 4) derives its
   * per-panel widget state from these, same as the transcript. */
  readonly widgetInteractions: readonly WidgetInteractionRow[];
  /** Pre-computed widget render surface keyed by interactionId (built in the
   * controller, not in render — keeps MessageList memo-friendly, D-08). Both
   * the transcript and the canvas render purely from this bundle. */
  readonly widgets: WidgetSurface;
}

/** The widget render surface both the transcript (MessageTurn) and the canvas
 * (GenuiPanelNode) consume — one source of truth (D-08). Keyed by
 * interactionId. */
export interface WidgetSurface {
  readonly states: Readonly<Record<string, WidgetDisplayState>>;
  /** The raw submitted_value payload (opaque per widgetKind) — proposal_cards
   * carries `{optionId}`, clarify_widget carries `{values}` (24-04). */
  readonly submittedValues: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly errorMessages: Readonly<Record<string, string | null>>;
  /** InteractiveWidgetBoundary's onSubmitResult gives the opaque result body;
   * the transcript/canvas bind the interactionId, so this takes both
   * (generalized over widgetKind, 24-04 Task 3). */
  readonly onSubmitResult: (interactionId: string, result: Readonly<Record<string, unknown>>) => void;
}

/**
 * useConversationController — lifted streaming/turn/webllm state (STREAM-01,
 * CHAT-01/03/06/07). The send handler branches purely on the selected
 * model's registry execution_locus — never a hardcoded per-model special
 * case — so both loci feed the SAME growing-parts + state-machine shape into
 * the SAME MessageList. The optimistic user message renders immediately on
 * submit — before either path starts — and both transient turns are dropped
 * once the turn settles and chat.getHistory is invalidated (the persisted
 * row takes over).
 */
export function useConversationController({
  conversationId,
  modelId,
  webllm,
}: UseConversationControllerOptions): ConversationController {
  const utils = api.useUtils();
  const { data: historyRows } = api.chat.getHistory.useQuery({
    conversationId,
  });
  const { data: widgetInteractionsData } =
    api.chat.getWidgetInteractions.useQuery({ conversationId });
  const { data: modelsData } = api.chat.models.useQuery();
  const recordBrowserTurn = api.chat.recordBrowserTurn.useMutation();
  // Data-driven locus branch (D-09) — looked up from the registry, never a
  // hardcoded model-id comparison in the renderer/send-path.
  const isBrowserLocus =
    (modelsData?.models ?? []).find((model) => model.id === modelId)
      ?.executionLocus === "browser";
  const [webllmParts, setWebllmParts] = useState<readonly MessagePart[]>([]);
  const [webllmStreamState, setWebllmStreamState] = useState<StreamState>("idle");
  const webllmStopRequestedRef = useRef(false);
  const [optimisticUserText, setOptimisticUserText] = useState<string | null>(
    null,
  );
  // D-16: the user's LOCAL choice of which sibling version to display per
  // regenerate group (groupKey -> selected message id) — purely visual, never
  // re-fetches and never affects the server's active-context sibling.
  const [siblingOverrides, setSiblingOverrides] = useState<
    Record<string, string>
  >({});
  // The active-sibling message id currently being regenerated, if any — used
  // to hide the stale cached row while the live pseudo-turn streams its
  // replacement (avoids a duplicate render of the same logical turn).
  const [regeneratingActiveId, setRegeneratingActiveId] = useState<
    string | null
  >(null);
  // Last text the user actually submitted via the composer — the fallback
  // retry path for a turn that fails before it has ever been persisted (so
  // there is no message id yet to regenerate against, CHAT-05).
  const lastSentTextRef = useRef<string>("");
  // chat.getHistory row count captured at the moment the CURRENT turn's
  // stream started — every terminal outcome except a pre-turn cost block
  // inserts at least one new row (D-15: even a failed/stopped turn persists
  // whatever partial streamed), so once the refetched count grows past this
  // snapshot the persisted row has landed and the transient live pseudo-turn
  // is dropped in favor of it (avoids rendering the same turn twice).
  const historyCountAtStreamStartRef = useRef<number>(0);

  const widgetInteractions: readonly WidgetInteractionRow[] = useMemo(
    () => widgetInteractionsData ?? [],
    [widgetInteractionsData],
  );

  // D-02: interaction ids the user has locally (optimistically) superseded by
  // typing a new message while the widget was pending — populated in
  // handleSubmit BEFORE the send request even starts. Held in state (not a
  // ref) so the derived display state re-renders the moment it changes.
  const [supersededLocally, setSupersededLocally] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  // The single in-flight widget submit (D-04: at most one pending widget per
  // turn). status "submitting" overlays the Submitting… row; status "error"
  // carries the errorKind the rejection mapped to (D-10/D-11/D-12).
  const [inFlightWidget, setInFlightWidget] = useState<{
    readonly interactionId: string;
    readonly status: "submitting" | "error";
    readonly errorKind?: "conflict" | "stale" | "invalid";
  } | null>(null);

  const handleTerminal = useCallback(() => {
    // Every terminal branch persists whatever streamed so far (D-15) — the
    // persisted row is now authoritative, so replace the transient turns.
    void utils.chat.getHistory.invalidate({ conversationId });
    // A completed turn writes a new chat_cost_ledger row (22-06/22-07) — keep
    // the session cost meter live (D-23) without a manual refresh.
    void utils.chat.sessionCost.invalidate({ conversationId });
    // A widget-submit continuation turn just settled — the pending widget is
    // now `submitted` server-side (D-16); refetch so its locked state lands.
    void utils.chat.getWidgetInteractions.invalidate({ conversationId });
    setOptimisticUserText(null);
    setRegeneratingActiveId(null);
    setInFlightWidget(null);
  }, [conversationId, utils]);

  // onWidgetRejected (D-10/D-11/D-12): a non-ok submit response maps to an
  // errorKind and invalidates getWidgetInteractions so server truth reconciles
  // the visual state. Never marks the global stream state failed — the
  // transcript turn is fine, only the widget shows the outcome.
  const handleWidgetRejected = useCallback(
    (status: number, reason: string) => {
      const errorKind: "conflict" | "stale" | "invalid" =
        status === 422
          ? "invalid"
          : reason.toLowerCase().includes("already")
            ? "conflict"
            : "stale";
      setInFlightWidget((prev) =>
        prev ? { ...prev, status: "error", errorKind } : prev,
      );
      void utils.chat.getWidgetInteractions.invalidate({ conversationId });
    },
    [conversationId, utils],
  );

  const chatStream = useChatStream({
    conversationId,
    onTerminal: handleTerminal,
    onWidgetRejected: handleWidgetRejected,
  });

  const handleWidgetSubmit = useCallback(
    (interactionId: string, result: Readonly<Record<string, unknown>>) => {
      setInFlightWidget({ interactionId, status: "submitting" });
      historyCountAtStreamStartRef.current = (historyRows ?? []).length;
      chatStream.submitWidget(interactionId, result, modelId);
    },
    [chatStream, modelId, historyRows],
  );

  // Browser-locus send path (D-08/D-09) — the SIBLING of chatStream.send for
  // a WebLLM model: streams locally via useWebllmEngine.generateStream, then
  // persists the finished turn in the SAME canonical shape server turns use
  // via chat.recordBrowserTurn (T-22-39-style: no genui, text-only).
  const runWebllmTurn = useCallback(
    async (text: string) => {
      webllmStopRequestedRef.current = false;
      setWebllmParts([]);
      setWebllmStreamState("streaming");
      historyCountAtStreamStartRef.current = (historyRows ?? []).length;

      const requestMessages = [
        ...toWebllmMessages(historyRows ?? []),
        { role: "user" as const, content: text },
      ];

      let accumulatedText = "";
      let usage: { inputTokens: number; outputTokens: number } | undefined;
      let terminalState: StreamTerminalState = "completed";

      try {
        await webllm.ensureLoaded();
        for await (const chunk of webllm.generateStream(requestMessages)) {
          if (chunk.textDelta) {
            accumulatedText += chunk.textDelta;
            setWebllmParts([{ type: "text", text: accumulatedText }]);
          }
          if (chunk.usage) {
            usage = chunk.usage;
          }
        }
        terminalState = webllmStopRequestedRef.current ? "stopped" : "completed";
      } catch (error) {
        console.error("[useConversationController] WebLLM generation failed:", error);
        terminalState = webllmStopRequestedRef.current ? "stopped" : "failed";
      }

      setWebllmStreamState(terminalState);

      try {
        await recordBrowserTurn.mutateAsync({
          conversationId,
          modelId,
          userText: text,
          assistantText: accumulatedText,
          status: terminalState,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
        });
      } catch (error) {
        console.error("[useConversationController] recordBrowserTurn failed:", error);
      }

      handleTerminal();
    },
    [webllm, historyRows, conversationId, modelId, recordBrowserTurn, handleTerminal],
  );

  const handleSubmit = useCallback(
    (text: string) => {
      lastSentTextRef.current = text;
      setOptimisticUserText(text);
      // D-02 (typing supersedes): every currently-pending widget is
      // optimistically marked superseded BEFORE the send starts — the
      // composer is never blocked by a pending widget.
      const pendingIds = widgetInteractions
        .filter((row) => row.state === "pending")
        .map((row) => row.id);
      if (pendingIds.length > 0) {
        setSupersededLocally((prev) => new Set([...prev, ...pendingIds]));
      }
      if (isBrowserLocus) {
        void runWebllmTurn(text);
        return;
      }
      historyCountAtStreamStartRef.current = (historyRows ?? []).length;
      chatStream.send(text, modelId);
    },
    [chatStream, modelId, historyRows, isBrowserLocus, runWebllmTurn, widgetInteractions],
  );

  const handleStop = useCallback(() => {
    if (isBrowserLocus) {
      webllmStopRequestedRef.current = true;
      webllm.interrupt();
      return;
    }
    chatStream.stop();
  }, [isBrowserLocus, webllm, chatStream]);

  const handleRegenerate = useCallback(
    (assistantMessageId: string) => {
      // A stale sibling override for this group would otherwise keep
      // pointing at a retired version once the new one lands.
      setSiblingOverrides({});
      setRegeneratingActiveId(assistantMessageId);
      historyCountAtStreamStartRef.current = (historyRows ?? []).length;
      chatStream.regenerate(assistantMessageId, modelId);
    },
    [chatStream, modelId, historyRows],
  );

  // CHAT-05: retry is the same operation as regenerate once a message id
  // exists; a turn that failed before ever being persisted (no id yet) falls
  // back to re-sending the same user text (via whichever locus is active).
  const handleLiveRetry = useCallback(() => {
    if (regeneratingActiveId) {
      handleRegenerate(regeneratingActiveId);
      return;
    }
    if (isBrowserLocus) {
      void runWebllmTurn(lastSentTextRef.current);
      return;
    }
    historyCountAtStreamStartRef.current = (historyRows ?? []).length;
    chatStream.send(lastSentTextRef.current, modelId);
  }, [
    regeneratingActiveId,
    handleRegenerate,
    chatStream,
    modelId,
    historyRows,
    isBrowserLocus,
    runWebllmTurn,
  ]);

  const handleNavigateSibling = useCallback(
    (siblingMessageId: string) => {
      const row = (historyRows ?? []).find((r) => r.id === siblingMessageId);
      if (!row) return;
      const groupKey = siblingGroupKeyFor(row);
      setSiblingOverrides((prev) => ({ ...prev, [groupKey]: siblingMessageId }));
    },
    [historyRows],
  );

  const historyTurns = groupTurnsFromHistory(
    historyRows ?? [],
    siblingOverrides,
    regeneratingActiveId,
  );

  // The currently-active locus's stream state/parts (D-09 — a data-driven
  // branch, never a hardcoded per-model special case). Exactly one of
  // {chatStream, runWebllmTurn} is ever active per controller instance (the
  // composer disables while either streams), so this union is safe.
  const activeStreamState: StreamState = isBrowserLocus
    ? webllmStreamState
    : chatStream.state;
  const activeStreamParts: readonly MessagePart[] = isBrowserLocus
    ? webllmParts
    : chatStream.parts;

  // D-21: a pre-turn fail-closed block never streams any content at all —
  // zero parts distinguishes it from a mid-stream cost-cap (which always has
  // whatever partial content streamed before the breach, D-15). Browser-locus
  // turns never cost-cap (D-08 — always $0), so this is only ever true for
  // the server-locus path.
  const isPreTurnCostBlock =
    activeStreamState === "cost_capped" && activeStreamParts.length === 0;
  // A pre-turn block never inserts a chat_messages row at all, so history
  // can never "catch up" to it — it stays visible until the next action
  // replaces it. Every other terminal outcome DOES insert a row (D-15), so
  // once the refetched row count grows past the pre-stream snapshot, the
  // persisted turn has landed and this transient stand-in is redundant.
  const historyHasCaughtUp =
    (historyRows ?? []).length > historyCountAtStreamStartRef.current;
  const suppressLiveTurn =
    activeStreamState !== "idle" &&
    activeStreamState !== "streaming" &&
    !isPreTurnCostBlock &&
    historyHasCaughtUp;

  const turns: MessageListItem[] = [...historyTurns];
  if (optimisticUserText !== null && activeStreamState !== "idle") {
    turns.push({
      id: OPTIMISTIC_USER_TURN_ID,
      role: "user",
      parts: [{ type: "text", text: optimisticUserText }],
    });
  }
  if (activeStreamState !== "idle" && !suppressLiveTurn) {
    const liveStatus: TurnStatus =
      activeStreamState === "streaming"
        ? "streaming"
        : isPreTurnCostBlock
          ? "cost_capped_pre_turn"
          : (activeStreamState as TurnStatus);
    turns.push({
      id: STREAMING_TURN_ID,
      role: "assistant",
      parts: activeStreamParts,
      status: liveStatus,
      // A "completed" live turn's real message id isn't known client-side
      // until chat.getHistory catches up (server-generated UUID) — offering
      // regenerate here would resend the user's text instead of regenerating
      // the reply it actually produced (handleLiveRetry's no-id fallback).
      // failed/cost_capped/stopped need an IMMEDIATELY actionable retry
      // (CHAT-05), and "resend" is an acceptable, correct fallback for those
      // (nothing meaningful to regenerate yet either way) — only the
      // "completed" case is excluded to avoid that misfire.
      regenerateTargetId: liveStatus === "completed" ? undefined : STREAMING_TURN_ID,
    });
  }

  const regenerateDisabled = activeStreamState === "streaming";

  const handleSelectBrowserModel = useCallback(
    async (_modelId: string) => {
      await webllm.ensureLoaded();
    },
    [webllm],
  );

  const onRegenerateTurn = useCallback(
    (assistantMessageId: string) =>
      assistantMessageId === STREAMING_TURN_ID
        ? handleLiveRetry()
        : handleRegenerate(assistantMessageId),
    [handleLiveRetry, handleRegenerate],
  );

  const onSubmitResult = useCallback(
    (interactionId: string, result: Readonly<Record<string, unknown>>) => {
      handleWidgetSubmit(interactionId, result);
    },
    [handleWidgetSubmit],
  );

  // The widget render surface both surfaces consume (D-08) — built here, not
  // in render, so MessageList stays memo-friendly. Keyed by interactionId.
  const widgets: WidgetSurface = useMemo(() => {
    const states: Record<string, WidgetDisplayState> = {};
    const submittedValues: Record<string, Readonly<Record<string, unknown>>> = {};
    const errorMessages: Record<string, string | null> = {};

    for (const interaction of widgetInteractions) {
      states[interaction.id] = deriveWidgetDisplayState({
        interaction,
        historyRows: historyRows ?? [],
        supersededLocally,
        // Only the "submitting" status feeds the in-flight overlay — once a
        // rejection lands ("error"), the base derived state (pending for a
        // 422 retry, or the reconciled server state) takes over.
        inFlightInteractionId:
          inFlightWidget?.status === "submitting" ? inFlightWidget.interactionId : null,
      });

      // Opaque per widgetKind (24-04): proposal_cards stores {optionId},
      // clarify_widget stores {values} — InteractiveWidgetBoundary reads the
      // shape it expects based on part.widgetKind, so this surface just
      // passes the raw submitted object through unchanged.
      const submitted = interaction.submittedValue;
      if (submitted !== null && typeof submitted === "object" && !Array.isArray(submitted)) {
        submittedValues[interaction.id] = submitted as Readonly<Record<string, unknown>>;
      }

      // Only the retryable validation error surfaces an inline error row that
      // re-enables the widget (D-10). Conflict/stale reconcile to their own
      // badge/caption via the invalidated server state — no separate row.
      errorMessages[interaction.id] =
        inFlightWidget?.interactionId === interaction.id &&
        inFlightWidget.status === "error" &&
        inFlightWidget.errorKind === "invalid"
          ? "This response couldn't be saved. Please try again."
          : null;
    }

    return { states, submittedValues, errorMessages, onSubmitResult };
  }, [widgetInteractions, historyRows, supersededLocally, inFlightWidget, onSubmitResult]);

  return {
    turns,
    streamingTurnId: STREAMING_TURN_ID,
    activeStreamState,
    regenerateDisabled,
    liveAnnouncement: liveAnnouncementFor(activeStreamState),
    historyRows: historyRows ?? [],
    regeneratingMessageId: regeneratingActiveId,
    handleSubmit,
    handleStop,
    handleRegenerate,
    handleLiveRetry,
    handleNavigateSibling,
    handleSelectBrowserModel,
    onRegenerateTurn,
    widgetInteractions,
    widgets,
  };
}
