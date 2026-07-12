/**
 * use-canvas-persistence-save-error.test.tsx — closes 52-UI-REVIEW.md's #1
 * priority finding: `scheduleSave`'s debounced `chat.saveCanvasLayout` save
 * is fire-and-forget, so a REAL persistence failure never reached the
 * originating panel/action — only `saveStatus` (the ambient
 * `SaveStatusIndicator`) ever saw it. `scheduleSave` now accepts an optional
 * `onError` callback, invoked ONLY when the underlying mutation's own
 * `onError` genuinely fires (never on success, never synchronously) — the
 * real wiring `pack-switcher.tsx`/`version-history-control.tsx` build on top
 * of (see their own test files' "genuine async persist failure" cases).
 *
 * Test plan:
 *   1. a scheduled save's onError callback fires when the mocked
 *      chat.saveCanvasLayout mutation's own onError fires (real failure).
 *   2. a scheduled save's onError callback is NEVER called on a successful
 *      save.
 *   3. TWO scheduleSave calls coalesced into the SAME debounced timer (both
 *      registering an onError) both fire when that single save fails —
 *      every optimistic write made during the coalescing window reverts.
 *   4. a stale onError from a PRIOR (already-settled) save cycle never
 *      fires again on a later cycle's outcome.
 *
 * Mounts the ACTUAL hook (tRPC mutation mocked) via raw react-dom/client +
 * act, mirrors use-canvas-persistence-edges-stable.test.tsx's convention
 * (no @testing-library in this package) — with vi.useFakeTimers() to control
 * the 800ms debounce deterministically.
 */

import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface SaveMutationCallbacks {
  readonly onSuccess?: () => void;
  readonly onError?: (error: unknown) => void;
}

let mutateImpl: (input: unknown, opts?: SaveMutationCallbacks) => void = () => undefined;
const mutateSpy = vi.fn((input: unknown, opts?: SaveMutationCallbacks) => mutateImpl(input, opts));

vi.mock("~/trpc/react", () => ({
  api: {
    chat: {
      getCanvasLayout: {
        useQuery: () => ({ data: null, isPending: false }),
      },
      saveCanvasLayout: {
        useMutation: () => ({ mutate: mutateSpy }),
      },
    },
  },
}));

import { useCanvasPersistence, type UseCanvasPersistenceResult } from "../use-canvas-persistence";

const CONVERSATION_ID = "00000000-0000-0000-0000-0000000000c1";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mutateSpy.mockClear();
  mutateImpl = (_input, opts) => {
    // Default: never resolves — individual tests override via mutateImpl
    // to simulate success/failure explicitly.
    void opts;
  };
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function mountProbe(): { latest: () => UseCanvasPersistenceResult } {
  let latest: UseCanvasPersistenceResult | undefined;

  function Probe(): null {
    latest = useCanvasPersistence({
      conversationId: CONVERSATION_ID,
      nodes: [],
      edges: [],
      viewport: null,
    });
    return null;
  }

  act(() => root.render(<Probe />));

  return {
    latest: () => {
      if (latest === undefined) throw new Error("Probe never rendered");
      return latest;
    },
  };
}

describe("useCanvasPersistence — scheduleSave onError propagation (real async failure)", () => {
  it("fires the onError callback passed to scheduleSave when the mutation's own onError genuinely fires", () => {
    const errorListener = vi.fn();
    mutateImpl = (_input, opts) => {
      // Deliberately NOT calling onSuccess/onError synchronously here —
      // the real failure is delivered by the test invoking the captured
      // callback below, mirroring a real async network rejection.
      void opts;
    };

    const { latest } = mountProbe();

    act(() => {
      latest().scheduleSave(null, errorListener);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(mutateSpy).toHaveBeenCalledTimes(1);
    expect(errorListener).not.toHaveBeenCalled();

    const [, opts] = mutateSpy.mock.calls[0] as [unknown, SaveMutationCallbacks];
    act(() => {
      opts.onError?.(new Error("network down"));
    });

    expect(errorListener).toHaveBeenCalledTimes(1);
  });

  it("never calls the onError callback when the save succeeds", () => {
    const errorListener = vi.fn();
    mutateImpl = (_input, opts) => {
      opts?.onSuccess?.();
    };

    const { latest } = mountProbe();

    act(() => {
      latest().scheduleSave(null, errorListener);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(mutateSpy).toHaveBeenCalledTimes(1);
    expect(errorListener).not.toHaveBeenCalled();
  });

  it("fires EVERY onError callback registered during the same coalesced debounce window", () => {
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    mutateImpl = (_input, opts) => {
      void opts;
    };

    const { latest } = mountProbe();

    act(() => {
      latest().scheduleSave(null, firstListener);
    });
    act(() => {
      vi.advanceTimersByTime(200); // still inside the 800ms debounce window
      latest().scheduleSave(null, secondListener);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Coalesced into exactly ONE real save call — the debounce contract.
    expect(mutateSpy).toHaveBeenCalledTimes(1);

    const [, opts] = mutateSpy.mock.calls[0] as [unknown, SaveMutationCallbacks];
    act(() => {
      opts.onError?.(new Error("network down"));
    });

    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(1);
  });

  it("never re-fires a settled cycle's onError listeners on a LATER cycle's outcome", () => {
    const firstCycleListener = vi.fn();
    const secondCycleListener = vi.fn();
    mutateImpl = (_input, opts) => {
      void opts;
    };

    const { latest } = mountProbe();

    // Cycle 1 — succeeds.
    act(() => {
      latest().scheduleSave(null, firstCycleListener);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const [, firstOpts] = mutateSpy.mock.calls[0] as [unknown, SaveMutationCallbacks];
    act(() => {
      firstOpts.onSuccess?.();
    });
    expect(firstCycleListener).not.toHaveBeenCalled();

    // Cycle 2 — a NEW schedule, fails.
    act(() => {
      latest().scheduleSave(null, secondCycleListener);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(mutateSpy).toHaveBeenCalledTimes(2);
    const [, secondOpts] = mutateSpy.mock.calls[1] as [unknown, SaveMutationCallbacks];
    act(() => {
      secondOpts.onError?.(new Error("network down"));
    });

    // Only cycle 2's listener fires — cycle 1's already settled successfully.
    expect(firstCycleListener).not.toHaveBeenCalled();
    expect(secondCycleListener).toHaveBeenCalledTimes(1);
  });
});
