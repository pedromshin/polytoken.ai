/**
 * vault-drive-ops.test.tsx — DR-01 multi-select + row menu, as behaviour
 * (jsdom, this app's createRoot + `act` convention — see vault-listing.test's
 * header on why not RTL).
 *
 * jsdom does NO layout, so this proves BEHAVIOUR only — which rows the range
 * arithmetic selects, and which callback each menu item fires. It makes no
 * visual claim; the selected-row fill and the menu's chrome are a screenshot
 * gate's job, not this one's.
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VaultEntry } from "../../../../../../../packages/api-client/src/router/files/vault-types";
import { VaultListing } from "../vault-listing";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(element: React.ReactElement) {
  act(() => root.render(element));
}

const folder = (name: string): VaultEntry => ({
  name,
  kind: "folder",
  isFolder: true,
  size: null,
  updatedAt: null,
  contentType: null,
});
const file = (name: string): VaultEntry => ({
  name,
  kind: "text",
  isFolder: false,
  size: 100,
  updatedAt: "2026-07-12T10:00:00Z",
  contentType: "text/plain",
});

// 0:archive 1:photos 2:notes.txt 3:report.pdf 4:cat.png
const ENTRIES: VaultEntry[] = [
  folder("archive"),
  folder("photos"),
  file("notes.txt"),
  file("report.pdf"),
  file("cat.png"),
];

const rowButtons = () =>
  Array.from(
    container.querySelectorAll<HTMLButtonElement>("[data-slot='vault-row-primary']"),
  );

function clickRow(index: number, mods: { shift?: boolean; meta?: boolean } = {}) {
  act(() => {
    rowButtons()[index]?.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        shiftKey: mods.shift ?? false,
        metaKey: mods.meta ?? false,
      }),
    );
  });
}

// ---------------------------------------------------------------------------
// DR-01 — range multi-select
// ---------------------------------------------------------------------------

describe("multi-select is modifier-click, plain click still opens", () => {
  it("a PLAIN click activates and does NOT select", () => {
    const onOpenFolder = vi.fn();
    const onSelectionChange = vi.fn();
    mount(
      <VaultListing
        entries={ENTRIES}
        onOpenFolder={onOpenFolder}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
        onSelectionChange={onSelectionChange}
      />,
    );

    clickRow(0); // archive, no modifier
    expect(onOpenFolder).toHaveBeenCalledWith("archive");
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("cmd/ctrl-click TOGGLES a single row into the selection", () => {
    const onSelectionChange = vi.fn();
    const onDownload = vi.fn();
    mount(
      <VaultListing
        entries={ENTRIES}
        onOpenFolder={vi.fn()}
        onDownload={onDownload}
        onDelete={vi.fn()}
        onSelectionChange={onSelectionChange}
      />,
    );

    clickRow(2, { meta: true }); // notes.txt
    expect(onDownload).not.toHaveBeenCalled(); // a select is not an open
    expect(onSelectionChange).toHaveBeenLastCalledWith(["notes.txt"]);

    clickRow(2, { meta: true }); // toggle off
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it("shift-click selects the CONTIGUOUS range from the anchor", () => {
    const onSelectionChange = vi.fn();
    mount(
      <VaultListing
        entries={ENTRIES}
        onOpenFolder={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
        onSelectionChange={onSelectionChange}
      />,
    );

    clickRow(1, { meta: true }); // anchor at photos (index 1)
    clickRow(3, { shift: true }); // extend to report.pdf (index 3)

    // photos, notes.txt, report.pdf — the run 1..3 inclusive.
    const last = onSelectionChange.mock.calls.at(-1)?.[0] as string[];
    expect([...last].sort()).toEqual(["notes.txt", "photos", "report.pdf"].sort());
  });

  it("a selectionResetKey change clears the selection", () => {
    const onSelectionChange = vi.fn();
    const base = {
      entries: ENTRIES,
      onOpenFolder: vi.fn(),
      onDownload: vi.fn(),
      onDelete: vi.fn(),
      onSelectionChange,
    };
    mount(<VaultListing {...base} selectionResetKey="a" />);
    clickRow(2, { meta: true });
    expect(rowButtons()[2]?.getAttribute("aria-selected")).toBe("true");

    // Bumping the key (a bulk action landed / folder changed) drops selection.
    mount(<VaultListing {...base} selectionResetKey="b" />);
    expect(rowButtons()[2]?.getAttribute("aria-selected")).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// DR-01/02 — the right-click row menu
// ---------------------------------------------------------------------------

describe("the row context menu (DR-01/02)", () => {
  function mountWithMenu(overrides: Partial<React.ComponentProps<typeof VaultListing>> = {}) {
    const handlers = {
      onRename: vi.fn(),
      onMove: vi.fn(),
      onShowVersions: vi.fn(),
      onDelete: vi.fn(),
    };
    mount(
      <VaultListing
        entries={ENTRIES}
        onOpenFolder={vi.fn()}
        onDownload={vi.fn()}
        onSelectionChange={vi.fn()}
        {...handlers}
        {...overrides}
      />,
    );
    return handlers;
  }

  function openMenuOn(index: number) {
    act(() => {
      rowButtons()[index]?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    });
  }

  it("right-click a FILE row exposes rename, move, version history, delete", () => {
    mountWithMenu();
    openMenuOn(2); // notes.txt (a file)

    // Radix portals the menu to document.body.
    expect(document.querySelector("[data-slot='menu-rename']")).not.toBeNull();
    expect(document.querySelector("[data-slot='menu-move']")).not.toBeNull();
    expect(document.querySelector("[data-slot='menu-versions']")).not.toBeNull();
    expect(document.querySelector("[data-slot='menu-delete']")).not.toBeNull();
  });

  it("a FOLDER row offers no version history — folders have no versions", () => {
    mountWithMenu();
    openMenuOn(0); // archive (a folder)

    expect(document.querySelector("[data-slot='menu-versions']")).toBeNull();
    expect(document.querySelector("[data-slot='menu-rename']")).not.toBeNull();
  });

  it("each item fires its callback with the row's own entry", () => {
    const handlers = mountWithMenu();
    openMenuOn(3); // report.pdf

    act(() => {
      document.querySelector<HTMLElement>("[data-slot='menu-rename']")?.click();
    });
    expect(handlers.onRename).toHaveBeenCalledWith(
      expect.objectContaining({ name: "report.pdf" }),
    );

    openMenuOn(3);
    act(() => {
      document.querySelector<HTMLElement>("[data-slot='menu-move']")?.click();
    });
    expect(handlers.onMove).toHaveBeenCalledWith(
      expect.objectContaining({ name: "report.pdf" }),
    );
  });
});
