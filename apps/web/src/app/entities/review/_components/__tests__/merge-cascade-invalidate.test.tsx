/**
 * merge-cascade-invalidate.test.tsx — Phase 75 CPF-05 (the visible half of
 * correct-once/propagate-everywhere, logic-only).
 *
 * Proves that when a merge (or reject) SUCCEEDS, `useMergeReview.settle`
 * invalidates `api.entities.byId` for BOTH the survivor and the absorbed id —
 * in addition to the pre-existing reviewQueue + list invalidations — so every
 * PLACED `EntityNode` for either id (entity-node.tsx rehydrates from
 * `entities.byId`) refetches and repaints live, no reload. It also proves the
 * touched ids are handed to the ephemeral cascade-highlight signal (CPF-06).
 *
 * jsdom does no layout, so this asserts the invalidation/signal WIRING only;
 * the actual on-canvas repaint + highlight sweep is a screenshot gate (CPF-06,
 * per CLAUDE.md). Harness follows the repo convention (createRoot + `act`); the
 * tRPC mutation options are captured at the `useMutation` boundary and the
 * success callback is invoked directly (the same pattern used to test optimistic
 * hooks without a live server).
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const SURVIVOR = "60000000-0000-0000-0000-0000000000a1";
const ABSORBED = "60000000-0000-0000-0000-0000000000a2";

type SuccessCb = (
  data: unknown,
  vars: { entityInstanceId: string; targetId: string },
  ctx: { pairKey?: string } | undefined,
) => Promise<void> | void;

let confirmOnSuccess: SuccessCb | undefined;
let rejectOnSuccess: SuccessCb | undefined;

const markCorrected = vi.fn();

const utils = {
  entities: {
    reviewQueue: {
      cancel: vi.fn(),
      getData: vi.fn(),
      setData: vi.fn(),
      invalidate: vi.fn(),
    },
    list: { invalidate: vi.fn() },
    byId: { invalidate: vi.fn() },
  },
};

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("~/app/chat/_canvas/cascade-highlight", () => ({
  markCorrected: (...args: unknown[]) => markCorrected(...args),
}));

vi.mock("~/trpc/react", () => ({
  api: {
    entities: {
      confirmMerge: {
        useMutation: (opts: { onSuccess?: SuccessCb }) => {
          confirmOnSuccess = opts.onSuccess;
          return { mutate: vi.fn() };
        },
      },
      rejectMerge: {
        useMutation: (opts: { onSuccess?: SuccessCb }) => {
          rejectOnSuccess = opts.onSuccess;
          return { mutate: vi.fn() };
        },
      },
    },
    useUtils: () => utils,
  },
}));

import { useMergeReview } from "../use-merge-review";

function Harness(): null {
  useMergeReview({ limit: 3, offset: 0 });
  return null;
}

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  markCorrected.mockReset();
  utils.entities.reviewQueue.invalidate.mockReset();
  utils.entities.list.invalidate.mockReset();
  utils.entities.byId.invalidate.mockReset();
  root = createRoot(container);
  act(() => {
    root!.render(<Harness />);
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container.remove();
});

describe("useMergeReview cascade invalidation (Phase 75 / CPF-05)", () => {
  it("merge success invalidates entities.byId for BOTH survivor and absorbed", async () => {
    expect(confirmOnSuccess).toBeTypeOf("function");
    await act(async () => {
      await confirmOnSuccess!(
        {},
        { entityInstanceId: SURVIVOR, targetId: ABSORBED },
        { pairKey: `${SURVIVOR}::${ABSORBED}` },
      );
    });

    // The pre-existing invalidations still fire…
    expect(utils.entities.reviewQueue.invalidate).toHaveBeenCalledTimes(1);
    expect(utils.entities.list.invalidate).toHaveBeenCalledTimes(1);
    // …plus the NEW byId invalidation for both sides — the whole point of CPF-05.
    expect(utils.entities.byId.invalidate).toHaveBeenCalledWith({ id: SURVIVOR });
    expect(utils.entities.byId.invalidate).toHaveBeenCalledWith({ id: ABSORBED });
    expect(utils.entities.byId.invalidate).toHaveBeenCalledTimes(2);
  });

  it("merge success hands both touched ids to the cascade-highlight signal (CPF-06)", async () => {
    await act(async () => {
      await confirmOnSuccess!(
        {},
        { entityInstanceId: SURVIVOR, targetId: ABSORBED },
        { pairKey: `${SURVIVOR}::${ABSORBED}` },
      );
    });
    expect(markCorrected).toHaveBeenCalledWith([SURVIVOR, ABSORBED]);
  });

  it("reject success also repaints both entities (pending count drops on each)", async () => {
    expect(rejectOnSuccess).toBeTypeOf("function");
    await act(async () => {
      await rejectOnSuccess!(
        {},
        { entityInstanceId: SURVIVOR, targetId: ABSORBED },
        { pairKey: `${SURVIVOR}::${ABSORBED}` },
      );
    });
    expect(utils.entities.byId.invalidate).toHaveBeenCalledWith({ id: SURVIVOR });
    expect(utils.entities.byId.invalidate).toHaveBeenCalledWith({ id: ABSORBED });
    expect(markCorrected).toHaveBeenCalledWith([SURVIVOR, ABSORBED]);
  });
});
