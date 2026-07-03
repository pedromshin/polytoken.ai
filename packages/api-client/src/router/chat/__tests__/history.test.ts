/**
 * history.test.ts — DB-free unit tests for the getHistory input schema.
 *
 * Test plan:
 *   Test 1: getHistoryInputSchema requires a uuid conversationId.
 *   Test 2: getHistoryInputSchema rejects a non-uuid conversationId.
 */

import { describe, expect, it } from "vitest";

import { getHistoryInputSchema } from "../history";

describe("getHistoryInputSchema", () => {
  it("Test 1: requires a uuid conversationId", () => {
    const parsed = getHistoryInputSchema.parse({
      conversationId: "00000000-0000-0000-0000-000000000001",
    });
    expect(parsed.conversationId).toBe(
      "00000000-0000-0000-0000-000000000001",
    );
  });

  it("Test 2: rejects a non-uuid conversationId", () => {
    expect(() =>
      getHistoryInputSchema.parse({ conversationId: "not-a-uuid" }),
    ).toThrow();
  });
});
