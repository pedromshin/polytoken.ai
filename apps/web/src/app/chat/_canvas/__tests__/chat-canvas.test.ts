/**
 * chat-canvas.test.ts — DB-free unit tests for chat-canvas.tsx's pure
 * provenance-map builders (CANVAS-04, D-07).
 *
 * Test plan:
 *   1. buildSpecsByProvenance: keys history-derived genui_spec parts by
 *      `messageId:partIndex`, skipping inactive sibling rows.
 *   2. buildStreamingByProvenance: empty when nothing is regenerating; empty
 *      when the active stream isn't "streaming"; maps genui_spec_streaming/
 *      genui_spec parts from the streaming pseudo-turn onto the REGENERATING
 *      message's EXISTING provenance key (never a new/synthetic one).
 */

import { describe, expect, it } from "vitest";

import type { ConversationController } from "../../_hooks/use-conversation-controller";
import { buildSpecsByProvenance, buildStreamingByProvenance, provenanceKey } from "../chat-canvas";

const MESSAGE_ID = "00000000-0000-0000-0000-0000000000a1";

function baseController(overrides: Partial<ConversationController>): ConversationController {
  return {
    turns: [],
    streamingTurnId: "__streaming-turn__",
    activeStreamState: "idle",
    regenerateDisabled: false,
    liveAnnouncement: "",
    historyRows: [],
    regeneratingMessageId: null,
    handleSubmit: () => undefined,
    handleStop: () => undefined,
    handleRegenerate: () => undefined,
    handleLiveRetry: () => undefined,
    handleNavigateSibling: () => undefined,
    handleSelectBrowserModel: async () => undefined,
    onRegenerateTurn: () => undefined,
    widgetInteractions: [],
    widgets: {
      states: {},
      submittedValues: {},
      errorMessages: {},
      onSubmitOption: () => undefined,
    },
    ...overrides,
  };
}

describe("buildSpecsByProvenance", () => {
  it("keys an active row's genui_spec part by messageId:partIndex", () => {
    const map = buildSpecsByProvenance([
      {
        id: MESSAGE_ID,
        role: "assistant",
        status: "completed",
        turnIndex: 0,
        siblingGroupId: null,
        version: 1,
        isActive: true,
        parts: [{ type: "genui_spec", spec: { v: 1 } }],
      },
    ]);

    expect(map.get(provenanceKey(MESSAGE_ID, 0))).toBe(JSON.stringify({ v: 1 }));
  });

  it("skips inactive sibling rows", () => {
    const map = buildSpecsByProvenance([
      {
        id: MESSAGE_ID,
        role: "assistant",
        status: "completed",
        turnIndex: 0,
        siblingGroupId: null,
        version: 1,
        isActive: false,
        parts: [{ type: "genui_spec", spec: { v: 1 } }],
      },
    ]);

    expect(map.size).toBe(0);
  });
});

describe("buildStreamingByProvenance", () => {
  it("returns an empty map when nothing is regenerating", () => {
    const controller = baseController({ regeneratingMessageId: null, activeStreamState: "streaming" });
    expect(buildStreamingByProvenance(controller).size).toBe(0);
  });

  it("returns an empty map when the active stream state isn't 'streaming'", () => {
    const controller = baseController({
      regeneratingMessageId: MESSAGE_ID,
      activeStreamState: "completed",
    });
    expect(buildStreamingByProvenance(controller).size).toBe(0);
  });

  it("maps a genui_spec_streaming part from the streaming pseudo-turn onto the regenerating message's provenance key", () => {
    const controller = baseController({
      regeneratingMessageId: MESSAGE_ID,
      activeStreamState: "streaming",
      turns: [
        {
          id: "__streaming-turn__",
          role: "assistant",
          parts: [{ type: "genui_spec_streaming", toolId: "t1", partialJson: '{"v":1' }],
        },
      ],
    });

    const map = buildStreamingByProvenance(controller);
    expect(map.get(provenanceKey(MESSAGE_ID, 0))).toEqual({
      specJson: '{"v":1',
      isStreaming: true,
    });
  });

  it("maps a finalized genui_spec part (mid-stream, before the terminal event) as isStreaming: false", () => {
    const controller = baseController({
      regeneratingMessageId: MESSAGE_ID,
      activeStreamState: "streaming",
      turns: [
        {
          id: "__streaming-turn__",
          role: "assistant",
          parts: [{ type: "genui_spec", spec: { v: 1 } }],
        },
      ],
    });

    const map = buildStreamingByProvenance(controller);
    expect(map.get(provenanceKey(MESSAGE_ID, 0))).toEqual({
      specJson: JSON.stringify({ v: 1 }),
      isStreaming: false,
    });
  });

  it("never keys by a synthetic/new id — only ever by the regenerating message's own real id", () => {
    const controller = baseController({
      regeneratingMessageId: MESSAGE_ID,
      activeStreamState: "streaming",
      turns: [
        {
          id: "__streaming-turn__",
          role: "assistant",
          parts: [{ type: "genui_spec_streaming", toolId: "t1", partialJson: "{}" }],
        },
      ],
    });

    const map = buildStreamingByProvenance(controller);
    expect([...map.keys()]).toEqual([provenanceKey(MESSAGE_ID, 0)]);
  });
});
