/**
 * chat-quick-actions-fab.test.tsx — task #18's floating quick-actions menu.
 * jsdom-only: BEHAVIOUR + class STRINGS, no layout (CLAUDE.md: the
 * geometry/screenshot gates own the visual claim).
 *
 * Covered:
 *   1. FLAT TRIGGER — circular, --bright + hairline border, and NO shadow-*
 *      utility (design law "zero shadow anywhere"; deliberately NOT
 *      jump-to-bottom-button's shadow-md).
 *   2. MENU CONTENT — New chat / Model… / Rename… / Duplicate; the three
 *      conversation-scoped items are disabled when selectedConversation is
 *      null, enabled otherwise; New chat is ALWAYS enabled.
 *   3. NEW CHAT routes to the caller's onNewChat (ChatPage's handleNewChat).
 *   4. DUPLICATE calls chat.duplicateConversation with the open
 *      conversation's id; its onSuccess invalidates listConversations and
 *      opens the fresh copy (onOpenConversation).
 *   5. RENAME… opens a dialog pre-seeded with the current title; submitting
 *      calls chat.renameConversation with the trimmed title.
 *   6. MODEL… opens a dialog hosting the SAME ModelPickerPanel as the header
 *      trigger (its cmdk search input is present).
 *
 * `~/trpc/react` is mocked per-procedure with captured mutation options
 * (mirrors send-to.test.tsx's convention). Radix DropdownMenu opens on
 * POINTERDOWN, not click — the opener below dispatches a bubbling
 * MouseEvent named "pointerdown" with button 0 (jsdom has no PointerEvent
 * constructor; Radix's trigger handler only reads .button/.ctrlKey).
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const CONV_ID = "11111111-1111-1111-1111-111111111111";
const NEW_ID = "33333333-3333-3333-3333-333333333333";

interface MutationOptions {
  onSuccess?: (result: unknown) => void | Promise<void>;
}

const listConversationsInvalidate = vi.fn(async () => undefined);
const renameMutate = vi.fn();
const duplicateMutate = vi.fn();
let renameOptions: MutationOptions = {};
let duplicateOptions: MutationOptions = {};
const setModelMutate = vi.fn();

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      chat: { listConversations: { invalidate: listConversationsInvalidate } },
    }),
    chat: {
      renameConversation: {
        useMutation: (opts?: MutationOptions) => {
          renameOptions = opts ?? {};
          return { mutate: renameMutate, isPending: false };
        },
      },
      duplicateConversation: {
        useMutation: (opts?: MutationOptions) => {
          duplicateOptions = opts ?? {};
          return { mutate: duplicateMutate, isPending: false };
        },
      },
      // ModelPickerPanel's own reads/writes (mounted by the Model… dialog).
      models: { useQuery: () => ({ data: { models: [] } }) },
      setModel: {
        useMutation: () => ({ mutate: setModelMutate, isPending: false }),
      },
    },
  },
}));

import { ChatQuickActionsFab } from "../chat-quick-actions-fab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// cmdk (ModelPickerPanel's Command) observes its list's size and scrolls the
// selected item into view; jsdom implements neither (mirrors omnibox.test.tsx).
Element.prototype.scrollIntoView = vi.fn();
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const SELECTED = {
  id: CONV_ID,
  title: "Freight quote",
  modelId: "m1",
} as const;

let containers: HTMLDivElement[] = [];
let roots: Root[] = [];

async function mount(element: React.ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(element);
  });
  return container;
}

afterEach(async () => {
  for (const root of roots) {
    await act(async () => {
      root.unmount();
    });
  }
  for (const c of containers) c.remove();
  containers = [];
  roots = [];
  document.body
    .querySelectorAll('[role="dialog"], [role="menu"], [data-radix-portal]')
    .forEach((node) => node.remove());
  listConversationsInvalidate.mockClear();
  renameMutate.mockClear();
  duplicateMutate.mockClear();
  setModelMutate.mockClear();
  renameOptions = {};
  duplicateOptions = {};
});

function trigger(container: HTMLDivElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    '[aria-label="Chat quick actions"]',
  );
  if (!button) throw new Error("FAB trigger not found");
  return button;
}

/** Radix DropdownMenuTrigger toggles on pointerdown (button 0, no ctrl). */
async function openMenu(container: HTMLDivElement): Promise<void> {
  await act(async () => {
    trigger(container).dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
  });
}

function menuItem(label: string): HTMLElement {
  const items = Array.from(
    document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  );
  const match = items.find((item) => item.textContent?.includes(label));
  if (!match) {
    throw new Error(
      `menu item "${label}" not found; menu has: ${items
        .map((item) => item.textContent)
        .join(", ")}`,
    );
  }
  return match;
}

async function clickMenuItem(label: string): Promise<void> {
  await act(async () => {
    menuItem(label).click();
  });
}

describe("ChatQuickActionsFab (task #18)", () => {
  it("Test 1: flat circular trigger — bright surface, hairline border, NO shadow utility (design law)", async () => {
    const container = await mount(
      <ChatQuickActionsFab
        selectedConversation={SELECTED}
        onNewChat={vi.fn()}
        onOpenConversation={vi.fn()}
        modelSettings={{ mode: "standard", effort: "medium" }}
        onSetMode={vi.fn()}
        onSetEffort={vi.fn()}
      />,
    );

    const className = trigger(container).className;
    expect(className).toContain("rounded-full");
    expect(className).toContain("bg-bright");
    expect(className).toContain("border-rule");
    expect(className).toContain("size-11");
    expect(
      className,
      "the FAB grew a drop shadow — the identity is flat surfaces + hairline " +
        "rules, zero shadow anywhere (do not copy jump-to-bottom-button's shadow-md)",
    ).not.toMatch(/\bshadow-/);
  });

  it("Test 1b: positioning clears the composer dock when a conversation is open, sits at bottom-4 on the empty state", async () => {
    // Empty state (no conversation → no composer) — bottom-4 is fine.
    const empty = await mount(
      <ChatQuickActionsFab
        selectedConversation={null}
        onNewChat={vi.fn()}
        onOpenConversation={vi.fn()}
        modelSettings={{ mode: "standard", effort: "medium" }}
        onSetMode={vi.fn()}
        onSetEffort={vi.fn()}
      />,
    );
    const emptyWrapper = trigger(empty).parentElement!;
    expect(emptyWrapper.className).toContain("bottom-4");
    expect(emptyWrapper.className).not.toContain("bottom-24");

    // Conversation open → a composer dock owns the column's bottom edge, so the
    // FAB must lift clear of it ("CHAT BUTTONS ARE OVERLAPPING").
    const open = await mount(
      <ChatQuickActionsFab
        selectedConversation={SELECTED}
        onNewChat={vi.fn()}
        onOpenConversation={vi.fn()}
        modelSettings={{ mode: "standard", effort: "medium" }}
        onSetMode={vi.fn()}
        onSetEffort={vi.fn()}
      />,
    );
    const openWrapper = trigger(open).parentElement!;
    expect(
      openWrapper.className,
      "the FAB must clear the composer dock when a conversation is open",
    ).toContain("bottom-24");
  });

  it("Test 2a: all four actions render; conversation-scoped items are DISABLED with no conversation", async () => {
    const container = await mount(
      <ChatQuickActionsFab
        selectedConversation={null}
        onNewChat={vi.fn()}
        onOpenConversation={vi.fn()}
        modelSettings={{ mode: "standard", effort: "medium" }}
        onSetMode={vi.fn()}
        onSetEffort={vi.fn()}
      />,
    );
    await openMenu(container);

    expect(menuItem("New chat").getAttribute("data-disabled")).toBeNull();
    for (const label of ["Model…", "Rename…", "Duplicate"]) {
      expect(
        menuItem(label).getAttribute("aria-disabled"),
        `"${label}" must be disabled while selectedConversation is null`,
      ).toBe("true");
    }
  });

  it("Test 2b: conversation-scoped items are ENABLED with a conversation open", async () => {
    const container = await mount(
      <ChatQuickActionsFab
        selectedConversation={SELECTED}
        onNewChat={vi.fn()}
        onOpenConversation={vi.fn()}
        modelSettings={{ mode: "standard", effort: "medium" }}
        onSetMode={vi.fn()}
        onSetEffort={vi.fn()}
      />,
    );
    await openMenu(container);

    for (const label of ["New chat", "Model…", "Rename…", "Duplicate"]) {
      expect(menuItem(label).getAttribute("aria-disabled")).toBeNull();
    }
  });

  it("Test 3: New chat routes to onNewChat (ChatPage's existing handleNewChat)", async () => {
    const onNewChat = vi.fn();
    const container = await mount(
      <ChatQuickActionsFab
        selectedConversation={null}
        onNewChat={onNewChat}
        onOpenConversation={vi.fn()}
        modelSettings={{ mode: "standard", effort: "medium" }}
        onSetMode={vi.fn()}
        onSetEffort={vi.fn()}
      />,
    );
    await openMenu(container);
    await clickMenuItem("New chat");

    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it("Test 4: Duplicate mutates with the open conversation's id; onSuccess invalidates the rail and opens the copy", async () => {
    const onOpenConversation = vi.fn();
    const container = await mount(
      <ChatQuickActionsFab
        selectedConversation={SELECTED}
        onNewChat={vi.fn()}
        onOpenConversation={onOpenConversation}
        modelSettings={{ mode: "standard", effort: "medium" }}
        onSetMode={vi.fn()}
        onSetEffort={vi.fn()}
      />,
    );
    await openMenu(container);
    await clickMenuItem("Duplicate");

    expect(duplicateMutate).toHaveBeenCalledWith({ id: CONV_ID });

    // Drive the captured onSuccess exactly as tRPC would.
    await act(async () => {
      await duplicateOptions.onSuccess?.({ id: NEW_ID });
    });
    expect(listConversationsInvalidate).toHaveBeenCalled();
    expect(onOpenConversation).toHaveBeenCalledWith(NEW_ID);
  });

  it("Test 5: Rename… opens a dialog pre-seeded with the current title; submit mutates with the trimmed title", async () => {
    const container = await mount(
      <ChatQuickActionsFab
        selectedConversation={SELECTED}
        onNewChat={vi.fn()}
        onOpenConversation={vi.fn()}
        modelSettings={{ mode: "standard", effort: "medium" }}
        onSetMode={vi.fn()}
        onSetEffort={vi.fn()}
      />,
    );
    await openMenu(container);
    await clickMenuItem("Rename…");

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const input = dialog!.querySelector<HTMLInputElement>(
      'input[aria-label="Conversation title"]',
    );
    expect(input).not.toBeNull();
    expect(input!.value).toBe(SELECTED.title);

    // React 19 controlled input: set via the native setter + input event.
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      nativeSetter?.call(input, "  Renamed title  ");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = dialog!.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => {
      form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(renameMutate).toHaveBeenCalledWith({
      id: CONV_ID,
      title: "Renamed title",
    });
    // The dialog closes on submit.
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    void renameOptions;
  });

  it("Test 6: Model… opens a dialog hosting the shared ModelPickerPanel (cmdk search input present)", async () => {
    const container = await mount(
      <ChatQuickActionsFab
        selectedConversation={SELECTED}
        onNewChat={vi.fn()}
        onOpenConversation={vi.fn()}
        modelSettings={{ mode: "standard", effort: "medium" }}
        onSetMode={vi.fn()}
        onSetEffort={vi.fn()}
      />,
    );
    await openMenu(container);
    await clickMenuItem("Model…");

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(
      dialog!.querySelector('input[placeholder="Search models…"]'),
      "the Model… dialog must host the SAME ModelPickerPanel as the header trigger",
    ).not.toBeNull();
  });

  it("Test 7: Model mode + Effort submenu triggers render and follow the conversation-scoped disable rule", async () => {
    // Empty state — both dials are conversation-scoped, so disabled with no
    // conversation (same rule as Model…/Rename…/Duplicate).
    const empty = await mount(
      <ChatQuickActionsFab
        selectedConversation={null}
        onNewChat={vi.fn()}
        onOpenConversation={vi.fn()}
        modelSettings={{ mode: "standard", effort: "medium" }}
        onSetMode={vi.fn()}
        onSetEffort={vi.fn()}
      />,
    );
    await openMenu(empty);
    for (const label of ["Model mode", "Effort"]) {
      expect(
        menuItem(label).getAttribute("aria-disabled"),
        `"${label}" must be disabled while selectedConversation is null`,
      ).toBe("true");
    }
    await act(async () => {
      roots.pop()!.unmount();
    });
    containers.pop()!.remove();
    document.body
      .querySelectorAll('[role="menu"], [data-radix-portal]')
      .forEach((node) => node.remove());

    // Conversation open — both dials become reachable.
    const open = await mount(
      <ChatQuickActionsFab
        selectedConversation={SELECTED}
        onNewChat={vi.fn()}
        onOpenConversation={vi.fn()}
        modelSettings={{ mode: "standard", effort: "medium" }}
        onSetMode={vi.fn()}
        onSetEffort={vi.fn()}
      />,
    );
    await openMenu(open);
    for (const label of ["Model mode", "Effort"]) {
      expect(
        menuItem(label).getAttribute("aria-disabled"),
        `"${label}" must be enabled while a conversation is open`,
      ).toBeNull();
    }
  });
});
