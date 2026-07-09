"use client";

/**
 * use-chat-stream.ts — SSE-consuming hook + streaming state machine
 * (CHAT-01/03/06/07, STREAM-01, D-24).
 *
 * Fetches the Next.js proxy route (/api/chat/stream or /api/chat/regenerate)
 * — never FastAPI directly — so EMAIL_LISTENER_API_KEY injection stays
 * server-side (T-22-29). Reads the streaming response body via
 * ReadableStream.getReader(), decodes UTF-8 chunks, and folds them through
 * two pure, independently unit-tested helpers:
 *
 *   parseSseChunk — splits a raw chunk into complete `data:` frames plus any
 *     trailing incomplete frame (a chunk boundary can split one SSE frame
 *     across two reads). Malformed JSON / unrecognized `type` values are
 *     dropped, never thrown (T-22-30 — untrusted stream input).
 *
 *   applyRunEvent — folds one ChatRunEvent into the running
 *     { parts, state } accumulator: idle -> streaming ->
 *     (completed|stopped|failed|cost_capped|interrupted), with D-18
 *     interleaved text/genui_spec parts preserved in emission order.
 *
 * stop() aborts the fetch via AbortController; the resulting abort is
 * caught internally and resolved to state 'stopped' — it never re-throws
 * out of the hook (T-22-32 — a user-initiated stop is a normal turn
 * outcome, not an error).
 */

import { useCallback, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types — mirror app/domain/ports/chat_repositories.py's ChatRunEventType and
// chat_stream.py's `{"type", "seq", "data"}` SSE frame shape (22-06/22-07).
// ---------------------------------------------------------------------------

export type ChatRunEventType =
  | "started"
  | "text_delta_checkpoint"
  | "tool_call"
  | "tool_result"
  | "usage"
  | "completed"
  | "stopped"
  | "failed"
  | "cost_capped"
  | "interrupted"
  | "server_tool_call"
  | "server_tool_result";

export interface ChatRunEvent {
  readonly type: ChatRunEventType;
  readonly seq: number | null;
  readonly data: Readonly<Record<string, unknown>>;
}

export type StreamTerminalState =
  | "completed"
  | "stopped"
  | "failed"
  | "cost_capped"
  | "interrupted";

export type StreamState = "idle" | "streaming" | StreamTerminalState;

/** D-18 canonical interleaved part — text | genui_spec | genui_spec_streaming
 * | interactive_widget | interaction_result | interactive_widget_streaming.
 * A finalized `emit_ui_spec` tool call becomes a genui_spec part, mirroring
 * the Python _TurnState accumulator exactly. genui_spec_streaming is a
 * CLIENT-ONLY transient part (never persisted server-side) that accumulates
 * an in-flight emit_ui_spec tool call's partial JSON across tool_call deltas
 * sharing the same toolId — 22-09's GenuiPartBoundary consumes it for
 * progressive partial-tree rendering (STREAM-02, D-17) before the matching
 * tool_result event replaces it with the finalized genui_spec part.
 *
 * Phase 24 (DCUI-01/D-01/D-04): `interactive_widget` (persisted, loaded via
 * chat.getHistory — the declared widget: proposal_cards today, clarify
 * widgets in 24-04) and `interaction_result` (persisted, the D-16 compact
 * user-response summary) never stream progressively client-side — the
 * emitting tool call's `tool_call` deltas accumulate into the CLIENT-ONLY
 * `interactive_widget_streaming` part instead (rendered as a skeleton, Task 4)
 * since the corresponding `tool_result` event carries no declaration (only
 * `interactionId`, 24-02) — the real part arrives moments later via
 * chat.getHistory once the turn's terminal event invalidates it (D-01
 * async-resume).
 *
 * Phase 39 (TUI-01/TUI-02): `tool_invocation_streaming` (CLIENT-ONLY,
 * transient — built from the new non-persisted `server_tool_call` mirror
 * event), `tool_invocation` (persisted, mirrors
 * build_tool_invocation_part's shape exactly — never built client-side
 * this phase, only replayed via chat.getHistory), and
 * `tool_invocation_result` (built client-side from the new non-persisted
 * `server_tool_result` mirror event OR persisted/replayed via
 * chat.getHistory — mirrors build_tool_invocation_result_part's shape
 * exactly so the two are byte-identical) — see 39-UI-SPEC.md's "SSE / Part
 * Contract" section. */
export type MessagePart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "genui_spec";
      readonly spec: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: "genui_spec_streaming";
      readonly toolId: string;
      readonly partialJson: string;
    }
  | {
      readonly type: "interactive_widget";
      readonly interactionId: string;
      readonly widgetKind: string;
      readonly declaration: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: "interaction_result";
      readonly interactionId: string;
      readonly widgetKind: string;
      readonly summary: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: "interactive_widget_streaming";
      readonly toolId: string;
      readonly partialJson: string;
    }
  | {
      readonly type: "tool_invocation_streaming";
      readonly toolUseId: string;
      readonly toolName: string;
    }
  | {
      readonly type: "tool_invocation";
      readonly toolUseId: string;
      readonly toolName: string;
      readonly arguments: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: "tool_invocation_result";
      readonly toolUseId: string;
      readonly toolName: string;
      readonly content: string;
      readonly isError: boolean;
    };

export interface ChatStreamAccumulator {
  readonly parts: readonly MessagePart[];
  readonly state: StreamState;
}

export interface UseChatStreamOptions {
  readonly conversationId: string;
  /** Fires once per turn, exactly when the stream settles into a terminal
   * state — the caller's cue to invalidate chat.getHistory (22-UI-SPEC.md,
   * "the persisted turn replaces the transient streamed parts"). */
  readonly onTerminal?: (state: StreamTerminalState) => void;
  /** Fires when a submitWidget() POST returns a non-ok response (404/409/422
   * — D-10/D-11/D-12). The GLOBAL stream state resolves to 'idle' rather than
   * 'failed' in this case — the transcript turn is fine, only the widget
   * itself shows the rejection (never a whole-turn InlineErrorCard). */
  readonly onWidgetRejected?: (status: number, reason: string) => void;
}

export interface UseChatStreamResult {
  readonly state: StreamState;
  readonly parts: readonly MessagePart[];
  readonly send: (userText: string, modelId: string) => void;
  readonly regenerate: (assistantMessageId: string, modelId: string) => void;
  /** Posts a widget interaction result to /api/chat/widget/submit and, on
   * success, reuses the SAME reader/accumulator loop as send() so the
   * continuation turn streams like any other turn (D-01). On rejection,
   * invokes onWidgetRejected instead of marking the global state 'failed'. */
  readonly submitWidget: (
    interactionId: string,
    result: Readonly<Record<string, unknown>>,
    modelId: string,
  ) => void;
  readonly stop: () => void;
}

// ---------------------------------------------------------------------------
// Pure, unit-tested helpers (see __tests__/use-chat-stream.test.ts)
// ---------------------------------------------------------------------------

const CHAT_RUN_EVENT_TYPES: ReadonlySet<string> = new Set<ChatRunEventType>([
  "started",
  "text_delta_checkpoint",
  "tool_call",
  "tool_result",
  "usage",
  "completed",
  "stopped",
  "failed",
  "cost_capped",
  "interrupted",
  "server_tool_call",
  "server_tool_result",
]);

const TERMINAL_EVENT_TYPES: ReadonlySet<string> = new Set<StreamTerminalState>(
  ["completed", "stopped", "failed", "cost_capped", "interrupted"],
);

function toChatRunEvent(value: unknown): ChatRunEvent | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string" || !CHAT_RUN_EVENT_TYPES.has(type)) {
    // Unrecognized event type — ignored rather than thrown (T-22-30); lets
    // the client tolerate a future server-added event type gracefully.
    return null;
  }
  const data =
    typeof record.data === "object" && record.data !== null
      ? (record.data as Record<string, unknown>)
      : {};
  const seq = typeof record.seq === "number" ? record.seq : null;
  return { type: type as ChatRunEventType, seq, data };
}

/**
 * parseSseChunk — pure SSE frame parser. Frames are separated by a blank
 * line (`\n\n`); a chunk boundary can split a frame mid-way, so any trailing
 * incomplete frame is returned as `remainder` for the caller to prepend to
 * the next chunk. Malformed JSON and unrecognized `type` values are
 * silently dropped rather than thrown (T-22-30).
 */
export function parseSseChunk(
  buffer: string,
  chunk: string,
): { readonly events: readonly ChatRunEvent[]; readonly remainder: string } {
  const combined = buffer + chunk;
  const frames = combined.split("\n\n");
  const remainder = frames.pop() ?? "";
  const events: ChatRunEvent[] = [];

  for (const frame of frames) {
    const dataLines = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart());
    if (dataLines.length === 0) {
      continue;
    }
    const payload = dataLines.join("\n");
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue; // malformed frame — dropped defensively (T-22-30)
    }
    const event = toChatRunEvent(parsed);
    if (event) {
      events.push(event);
    }
  }

  return { events, remainder };
}

/**
 * applyRunEvent — pure fold of one ChatRunEvent into the running
 * accumulator. text_delta_checkpoint merges into (or starts) the trailing
 * text part; tool_call accumulates a genui_spec_streaming part (partial_json
 * chunks concatenated per toolId, mirroring the Python _TurnState's
 * pending_tool_json accumulator exactly) so GenuiPartBoundary can render the
 * partial tree progressively (STREAM-02, D-17); tool_result replaces that
 * trailing streaming part with the finalized genui_spec part (D-18 order
 * preserved); started/usage advance no part but confirm streaming; the five
 * terminal types settle `state`, never touching `parts` again (the partial
 * already accumulated is never dropped, D-15).
 */
export function applyRunEvent(
  acc: ChatStreamAccumulator,
  event: ChatRunEvent,
): ChatStreamAccumulator {
  if (TERMINAL_EVENT_TYPES.has(event.type)) {
    return { parts: acc.parts, state: event.type as StreamTerminalState };
  }

  if (event.type === "text_delta_checkpoint") {
    const deltaText =
      typeof event.data.text === "string" ? event.data.text : "";
    const lastPart = acc.parts[acc.parts.length - 1];
    const parts: MessagePart[] =
      lastPart && lastPart.type === "text"
        ? [
            ...acc.parts.slice(0, -1),
            { type: "text", text: lastPart.text + deltaText },
          ]
        : [...acc.parts, { type: "text", text: deltaText }];
    return { parts, state: "streaming" };
  }

  if (event.type === "tool_call") {
    // 39-UI-SPEC.md "SSE / Part Contract" naming-collision resolution: a
    // real server-tool round's PERSISTED tool_call event carries
    // `arguments`, never `partial_json` — this branch was built for the
    // emit_ui_spec/interactive-widget streaming case and must ignore that
    // shape entirely (the new server_tool_call branch below builds the
    // correct part instead), or it would mis-fold the round into a
    // permanently-stuck, empty interactive_widget_streaming skeleton.
    if (typeof event.data.partial_json !== "string") {
      return { parts: acc.parts, state: "streaming" };
    }
    const toolId = typeof event.data.id === "string" ? event.data.id : "";
    const chunk =
      typeof event.data.partial_json === "string" ? event.data.partial_json : "";
    const toolName = typeof event.data.tool_name === "string" ? event.data.tool_name : undefined;
    // A recognized interactive-widget tool (any tool_name other than the
    // default emit_ui_spec) streams into interactive_widget_streaming
    // instead of genui_spec_streaming (Phase 24 Task 3) — an ABSENT tool_name
    // defaults to the existing genui path (backward compatibility).
    const streamingPartType: "genui_spec_streaming" | "interactive_widget_streaming" =
      toolName !== undefined && toolName !== "emit_ui_spec"
        ? "interactive_widget_streaming"
        : "genui_spec_streaming";
    const lastPart = acc.parts[acc.parts.length - 1];
    // Same in-flight tool call of the SAME streaming part type — concatenate.
    // A DIFFERENT (or absent) prior streaming part is REPLACED rather than
    // appended alongside — the server always finalizes a tool call
    // (tool_result) before starting a different one, but defensively
    // dropping an orphaned partial avoids a permanently stuck skeleton
    // placeholder if that invariant is ever violated.
    const parts: MessagePart[] =
      lastPart &&
      (lastPart.type === "genui_spec_streaming" || lastPart.type === "interactive_widget_streaming")
        ? [
            ...acc.parts.slice(0, -1),
            lastPart.toolId === toolId && lastPart.type === streamingPartType
              ? {
                  type: streamingPartType,
                  toolId,
                  partialJson: lastPart.partialJson + chunk,
                }
              : { type: streamingPartType, toolId, partialJson: chunk },
          ]
        : [
            ...acc.parts,
            { type: streamingPartType, toolId, partialJson: chunk },
          ];
    return { parts, state: "streaming" };
  }

  if (event.type === "tool_result") {
    const toolName = typeof event.data.tool_name === "string" ? event.data.tool_name : undefined;
    const isWidgetTool = toolName !== undefined && toolName !== "emit_ui_spec";
    if (isWidgetTool) {
      // The tool_result event for an interactive-widget tool carries no
      // declaration client-side (only interactionId, 24-02's
      // _finalize_pending_tool) — the real interactive_widget part arrives
      // moments later via chat.getHistory once the turn's terminal event
      // invalidates it (D-01 async-resume, D-04 the turn ends right here).
      // Leave the interactive_widget_streaming placeholder exactly as-is
      // rather than fabricate an incomplete part.
      return { parts: acc.parts, state: "streaming" };
    }
    const spec =
      typeof event.data.spec === "object" && event.data.spec !== null
        ? (event.data.spec as Record<string, unknown>)
        : {};
    const lastPart = acc.parts[acc.parts.length - 1];
    const parts: MessagePart[] =
      lastPart && lastPart.type === "genui_spec_streaming"
        ? [...acc.parts.slice(0, -1), { type: "genui_spec", spec }]
        : [...acc.parts, { type: "genui_spec", spec }];
    return { parts, state: "streaming" };
  }

  if (event.type === "server_tool_call") {
    // Mirrors the persisted "tool_call" event at the same dispatch point
    // (39-UI-SPEC.md) — fires exactly once per round, so this always
    // REPLACES a trailing tool_invocation_streaming part rather than
    // concatenating chunks (unlike the genui_spec_streaming reducer above).
    const toolUseId = typeof event.data.id === "string" ? event.data.id : "";
    const toolName =
      typeof event.data.tool_name === "string" ? event.data.tool_name : "";
    const lastPart = acc.parts[acc.parts.length - 1];
    const newPart: MessagePart = {
      type: "tool_invocation_streaming",
      toolUseId,
      toolName,
    };
    const parts: MessagePart[] =
      lastPart && lastPart.type === "tool_invocation_streaming"
        ? [...acc.parts.slice(0, -1), newPart]
        : [...acc.parts, newPart];
    return { parts, state: "streaming" };
  }

  if (event.type === "server_tool_result") {
    // Mirrors the persisted "tool_result" event at the same dispatch point
    // (39-UI-SPEC.md) — replaces the matching trailing
    // tool_invocation_streaming part with the finalized result, or appends
    // it defensively if no matching trailing streaming part exists.
    const toolUseId = typeof event.data.id === "string" ? event.data.id : "";
    const toolName =
      typeof event.data.tool_name === "string" ? event.data.tool_name : "";
    const content =
      typeof event.data.content === "string" ? event.data.content : "";
    const isError =
      typeof event.data.isError === "boolean" ? event.data.isError : false;
    const lastPart = acc.parts[acc.parts.length - 1];
    const newPart: MessagePart = {
      type: "tool_invocation_result",
      toolUseId,
      toolName,
      content,
      isError,
    };
    const parts: MessagePart[] =
      lastPart &&
      lastPart.type === "tool_invocation_streaming" &&
      lastPart.toolUseId === toolUseId
        ? [...acc.parts.slice(0, -1), newPart]
        : [...acc.parts, newPart];
    return { parts, state: "streaming" };
  }

  // started | usage — streaming continues, parts unchanged
  return { parts: acc.parts, state: "streaming" };
}

// ---------------------------------------------------------------------------
// useChatStream
// ---------------------------------------------------------------------------

export function useChatStream({
  conversationId,
  onTerminal,
  onWidgetRejected,
}: UseChatStreamOptions): UseChatStreamResult {
  const [state, setState] = useState<StreamState>("idle");
  const [parts, setParts] = useState<readonly MessagePart[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * runStream — shared fetch+reader+accumulate body for send/regenerate AND
   * submitWidget (Task 3, 24-03). `onHttpError`, when supplied, replaces the
   * default "mark the whole turn failed" behavior on a non-ok response with
   * a caller-owned rejection callback — used by submitWidget so a 404/409/422
   * widget rejection never surfaces as a whole-turn InlineErrorCard (D-10/
   * D-11/D-12: only the widget itself shows the rejection).
   */
  const runStream = useCallback(
    async (
      url: string,
      body: Record<string, unknown>,
      onHttpError?: (status: number, reason: string) => void,
    ) => {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setParts([]);
      setState("streaming");

      let acc: ChatStreamAccumulator = { parts: [], state: "streaming" };

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          if (onHttpError) {
            const bodyJson = (await res.json().catch(() => null)) as
              | { readonly error?: string; readonly reason?: string }
              | null;
            setState("idle");
            onHttpError(res.status, bodyJson?.reason ?? bodyJson?.error ?? "Request rejected");
            return;
          }
          setState("failed");
          onTerminal?.("failed");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          const chunk = decoder.decode(value, { stream: true });
          const parsedChunk = parseSseChunk(buffer, chunk);
          buffer = parsedChunk.remainder;
          for (const event of parsedChunk.events) {
            acc = applyRunEvent(acc, event);
            setParts(acc.parts);
            setState(acc.state);
          }
        }

        if (acc.state === "streaming") {
          // Stream ended without a terminal frame (e.g. connection cut) —
          // resolve to 'failed' rather than leaving the UI stuck streaming.
          setState("failed");
          onTerminal?.("failed");
        } else {
          onTerminal?.(acc.state as StreamTerminalState);
        }
      } catch (error) {
        if (controller.signal.aborted) {
          // A user-initiated stop() is a normal turn outcome, not an error
          // (T-22-32) — resolved quietly, never re-thrown.
          setState("stopped");
          onTerminal?.("stopped");
          return;
        }
        console.error("[useChatStream] stream failed:", error);
        if (onHttpError) {
          // A network-level failure during a widget submit — no structured
          // rejection status/reason to report, but the global state must
          // still resolve out of 'streaming' without faking a turn failure.
          setState("idle");
          return;
        }
        setState("failed");
        onTerminal?.("failed");
      } finally {
        abortControllerRef.current = null;
      }
    },
    [onTerminal],
  );

  const send = useCallback(
    (userText: string, modelId: string) => {
      void runStream("/api/chat/stream", {
        conversation_id: conversationId,
        user_text: userText,
        model_id: modelId,
      });
    },
    [conversationId, runStream],
  );

  const regenerate = useCallback(
    (assistantMessageId: string, modelId: string) => {
      void runStream("/api/chat/regenerate", {
        conversation_id: conversationId,
        assistant_message_id: assistantMessageId,
        model_id: modelId,
      });
    },
    [conversationId, runStream],
  );

  const submitWidget = useCallback(
    (
      interactionId: string,
      result: Readonly<Record<string, unknown>>,
      modelId: string,
    ) => {
      void runStream(
        "/api/chat/widget/submit",
        {
          conversation_id: conversationId,
          interaction_id: interactionId,
          model_id: modelId,
          result,
        },
        (status, reason) => onWidgetRejected?.(status, reason),
      );
    },
    [conversationId, runStream, onWidgetRejected],
  );

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  return { state, parts, send, regenerate, submitWidget, stop };
}
