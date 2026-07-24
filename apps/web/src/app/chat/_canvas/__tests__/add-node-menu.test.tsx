/**
 * add-node-menu.test.tsx — AddNodeMenu, the canvas Panel's touch-reachable
 * "Add node" dropdown ("i need to be able to add nodes of various types").
 * Proves the four addable types are offered and each fires the right handler:
 * Email/Drive treemap → onAddCirclePack(scope); Email thread / Knowledge node
 * → the picker openers.
 *
 * Radix DropdownMenu opens on POINTERDOWN (not click) and portals its content
 * to document.body (mirrors chat-quick-actions-fab.test.tsx).
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const createMutateAsync = vi.fn(async (_input?: unknown) => ({
  spreadsheetId: "5c5c5c5c-0000-0000-0000-000000000001",
  created: true as const,
}));

vi.mock("~/trpc/react", () => ({
  api: {
    spreadsheets: {
      create: { useMutation: () => ({ mutateAsync: createMutateAsync }) },
    },
  },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { AddNodeMenu } from "../add-node-menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

interface Handlers {
  onAddCirclePack: ReturnType<typeof vi.fn>;
  onAddEmailThread: ReturnType<typeof vi.fn>;
  onAddKnowledge: ReturnType<typeof vi.fn>;
  onAddSpreadsheet: ReturnType<typeof vi.fn>;
}

async function mountMenu(): Promise<Handlers> {
  const handlers: Handlers = {
    onAddCirclePack: vi.fn(),
    onAddEmailThread: vi.fn(),
    onAddKnowledge: vi.fn(),
    onAddSpreadsheet: vi.fn(),
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<AddNodeMenu {...handlers} />);
  });
  return handlers;
}

async function openMenu(): Promise<void> {
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Add node"]',
  )!;
  await act(async () => {
    trigger.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
  });
}

function menuItems(): HTMLElement[] {
  return Array.from(
    document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  );
}

function itemByText(text: string): HTMLElement {
  const found = menuItems().find((el) =>
    (el.textContent ?? "").includes(text),
  );
  if (!found) throw new Error(`menu item "${text}" not found`);
  return found;
}

async function clickItem(text: string): Promise<void> {
  await act(async () => {
    itemByText(text).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  document.body
    .querySelectorAll('[role="menu"], [data-radix-portal]')
    .forEach((n) => n.remove());
});

describe("AddNodeMenu", () => {
  it("offers every addable node type", async () => {
    await mountMenu();
    await openMenu();
    const labels = menuItems().map((el) => el.textContent ?? "");
    expect(labels.some((l) => l.includes("Email treemap"))).toBe(true);
    expect(labels.some((l) => l.includes("Drive treemap"))).toBe(true);
    expect(labels.some((l) => l.includes("Spreadsheet"))).toBe(true);
    expect(labels.some((l) => l.includes("Email thread"))).toBe(true);
    expect(labels.some((l) => l.includes("Knowledge node"))).toBe(true);
  });

  it("Spreadsheet creates a blank sheet, then places a node for its id", async () => {
    const h = await mountMenu();
    await openMenu();
    createMutateAsync.mockClear();
    await clickItem("Spreadsheet");
    // Let the async create + placement settle.
    await act(async () => {
      await Promise.resolve();
    });
    expect(createMutateAsync).toHaveBeenCalledTimes(1);
    expect(h.onAddSpreadsheet).toHaveBeenCalledWith(
      "5c5c5c5c-0000-0000-0000-000000000001",
    );
  });

  it("Email treemap adds a mailbox-scoped circle-pack", async () => {
    const h = await mountMenu();
    await openMenu();
    await clickItem("Email treemap");
    expect(h.onAddCirclePack).toHaveBeenCalledWith("mailbox");
  });

  it("Drive treemap adds a drive-scoped circle-pack", async () => {
    const h = await mountMenu();
    await openMenu();
    await clickItem("Drive treemap");
    expect(h.onAddCirclePack).toHaveBeenCalledWith("drive");
  });

  it("Email thread opens the thread picker", async () => {
    const h = await mountMenu();
    await openMenu();
    await clickItem("Email thread");
    expect(h.onAddEmailThread).toHaveBeenCalledTimes(1);
  });

  it("Knowledge node opens the knowledge picker", async () => {
    const h = await mountMenu();
    await openMenu();
    await clickItem("Knowledge node");
    expect(h.onAddKnowledge).toHaveBeenCalledTimes(1);
  });
});
