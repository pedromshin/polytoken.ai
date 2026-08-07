/**
 * cap-message.test.ts — capNoticeFromEvent + overLimitFromEvent (Wave 0.5
 * HIGH-1, reworked in Wave 0.6): the pure extractors that let the
 * monthly-turns cap block carry its DISCRIMINANT (`kind`, read explicitly
 * from data.breached_cap) and its presentation copy to CostCapBlockedCard,
 * and the paid-over-cap `completed` marker reach the one-per-mount toast.
 * Untrusted stream input: every off-shape case must resolve safely, never
 * throw.
 */
import { describe, expect, it } from "vitest";

import {
  capNoticeFromEvent,
  overLimitFromEvent,
  type ChatRunEvent,
} from "../use-chat-stream";

const event = (
  type: ChatRunEvent["type"],
  data: Record<string, unknown>,
): ChatRunEvent => ({ type, seq: 1, data });

describe("capNoticeFromEvent", () => {
  it("extracts kind + message from a monthly-turns cost_capped event", () => {
    expect(
      capNoticeFromEvent(
        event("cost_capped", {
          breached_cap: "monthly_chat_turns",
          message: "Upgrade to keep chatting.",
        }),
      ),
    ).toEqual({
      kind: "monthly_chat_turns",
      message: "Upgrade to keep chatting.",
    });
  });

  it("returns null for the daily cost breaker's shapes (kind discriminates, not message presence)", () => {
    expect(
      capNoticeFromEvent(event("cost_capped", { breached_cap: "per_turn" })),
    ).toBeNull();
    expect(
      capNoticeFromEvent(event("cost_capped", { breached_cap: "daily" })),
    ).toBeNull();
    expect(capNoticeFromEvent(event("cost_capped", {}))).toBeNull();
  });

  it("returns null for non-cost_capped events even with a matching payload", () => {
    expect(
      capNoticeFromEvent(
        event("failed", {
          breached_cap: "monthly_chat_turns",
          message: "nope",
        }),
      ),
    ).toBeNull();
  });

  it("keeps the kind but nulls the message when it is absent, empty, or non-string", () => {
    expect(
      capNoticeFromEvent(
        event("cost_capped", { breached_cap: "monthly_chat_turns" }),
      ),
    ).toEqual({ kind: "monthly_chat_turns", message: null });
    expect(
      capNoticeFromEvent(
        event("cost_capped", {
          breached_cap: "monthly_chat_turns",
          message: "",
        }),
      ),
    ).toEqual({ kind: "monthly_chat_turns", message: null });
    expect(
      capNoticeFromEvent(
        event("cost_capped", {
          breached_cap: "monthly_chat_turns",
          message: 42,
        }),
      ),
    ).toEqual({ kind: "monthly_chat_turns", message: null });
  });
});

describe("overLimitFromEvent", () => {
  it("true only for a completed event carrying over_limit === true", () => {
    expect(
      overLimitFromEvent(
        event("completed", {
          over_limit: true,
          breached_cap: "monthly_chat_turns",
        }),
      ),
    ).toBe(true);
  });

  it("tolerates the field being absent (older listener) — false", () => {
    expect(overLimitFromEvent(event("completed", {}))).toBe(false);
  });

  it("false for non-true values and non-completed events", () => {
    expect(overLimitFromEvent(event("completed", { over_limit: false }))).toBe(
      false,
    );
    expect(overLimitFromEvent(event("completed", { over_limit: "true" }))).toBe(
      false,
    );
    expect(overLimitFromEvent(event("completed", { over_limit: 1 }))).toBe(
      false,
    );
    expect(
      overLimitFromEvent(event("cost_capped", { over_limit: true })),
    ).toBe(false);
    expect(overLimitFromEvent(event("failed", { over_limit: true }))).toBe(
      false,
    );
  });
});
