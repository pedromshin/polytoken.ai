/**
 * chat-auto-open.test.tsx — task #18's auto-open contract for /chat:
 *
 *   1. On mount with conversations present, the MOST RECENT one
 *      (conversations[0] — listConversations is updatedAt-desc) is selected
 *      automatically: the rail receives selectedId=CONV_A and the main
 *      column mounts ConversationView (composer textarea) instead of the
 *      home empty state.
 *   2. FIRES ONCE PER MOUNT: after the user deletes the open conversation
 *      (rail's onDeleted → selectedId null), the page shows the empty state
 *      and does NOT re-auto-open the next row uninvited.
 *   3. With an empty conversation list nothing is selected — the empty
 *      state renders as before.
 *
 * Mounts the REAL ChatPage default export with the same per-procedure
 * `~/trpc/react` stub convention as chat-mobile-feed.test.tsx (see that
 * file's doc comment). `ConversationRail` is mocked to a prop-capturing
 * null-render so case 2 can drive `onDeleted` directly without walking the
 * rail's own dropdown+AlertDialog flow (that flow has its own coverage);
 * everything else in the page tree is real.
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const CONV_A = "11111111-1111-1111-1111-111111111111"; // most recent
const CONV_B = "22222222-2222-2222-2222-222222222222";

// Desktop path — auto-open is viewport-independent; desktop keeps the tree
// simplest (no Sheet).
vi.mock("~/hooks/use-is-mobile-viewport", () => ({
  useIsMobileViewport: () => false,
}));

// useConversationController calls useRouter() (Wave 0.6: injected router.push
// for the over-allowance Billing toast) — jsdom has no App Router; the repo's
// standard stub (entities-table.test.tsx idiom).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("../_canvas/chat-canvas-island", () => ({
  ChatCanvasIsland: () => null,
}));

// Prop-capturing rail stub (see file doc comment).
interface CapturedRailProps {
  selectedId: string | null;
  onDeleted: (id: string) => void;
}
let capturedRailProps: CapturedRailProps | null = null;
vi.mock("../_components/conversation-rail", () => ({
  ConversationRail: (props: CapturedRailProps) => {
    capturedRailProps = props;
    return null;
  },
}));

const FAKE_CONVERSATIONS = [
  {
    id: CONV_A,
    title: "Most recent conversation",
    modelId: "m1",
    updatedAt: "2026-01-02T00:00:00.000Z",
  },
  {
    id: CONV_B,
    title: "Older conversation",
    modelId: "m1",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

// Mutable per-test (empty-list case) — read at CALL time inside the hoisted
// mock factory (chat-mobile-feed.test.tsx's established shape).
let conversationsData: typeof FAKE_CONVERSATIONS = FAKE_CONVERSATIONS;

// getHistory inputs, captured to prove WHICH conversation auto-opened.
let getHistoryInputs: Array<{ conversationId?: string }> = [];

const FAKE_UTILS = {
  chat: {
    listConversations: { invalidate: async () => undefined },
    getHistory: { invalidate: () => undefined },
    sessionCost: { invalidate: () => undefined },
    getWidgetInteractions: { invalidate: () => undefined },
    clusterSummary: { invalidate: () => undefined },
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

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => FAKE_UTILS,
    chat: {
      listConversations: {
        useQuery: () => ({ data: conversationsData }),
      },
      createConversation: {
        useMutation: () => ({ mutate: () => undefined, isPending: false }),
      },
      renameConversation: { useMutation: () => ({ mutate: () => undefined }) },
      deleteConversation: { useMutation: () => ({ mutate: () => undefined }) },
      duplicateConversation: {
        useMutation: () => ({ mutate: () => undefined, isPending: false }),
      },
      getHistory: {
        useQuery: (input: { conversationId?: string }) => {
          getHistoryInputs.push(input);
          return { data: [] };
        },
      },
      getWidgetInteractions: { useQuery: () => ({ data: [] }) },
      models: { useQuery: () => ({ data: { models: [] } }) },
      recordBrowserTurn: {
        useMutation: () => ({ mutateAsync: async () => undefined }),
      },
      setModel: { useMutation: () => ({ mutate: () => undefined }) },
      sessionCost: {
        useQuery: () => ({ data: { totalCostUsd: 0, breakdown: [] } }),
      },
      getConversationThreadId: {
        useQuery: () => ({ data: { threadId: null } }),
      },
      clusterSummary: { useQuery: () => ({ data: undefined }) },
      getCanvasLayout: { useQuery: () => ({ data: null, isPending: false }) },
      saveCanvasLayout: { useMutation: () => ({ mutate: () => undefined }) },
      listContextEdges: { useQuery: () => ({ data: [] }) },
      createContextEdge: {
        useMutation: () => ({ mutate: () => undefined, isPending: false }),
      },
      addCanvasNode: {
        useMutation: () => ({ mutate: () => undefined, isPending: false }),
      },
      removeContextEdge: { useMutation: () => ({ mutate: () => undefined }) },
    },
    files: {
      requestUpload: {
        useMutation: () => ({ mutateAsync: async () => ({ url: "" }) }),
      },
      list: {
        useQuery: () => ({ data: { entries: [] }, isPending: false, isError: false }),
      },
    },
    // W8-1: UpsellBanner mounts in ConversationView's dock stack. A loading
    // read keeps it fail-quiet (renders nothing) — this suite is about
    // auto-open, not billing.
    billing: {
      currentSubscription: {
        useQuery: () => ({ data: undefined, isLoading: true, isError: false }),
      },
      usage: {
        useQuery: () => ({ data: undefined, isLoading: true, isError: false }),
      },
    },
    emails: {
      threadCard: { useQuery: () => ({ data: undefined }) },
      listThreads: {
        useQuery: () => ({ data: { threads: [] }, isPending: false, isError: false }),
      },
    },
  },
}));

import ChatPage from "../page";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function composerTextarea(container: HTMLDivElement): Element | null {
  return container.querySelector(
    'textarea[placeholder="Ask the agent anything…"]',
  );
}

afterEach(() => {
  for (const c of containers) document.body.removeChild(c);
  containers = [];
  document.body
    .querySelectorAll('[role="dialog"], [data-radix-portal]')
    .forEach((node) => node.remove());
  capturedRailProps = null;
  conversationsData = FAKE_CONVERSATIONS;
  getHistoryInputs = [];
});

describe("/chat auto-open (task #18)", () => {
  it("selects the MOST RECENT conversation (conversations[0]) on mount, without any click", async () => {
    const container = await mount(<ChatPage />);

    // The rail was told the most-recent row is selected…
    expect(capturedRailProps?.selectedId).toBe(CONV_A);
    // …the main column mounted ConversationView (composer present, empty
    // state gone)…
    expect(composerTextarea(container)).not.toBeNull();
    // …and the history being fetched is CONV_A's, not CONV_B's.
    expect(
      getHistoryInputs.some((input) => input.conversationId === CONV_A),
    ).toBe(true);
    expect(
      getHistoryInputs.some((input) => input.conversationId === CONV_B),
    ).toBe(false);
  });

  it("fires ONCE per mount: deleting the open conversation shows the empty state, never re-auto-opens the next row", async () => {
    const container = await mount(<ChatPage />);
    expect(capturedRailProps?.selectedId).toBe(CONV_A);

    await act(async () => {
      capturedRailProps?.onDeleted(CONV_A);
    });

    // De-selected, NOT bounced to CONV_B.
    expect(capturedRailProps?.selectedId).toBeNull();
    expect(composerTextarea(container)).toBeNull();
    // The home empty state is back (its New-chat CTA renders).
    const newChat = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("New chat"),
    );
    expect(newChat).toBeDefined();
  });

  it("with no conversations, nothing is selected and the empty state renders", async () => {
    conversationsData = [];

    const container = await mount(<ChatPage />);

    expect(capturedRailProps?.selectedId).toBeNull();
    expect(composerTextarea(container)).toBeNull();
  });
});
