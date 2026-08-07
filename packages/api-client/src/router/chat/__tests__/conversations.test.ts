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
 *   Test 10: duplicateConversationInputSchema requires a uuid id.
 *   Test 11: duplicateTitleFor prefixes "Copy of " and caps at 200 chars.
 *   Test 12: remapSiblingGroupIds mints ONE fresh uuid per source group,
 *            keeps null groups null, and never reuses a source id.
 *   Test 13: duplicateConversation carries createdAt VERBATIM into the copied
 *            chat_messages rows — last-month duplicates stay outside the
 *            current monthlyChatTurns window, so the meter/gate count is
 *            unchanged by duplicating (fake-db procedure test, turn-cap.test.ts
 *            convention).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@polytoken/db/ownership", async () => {
  const actual = await vi.importActual<typeof import("@polytoken/db/ownership")>(
    "@polytoken/db/ownership",
  );
  return {
    ...actual,
    assertConversationOwnership: vi.fn(),
  };
});

import { assertConversationOwnership } from "@polytoken/db/ownership";
import { ChatConversations, ChatMessages } from "@polytoken/db/schema";

import { startOfCurrentUtcMonth } from "../../_chat-turn-usage";
import { __resetColumnExistsCacheForTests } from "../../_column-detect";
import {
  createThenableChain,
  makeCaller,
  type FakeRow,
} from "../../__tests__/support/fake-drizzle";
import {
  createConversationInputSchema,
  DEFAULT_CHAT_MODEL_ID,
  deleteConversationInputSchema,
  duplicateConversationInputSchema,
  duplicateTitleFor,
  listConversationsInputSchema,
  remapSiblingGroupIds,
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

describe("duplicateConversationInputSchema", () => {
  it("Test 10: requires a uuid id", () => {
    expect(() =>
      duplicateConversationInputSchema.parse({ id: "not-a-uuid" }),
    ).toThrow();
    expect(
      duplicateConversationInputSchema.parse({
        id: "00000000-0000-0000-0000-000000000001",
      }).id,
    ).toBe("00000000-0000-0000-0000-000000000001");
  });
});

describe("duplicateTitleFor", () => {
  it('Test 11: prefixes "Copy of " and caps at 200 chars', () => {
    expect(duplicateTitleFor("Freight quote")).toBe("Copy of Freight quote");
    const long = duplicateTitleFor("a".repeat(200));
    expect(long).toHaveLength(200);
    expect(long.startsWith("Copy of ")).toBe(true);
  });
});

describe("remapSiblingGroupIds (D-16 fresh per-group uuids)", () => {
  const GROUP_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const GROUP_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  it("Test 12: one fresh id per source group, null stays null, no source id reused", () => {
    const minted: string[] = [];
    let n = 0;
    const mint = (): string => {
      const id = `fresh-${++n}`;
      minted.push(id);
      return id;
    };

    const rows = [
      { siblingGroupId: null, turnIndex: 0 },
      { siblingGroupId: GROUP_A, turnIndex: 1 },
      { siblingGroupId: GROUP_A, turnIndex: 1 },
      { siblingGroupId: GROUP_B, turnIndex: 2 },
    ] as const;

    const remapped = remapSiblingGroupIds(rows, mint);

    // Null group untouched.
    expect(remapped[0]?.siblingGroupId).toBeNull();
    // Both GROUP_A rows share ONE fresh id (the navigator's grouping survives).
    expect(remapped[1]?.siblingGroupId).toBe(remapped[2]?.siblingGroupId);
    // Distinct source groups get distinct fresh ids.
    expect(remapped[3]?.siblingGroupId).not.toBe(remapped[1]?.siblingGroupId);
    // Exactly one mint per distinct source group.
    expect(minted).toHaveLength(2);
    // No source id survives into the output.
    for (const row of remapped) {
      expect([GROUP_A, GROUP_B]).not.toContain(row.siblingGroupId ?? "");
    }
    // Input rows are not mutated.
    expect(rows[1].siblingGroupId).toBe(GROUP_A);
    // Non-sibling fields ride along untouched.
    expect(remapped[3]?.turnIndex).toBe(2);
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

// ===========================================================================
// Test 13 — duplicateConversation carries createdAt VERBATIM.
//
// The bug: the copy insert omitted createdAt, so the column's defaultNow()
// stamped every duplicated row into the CURRENT month — duplicating an old
// conversation spuriously consumed monthlyChatTurns allowance (both the
// /billing meter and the enforcement gate window on created_at, see
// _chat-turn-usage.ts). Fake-db procedure test following turn-cap.test.ts's
// convention: the fake records the exact INSERT payload; the meter's WHERE
// semantics (role='user' AND is_active AND created_at >= UTC month start,
// pinned by chat-turn-usage.test.ts Test 2) are then applied to that payload
// at the fixture level.
// ===========================================================================

const USER_A = { id: "10000000-0000-0000-0000-00000000000a" };
const SOURCE_CONVERSATION_ID = "60000000-0000-0000-0000-000000000001";
const NEW_CONVERSATION_ID = "60000000-0000-0000-0000-000000000002";

// The thenable chain / makeCaller live in ../../__tests__/support/
// fake-drizzle.ts (shared, W7-2); only the duplicate-specific fake db
// remains below.

/**
 * Fake db for duplicateConversation: the root handle serves the source
 * conversation select + tableColumnExists's information_schema probe (empty →
 * thread_id treated absent); the transaction serves the messages/edges
 * selects and RECORDS every insert's values per table — the level at which
 * the createdAt-omission bug lived.
 */
function createDuplicateFakeDb(opts: {
  readonly sourceConversation: FakeRow;
  readonly sourceMessages: ReadonlyArray<FakeRow>;
  readonly sourceEdges?: ReadonlyArray<FakeRow>;
}) {
  const insertedByTable = new Map<unknown, FakeRow[]>();
  const txSelectQueue: Array<ReadonlyArray<FakeRow>> = [
    opts.sourceMessages,
    opts.sourceEdges ?? [],
  ];

  const tx = {
    select() {
      const rows = txSelectQueue.shift() ?? [];
      return createThenableChain(rows);
    },
    insert(table: unknown) {
      return {
        values(vals: FakeRow | FakeRow[]) {
          const list = Array.isArray(vals) ? vals : [vals];
          insertedByTable.set(table, [
            ...(insertedByTable.get(table) ?? []),
            ...list,
          ]);
          return {
            returning: () => Promise.resolve([{ id: NEW_CONVERSATION_ID }]),
            then(
              onFulfilled: (value: unknown) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) {
              return Promise.resolve(undefined).then(onFulfilled, onRejected);
            },
          };
        },
      };
    },
  };

  const db = {
    select() {
      return createThenableChain([opts.sourceConversation]);
    },
    // tableColumnExists's information_schema probe — no rows → thread_id
    // treated as not-yet-migrated (the simpler duplicate path).
    execute: () => Promise.resolve([]),
    transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
  };

  return {
    db,
    insertedRowsFor: (table: unknown) => insertedByTable.get(table) ?? [],
  };
}

/**
 * The meter's WHERE semantics applied at the fixture level (pinned to
 * _chat-turn-usage.ts by chat-turn-usage.test.ts Test 2): ACTIVE user-role
 * rows with created_at >= the UTC month start. A row WITHOUT a createdAt in
 * its insert payload gets defaultNow() from the column — modeled here as
 * `now`, which is exactly how the bug inflated the count.
 */
function meterCountFor(
  rows: ReadonlyArray<FakeRow>,
  monthStart: Date,
  now: Date,
): number {
  return rows.filter((row) => {
    const effectiveCreatedAt =
      row.createdAt instanceof Date ? row.createdAt : now;
    return (
      row.role === "user" &&
      row.isActive === true &&
      effectiveCreatedAt.getTime() >= monthStart.getTime()
    );
  }).length;
}

describe("duplicateConversation — createdAt carried verbatim (Test 13)", () => {
  const FROZEN_NOW = new Date("2026-08-15T12:00:00.000Z");
  const GROUP_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  // Every source row is LAST month (July) relative to FROZEN_NOW (August).
  const sourceMessages: ReadonlyArray<FakeRow> = [
    {
      role: "user",
      parts: [{ type: "text", text: "hello" }],
      turnIndex: 0,
      siblingGroupId: null,
      version: 1,
      isActive: true,
      status: "completed",
      createdAt: new Date("2026-07-03T09:00:00.000Z"),
    },
    {
      role: "assistant",
      parts: [{ type: "text", text: "hi" }],
      turnIndex: 0,
      siblingGroupId: null,
      version: 1,
      isActive: true,
      status: "completed",
      createdAt: new Date("2026-07-03T09:00:05.000Z"),
    },
    {
      role: "user",
      parts: [{ type: "text", text: "again" }],
      turnIndex: 1,
      siblingGroupId: null,
      version: 1,
      isActive: true,
      status: "completed",
      createdAt: new Date("2026-07-10T18:30:00.000Z"),
    },
    // A regenerated turn — the sibling remap path must ALSO carry createdAt.
    {
      role: "assistant",
      parts: [{ type: "text", text: "v1" }],
      turnIndex: 1,
      siblingGroupId: GROUP_A,
      version: 1,
      isActive: false,
      status: "completed",
      createdAt: new Date("2026-07-10T18:30:05.000Z"),
    },
    {
      role: "assistant",
      parts: [{ type: "text", text: "v2" }],
      turnIndex: 1,
      siblingGroupId: GROUP_A,
      version: 2,
      isActive: true,
      status: "completed",
      createdAt: new Date("2026-07-10T18:31:00.000Z"),
    },
  ];

  beforeEach(() => {
    __resetColumnExistsCacheForTests();
    vi.mocked(assertConversationOwnership).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.mocked(assertConversationOwnership).mockReset();
  });

  it("Test 13: duplicated messages keep their original createdAt, so a last-month duplicate leaves the monthly turn count unchanged", async () => {
    const { db, insertedRowsFor } = createDuplicateFakeDb({
      sourceConversation: {
        title: "Freight quote",
        modelId: "some-model",
        importerId: null,
      },
      sourceMessages,
    });
    const caller = makeCaller(USER_A, db);

    await expect(
      caller.chat.duplicateConversation({ id: SOURCE_CONVERSATION_ID }),
    ).resolves.toEqual({ id: NEW_CONVERSATION_ID });

    // Every copied row carries createdAt EXPLICITLY (an absent key is the
    // bug: defaultNow() would stamp the copy into the current month) and
    // VERBATIM (same instant as its source row, in select order).
    const inserted = insertedRowsFor(ChatMessages);
    expect(inserted).toHaveLength(sourceMessages.length);
    inserted.forEach((row, i) => {
      expect(Object.prototype.hasOwnProperty.call(row, "createdAt")).toBe(true);
      expect(row.createdAt).toBeInstanceOf(Date);
      expect((row.createdAt as Date).getTime()).toBe(
        (sourceMessages[i]!.createdAt as Date).getTime(),
      );
    });

    // The conversation-row insert is unaffected (still fresh-stamped by its
    // own defaults — only the MESSAGE copies carry provenance timestamps).
    expect(insertedRowsFor(ChatConversations)).toHaveLength(1);

    // The meter proof: under the current-month window, the July source rows
    // counted 0 turns before the duplicate — and the union of source rows +
    // the EXACT insert payload still counts 0 (unchanged). Under the old
    // omit-createdAt behavior the two copied user rows would defaultNow()
    // into August and inflate this to 2.
    const monthStart = startOfCurrentUtcMonth(FROZEN_NOW);
    const countBefore = meterCountFor(sourceMessages, monthStart, FROZEN_NOW);
    const countAfter = meterCountFor(
      [...sourceMessages, ...inserted],
      monthStart,
      FROZEN_NOW,
    );
    expect(countBefore).toBe(0);
    expect(countAfter).toBe(countBefore);
  });
});
