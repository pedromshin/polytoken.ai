/**
 * code-island-picker-dialog.test.tsx — "Your tools" picker (Phase 76 / 76-04c).
 * Proves: opens on a nonce bump, lists saved tools, selecting one fires
 * onAdd(islandId) + closes, and the empty state guides the user to build one.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let queryResult: { data?: unknown; isPending: boolean; isError: boolean } = {
  data: [],
  isPending: false,
  isError: false,
};

vi.mock("~/trpc/react", () => ({
  api: {
    codeIslands: {
      list: { useQuery: () => queryResult },
    },
  },
}));

import { CodeIslandPickerDialog } from "../code-island-picker-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render(nonce: number, onAdd: (id: string) => void): Promise<void> {
  await act(async () => {
    root.render(<CodeIslandPickerDialog onAdd={onAdd} requestOpenNonce={nonce} />);
  });
}
function dialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"]');
}
async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  queryResult = { data: [], isPending: false, isError: false };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  document.body.querySelectorAll('[role="dialog"], [data-radix-portal]').forEach((n) => n.remove());
});

describe("CodeIslandPickerDialog", () => {
  it("does not open on mount", async () => {
    await render(0, vi.fn());
    expect(dialog()).toBeNull();
  });

  it("opens on a nonce bump and shows the empty-state guidance", async () => {
    await render(0, vi.fn());
    await render(1, vi.fn());
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent ?? "").toContain("Build a tool from these");
  });

  it("lists saved tools and selecting one fires onAdd + closes", async () => {
    queryResult = {
      data: [
        { id: "isl-1", intent: "Rent reconciler", updatedAt: "2026-07-26T10:00:00.000Z" },
        { id: "isl-2", intent: "Spend tracker", updatedAt: "2026-07-25T10:00:00.000Z" },
      ],
      isPending: false,
      isError: false,
    };
    const onAdd = vi.fn();
    await render(0, onAdd);
    await render(1, onAdd);
    const rentBtn = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ).find((b) => (b.textContent ?? "").includes("Rent reconciler"));
    expect(rentBtn).toBeTruthy();
    await click(rentBtn!);
    expect(onAdd).toHaveBeenCalledWith("isl-1");
    expect(dialog()).toBeNull();
  });

  it("shows a loading state while pending", async () => {
    queryResult = { data: undefined, isPending: true, isError: false };
    await render(0, vi.fn());
    await render(1, vi.fn());
    expect(document.body.querySelector('[aria-label="Loading tools"]')).not.toBeNull();
  });
});
