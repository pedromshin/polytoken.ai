/**
 * use-chat-stream.test.ts — unit tests for the pure, exported SSE helpers
 * (STREAM-01, T-22-30). useChatStream itself wraps fetch()/AbortController
 * around these two pure functions; the hook is deliberately kept thin so the
 * parsing + state-machine logic is fully unit-testable without a live
 * network stream.
 *
 * parseSseChunk: splits a raw text/event-stream chunk into complete
 * `data:` frames plus any trailing incomplete frame (a chunk boundary can
 * split one SSE frame across two reads). Malformed JSON and unrecognized
 * `type` values are dropped rather than thrown (T-22-30 — untrusted stream
 * input must never corrupt client state).
 *
 * applyRunEvent: folds one ChatRunEvent into the running
 * { parts, state } accumulator — the idle -> streaming ->
 * (completed|stopped|failed|cost_capped|interrupted) state machine
 * (22-UI-SPEC.md Interaction Contracts) plus D-18 interleaved parts.
 */

import { describe, expect, it } from "vitest";

// Forward declaration — will fail to resolve until use-chat-stream.ts is
// created (RED).
import {
  applyRunEvent,
  parseSseChunk,
  type ChatRunEvent,
  type ChatStreamAccumulator,
} from "../use-chat-stream";

function frame(
  type: string,
  data: Record<string, unknown> = {},
  seq = 1,
): string {
  return `data: ${JSON.stringify({ type, seq, data })}\n\n`;
}

describe("parseSseChunk", () => {
  it("parses multiple complete frames delivered in a single chunk", () => {
    const chunk =
      frame("started", { model_id: "us.anthropic.claude-sonnet-4-6" }) +
      frame("text_delta_checkpoint", { text: "Hello" }) +
      frame("completed", {});

    const { events, remainder } = parseSseChunk("", chunk);

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.type)).toEqual([
      "started",
      "text_delta_checkpoint",
      "completed",
    ]);
    expect(remainder).toBe("");
  });

  it("buffers a frame split across two chunk reads (chunk-boundary safety)", () => {
    const full = frame("text_delta_checkpoint", { text: "partial-frame" });
    const splitPoint = Math.floor(full.length / 2);
    const first = full.slice(0, splitPoint);
    const second = full.slice(splitPoint);

    const firstResult = parseSseChunk("", first);
    expect(firstResult.events).toHaveLength(0);

    const secondResult = parseSseChunk(firstResult.remainder, second);
    expect(secondResult.events).toHaveLength(1);
    expect(secondResult.events[0]?.data.text).toBe("partial-frame");
    expect(secondResult.remainder).toBe("");
  });

  it("silently drops a malformed-JSON frame (T-22-30)", () => {
    const chunk = "data: {not valid json\n\n" + frame("completed", {});
    const { events } = parseSseChunk("", chunk);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("completed");
  });

  it("silently drops a frame with an unrecognized event type (T-22-30)", () => {
    const chunk =
      frame("some_future_event_type", { foo: "bar" }) + frame("completed", {});
    const { events } = parseSseChunk("", chunk);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("completed");
  });
});

describe("applyRunEvent", () => {
  const initial: ChatStreamAccumulator = { parts: [], state: "idle" };

  it("accumulates text across started -> several text_delta_checkpoint -> completed", () => {
    const events: ChatRunEvent[] = [
      { type: "started", seq: 1, data: { model_id: "x" } },
      { type: "text_delta_checkpoint", seq: 2, data: { text: "Hello, " } },
      { type: "text_delta_checkpoint", seq: 3, data: { text: "world" } },
      { type: "text_delta_checkpoint", seq: 4, data: { text: "!" } },
      { type: "completed", seq: 5, data: {} },
    ];

    const final = events.reduce(applyRunEvent, initial);

    expect(final.state).toBe("completed");
    expect(final.parts).toEqual([{ type: "text", text: "Hello, world!" }]);
  });

  it("settles state to 'stopped' on a stopped terminal event, keeping the partial", () => {
    const events: ChatRunEvent[] = [
      { type: "started", seq: 1, data: {} },
      { type: "text_delta_checkpoint", seq: 2, data: { text: "partial" } },
      { type: "stopped", seq: 3, data: {} },
    ];

    const final = events.reduce(applyRunEvent, initial);

    expect(final.state).toBe("stopped");
    expect(final.parts).toEqual([{ type: "text", text: "partial" }]);
  });

  it("interleaves a genui_spec part between text parts in emission order (D-18)", () => {
    const events: ChatRunEvent[] = [
      { type: "text_delta_checkpoint", seq: 1, data: { text: "before " } },
      {
        type: "tool_call",
        seq: 2,
        data: { tool_name: "emit_ui_spec", id: "t1", partial_json: "{}" },
      },
      {
        type: "tool_result",
        seq: 3,
        data: {
          tool_name: "emit_ui_spec",
          id: "t1",
          spec: { kind: "card" },
        },
      },
      { type: "text_delta_checkpoint", seq: 4, data: { text: "after" } },
      { type: "completed", seq: 5, data: {} },
    ];

    const final = events.reduce(applyRunEvent, initial);

    expect(final.parts).toEqual([
      { type: "text", text: "before " },
      { type: "genui_spec", spec: { kind: "card" } },
      { type: "text", text: "after" },
    ]);
    expect(final.state).toBe("completed");
  });

  it("marks cost_capped as a distinct terminal state, partial preserved", () => {
    const events: ChatRunEvent[] = [
      { type: "text_delta_checkpoint", seq: 1, data: { text: "partial" } },
      { type: "cost_capped", seq: 2, data: { breached_cap: "per_turn" } },
    ];

    const final = events.reduce(applyRunEvent, initial);

    expect(final.state).toBe("cost_capped");
    expect(final.parts).toEqual([{ type: "text", text: "partial" }]);
  });

  it("does not disturb parts on started/usage — streaming continues", () => {
    const afterUsage = applyRunEvent(
      { parts: [{ type: "text", text: "x" }], state: "streaming" },
      { type: "usage", seq: 9, data: { input_tokens: 10, output_tokens: 20 } },
    );
    expect(afterUsage.state).toBe("streaming");
    expect(afterUsage.parts).toEqual([{ type: "text", text: "x" }]);
  });

  it("accumulates tool_call partial_json chunks into a genui_spec_streaming part (STREAM-02/D-17)", () => {
    const events: ChatRunEvent[] = [
      { type: "text_delta_checkpoint", seq: 1, data: { text: "before " } },
      {
        type: "tool_call",
        seq: 2,
        data: { tool_name: "emit_ui_spec", id: "t1", partial_json: '{"v":1' },
      },
      {
        type: "tool_call",
        seq: 3,
        data: { tool_name: "emit_ui_spec", id: "t1", partial_json: ',"root":{' },
      },
    ];

    const final = events.reduce(applyRunEvent, initial);

    expect(final.parts).toEqual([
      { type: "text", text: "before " },
      {
        type: "genui_spec_streaming",
        toolId: "t1",
        partialJson: '{"v":1,"root":{',
      },
    ]);
    expect(final.state).toBe("streaming");
  });

  it("replaces the trailing genui_spec_streaming part with the finalized genui_spec part on tool_result", () => {
    const events: ChatRunEvent[] = [
      {
        type: "tool_call",
        seq: 1,
        data: { tool_name: "emit_ui_spec", id: "t1", partial_json: "{}" },
      },
      {
        type: "tool_result",
        seq: 2,
        data: { tool_name: "emit_ui_spec", id: "t1", spec: { kind: "card" } },
      },
    ];

    const final = events.reduce(applyRunEvent, initial);

    expect(final.parts).toEqual([{ type: "genui_spec", spec: { kind: "card" } }]);
  });

  it("starts a fresh genui_spec_streaming part when a new tool id arrives without a prior finalize (defensive, T-22-30 class)", () => {
    const events: ChatRunEvent[] = [
      {
        type: "tool_call",
        seq: 1,
        data: { tool_name: "emit_ui_spec", id: "t1", partial_json: "{a" },
      },
      {
        type: "tool_call",
        seq: 2,
        data: { tool_name: "emit_ui_spec", id: "t2", partial_json: "{b" },
      },
    ];

    const final = events.reduce(applyRunEvent, initial);

    expect(final.parts).toEqual([
      { type: "genui_spec_streaming", toolId: "t2", partialJson: "{b" },
    ]);
  });
});
