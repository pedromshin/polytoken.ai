/**
 * use-conversation-controller.test.ts — re-asserts the pure helpers moved out
 * of ConversationView (page.tsx) into useConversationController (23-03 Task
 * 1), proving the extraction is behavior-preserving:
 *
 *   groupTurnsFromHistory — all-siblings fold into one MessageListItem per
 *     turn, local sibling-override display, and in-flight-regenerate
 *     suppression of the stale cached row (D-16).
 *
 *   toWebllmMessages — text-only content extraction (genui_spec parts
 *     dropped, D-08), active-sibling-only filter, turnIndex ordering.
 *
 * (The over-allowance toast latch moved to turn-cap-notices.ts — see
 * turn-cap-notices.test.ts.)
 */

import { describe, expect, it } from "vitest";

import {
  errorMessageForWidgetError,
  groupTurnsFromHistory,
  toWebllmMessages,
  type ChatHistoryRow,
} from "../use-conversation-controller";

function row(
  overrides: Partial<ChatHistoryRow> &
    Pick<ChatHistoryRow, "id" | "role" | "turnIndex">,
): ChatHistoryRow {
  return {
    parts: null,
    status: "completed",
    siblingGroupId: null,
    version: 1,
    isActive: true,
    ...overrides,
  };
}

describe("groupTurnsFromHistory", () => {
  it("folds a user row + multiple assistant siblings into ONE assistant MessageListItem carrying all sibling ids", () => {
    const rows: ChatHistoryRow[] = [
      row({
        id: "u1",
        role: "user",
        turnIndex: 0,
        parts: [{ type: "text", text: "hi" }],
      }),
      row({
        id: "a1",
        role: "assistant",
        turnIndex: 0,
        version: 1,
        isActive: false,
        siblingGroupId: "g1",
      }),
      row({
        id: "a2",
        role: "assistant",
        turnIndex: 0,
        version: 2,
        isActive: true,
        siblingGroupId: "g1",
      }),
    ];

    const items = groupTurnsFromHistory(rows, {}, null);

    expect(items).toHaveLength(2);
    const assistantItem = items[1]!;
    expect(assistantItem.id).toBe("a2"); // active sibling by default
    expect(assistantItem.siblings).toEqual(["a1", "a2"]);
    expect(assistantItem.activeSiblingIndex).toBe(1);
    expect(assistantItem.regenerateTargetId).toBe("a2");
  });

  it("honors a local siblingOverrides display choice without changing the server-active regenerate target", () => {
    const rows: ChatHistoryRow[] = [
      row({
        id: "a1",
        role: "assistant",
        turnIndex: 0,
        version: 1,
        isActive: false,
        siblingGroupId: "g1",
      }),
      row({
        id: "a2",
        role: "assistant",
        turnIndex: 0,
        version: 2,
        isActive: true,
        siblingGroupId: "g1",
      }),
    ];

    const items = groupTurnsFromHistory(rows, { g1: "a1" }, null);

    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe("a1"); // locally-overridden display sibling
    expect(items[0]!.regenerateTargetId).toBe("a2"); // still the server-active sibling
  });

  it("suppresses the stale cached row for a turn whose regenerate is in flight", () => {
    const rows: ChatHistoryRow[] = [
      row({ id: "a1", role: "assistant", turnIndex: 0, isActive: true }),
    ];

    const items = groupTurnsFromHistory(rows, {}, "a1");

    expect(items).toHaveLength(0);
  });

  it("omits the siblings array entirely when a turn has only one assistant version", () => {
    const rows: ChatHistoryRow[] = [
      row({ id: "a1", role: "assistant", turnIndex: 0, isActive: true }),
    ];

    const items = groupTurnsFromHistory(rows, {}, null);

    expect(items).toHaveLength(1);
    expect(items[0]!.siblings).toBeUndefined();
  });
});

describe("toWebllmMessages", () => {
  it("keeps only text parts, joining multiple text parts with a newline", () => {
    const rows: ChatHistoryRow[] = [
      row({
        id: "u1",
        role: "user",
        turnIndex: 0,
        parts: [
          { type: "text", text: "line one" },
          { type: "text", text: "line two" },
        ],
      }),
    ];

    const messages = toWebllmMessages(rows);

    expect(messages).toEqual([{ role: "user", content: "line one\nline two" }]);
  });

  it("drops genui_spec parts entirely (D-08: browser locus never sees them)", () => {
    const rows: ChatHistoryRow[] = [
      row({
        id: "a1",
        role: "assistant",
        turnIndex: 0,
        parts: [{ type: "genui_spec", spec: { v: 1 } }],
      }),
    ];

    const messages = toWebllmMessages(rows);

    expect(messages).toEqual([{ role: "assistant", content: "" }]);
  });

  it("filters out inactive sibling rows", () => {
    const rows: ChatHistoryRow[] = [
      row({
        id: "a1",
        role: "assistant",
        turnIndex: 0,
        isActive: false,
        parts: [{ type: "text", text: "stale" }],
      }),
      row({
        id: "a2",
        role: "assistant",
        turnIndex: 0,
        isActive: true,
        parts: [{ type: "text", text: "current" }],
      }),
    ];

    const messages = toWebllmMessages(rows);

    expect(messages).toEqual([{ role: "assistant", content: "current" }]);
  });

  it("sorts by turnIndex regardless of input row order", () => {
    const rows: ChatHistoryRow[] = [
      row({
        id: "a2",
        role: "assistant",
        turnIndex: 1,
        parts: [{ type: "text", text: "second" }],
      }),
      row({
        id: "a1",
        role: "user",
        turnIndex: 0,
        parts: [{ type: "text", text: "first" }],
      }),
    ];

    const messages = toWebllmMessages(rows);

    expect(messages.map((m) => m.content)).toEqual(["first", "second"]);
  });
});

// ===========================================================================
// errorMessageForWidgetError — 24-05 fix pass (24-UI-REVIEW.md Copywriting
// Contract violation #1): a double-submit 409 conflict must render "This was
// already answered." — previously errorMessages was populated ONLY for
// errorKind "invalid", so a conflict rejection produced no message text
// anywhere in the UI.
// ===========================================================================

describe("errorMessageForWidgetError (24-05, 24-UI-SPEC.md Copywriting Contract)", () => {
  it("'invalid' — the retryable validation-rejection message (D-10, unchanged)", () => {
    expect(errorMessageForWidgetError("invalid")).toBe(
      "This response couldn't be saved. Please try again.",
    );
  });

  it("'conflict' — 'This was already answered.' (previously unrendered anywhere)", () => {
    expect(errorMessageForWidgetError("conflict")).toBe("This was already answered.");
  });

  it("'stale' — null (reconciles via the Stale badge's own caption instead, D-12)", () => {
    expect(errorMessageForWidgetError("stale")).toBeNull();
  });

  it("undefined — null (no in-flight error)", () => {
    expect(errorMessageForWidgetError(undefined)).toBeNull();
  });
});

