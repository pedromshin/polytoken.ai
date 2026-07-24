/**
 * reconcile-selection.test.ts — ChatPage's stale-selection safety net
 * (task #4, criterion c): a deleted / inaccessible conversation must fall back
 * to the newest-available conversation or a fresh chat, never an error screen
 * or a permanent "Loading conversation…".
 */

import { describe, expect, it } from "vitest";

import { reconcileSelectedConversation } from "../reconcile-selection";

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-cccc-cccc-cccccccccccc";

describe("reconcileSelectedConversation", () => {
  it("no change while the list has not loaded yet", () => {
    expect(
      reconcileSelectedConversation({
        selectedId: A,
        conversationIds: undefined,
        seenIds: new Set([A]),
      }),
    ).toBeNull();
  });

  it("no change when nothing is selected (the empty state is already right)", () => {
    expect(
      reconcileSelectedConversation({
        selectedId: null,
        conversationIds: [A, B],
        seenIds: new Set([A, B]),
      }),
    ).toBeNull();
  });

  it("no change when the selection still exists", () => {
    expect(
      reconcileSelectedConversation({
        selectedId: B,
        conversationIds: [A, B],
        seenIds: new Set([A, B]),
      }),
    ).toBeNull();
  });

  it("does NOT bounce away from a freshly-created id absent from the list (never seen before)", () => {
    // create/duplicate select a new id before the refetch includes it.
    expect(
      reconcileSelectedConversation({
        selectedId: C,
        conversationIds: [A, B],
        seenIds: new Set([A, B]),
      }),
    ).toBeNull();
  });

  it("falls back to the newest-available conversation when a previously-seen selection vanishes", () => {
    // B was deleted (in another tab) — it was seen before, now gone; A is the
    // newest remaining (list is updatedAt-desc), so land there, not on an error.
    expect(
      reconcileSelectedConversation({
        selectedId: B,
        conversationIds: [A],
        seenIds: new Set([A, B]),
      }),
    ).toEqual({ nextSelectedId: A });
  });

  it("falls back to the empty state (a fresh chat) when the vanished selection was the last one", () => {
    expect(
      reconcileSelectedConversation({
        selectedId: A,
        conversationIds: [],
        seenIds: new Set([A]),
      }),
    ).toEqual({ nextSelectedId: null });
  });
});
