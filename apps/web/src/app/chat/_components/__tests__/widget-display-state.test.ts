/**
 * widget-display-state.test.ts — deriveWidgetDisplayState unit tests
 * (Task 3, 24-03, D-02/D-11/D-12).
 */

import { describe, expect, it } from "vitest";

import type { ChatHistoryRow } from "../../_hooks/use-conversation-controller";
import {
  deriveWidgetDisplayState,
  type WidgetInteractionRow,
} from "../widget-display-state";

function interaction(overrides: Partial<WidgetInteractionRow> = {}): WidgetInteractionRow {
  return {
    id: "int-1",
    messageId: "msg-1",
    partIndex: 0,
    widgetKind: "proposal_cards",
    state: "pending",
    submittedValue: null,
    ...overrides,
  };
}

function historyRow(overrides: Partial<ChatHistoryRow> = {}): ChatHistoryRow {
  return {
    id: "msg-1",
    role: "assistant",
    parts: [],
    status: "completed",
    turnIndex: 0,
    siblingGroupId: null,
    version: 1,
    isActive: true,
    ...overrides,
  };
}

describe("deriveWidgetDisplayState", () => {
  it("returns 'submitted' when the interaction row's state is submitted", () => {
    const result = deriveWidgetDisplayState({
      interaction: interaction({ state: "submitted" }),
      historyRows: [historyRow()],
      supersededLocally: new Set(),
      inFlightInteractionId: null,
    });
    expect(result).toBe("submitted");
  });

  it("returns 'stale' when the emitting message is no longer the active sibling", () => {
    const result = deriveWidgetDisplayState({
      interaction: interaction(),
      historyRows: [historyRow({ isActive: false })],
      supersededLocally: new Set(),
      inFlightInteractionId: null,
    });
    expect(result).toBe("stale");
  });

  it("returns 'stale' when a strictly newer turn exists in history", () => {
    const result = deriveWidgetDisplayState({
      interaction: interaction(),
      historyRows: [historyRow({ turnIndex: 0 }), historyRow({ id: "msg-2", turnIndex: 1 })],
      supersededLocally: new Set(),
      inFlightInteractionId: null,
    });
    expect(result).toBe("stale");
  });

  it("returns 'superseded' when the interaction id is in the local superseded set", () => {
    const result = deriveWidgetDisplayState({
      interaction: interaction(),
      historyRows: [historyRow()],
      supersededLocally: new Set(["int-1"]),
      inFlightInteractionId: null,
    });
    expect(result).toBe("superseded");
  });

  it("returns 'pending' when nothing overrides the default (active sibling, no newer turn, not superseded)", () => {
    const result = deriveWidgetDisplayState({
      interaction: interaction(),
      historyRows: [historyRow()],
      supersededLocally: new Set(),
      inFlightInteractionId: null,
    });
    expect(result).toBe("pending");
  });

  it("returns 'submitting' overlay when the interaction id is currently in-flight", () => {
    const result = deriveWidgetDisplayState({
      interaction: interaction(),
      historyRows: [historyRow()],
      supersededLocally: new Set(),
      inFlightInteractionId: "int-1",
    });
    expect(result).toBe("submitting");
  });

  it("a submitted row is never overridden by an in-flight id (cannot resubmit)", () => {
    const result = deriveWidgetDisplayState({
      interaction: interaction({ state: "submitted" }),
      historyRows: [historyRow()],
      supersededLocally: new Set(),
      inFlightInteractionId: "int-1",
    });
    expect(result).toBe("submitted");
  });
});
