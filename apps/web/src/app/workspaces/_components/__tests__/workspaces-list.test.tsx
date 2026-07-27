/**
 * workspaces-list.test.tsx — behaviour of the /workspaces list surface
 * (Stream B). jsdom-only: BEHAVIOUR, not layout (CLAUDE.md — jsdom does no
 * layout; the geometry/screenshot gates own any visual claim).
 *
 * Covered:
 *   1. LIST RENDERS — a row per workspace from `workspaces.list`, with its
 *      role label.
 *   2. CREATE CALLS THE MUTATION — typing a name + submitting the form calls
 *      `workspaces.create` with that name.
 *
 * `~/trpc/react` is mocked as plain vi.fn()s (mirrors send-to.test.tsx's
 * convention). Query + mutation state is module-level and reset per test.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

interface WsRow {
  id: string;
  name: string;
  role: "owner" | "admin" | "member" | "viewer";
  createdAt: string;
}

let listData: WsRow[] = [];
const createMutate = vi.fn();
const listInvalidate = vi.fn(async () => undefined);

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ workspaces: { list: { invalidate: listInvalidate } } }),
    workspaces: {
      list: {
        useQuery: () => ({
          data: listData,
          isPending: false,
          isError: false,
          error: null,
        }),
      },
      create: {
        useMutation: () => ({ mutate: createMutate, isPending: false, isError: false, error: null }),
      },
    },
  },
}));

import { WorkspacesList } from "../workspaces-list";

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<WorkspacesList />);
  });
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  listData = [];
  createMutate.mockClear();
  listInvalidate.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("WorkspacesList", () => {
  it("renders a row per workspace with its role label", async () => {
    listData = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        name: "Acme",
        role: "owner",
        createdAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        name: "Beta team",
        role: "admin",
        createdAt: "2026-07-02T00:00:00.000Z",
      },
    ];
    await mount();

    const links = Array.from(container.querySelectorAll("a"));
    expect(links).toHaveLength(2);
    expect(container.textContent).toContain("Acme");
    expect(container.textContent).toContain("Beta team");
    expect(container.textContent).toContain("Owner");
    expect(container.textContent).toContain("Admin");
    // Rows are single-click opens into the detail surface.
    expect(links[0]!.getAttribute("href")).toBe(
      "/workspaces/11111111-1111-1111-1111-111111111111",
    );
  });

  it("shows a teaching empty state when there are no workspaces", async () => {
    listData = [];
    await mount();
    expect(container.textContent).toContain("No workspaces yet");
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("create form calls the create mutation with the typed name", async () => {
    listData = [];
    await mount();

    const input = container.querySelector<HTMLInputElement>(
      "#new-workspace-name",
    )!;
    expect(input).not.toBeNull();

    await act(async () => {
      setInputValue(input, "  My workspace  ");
    });

    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(createMutate).toHaveBeenCalledTimes(1);
    // Trimmed before send.
    expect(createMutate).toHaveBeenCalledWith({ name: "My workspace" });
  });

  it("does not submit an empty (whitespace-only) name", async () => {
    listData = [];
    await mount();

    const input = container.querySelector<HTMLInputElement>(
      "#new-workspace-name",
    )!;
    await act(async () => {
      setInputValue(input, "   ");
    });
    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(createMutate).not.toHaveBeenCalled();
  });
});
