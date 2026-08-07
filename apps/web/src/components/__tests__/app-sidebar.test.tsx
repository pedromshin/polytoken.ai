/**
 * app-sidebar.test.tsx — the shared nav mounts the workspace switcher
 * (PEDRO-CHECKLIST §5: /workspaces was direct-URL-only because the built
 * WorkspaceSwitcher was mounted nowhere). jsdom-only: BEHAVIOUR, not layout
 * (CLAUDE.md — jsdom does no layout; geometry/screenshot gates own visuals).
 *
 * Covered:
 *   1. SWITCHER IN NAV — with workspaces present, the switcher trigger
 *      renders inside the sidebar header and carries the default (first)
 *      workspace's name.
 *   2. QUIET WHEN NONE — with zero workspaces the rail renders NO switcher
 *      chrome at all: no trigger, no "No workspaces", no "Loading…", and the
 *      nav itself still stands (never an error).
 *   3. QUIET WHILE LOADING — the pending list renders nothing either.
 *
 * `~/trpc/react` is mocked as plain vi.fn()s (mirrors
 * workspaces-list.test.tsx's convention); `next/navigation` is mocked for
 * `usePathname`; `window.matchMedia` is stubbed for the sidebar's internal
 * mobile-viewport hook.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@polytoken/ui/sidebar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

interface WsRow {
  id: string;
  name: string;
  role: "owner" | "admin" | "member" | "viewer";
}

let listData: WsRow[] | undefined = [];
let listPending = false;

vi.mock("~/trpc/react", () => ({
  api: {
    workspaces: {
      list: {
        useQuery: () => ({
          data: listData,
          isPending: listPending,
          isError: false,
          error: null,
        }),
      },
    },
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

import { AppSidebar } from "../app-sidebar";

let container: HTMLDivElement;
let root: Root;

function stubMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

async function mount(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>,
    );
  });
}

function switcherTrigger(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-label="Switch workspace"]',
  );
}

beforeEach(() => {
  stubMatchMedia();
  window.localStorage.clear();
  listData = [];
  listPending = false;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("AppSidebar workspace switcher", () => {
  it("mounts the switcher in the sidebar header when workspaces exist", async () => {
    listData = [
      { id: "11111111-1111-1111-1111-111111111111", name: "Acme", role: "owner" },
      { id: "22222222-2222-2222-2222-222222222222", name: "Beta", role: "member" },
    ];
    await mount();

    const trigger = switcherTrigger();
    expect(trigger).not.toBeNull();
    // It lives in the header chrome, not floating loose in the content pane.
    expect(trigger!.closest('[data-sidebar="header"]')).not.toBeNull();
    // Default selection is the first (newest) workspace.
    expect(trigger!.textContent).toContain("Acme");
    expect(trigger!.disabled).toBe(false);
  });

  it("renders nothing for a zero-workspace user — quiet, never an error", async () => {
    listData = [];
    await mount();

    expect(switcherTrigger()).toBeNull();
    expect(container.textContent).not.toContain("No workspaces");
    expect(container.textContent).not.toContain("Loading");
    // The rail itself still stands.
    expect(container.textContent).toContain("Inbox");
    expect(container.textContent).toContain("Polytoken");
  });

  it("renders nothing while the workspace list is still loading", async () => {
    listData = undefined;
    listPending = true;
    await mount();

    expect(switcherTrigger()).toBeNull();
    expect(container.textContent).not.toContain("Loading");
  });
});
