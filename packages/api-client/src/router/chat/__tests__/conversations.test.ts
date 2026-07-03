/**
 * conversations.test.ts — DB-free unit tests for the chat conversation input
 * schemas + the D-10 remember-last-used pure helper (mirrors
 * entities/gallery.test.ts's shapeGalleryItem / listInputSchema pattern).
 *
 * Test plan:
 *   Test 1: resolveDefaultModelId returns the explicitly requested modelId when provided.
 *   Test 2: resolveDefaultModelId falls back to the last-used modelId when none requested (D-10).
 *   Test 3: resolveDefaultModelId falls back to DEFAULT_CHAT_MODEL_ID with no request and no history.
 *   Test 4: createConversationInputSchema accepts an omitted modelId (optional).
 *   Test 5: createConversationInputSchema rejects a non-uuid importerId.
 *   Test 6: renameConversationInputSchema requires a non-empty title, capped at 200 chars.
 *   Test 7: renameConversationInputSchema rejects a non-uuid id.
 *   Test 8: deleteConversationInputSchema requires a uuid id.
 *   Test 9: listConversationsInputSchema importerId is optional and uuid-validated.
 */

import { describe, expect, it } from "vitest";

import {
  createConversationInputSchema,
  DEFAULT_CHAT_MODEL_ID,
  deleteConversationInputSchema,
  listConversationsInputSchema,
  renameConversationInputSchema,
  resolveDefaultModelId,
} from "../conversations";

describe("resolveDefaultModelId (D-10 remember-last-used)", () => {
  it("Test 1: returns the explicitly requested modelId when provided", () => {
    expect(resolveDefaultModelId("some-model", "last-used-model")).toBe(
      "some-model",
    );
  });

  it("Test 2: falls back to the last-used modelId when none requested", () => {
    expect(resolveDefaultModelId(undefined, "last-used-model")).toBe(
      "last-used-model",
    );
  });

  it("Test 3: falls back to DEFAULT_CHAT_MODEL_ID with no request and no history", () => {
    expect(resolveDefaultModelId(undefined, null)).toBe(
      DEFAULT_CHAT_MODEL_ID,
    );
    expect(resolveDefaultModelId(undefined, undefined)).toBe(
      DEFAULT_CHAT_MODEL_ID,
    );
  });
});

describe("createConversationInputSchema", () => {
  it("Test 4: accepts an omitted modelId (optional, resolved server-side)", () => {
    const parsed = createConversationInputSchema.parse({});
    expect(parsed.modelId).toBeUndefined();
  });

  it("Test 5: rejects a non-uuid importerId", () => {
    expect(() =>
      createConversationInputSchema.parse({ importerId: "not-a-uuid" }),
    ).toThrow();
  });
});

describe("renameConversationInputSchema", () => {
  const VALID_ID = "00000000-0000-0000-0000-000000000001";

  it("Test 6: requires a non-empty title, capped at 200 chars", () => {
    expect(() =>
      renameConversationInputSchema.parse({ id: VALID_ID, title: "" }),
    ).toThrow();
    expect(() =>
      renameConversationInputSchema.parse({
        id: VALID_ID,
        title: "a".repeat(201),
      }),
    ).toThrow();
    expect(
      renameConversationInputSchema.parse({
        id: VALID_ID,
        title: "a".repeat(200),
      }).title,
    ).toHaveLength(200);
  });

  it("Test 7: rejects a non-uuid id", () => {
    expect(() =>
      renameConversationInputSchema.parse({ id: "not-a-uuid", title: "x" }),
    ).toThrow();
  });
});

describe("deleteConversationInputSchema", () => {
  it("Test 8: requires a uuid id", () => {
    expect(() =>
      deleteConversationInputSchema.parse({ id: "not-a-uuid" }),
    ).toThrow();
    expect(
      deleteConversationInputSchema.parse({
        id: "00000000-0000-0000-0000-000000000001",
      }).id,
    ).toBe("00000000-0000-0000-0000-000000000001");
  });
});

describe("listConversationsInputSchema", () => {
  it("Test 9: importerId is optional and uuid-validated", () => {
    expect(listConversationsInputSchema.parse({}).importerId).toBeUndefined();
    expect(() =>
      listConversationsInputSchema.parse({ importerId: "not-a-uuid" }),
    ).toThrow();
  });
});
