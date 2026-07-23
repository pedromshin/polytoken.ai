/**
 * home-board.test.tsx — HM-01/HM-02 jsdom BEHAVIOR test (no visual claim —
 * jsdom does no layout; the screenshot/geometry gates own the visual side).
 *
 * Proves the board renders the default panels from the EXISTING queries, that
 * the inbox three-pane stays one click away (HM-01), and that the HM-02 morning
 * brief renders its sections from the shaped fold. tRPC is mocked at the
 * `~/trpc/react` boundary (the codebase's convention) so no server is needed.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// --- fixtures (all timestamps NOW so the 24h brief window includes them) ----
const NOW = new Date();

const threadsData = {
  items: [
    {
      key: "thr-1",
      threadId: "t1",
      importerId: "imp-1",
      subject: "Renewal quote from Acme",
      messageCount: 3,
      latestReceivedAt: NOW,
      latestSnippet: null,
      memberEmailIds: [],
    },
  ],
  hasMore: false,
  nextOffset: 0,
};

const entitiesData = {
  items: [
    { id: "ent-1", displayName: "Acme Inc", entityTypeLabel: "Company", status: "confirmed" },
  ],
  hasMore: false,
  nextOffset: 0,
};

const documentsData = {
  items: [
    { id: "doc-1", title: "Q3 renewal brief", sourceLedgerId: null, createdAt: NOW },
  ],
  hasMore: false,
  nextOffset: 0,
};

const reviewsData = {
  items: [
    {
      pairKey: "pair-1",
      subject: {
        id: "ent-1",
        displayName: "Acme Inc",
        entityTypeId: "ty-1",
        entityTypeLabel: "Company",
        aliases: [],
        identifiers: {},
        occurrenceCount: 2,
      },
      candidate: {
        id: "ent-2",
        displayName: "Acme Incorporated",
        entityTypeId: "ty-1",
        entityTypeLabel: "Company",
        aliases: [],
        identifiers: {},
        occurrenceCount: 1,
      },
      matchTypes: ["alias"],
      maxSimilarity: 0.9,
    },
  ],
  hasMore: false,
  nextOffset: 0,
  totalPending: 1,
};

const saveMutate = vi.fn();

vi.mock("~/trpc/react", () => ({
  api: {
    chat: {
      getHomeCanvasLayout: {
        useQuery: () => ({ data: null, isPending: false, isFetched: true }),
      },
      saveHomeCanvasLayout: {
        useMutation: () => ({
          mutate: saveMutate,
          isPending: false,
          isSuccess: false,
        }),
      },
    },
    emails: {
      listThreads: {
        useQuery: () => ({ data: threadsData, isPending: false, isError: false }),
      },
    },
    entities: {
      list: {
        useQuery: () => ({ data: entitiesData, isPending: false, isError: false }),
      },
      reviewQueue: {
        useQuery: () => ({ data: reviewsData, isPending: false, isError: false }),
      },
    },
    documents: {
      list: {
        useQuery: () => ({ data: documentsData, isPending: false, isError: false }),
      },
    },
  },
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) =>
    React.createElement("a", { href, ...rest }, children),
}));

import { HomeBoard } from "../home-board";

let container: HTMLDivElement;
let root: Root;

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(HomeBoard));
  });
}

beforeEach(() => {
  saveMutate.mockClear();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("HomeBoard (HM-01 / HM-02)", () => {
  it("renders the four default board panels", async () => {
    await mount();
    const headings = Array.from(container.querySelectorAll("h2")).map(
      (h) => h.textContent,
    );
    expect(headings).toContain("Inbox");
    expect(headings).toContain("Today’s entities");
    expect(headings).toContain("Recent documents");
    expect(headings).toContain("Morning brief");
  });

  it("keeps the inbox three-pane one click away (HM-01)", async () => {
    await mount();
    const inboxLink = Array.from(container.querySelectorAll("a")).find(
      (a) => a.getAttribute("href") === "/" && /inbox/i.test(a.textContent ?? ""),
    );
    expect(inboxLink).toBeDefined();
  });

  it("renders panel data from the existing queries", async () => {
    await mount();
    const text = container.textContent ?? "";
    expect(text).toContain("Renewal quote from Acme"); // inbox summary
    expect(text).toContain("Acme Inc"); // today's entities
    expect(text).toContain("Q3 renewal brief"); // recent documents
  });

  it("renders the HM-02 morning brief sections from the shaped fold", async () => {
    await mount();
    const text = container.textContent ?? "";
    expect(text).toContain("New email");
    expect(text).toContain("Merges to review");
    expect(text).toContain("New documents");
    // The merge row shows both entity names (EN-02 reviewQueue).
    expect(text).toContain("Acme Incorporated");
  });

  it("exposes a Pin board action wired to the reused home persistence", async () => {
    await mount();
    const pinBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      /pin board/i.test(b.textContent ?? ""),
    );
    expect(pinBtn).toBeDefined();
    await act(async () => {
      pinBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(saveMutate).toHaveBeenCalledTimes(1);
    const arg = saveMutate.mock.calls[0][0];
    // Home snapshot pins panels in sharedState — NODES STAY EMPTY (no new
    // canvas node type introduced by the home board).
    expect(arg.snapshot.nodes).toEqual([]);
    expect(arg.snapshot.sharedState["home.panels"]).toContain("morning-brief");
  });
});
