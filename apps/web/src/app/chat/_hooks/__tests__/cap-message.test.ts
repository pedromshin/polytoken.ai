/**
 * cap-message.test.ts — capMessageFromEvent (Wave 0.5 review HIGH-1): the
 * pure extractor that lets the monthly-turns cap block (listener cap mirror,
 * ASSUMPTIONS A7) carry its upgrade copy to CostCapBlockedCard. Untrusted
 * stream input: every off-shape case must return null, never throw.
 */
import { describe, expect, it } from "vitest";

import { capMessageFromEvent, type ChatRunEvent } from "../use-chat-stream";

const event = (
  type: ChatRunEvent["type"],
  data: Record<string, unknown>,
): ChatRunEvent => ({ type, seq: 1, data });

describe("capMessageFromEvent", () => {
  it("extracts the message from a monthly-turns cost_capped event", () => {
    expect(
      capMessageFromEvent(
        event("cost_capped", {
          breached_cap: "monthly_chat_turns",
          message: "Upgrade to keep chatting.",
        }),
      ),
    ).toBe("Upgrade to keep chatting.");
  });

  it("returns null for the daily cost breaker's shapes", () => {
    expect(
      capMessageFromEvent(event("cost_capped", { breached_cap: "per_turn" })),
    ).toBeNull();
    expect(
      capMessageFromEvent(event("cost_capped", { breached_cap: "daily" })),
    ).toBeNull();
  });

  it("returns null for non-cost_capped events even with a matching payload", () => {
    expect(
      capMessageFromEvent(
        event("failed", {
          breached_cap: "monthly_chat_turns",
          message: "nope",
        }),
      ),
    ).toBeNull();
  });

  it("returns null when the message is absent, empty, or non-string", () => {
    expect(
      capMessageFromEvent(
        event("cost_capped", { breached_cap: "monthly_chat_turns" }),
      ),
    ).toBeNull();
    expect(
      capMessageFromEvent(
        event("cost_capped", {
          breached_cap: "monthly_chat_turns",
          message: "",
        }),
      ),
    ).toBeNull();
    expect(
      capMessageFromEvent(
        event("cost_capped", {
          breached_cap: "monthly_chat_turns",
          message: 42,
        }),
      ),
    ).toBeNull();
  });
});
