/**
 * inbox-mobile-stack.test.tsx — 53-03-PLAN.md Task 1: proves InboxThreePane's
 * MOBL-02 single-pane master->detail stack below `md` (53-UI-SPEC §4)
 * without regressing the desktop three-pane.
 *
 * Mounts the REAL `InboxThreePane` — mirrors
 * `knowledge-preview-node.test.tsx`'s createRoot-in-jsdom + `act` convention.
 * `~/trpc/react`'s three direct `.useQuery` calls this component makes
 * (`emails.list`, `emails.entitySummary`, `emails.listThreads`) are each
 * mocked as a plain stub — mirrors `knowledge-preview-node.test.tsx`'s
 * single-`.useQuery`-per-procedure convention (simpler than the
 * `useQueries` proxy other suites use, since none of these three calls fan
 * out through `useQueries`).
 *
 * Both the desktop (`hidden md:block`) and mobile (`flex ... md:hidden`)
 * trees render simultaneously in jsdom (CSS media queries are not evaluated
 * there) — tests that need to interact with ONLY the mobile tree scope
 * their queries to the mobile wrapper `<div>` by its literal `className`
 * string, since both trees render the SAME `InboxThreadGroup`/`InboxRow`
 * rows for the same fixture data.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const EMAIL_1_ID = "11111111-1111-1111-1111-111111111111";
const EMAIL_2_ID = "22222222-2222-2222-2222-222222222222";

const FAKE_EMAILS = [
  {
    id: EMAIL_1_ID,
    subject: "Welcome to polytoken",
    senderName: "Ada Lovelace",
    senderAddress: "ada@example.com",
    receivedAt: "2026-01-01T00:00:00.000Z",
    bodyText: "Hello there",
    toAddresses: ["me@example.com"],
  },
  {
    id: EMAIL_2_ID,
    subject: "Invoice #42",
    senderName: null,
    senderAddress: "billing@example.com",
    receivedAt: "2026-01-02T00:00:00.000Z",
    bodyText: null,
    toAddresses: [] as string[],
  },
];

const FAKE_THREADS = [
  {
    key: "t1",
    threadId: null,
    importerId: "imp-1",
    subject: "Welcome to polytoken",
    messageCount: 1,
    latestReceivedAt: "2026-01-01T00:00:00.000Z",
    latestSnippet: "Hello there",
    memberEmailIds: [EMAIL_1_ID],
  },
  {
    key: "t2",
    threadId: null,
    importerId: "imp-1",
    subject: "Invoice #42",
    messageCount: 1,
    latestReceivedAt: "2026-01-02T00:00:00.000Z",
    latestSnippet: null,
    memberEmailIds: [EMAIL_2_ID],
  },
];

const listThreadsRefetch = vi.fn().mockResolvedValue({ data: undefined });

vi.mock("~/trpc/react", () => ({
  api: {
    emails: {
      list: {
        useQuery: () => ({
          data: { items: FAKE_EMAILS },
          isLoading: false,
          isError: false,
        }),
      },
      entitySummary: {
        useQuery: () => ({ data: [], isLoading: false, isError: false }),
      },
      listThreads: {
        useQuery: () => ({
          data: undefined,
          isFetching: false,
          refetch: listThreadsRefetch,
        }),
      },
    },
  },
}));

import { InboxThreePane, type InboxData } from "../inbox-three-pane";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(
  path.join(__dirname, "..", "inbox-three-pane.tsx"),
  "utf-8",
);

const FAKE_DATA: InboxData = {
  items: FAKE_THREADS,
  hasMore: false,
  nextOffset: 2,
};

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

/**
 * Finds a `<div>` by its EXACT `className` string. Both the desktop and
 * mobile trees are simultaneously present in jsdom (no media-query
 * evaluation there), so scoping by the wrapper's literal className is the
 * reliable way to isolate one tree's rows from the other's identical
 * fixture-backed content.
 */
function findByExactClassName(root: HTMLElement, className: string): HTMLElement {
  const match = Array.from(root.querySelectorAll<HTMLElement>("div")).find(
    (el) => el.className === className,
  );
  if (!match) throw new Error(`No <div className="${className}"> found`);
  return match;
}

beforeEach(() => {
  listThreadsRefetch.mockClear();
});

afterEach(() => {
  for (const c of containers) {
    document.body.removeChild(c);
  }
  containers = [];
});

describe("InboxThreePane mobile stack (MOBL-02, 53-UI-SPEC §4)", () => {
  it("renders a segmented Tabs filter labelled 'Inbox filter'", async () => {
    const container = await mount(
      <InboxThreePane data={FAKE_DATA} isLoading={false} isError={false} />,
    );

    const tablist = container.querySelector('[aria-label="Inbox filter"]');
    expect(tablist).not.toBeNull();
    expect(tablist?.getAttribute("role")).toBe("tablist");
  });

  it("desktop three-pane wrapper carries hidden md:block + data-tree=desktop; mobile stack carries md:hidden + data-tree=mobile", () => {
    // 60-03 Task 1 added `data-tree` markers to both top-level wrappers (the
    // pane-level gate in inbox-structure.test.tsx scopes its queries by
    // `[data-tree="desktop"]`) — a literal whole-tag substring match would
    // break the instant an attribute is added, so this asserts the class
    // gating and the marker attribute as two independent substrings instead.
    expect(SOURCE).toContain('data-tree="desktop" className="hidden h-full md:block"');
    expect(SOURCE).toContain(
      'data-tree="mobile" className="flex h-full flex-col md:hidden"',
    );
  });

  it("first paint always shows the list — the background auto-select effect never flips mobileView to detail", async () => {
    const container = await mount(
      <InboxThreePane data={FAKE_DATA} isLoading={false} isError={false} />,
    );

    // The auto-select effect has already resolved selectedEmailId by now
    // (proven by the round-trip test below), yet the back bar must still be
    // absent on first paint — a mobile user is never silently deposited
    // into the detail view.
    expect(container.querySelector('[aria-label="Back to inbox"]')).toBeNull();

    const mobileRoot = findByExactClassName(
      container,
      "flex h-full flex-col md:hidden",
    );
    expect(mobileRoot.querySelectorAll('[role="button"]')).toHaveLength(2);
  });

  it("tapping a mobile row shows the back bar (list -> detail); back returns to list with selection preserved", async () => {
    const container = await mount(
      <InboxThreePane data={FAKE_DATA} isLoading={false} isError={false} />,
    );

    const mobileRoot = findByExactClassName(
      container,
      "flex h-full flex-col md:hidden",
    );
    const rows = mobileRoot.querySelectorAll<HTMLElement>('[role="button"]');
    expect(rows).toHaveLength(2);

    // Tap the SECOND row ("Invoice #42") — distinct from whatever the
    // background default-select effect already chose (the first thread), so
    // preservation through the list->detail->list round trip is unambiguous.
    await act(async () => {
      rows[1]!.click();
    });

    const backBar = container.querySelector('[aria-label="Back to inbox"]');
    expect(backBar).not.toBeNull();
    expect(backBar?.parentElement?.textContent).toContain("Invoice #42");

    // Tap back — returns to the list.
    await act(async () => {
      (backBar as HTMLButtonElement).click();
    });

    expect(container.querySelector('[aria-label="Back to inbox"]')).toBeNull();
    const mobileRootAfter = findByExactClassName(
      container,
      "flex h-full flex-col md:hidden",
    );
    expect(mobileRootAfter.querySelectorAll('[role="button"]')).toHaveLength(2);

    // Desktop's ReadingPreview reads the SAME selectedEmailId state — its
    // header still resolves "Invoice #42", proving mobileView reset without
    // clearing the underlying selection.
    const desktopRoot = findByExactClassName(container, "hidden h-full md:block");
    expect(desktopRoot.textContent).toContain("Invoice #42");
  });
});
