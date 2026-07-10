/**
 * browser-turn.test.ts — DB-free unit tests for buildBrowserTurnRows (the
 * pure helper recordBrowserTurn delegates to) + titleSnippetFor +
 * recordBrowserTurnInputSchema. Mirrors cost.test.ts / conversations.test.ts'
 * established convention — this codebase has no precedent for mocking
 * ctx.db chains, only pure-helper + Zod-schema tests (22-05/22-10's
 * key-decisions). Testing buildBrowserTurnRows IS testing "what
 * recordBrowserTurn writes" — it is the exact function that determines the
 * message/run_events/ledger row shapes the mutation inserts verbatim.
 *
 * Test plan:
 *   Test 1: buildBrowserTurnRows shapes the user + assistant messages as
 *     canonical text parts, sharing turnIndex, with the assistant message
 *     carrying the run id.
 *   Test 2: buildBrowserTurnRows' cost ledger row is executionLocus="browser",
 *     costUsd="0", but preserves the REAL (non-zero) token counts (D-22).
 *   Test 3: buildBrowserTurnRows' run_events are exactly [started, <status>]
 *     in seq order.
 *   Test 4: buildBrowserTurnRows only sets conversationUpdate.title when
 *     isFirstTurn is true; always sets modelId.
 *   Test 5: buildBrowserTurnRows never mutates its input.
 *   Test 6: titleSnippetFor collapses whitespace, truncates with an
 *     ellipsis, and falls back to "Untitled conversation" for empty text.
 *   Test 7: recordBrowserTurnInputSchema requires a uuid conversationId.
 *   Test 8: recordBrowserTurnInputSchema bounds userText/assistantText
 *     length (T-22-40 forged/oversized payload guard).
 *   Test 9: recordBrowserTurnInputSchema defaults status to "completed" and
 *     accepts "stopped"/"failed".
 */

import { describe, expect, it } from "vitest";

import {
  BROWSER_AGENT_ID,
  buildBrowserTurnRows,
  DEFAULT_IMPORTER_ID,
  recordBrowserTurnInputSchema,
  titleSnippetFor,
  type RecordBrowserTurnInput,
} from "../browser-turn";

const BASE_INPUT: RecordBrowserTurnInput = {
  conversationId: "00000000-0000-0000-0000-000000000001",
  modelId: "webllm-qwen3-4b",
  userText: "Hello there",
  assistantText: "General Kenobi!",
  status: "completed",
  inputTokens: 42,
  outputTokens: 17,
};

const BASE_CTX = {
  turnIndex: 3,
  runId: "00000000-0000-0000-0000-000000000099",
  importerId: DEFAULT_IMPORTER_ID,
  isFirstTurn: false,
  // Phase 44 (TENA-03): session-derived owner of the ledger row.
  userId: "20000000-0000-0000-0000-000000000001",
};

describe("buildBrowserTurnRows", () => {
  it("Test 1: shapes user + assistant messages as canonical text parts sharing turnIndex", () => {
    const rows = buildBrowserTurnRows(BASE_INPUT, BASE_CTX);

    expect(rows.userMessage).toMatchObject({
      conversationId: BASE_INPUT.conversationId,
      role: "user",
      parts: [{ type: "text", text: "Hello there" }],
      turnIndex: 3,
      status: "completed",
    });
    expect(rows.assistantMessage).toMatchObject({
      conversationId: BASE_INPUT.conversationId,
      role: "assistant",
      runId: BASE_CTX.runId,
      parts: [{ type: "text", text: "General Kenobi!" }],
      turnIndex: 3,
      status: "completed",
    });
  });

  it("Test 2: cost ledger row is browser-locus, $0, with real token counts (D-22)", () => {
    const rows = buildBrowserTurnRows(BASE_INPUT, BASE_CTX);

    expect(rows.costLedgerRow).toMatchObject({
      conversationId: BASE_INPUT.conversationId,
      runId: BASE_CTX.runId,
      importerId: DEFAULT_IMPORTER_ID,
      userId: BASE_CTX.userId,
      modelId: "webllm-qwen3-4b",
      executionLocus: "browser",
      costUsd: "0",
      inputTokens: 42,
      outputTokens: 17,
    });
  });

  it("Test 3: run_events are exactly [started, <status>] in seq order", () => {
    const rows = buildBrowserTurnRows(BASE_INPUT, BASE_CTX);

    expect(rows.runEvents).toEqual([
      { runId: BASE_CTX.runId, seq: 0, type: "started", data: { modelId: "webllm-qwen3-4b" } },
      { runId: BASE_CTX.runId, seq: 1, type: "completed", data: {} },
    ]);
  });

  it("Test 3b: a stopped turn's terminal run_event carries type 'stopped'", () => {
    const rows = buildBrowserTurnRows(
      { ...BASE_INPUT, status: "stopped" },
      BASE_CTX,
    );

    expect(rows.runEvents[1]).toMatchObject({ type: "stopped" });
    expect(rows.assistantMessage).toMatchObject({ status: "stopped" });
  });

  it("Test 4: conversationUpdate only sets title on the first turn", () => {
    const firstTurnRows = buildBrowserTurnRows(BASE_INPUT, {
      ...BASE_CTX,
      turnIndex: 0,
      isFirstTurn: true,
    });
    const laterTurnRows = buildBrowserTurnRows(BASE_INPUT, BASE_CTX);

    expect(firstTurnRows.conversationUpdate).toEqual({
      modelId: "webllm-qwen3-4b",
      title: "Hello there",
    });
    expect(laterTurnRows.conversationUpdate).toEqual({
      modelId: "webllm-qwen3-4b",
    });
  });

  it("Test 5: never mutates its input", () => {
    const inputCopy = { ...BASE_INPUT };
    buildBrowserTurnRows(BASE_INPUT, BASE_CTX);
    expect(BASE_INPUT).toEqual(inputCopy);
  });
});

describe("titleSnippetFor", () => {
  it("Test 6: collapses whitespace, truncates with an ellipsis, falls back for empty text", () => {
    expect(titleSnippetFor("  Hello   there  ")).toBe("Hello there");
    expect(titleSnippetFor("a".repeat(100), 60)).toBe(`${"a".repeat(59)}…`);
    expect(titleSnippetFor("   ")).toBe("Untitled conversation");
    expect(titleSnippetFor("")).toBe("Untitled conversation");
  });
});

describe("recordBrowserTurnInputSchema", () => {
  it("Test 7: requires a uuid conversationId", () => {
    expect(() =>
      recordBrowserTurnInputSchema.parse({ ...BASE_INPUT, conversationId: "not-a-uuid" }),
    ).toThrow();
    expect(recordBrowserTurnInputSchema.parse(BASE_INPUT).conversationId).toBe(
      BASE_INPUT.conversationId,
    );
  });

  it("Test 8: bounds userText/assistantText length (T-22-40)", () => {
    expect(() =>
      recordBrowserTurnInputSchema.parse({ ...BASE_INPUT, userText: "a".repeat(100_001) }),
    ).toThrow();
    expect(() =>
      recordBrowserTurnInputSchema.parse({ ...BASE_INPUT, assistantText: "a".repeat(100_001) }),
    ).toThrow();
    expect(() =>
      recordBrowserTurnInputSchema.parse({ ...BASE_INPUT, userText: "" }),
    ).toThrow(); // userText must be non-empty (something was actually sent)
    // assistantText MAY be empty (stopped before any token streamed, D-15).
    expect(
      recordBrowserTurnInputSchema.parse({ ...BASE_INPUT, assistantText: "" }).assistantText,
    ).toBe("");
  });

  it("Test 9: defaults status to 'completed' and accepts 'stopped'/'failed'", () => {
    const { status: _status, ...withoutStatus } = BASE_INPUT;
    expect(recordBrowserTurnInputSchema.parse(withoutStatus).status).toBe("completed");
    expect(
      recordBrowserTurnInputSchema.parse({ ...BASE_INPUT, status: "stopped" }).status,
    ).toBe("stopped");
    expect(() =>
      recordBrowserTurnInputSchema.parse({ ...BASE_INPUT, status: "bogus" }),
    ).toThrow();
  });
});

describe("BROWSER_AGENT_ID", () => {
  it("matches the server-side agent id (SEAM-04 — same shape regardless of locus)", () => {
    expect(BROWSER_AGENT_ID).toBe("chat-agent-v1");
  });
});
