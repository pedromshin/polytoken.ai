/**
 * turn-cap-notices.test.tsx — the monthlyChatTurns cap's user-facing half
 * (extracted from use-conversation-controller.ts, Wave 0.6):
 *
 *   notifyOverAllowanceOnce — ONE warning toast per mount (ref latch), the
 *     Billing action navigating via the INJECTED navigate (router.push —
 *     never window.location).
 *
 *   useOverAllowanceNotice — the server locus' over_limit marker (effect) and
 *     the browser locus' imperative notifier share a single latch.
 *
 *   capBlockPresentationFor — the { capKind, capMessage, draftText } glue the
 *     live pseudo-turn threads to CostCapBlockedCard; byte-empty for every
 *     non-pre-turn state.
 *
 *   useDraftRestore — seq-keyed restore requests (same text twice still
 *     re-applies), empty text ignored.
 *
 *   notifyBrowserTurnCapBlocked (W7-4) — the browser locus' FORBIDDEN cap
 *     rejection toast carries a one-click "Restore draft" action feeding the
 *     same restore channel; no action when there is no draft to restore.
 *
 *   useBlockedDraftHolder (W7-4) — the SINGLE-SLOT durability holder: the
 *     draft survives later pending-ref clears while the card is visible;
 *     an unclaimed draft drops with only a console.warn when the card
 *     leaves; no draft history is kept.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }),
}));

import { toast } from "sonner";

import { Composer } from "../../_components/composer";
import {
  capBlockPresentationFor,
  notifyBrowserTurnCapBlocked,
  notifyOverAllowanceOnce,
  OVER_ALLOWANCE_TOAST_MESSAGE,
  useBlockedDraftHolder,
  useDraftRestore,
  useOverAllowanceNotice,
  type DraftRestoreRequest,
} from "../turn-cap-notices";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// ---------------------------------------------------------------------------
// notifyOverAllowanceOnce
// ---------------------------------------------------------------------------

describe("notifyOverAllowanceOnce (paid-tier over-cap marker)", () => {
  beforeEach(() => {
    vi.mocked(toast.warning).mockClear();
  });

  it("overLimit:true on a fresh latch — exactly ONE warning toast with a Billing action, and the latch sets", () => {
    const latchRef = { current: false };

    notifyOverAllowanceOnce(true, latchRef, vi.fn());

    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith(
      OVER_ALLOWANCE_TOAST_MESSAGE,
      expect.objectContaining({
        action: expect.objectContaining({ label: "Billing" }),
      }),
    );
    expect(latchRef.current).toBe(true);
  });

  it("a latched ref never re-toasts — once per mount, not per over-cap turn", () => {
    const latchRef = { current: false };
    const navigate = vi.fn();

    notifyOverAllowanceOnce(true, latchRef, navigate);
    notifyOverAllowanceOnce(true, latchRef, navigate);
    notifyOverAllowanceOnce(true, latchRef, navigate);

    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("overLimit false/undefined — no toast, latch stays open for a later over-cap turn", () => {
    const latchRef = { current: false };
    const navigate = vi.fn();

    notifyOverAllowanceOnce(false, latchRef, navigate);
    notifyOverAllowanceOnce(undefined, latchRef, navigate);

    expect(toast.warning).not.toHaveBeenCalled();
    expect(latchRef.current).toBe(false);
  });

  it("the Billing action calls the INJECTED navigate with /billing (never window.location)", () => {
    const navigate = vi.fn();

    notifyOverAllowanceOnce(true, { current: false }, navigate);

    const options = vi.mocked(toast.warning).mock.calls[0]?.[1] as
      | { action?: { label: string; onClick: () => void } }
      | undefined;
    options?.action?.onClick();

    expect(navigate).toHaveBeenCalledWith("/billing");
  });
});

// ---------------------------------------------------------------------------
// Hook harnesses (no @testing-library — createRoot + act, repo convention)
// ---------------------------------------------------------------------------

let containers: HTMLDivElement[] = [];
let roots: Root[] = [];

async function mount(element: React.ReactElement): Promise<void> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(element);
  });
}

afterEach(async () => {
  for (const root of roots) {
    await act(async () => {
      root.unmount();
    });
  }
  roots = [];
  for (const c of containers) {
    c.remove();
  }
  containers = [];
});

// ---------------------------------------------------------------------------
// useOverAllowanceNotice — one latch across both loci
// ---------------------------------------------------------------------------

function OverAllowanceHarness({
  serverOverLimit,
  navigate,
  notifyRef,
}: {
  readonly serverOverLimit: boolean;
  readonly navigate: (href: string) => void;
  readonly notifyRef: { current: ((overLimit: boolean | undefined) => void) | null };
}): null {
  notifyRef.current = useOverAllowanceNotice(serverOverLimit, navigate);
  return null;
}

describe("useOverAllowanceNotice (shared latch across server + browser loci)", () => {
  beforeEach(() => {
    vi.mocked(toast.warning).mockClear();
  });

  it("server-locus over_limit (effect) toasts once; the browser-locus notifier then hits the SAME latch", async () => {
    const notifyRef: {
      current: ((overLimit: boolean | undefined) => void) | null;
    } = { current: null };

    await mount(
      <OverAllowanceHarness
        serverOverLimit={true}
        navigate={vi.fn()}
        notifyRef={notifyRef}
      />,
    );

    expect(toast.warning).toHaveBeenCalledTimes(1);

    // Browser path reporting afterwards must NOT re-toast — one latch.
    act(() => {
      notifyRef.current?.(true);
    });
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("no server over_limit — no toast until the browser locus reports, then exactly one", async () => {
    const notifyRef: {
      current: ((overLimit: boolean | undefined) => void) | null;
    } = { current: null };

    await mount(
      <OverAllowanceHarness
        serverOverLimit={false}
        navigate={vi.fn()}
        notifyRef={notifyRef}
      />,
    );

    expect(toast.warning).not.toHaveBeenCalled();

    act(() => {
      notifyRef.current?.(true);
      notifyRef.current?.(true);
    });
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// capBlockPresentationFor — pure glue
// ---------------------------------------------------------------------------

describe("capBlockPresentationFor", () => {
  const NOTICE = { kind: "monthly_chat_turns", message: "Upgrade." } as const;

  it("returns the empty object for every non-pre-turn state (mid-stream cap, completed, …)", () => {
    expect(
      capBlockPresentationFor({
        isPreTurnCapBlock: false,
        capNotice: NOTICE,
        lostDraftText: "typed text",
      }),
    ).toEqual({});
  });

  it("pre-turn monthly-turns block — kind + message + the destroyed draft", () => {
    expect(
      capBlockPresentationFor({
        isPreTurnCapBlock: true,
        capNotice: NOTICE,
        lostDraftText: "my lost message",
      }),
    ).toEqual({
      capKind: "monthly_chat_turns",
      capMessage: "Upgrade.",
      draftText: "my lost message",
    });
  });

  it("pre-turn daily-cost block (no notice) — no kind/message, draft still offered", () => {
    expect(
      capBlockPresentationFor({
        isPreTurnCapBlock: true,
        capNotice: null,
        lostDraftText: "my lost message",
      }),
    ).toEqual({
      capKind: undefined,
      capMessage: undefined,
      draftText: "my lost message",
    });
  });

  it("non-composer turn (regenerate/widget: null draft) and empty draft — no draftText", () => {
    expect(
      capBlockPresentationFor({
        isPreTurnCapBlock: true,
        capNotice: NOTICE,
        lostDraftText: null,
      }).draftText,
    ).toBeUndefined();
    expect(
      capBlockPresentationFor({
        isPreTurnCapBlock: true,
        capNotice: NOTICE,
        lostDraftText: "",
      }).draftText,
    ).toBeUndefined();
  });

  it("a copy-less monthly notice still carries the kind (remedy discriminates on kind, not message)", () => {
    const presentation = capBlockPresentationFor({
      isPreTurnCapBlock: true,
      capNotice: { kind: "monthly_chat_turns", message: null },
      lostDraftText: null,
    });
    expect(presentation.capKind).toBe("monthly_chat_turns");
    expect(presentation.capMessage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// useDraftRestore — seq-keyed restore channel
// ---------------------------------------------------------------------------

function DraftRestoreHarness({
  stateRef,
}: {
  readonly stateRef: {
    current: {
      draftRestore: DraftRestoreRequest | null;
      requestDraftRestore: (text: string) => void;
    } | null;
  };
}): null {
  stateRef.current = useDraftRestore();
  return null;
}

describe("useDraftRestore", () => {
  it("each request bumps seq — restoring the SAME text twice still produces a new request", async () => {
    const stateRef: {
      current: {
        draftRestore: DraftRestoreRequest | null;
        requestDraftRestore: (text: string) => void;
      } | null;
    } = { current: null };

    await mount(<DraftRestoreHarness stateRef={stateRef} />);
    expect(stateRef.current?.draftRestore).toBeNull();

    act(() => {
      stateRef.current?.requestDraftRestore("hello");
    });
    expect(stateRef.current?.draftRestore).toEqual({ text: "hello", seq: 1 });

    act(() => {
      stateRef.current?.requestDraftRestore("hello");
    });
    expect(stateRef.current?.draftRestore).toEqual({ text: "hello", seq: 2 });
  });

  it("ignores empty text — nothing to restore", async () => {
    const stateRef: {
      current: {
        draftRestore: DraftRestoreRequest | null;
        requestDraftRestore: (text: string) => void;
      } | null;
    } = { current: null };

    await mount(<DraftRestoreHarness stateRef={stateRef} />);
    act(() => {
      stateRef.current?.requestDraftRestore("");
    });
    expect(stateRef.current?.draftRestore).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Composer end of the channel — the request actually lands in the field
// (jsdom: the one-click recovery's second half; the card's click is the
// first, pinned in cost-cap-blocked-card.test.tsx)
// ---------------------------------------------------------------------------

describe("Composer applies a draft-restore request", () => {
  it("copies the requested text into the textarea, exactly once per seq", async () => {
    function Harness(): React.ReactElement {
      const { draftRestore, requestDraftRestore } = useDraftRestore();
      return (
        <>
          <button
            type="button"
            data-testid="restore"
            onClick={() => requestDraftRestore("my lost draft")}
          >
            restore
          </button>
          <Composer
            isStreaming={false}
            onSubmit={() => undefined}
            onStop={() => undefined}
            restoreDraft={draftRestore}
          />
        </>
      );
    }

    await mount(<Harness />);
    const container = containers[containers.length - 1]!;
    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect(textarea!.value).toBe("");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="restore"]')!
        .click();
    });

    expect(textarea!.value).toBe("my lost draft");

    // The user clears the field... a SECOND request (new seq) re-applies.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(textarea, "");
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(textarea!.value).toBe("");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="restore"]')!
        .click();
    });
    expect(textarea!.value).toBe("my lost draft");
  });
});

// ---------------------------------------------------------------------------
// notifyBrowserTurnCapBlocked — browser-locus draft parity (W7-4 item 1):
// recordBrowserTurn's FORBIDDEN has no block card (the turn rendered), so the
// error toast itself carries the one-click restore.
// ---------------------------------------------------------------------------

describe("notifyBrowserTurnCapBlocked (browser-locus cap rejection)", () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
  });

  it("toasts the server's message with a 'Restore draft' action that feeds the restore channel", () => {
    const requestDraftRestore = vi.fn();

    notifyBrowserTurnCapBlocked("Cap hit.", "my typed text", requestDraftRestore);

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Cap hit.",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Restore draft" }),
      }),
    );

    const options = vi.mocked(toast.error).mock.calls[0]?.[1] as
      | { action?: { label: string; onClick: () => void } }
      | undefined;
    options?.action?.onClick();
    expect(requestDraftRestore).toHaveBeenCalledTimes(1);
    expect(requestDraftRestore).toHaveBeenCalledWith("my typed text");
  });

  it("empty draft text — plain error toast, NO Restore action (nothing to restore)", () => {
    notifyBrowserTurnCapBlocked("Cap hit.", "", vi.fn());

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0]?.[1]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// useBlockedDraftHolder — single-slot durability (W7-4 item 2): the card's
// Restore keeps working while the card is visible, even after a later action
// clears the controller's pending-draft ref.
// ---------------------------------------------------------------------------

interface BlockedDraftHandle {
  readonly heldDraft: string | null;
  readonly noteDraftRestored: (text: string) => void;
}

function BlockedDraftHarness({
  isPreTurnCapBlock,
  pendingDraft,
  stateRef,
}: {
  readonly isPreTurnCapBlock: boolean;
  readonly pendingDraft: string | null;
  readonly stateRef: { current: BlockedDraftHandle | null };
}): null {
  stateRef.current = useBlockedDraftHolder(isPreTurnCapBlock, pendingDraft);
  return null;
}

describe("useBlockedDraftHolder (single-slot blocked-draft durability)", () => {
  let warnSpy: MockInstance;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  async function mountHolder(): Promise<{
    stateRef: { current: BlockedDraftHandle | null };
    rerender: (block: boolean, draft: string | null) => Promise<void>;
  }> {
    const stateRef: { current: BlockedDraftHandle | null } = { current: null };
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    const rerender = async (
      block: boolean,
      draft: string | null,
    ): Promise<void> => {
      await act(async () => {
        root.render(
          <BlockedDraftHarness
            isPreTurnCapBlock={block}
            pendingDraft={draft}
            stateRef={stateRef}
          />,
        );
      });
    };
    return { stateRef, rerender };
  }

  it("captures the draft when the block lands and KEEPS it after a later action clears the pending ref", async () => {
    const { stateRef, rerender } = await mountHolder();
    await rerender(false, null);
    expect(stateRef.current?.heldDraft).toBeNull();

    await rerender(true, "my draft");
    expect(stateRef.current?.heldDraft).toBe("my draft");

    // Regenerate/widget submit nulls pendingComposerDraftRef while the card
    // is still visible — the slot, not the ref, is the card's holder now.
    await rerender(true, null);
    expect(stateRef.current?.heldDraft).toBe("my draft");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("empties when the card leaves — an unclaimed draft is dropped with ONLY a console.warn (no history)", async () => {
    const { stateRef, rerender } = await mountHolder();
    await rerender(true, "unclaimed");
    await rerender(false, null);

    expect(stateRef.current?.heldDraft).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("a draft claimed via noteDraftRestored drops silently (normal restore-then-resend flow)", async () => {
    const { stateRef, rerender } = await mountHolder();
    await rerender(true, "claimed");
    stateRef.current?.noteDraftRestored("claimed");
    await rerender(false, null);

    expect(stateRef.current?.heldDraft).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("a draft-less block (blocked regenerate/widget continuation) holds nothing and never warns", async () => {
    const { stateRef, rerender } = await mountHolder();
    await rerender(true, null);
    expect(stateRef.current?.heldDraft).toBeNull();
    await rerender(false, null);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("a NEW block captures its OWN draft — single slot, the previous draft was dropped, never queued", async () => {
    const { stateRef, rerender } = await mountHolder();
    await rerender(true, "first");
    await rerender(false, null); // "first" dropped (warned)
    await rerender(true, "second");

    expect(stateRef.current?.heldDraft).toBe("second");
  });
});
