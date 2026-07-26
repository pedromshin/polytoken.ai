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

const createDocumentMutateAsync = vi.fn(async (_input?: unknown) => ({
  documentId: "d0c0d0c0-0000-0000-0000-000000000001",
  created: true as const,
}));

vi.mock("~/trpc/react", () => ({
  api: {
    spreadsheets: {
      create: { useMutation: () => ({ mutateAsync: createMutateAsync }) },
    },
    documents: {
      create: { useMutation: () => ({ mutateAsync: createDocumentMutateAsync }) },
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
  onAddDocument: ReturnType<typeof vi.fn>;
  onAddSimpleNode: ReturnType<typeof vi.fn>;
  onAddEntity: ReturnType<typeof vi.fn>;
  onAssembleBoard: ReturnType<typeof vi.fn>;
  onBuildTool: ReturnType<typeof vi.fn>;
}

interface MountOptions {
  readonly buildToolSourceCount?: number;
  readonly buildToolPending?: boolean;
}

async function mountMenu(options: MountOptions = {}): Promise<Handlers> {
  const handlers: Handlers = {
    onAddCirclePack: vi.fn(),
    onAddEmailThread: vi.fn(),
    onAddKnowledge: vi.fn(),
    onAddSpreadsheet: vi.fn(),
    onAddDocument: vi.fn(),
    onAddSimpleNode: vi.fn(),
    onAddEntity: vi.fn(),
    onAssembleBoard: vi.fn(),
    onBuildTool: vi.fn(),
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <AddNodeMenu
        {...handlers}
        buildToolSourceCount={options.buildToolSourceCount ?? 0}
        buildToolPending={options.buildToolPending ?? false}
      />,
    );
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
    expect(labels.some((l) => l.includes("Document"))).toBe(true);
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

  it("Document creates a blank document, then places a node for its id", async () => {
    const h = await mountMenu();
    await openMenu();
    createDocumentMutateAsync.mockClear();
    await clickItem("Document");
    // Let the async create + placement settle.
    await act(async () => {
      await Promise.resolve();
    });
    expect(createDocumentMutateAsync).toHaveBeenCalledTimes(1);
    expect(h.onAddDocument).toHaveBeenCalledWith(
      "d0c0d0c0-0000-0000-0000-000000000001",
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

  it("Entity opens the entity picker", async () => {
    const h = await mountMenu();
    await openMenu();
    await clickItem("Entity…");
    expect(h.onAddEntity).toHaveBeenCalledTimes(1);
  });

  it("Daily brief places a direct simple node", async () => {
    const h = await mountMenu();
    await openMenu();
    await clickItem("Daily brief");
    expect(h.onAddSimpleNode).toHaveBeenCalledWith("brief");
  });

  it("Assemble board fires onAssembleBoard (Phase 74 MVP)", async () => {
    const h = await mountMenu();
    await openMenu();
    await clickItem("Assemble board");
    expect(h.onAssembleBoard).toHaveBeenCalledTimes(1);
  });

  it("Merge review places a direct simple node", async () => {
    const h = await mountMenu();
    await openMenu();
    await clickItem("Merge review");
    expect(h.onAddSimpleNode).toHaveBeenCalledWith("review-queue");
  });

  it("Build a tool is disabled with a hint when < 2 sources are selected (76-04)", async () => {
    const h = await mountMenu({ buildToolSourceCount: 1 });
    await openMenu();
    const item = itemByText("Build a tool from these");
    expect(item.getAttribute("data-disabled")).not.toBeNull();
    expect(item.textContent ?? "").toContain("Select 2+ data nodes first");
    await clickItem("Build a tool from these");
    expect(h.onBuildTool).not.toHaveBeenCalled();
  });

  it("Build a tool fires onBuildTool with ≥2 sources selected (76-04)", async () => {
    const h = await mountMenu({ buildToolSourceCount: 2 });
    await openMenu();
    await clickItem("Build a tool from these");
    expect(h.onBuildTool).toHaveBeenCalledTimes(1);
  });

  it("Build a tool is disabled while a summon is pending (76-04)", async () => {
    const h = await mountMenu({ buildToolSourceCount: 3, buildToolPending: true });
    await openMenu();
    const item = itemByText("Build a tool from these");
    expect(item.getAttribute("data-disabled")).not.toBeNull();
    expect(item.textContent ?? "").toContain("Building…");
    await clickItem("Build a tool from these");
    expect(h.onBuildTool).not.toHaveBeenCalled();
  });
});
