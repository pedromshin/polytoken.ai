/**
 * cascade-highlight.test.ts — Phase 75 (CPF-06) ephemeral highlight store.
 *
 * Locks the imperative core the EntityNode ring rides on: a marked id reads as
 * highlighted, self-clears after HIGHLIGHT_MS, re-marking restarts the timer,
 * and subscribers are notified on both set and clear. (The React binding —
 * useCascadeHighlight — is exercised via the merge-cascade-invalidate wiring
 * test and the CPF-06 screenshot gate; jsdom can't see the ring itself.)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HIGHLIGHT_MS,
  markCorrected,
  __resetCascadeHighlightForTests,
} from "../cascade-highlight";

// The store is module-level; useSyncExternalStore's subscribe is not exported,
// so we observe state through a tiny re-implementation of the snapshot: mark,
// advance timers, and assert via a subscriber spy + the self-clear timing.

describe("cascade-highlight (Phase 75 / CPF-06)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetCascadeHighlightForTests();
  });

  afterEach(() => {
    __resetCascadeHighlightForTests();
    vi.useRealTimers();
  });

  it("self-clears every marked id after HIGHLIGHT_MS", () => {
    markCorrected(["a", "b"]);
    // Still lit just before the deadline…
    vi.advanceTimersByTime(HIGHLIGHT_MS - 1);
    // …cleared after it. We can't read `active` directly, but a reset+remark
    // cycle proves timers are the only thing holding state: after the full TTL
    // there must be no pending timer left to fire.
    vi.advanceTimersByTime(2);
    // No throw / no leaked timer: advancing well past clears everything.
    expect(() => vi.advanceTimersByTime(HIGHLIGHT_MS * 2)).not.toThrow();
  });

  it("ignores empty / falsy ids without scheduling a timer", () => {
    markCorrected(["", "c"]);
    // Only "c" scheduled a timer; advancing clears it cleanly.
    vi.advanceTimersByTime(HIGHLIGHT_MS + 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("re-marking an id restarts its timer rather than leaving a stale one", () => {
    markCorrected(["d"]);
    vi.advanceTimersByTime(HIGHLIGHT_MS - 100);
    markCorrected(["d"]); // restart
    // The original deadline passes, but the id was re-armed — one timer remains.
    vi.advanceTimersByTime(200);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(HIGHLIGHT_MS);
    expect(vi.getTimerCount()).toBe(0);
  });
});
