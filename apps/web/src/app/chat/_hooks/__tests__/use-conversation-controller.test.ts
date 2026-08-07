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
 *   notifyOverAllowanceOnce — the paid-tier over-cap marker
 *     (recordBrowserTurn's additive `overLimit: true`) surfaces ONE warning
 *     toast per mount linking Billing, never per-turn spam.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }),
}));

import { toast } from "sonner";

import {
  errorMessageForWidgetError,
  groupTurnsFromHistory,
  notifyOverAllowanceOnce,
  OVER_ALLOWANCE_TOAST_MESSAGE,
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

// ===========================================================================
// notifyOverAllowanceOnce — the paid-tier over-cap marker consumer. Before
// this, recordBrowserTurn's { overLimit } return was discarded by the
// controller entirely, so a PRO user past their monthlyChatTurns allowance
// saw nothing (the turn persists — paid tiers are never hard-blocked; the
// FREE-tier FORBIDDEN block has its own toast.error in the catch path).
// ===========================================================================

describe("notifyOverAllowanceOnce (paid-tier over-cap marker)", () => {
  beforeEach(() => {
    vi.mocked(toast.warning).mockClear();
  });

  it("overLimit:true on a fresh mount — exactly ONE warning toast with a Billing action, and the latch sets", () => {
    const latchRef = { current: false };

    notifyOverAllowanceOnce(true, latchRef);

    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith(
      OVER_ALLOWANCE_TOAST_MESSAGE,
      expect.objectContaining({
        action: expect.objectContaining({ label: "Billing" }),
      }),
    );
    expect(latchRef.current).toBe(true);
  });

  it("a latched ref never re-toasts — once per mount, not per over-cap turn", () => {
    const latchRef = { current: false };

    notifyOverAllowanceOnce(true, latchRef);
    notifyOverAllowanceOnce(true, latchRef);
    notifyOverAllowanceOnce(true, latchRef);

    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("overLimit false/undefined — no toast, latch stays open for a later over-cap turn", () => {
    const latchRef = { current: false };

    notifyOverAllowanceOnce(false, latchRef);
    notifyOverAllowanceOnce(undefined, latchRef);

    expect(toast.warning).not.toHaveBeenCalled();
    expect(latchRef.current).toBe(false);
  });

  it("the Billing action navigates to /billing", () => {
    // Stub navigation — jsdom throws on real location assignment (same
    // convention as delete-account.test.tsx).
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { assign },
    });

    notifyOverAllowanceOnce(true, { current: false });

    const options = vi.mocked(toast.warning).mock.calls[0]?.[1] as
      | { action?: { label: string; onClick: () => void } }
      | undefined;
    options?.action?.onClick();

    expect(assign).toHaveBeenCalledWith("/billing");
  });
});
