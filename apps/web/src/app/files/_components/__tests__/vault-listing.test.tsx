/**
 * vault-listing.test.tsx — THE CLICK-ECONOMY GATE (Phase 66 Plan 03 Task 3,
 * D-66-10).
 *
 * This file is the user's directive — *"minimize clicks"* — as tests rather
 * than as an aspiration. Each assertion below is a row of D-66-10's budget
 * table. If a design change costs a click, one of these must change, and the
 * SUMMARY has to say so.
 *
 * Harness: jsdom + createRoot + `act` from "react" — this app's real
 * convention. See vault-states.test.tsx's header on why not RTL.
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

// ---------------------------------------------------------------------------
// Fixture — 2 folders then 3 files, in the order the SERVER sorted them
// ---------------------------------------------------------------------------

const folder = (name: string): VaultEntry => ({
  name,
  kind: "folder",
  isFolder: true,
  size: null,
  updatedAt: null,
  contentType: null,
});

const file = (name: string, kind: VaultEntry["kind"] = "text"): VaultEntry => ({
  name,
  kind,
  isFolder: false,
  size: 1536,
  updatedAt: "2026-07-12T10:00:00Z",
  contentType: "text/plain",
});

const ENTRIES: VaultEntry[] = [
  folder("archive"),
  folder("photos"),
  file("notes.txt"),
  file("report.pdf"),
  file("cat.png", "image"),
];

type Handlers = {
  onOpenFolder: ReturnType<typeof vi.fn>;
  onDownload: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
};

function renderListing(entries: VaultEntry[] = ENTRIES): Handlers {
  const handlers: Handlers = {
    onOpenFolder: vi.fn(),
    onDownload: vi.fn(),
    onDelete: vi.fn(),
  };
  mount(<VaultListing entries={entries} {...handlers} />);
  return handlers;
}

/** The primary button of each row — the row body itself. */
const rowButtons = () =>
  Array.from(
    container.querySelectorAll<HTMLButtonElement>("[data-slot='vault-row-primary']"),
  );

const list = () => container.querySelector<HTMLElement>("[data-slot='vault-listing']")!;

function press(key: string) {
  act(() => {
    list().dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

// ---------------------------------------------------------------------------

describe("the server's order is preserved", () => {
  it("renders folders before files, exactly as handed over", () => {
    renderListing();

    // The server already sorted (storage-adapter.ts: folders first, then
    // name). Asserting the order is PRESERVED — not re-derived — is what stops
    // a client-side re-sort silently disagreeing with the registry rhythm the
    // server decided.
    expect(rowButtons().map((b) => b.textContent)).toEqual([
      expect.stringContaining("archive"),
      expect.stringContaining("photos"),
      expect.stringContaining("notes.txt"),
      expect.stringContaining("report.pdf"),
      expect.stringContaining("cat.png"),
    ]);
  });
});

describe("scan the vault: ZERO clicks", () => {
  it("ArrowDown moves focus down the rows", () => {
    renderListing();

    press("ArrowDown");
    press("ArrowDown");
    expect(document.activeElement).toBe(rowButtons()[2]);

    press("ArrowUp");
    expect(document.activeElement).toBe(rowButtons()[1]);
  });

  it("Home and End reach the ends", () => {
    renderListing();

    press("End");
    expect(document.activeElement).toBe(rowButtons()[4]);

    press("Home");
    expect(document.activeElement).toBe(rowButtons()[0]);
  });

  it("does NOT wrap at either end", () => {
    renderListing();

    // Wrapping in a file list teleports the user from the bottom to the top,
    // which reads as a bug rather than a feature. Clamp, don't cycle.
    press("End");
    press("ArrowDown");
    expect(document.activeElement).toBe(rowButtons()[4]);

    press("Home");
    press("ArrowUp");
    expect(document.activeElement).toBe(rowButtons()[0]);
  });

  it("keeps exactly ONE row in the tab order (roving tabindex)", () => {
    renderListing();

    const tabbable = () => rowButtons().filter((b) => b.tabIndex === 0);

    expect(tabbable()).toHaveLength(1);
    expect(tabbable()[0]).toBe(rowButtons()[0]);

    // And after moving — a broken roving implementation puts all 500 files in
    // the tab order, which is the exact accessibility failure this pattern
    // exists to prevent.
    press("ArrowDown");
    expect(tabbable()).toHaveLength(1);
    expect(tabbable()[0]).toBe(rowButtons()[1]);
  });

  it("resets focus to the first row when the folder's contents change", () => {
    renderListing();
    press("End");
    expect(document.activeElement).toBe(rowButtons()[4]);

    // Walking into a folder with 2 rows must not leave focus pointing at row 5.
    mount(
      <VaultListing
        entries={[folder("only"), file("one.txt")]}
        onOpenFolder={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(rowButtons().filter((b) => b.tabIndex === 0)).toHaveLength(1);
    expect(rowButtons()[0]?.tabIndex).toBe(0);
  });
});

describe("act on a file: ONE keystroke", () => {
  it("Enter on a folder row opens it", () => {
    const h = renderListing();

    press("ArrowDown"); // -> photos (folder)
    press("Enter");

    expect(h.onOpenFolder).toHaveBeenCalledWith("photos");
    expect(h.onDownload).not.toHaveBeenCalled();
  });

  it("Enter on a file row downloads it", () => {
    const h = renderListing();

    press("End"); // -> cat.png (file)
    press("Enter");

    expect(h.onDownload).toHaveBeenCalledWith(
      expect.objectContaining({ name: "cat.png" }),
    );
    expect(h.onOpenFolder).not.toHaveBeenCalled();
  });

  it("Delete on the focused row asks to delete it", () => {
    const h = renderListing();

    press("ArrowDown");
    press("Delete");

    expect(h.onDelete).toHaveBeenCalledWith(
      expect.objectContaining({ name: "photos" }),
    );
  });
});

describe("act on a file: ONE click, and no menu in between", () => {
  it("clicking a folder row's body opens it", () => {
    const h = renderListing();

    act(() => rowButtons()[0]?.click());

    expect(h.onOpenFolder).toHaveBeenCalledWith("archive");
    // THE BUDGET: no menu opened in between. A "…" -> "Open" two-step is what
    // this assertion exists to forbid.
    expect(container.querySelector("[role='menu']")).toBeNull();
  });

  it("clicking a file row's body downloads it", () => {
    const h = renderListing();

    act(() => rowButtons()[2]?.click());

    expect(h.onDownload).toHaveBeenCalledWith(
      expect.objectContaining({ name: "notes.txt" }),
    );
    expect(container.querySelector("[role='menu']")).toBeNull();
  });
});

describe("secondary actions are reachable — never hover-only", () => {
  it("the delete trigger is ALWAYS in the DOM and always named", () => {
    renderListing();

    // Taste item 5: hover-revealed, never hover-only. Concealment is opacity,
    // never `hidden` and never conditional rendering — both of which put the
    // control out of reach of a keyboard AND a screen reader, on a touch
    // device where there is no hover at all.
    const triggers = container.querySelectorAll("[data-slot='vault-row-delete']");
    expect(triggers).toHaveLength(ENTRIES.length);

    for (const trigger of Array.from(triggers)) {
      expect(trigger.getAttribute("aria-label")).toMatch(/Delete/i);
    }
  });

  it("the delete trigger is keyboard-reachable from its row", () => {
    renderListing();

    const trigger = container.querySelectorAll<HTMLButtonElement>(
      "[data-slot='vault-row-delete']",
    )[0]!;

    // A real tab stop: present, not the `hidden` ATTRIBUTE, not tabindex=-1.
    expect(trigger.hasAttribute("hidden")).toBe(false);
    expect(trigger.tabIndex).toBeGreaterThanOrEqual(0);

    // ── AND THE HOLE THIS TEST CANNOT SEE, CLOSED AS FAR AS IT CAN BE ──
    // Concealment via the `hidden` CLASS (or any `display:none`) would leave
    // every assertion above green: jsdom loads no stylesheet and does no
    // layout, so it cannot know the element is not rendered. This suite is
    // therefore blind to exactly the regression the surrounding tests claim to
    // prevent — the standing rendered-geometry blind spot in this repo, where
    // class-string gates have repeatedly reported safety on dead styles.
    //
    // A class check is a weaker instrument than a rendered one and is not
    // pretending otherwise. It is here because it is the strongest thing
    // available in jsdom, and because the concealment mechanism on this row is
    // a FIXED, deliberate choice (opacity + group-hover/group-focus-within):
    // anything reaching for `hidden` is a regression by definition.
    const className = trigger.getAttribute("class") ?? "";
    expect(className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(className).toMatch(/group-focus-within:opacity-100/);
  });

  it("the delete trigger fires with its own row's entry", () => {
    const h = renderListing();

    const trigger = container.querySelectorAll<HTMLButtonElement>(
      "[data-slot='vault-row-delete']",
    )[2]!;
    act(() => trigger.click());

    expect(h.onDelete).toHaveBeenCalledWith(
      expect.objectContaining({ name: "notes.txt" }),
    );
  });

  it("declares its shortcut where the user can see it", () => {
    renderListing();

    // Taste item 3: a shortcut nobody is told about teaches that shortcuts
    // don't exist.
    const trigger = container.querySelector("[data-slot='vault-row-delete']");
    expect(trigger?.getAttribute("aria-keyshortcuts")).toBe("Delete");
  });
});

describe("nothing on this surface is a nameless glyph", () => {
  it("every button has an accessible name (anti-generic tell #4)", () => {
    renderListing();

    for (const button of Array.from(container.querySelectorAll("button"))) {
      const name =
        button.getAttribute("aria-label")?.trim() ?? button.textContent?.trim() ?? "";
      expect(name.length, `a button rendered with no accessible name`).toBeGreaterThan(0);
    }
  });

  it("kind glyphs carry no hue — kind is geometry (law 3)", () => {
    renderListing();

    const classes = Array.from(container.querySelectorAll("svg"))
      .map((s) => s.getAttribute("class") ?? "")
      .join(" ");

    // Colour-coded file types is anti-generic tell #2. Every glyph is faded.
    expect(classes).not.toMatch(/text-(conf|sugg|bad)\b/);
    expect(classes).toMatch(/text-faded/);
  });
});
