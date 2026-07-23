/**
 * chat-mobile-feed.test.tsx — 53-05-PLAN.md Tasks 1+2: proves `/chat`'s
 * MOBL-01 mobile inline feed (53-UI-SPEC.md §2 "/chat mobile feed") without
 * regressing the desktop canvas/toggle/inline-rail behavior.
 *
 * Task 1 — `useIsMobileViewport` mocked `true`: `ChatCanvasIsland` (the
 * `dynamic(ssr:false)` React-Flow island) is NEVER invoked, even when the
 * persisted `chat:canvas-view:{id}` value is "canvas"; `ChatCanvasViewToggle`
 * is not in the DOM. Mocked `false`: the toggle IS present (desktop path
 * intact) and canvas mode still mounts the island.
 *
 * Task 2 — `ConversationRail`'s mobile Sheet is closed by default; the
 * existing top-bar rail-toggle button (lifted `mobileRailOpen` state, D-11's
 * `size-11` button) opens it; selecting a conversation from inside the Sheet
 * closes it.
 *
 * Mounts the REAL `ChatPage` default export (`ConversationView` itself has no
 * named export) — `~/trpc/react`'s handful of direct `.useQuery`/
 * `.useMutation` calls this render tree makes (`chat.listConversations`,
 * `chat.createConversation`, `chat.getHistory`, `chat.getWidgetInteractions`,
 * `chat.models`, `chat.recordBrowserTurn`, `chat.setModel`,
 * `chat.sessionCost`, `chat.renameConversation`, `chat.deleteConversation`,
 * `useUtils`) are each mocked as plain stubs — mirrors
 * `inbox-mobile-stack.test.tsx`'s (53-03) per-procedure convention. A
 * selected conversation is reached by clicking either page's "New chat"
 * button — `createConversation`'s mocked `mutate()` synchronously invokes the
 * caller's own `onSuccess({ id: CONVERSATION_ID })`, and the mocked
 * `listConversations` data already contains a matching row, so
 * `selectedConversation` resolves without a second render pass.
 *
 * `useIsMobileViewport` is mocked via a mutable module-level `let` so the
 * same file can exercise both the mobile-forced and desktop cases without a
 * second test file — the mock factory's returned function reads the current
 * value of the closed-over variable at CALL time, not at mock-definition
 * time (same "outer const/let referenced inside a hoisted vi.mock factory"
 * shape `inbox-mobile-stack.test.tsx` already establishes for its fixtures).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const CONVERSATION_ID = "11111111-1111-1111-1111-111111111111";
const VIEW_MODE_STORAGE_KEY = `polytoken.chat.canvas-view:${CONVERSATION_ID}`;

// Mutable across tests (see file doc comment) — defaults true (mobile) since
// most of this suite's cases exercise the mobile-forced path.
let mockIsMobile = true;

vi.mock("~/hooks/use-is-mobile-viewport", () => ({
  useIsMobileViewport: () => mockIsMobile,
}));

const chatCanvasIslandMock = vi.fn((_props: unknown) => null);

vi.mock("../_canvas/chat-canvas-island", () => ({
  ChatCanvasIsland: (props: unknown) => chatCanvasIslandMock(props),
}));

const FAKE_UTILS = {
  chat: {
    listConversations: { invalidate: async () => undefined },
    getHistory: { invalidate: () => undefined },
    sessionCost: { invalidate: () => undefined },
    getWidgetInteractions: { invalidate: () => undefined },
    clusterSummary: { invalidate: () => undefined },
    // CH-01: the useSendTo seam + chip-rail removal touch these caches.
    listContextEdges: {
      cancel: async () => undefined,
      getData: () => undefined,
      setData: () => undefined,
      invalidate: async () => undefined,
    },
    getCanvasLayout: {
      cancel: async () => undefined,
      getData: () => null,
      setData: () => undefined,
      invalidate: async () => undefined,
    },
  },
  knowledge: {
    byId: { invalidate: () => undefined },
    graph: { invalidate: () => undefined },
    expandNode: { invalidate: () => undefined },
  },
};

const FAKE_CONVERSATION = {
  id: CONVERSATION_ID,
  title: "Test conversation",
  modelId: "bedrock-claude-haiku",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => FAKE_UTILS,
    chat: {
      listConversations: {
        useQuery: () => ({ data: [FAKE_CONVERSATION] }),
      },
      createConversation: {
        useMutation: (opts?: {
          onSuccess?: (result: { id: string }) => void | Promise<void>;
        }) => ({
          mutate: () => {
            void opts?.onSuccess?.({ id: CONVERSATION_ID });
          },
          isPending: false,
        }),
      },
      renameConversation: { useMutation: () => ({ mutate: () => undefined }) },
      deleteConversation: { useMutation: () => ({ mutate: () => undefined }) },
      getHistory: { useQuery: () => ({ data: [] }) },
      getWidgetInteractions: { useQuery: () => ({ data: [] }) },
      models: { useQuery: () => ({ data: { models: [] } }) },
      recordBrowserTurn: {
        useMutation: () => ({ mutateAsync: async () => undefined }),
      },
      setModel: { useMutation: () => ({ mutate: () => undefined }) },
      sessionCost: {
        useQuery: () => ({ data: { totalCostUsd: 0, breakdown: [] } }),
      },
      // CLUS-02/CLUS-06 (54-06): ThreadClusterIndicator is now unconditionally
      // mounted in ConversationView's top bar — a null threadId keeps it
      // additive-only (renders nothing), matching every conversation in this
      // suite's fixtures (none are thread-linked).
      getConversationThreadId: {
        useQuery: () => ({ data: { threadId: null } }),
      },
      clusterSummary: {
        useQuery: () => ({ data: undefined }),
      },
      // 61-07: the DOCKED branch is now wrapped in `TranscriptPanelHost`, so
      // it genuinely reads `chat.getCanvasLayout` — that is criterion 4's whole
      // point (the transcript resolves the overlays the canvas persists), and
      // it is why these two appear in a MOBILE feed suite: below `md` the
      // canvas cannot be reached at all, so the docked transcript is the ONLY
      // surface a panel overlay can reach a phone through.
      //
      // `data: null` = this conversation has no canvas row (the common case).
      // The host then provides no store at all and the transcript renders
      // exactly as it did before — which is what the rest of this suite
      // asserts, and why those assertions still hold.
      getCanvasLayout: {
        useQuery: () => ({ data: null, isPending: false }),
      },
      saveCanvasLayout: {
        useMutation: () => ({ mutate: () => undefined }),
      },
      // CH-01: the composer's attach affordance (ComposerAttachments) reaches
      // these through the shared AI-04 `useSendTo` seam + the chip rail. All
      // additive here — no attachments in this suite's fixtures.
      listContextEdges: { useQuery: () => ({ data: [] }) },
      createContextEdge: { useMutation: () => ({ mutate: () => undefined, isPending: false }) },
      addCanvasNode: { useMutation: () => ({ mutate: () => undefined, isPending: false }) },
      removeContextEdge: { useMutation: () => ({ mutate: () => undefined }) },
    },
    files: {
      requestUpload: { useMutation: () => ({ mutateAsync: async () => ({ url: "" }) }) },
      list: { useQuery: () => ({ data: { entries: [] }, isPending: false, isError: false }) },
    },
    emails: {
      threadCard: {
        useQuery: () => ({ data: undefined }),
      },
    },
  },
}));

import ChatPage from "../page";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE_SOURCE = readFileSync(path.join(__dirname, "..", "page.tsx"), "utf-8");
const RAIL_SOURCE = readFileSync(
  path.join(__dirname, "..", "_components", "conversation-rail.tsx"),
  "utf-8",
);

let containers: HTMLDivElement[] = [];

async function mount(element: React.ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return container;
}

/** Clicks whichever "New chat" button is present (rail's or the home empty
 * state's — both wire to the SAME `handleNewChat`), driving `selectedId` to
 * `CONVERSATION_ID` via the mocked `createConversation.mutate()`. */
async function selectConversation(container: HTMLDivElement): Promise<void> {
  const newChatButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.includes("New chat"),
  );
  if (!newChatButton) throw new Error('No "New chat" button found');
  await act(async () => {
    newChatButton.click();
  });
}

function railToggleButton(container: HTMLDivElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    '[aria-label="Expand conversation list"], [aria-label="Collapse conversation list"]',
  );
  if (!button) throw new Error("rail toggle button not found");
  return button;
}

afterEach(() => {
  for (const c of containers) {
    document.body.removeChild(c);
  }
  containers = [];
  document.body
    .querySelectorAll('[role="dialog"], [data-radix-portal]')
    .forEach((node) => node.remove());
  window.localStorage.clear();
  chatCanvasIslandMock.mockClear();
  mockIsMobile = true;
});

describe("/chat mobile feed — useIsMobileViewport mocked true (MOBL-01, 53-UI-SPEC §2)", () => {
  it("ChatCanvasIsland is never mounted even when the stored viewMode is 'canvas'", async () => {
    mockIsMobile = true;
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, "canvas");

    const container = await mount(<ChatPage />);
    await selectConversation(container);

    expect(chatCanvasIslandMock).not.toHaveBeenCalled();
  });

  it("ChatCanvasViewToggle (the Chat/Canvas TabsList) is not in the DOM", async () => {
    mockIsMobile = true;

    const container = await mount(<ChatPage />);
    await selectConversation(container);

    expect(container.querySelector('[aria-label="View"]')).toBeNull();
    expect(container.querySelector('[aria-label="Chat view"]')).toBeNull();
    expect(container.querySelector('[aria-label="Canvas view"]')).toBeNull();
  });

  it("the docked MessageList/Composer path renders instead", async () => {
    mockIsMobile = true;
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, "canvas");

    const container = await mount(<ChatPage />);
    await selectConversation(container);

    expect(
      container.querySelector('textarea[placeholder="Ask the agent anything…"]'),
    ).not.toBeNull();
  });

  it("the persisted chat:canvas-view value is still read but never overwritten while mobile-forced", async () => {
    mockIsMobile = true;
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, "canvas");

    const container = await mount(<ChatPage />);
    await selectConversation(container);

    // Nothing on the mobile render path can call writeStoredViewMode (the
    // toggle that owns that side effect isn't even mounted) — the stored
    // value survives untouched.
    expect(window.localStorage.getItem(VIEW_MODE_STORAGE_KEY)).toBe("canvas");
  });
});

describe("/chat desktop path — useIsMobileViewport mocked false (regression)", () => {
  it("the toggle IS present", async () => {
    mockIsMobile = false;

    const container = await mount(<ChatPage />);
    await selectConversation(container);

    expect(container.querySelector('[aria-label="View"]')).not.toBeNull();
  });

  it("canvas mode still mounts ChatCanvasIsland (desktop unchanged)", async () => {
    mockIsMobile = false;
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, "canvas");

    const container = await mount(<ChatPage />);
    await selectConversation(container);

    expect(chatCanvasIslandMock).toHaveBeenCalled();
  });
});

describe("(source) page.tsx gates the toggle + canvas branch on useIsMobileViewport", () => {
  it("imports useIsMobileViewport", () => {
    expect(PAGE_SOURCE).toContain("useIsMobileViewport");
  });
});

describe("ConversationRail becomes an overlay Sheet below md (MOBL-01, 53-UI-SPEC §2 rail bullet)", () => {
  it("the mobile rail Sheet is closed by default", async () => {
    mockIsMobile = true;

    await mount(<ChatPage />);

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("the top-bar rail toggle opens the Sheet, revealing rail content", async () => {
    mockIsMobile = true;

    const container = await mount(<ChatPage />);
    const toggle = railToggleButton(container);

    await act(async () => {
      toggle.click();
    });

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("New chat");
    expect(dialog?.textContent).toContain(FAKE_CONVERSATION.title);
  });

  it("selecting a conversation from the mobile rail closes the Sheet", async () => {
    mockIsMobile = true;

    const container = await mount(<ChatPage />);
    const toggle = railToggleButton(container);

    await act(async () => {
      toggle.click();
    });

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();

    const rowButton = Array.from(dialog!.querySelectorAll("button")).find(
      (button) => button.textContent?.includes(FAKE_CONVERSATION.title),
    );
    if (!rowButton) throw new Error("conversation row button not found in Sheet");

    await act(async () => {
      rowButton.click();
    });

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("(source) conversation-rail.tsx Sheet-collapse assertions", () => {
  it("renders a side=\"left\" Sheet gated md:hidden and retains the desktop Collapsible gated hidden md:block", () => {
    expect(RAIL_SOURCE).toContain('side="left"');
    expect(RAIL_SOURCE).toMatch(/SheetContent[\s\S]{0,120}md:hidden/);
    expect(RAIL_SOURCE).toContain("hidden md:block");
  });

  it("the mobile row-select handler closes the Sheet (onMobileOpenChange(false))", () => {
    expect(RAIL_SOURCE).toMatch(/onMobileOpenChange\(false\)/);
  });
});
