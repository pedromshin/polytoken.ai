/**
 * vault-states.test.tsx — the SURF-06 bar for /files (Phase 66 Plan 03 Task 3,
 * FVLT-04).
 *
 * TEST HARNESS NOTE — read before "fixing" the imports:
 * this suite uses jsdom + `createRoot` + `act` from "react", which IS this
 * app's convention (`genui-panel-node-toolbar.test.tsx`,
 * `panel-data-flow.test.tsx`, `markdown-renderer.test.tsx`, and ~20 others).
 * `@testing-library/react` is NOT a dependency of this repo and is not
 * resolvable — `markdown-renderer.test.tsx`'s own header says so in as many
 * words: "no @testing-library/react needed — matches packages/genui's existing
 * test convention". The 66-03 plan called for RTL + user-event; that was a
 * mistake in the plan, and adding the dep is orchestrator-reserved
 * (package.json/lockfile changes, LANE-CONTRACTS). Every assertion the plan
 * asked for is here, expressed against the real DOM.
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VaultEmpty, VaultError, VaultLoading } from "../vault-states";

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

const buttons = () => Array.from(container.querySelectorAll("button"));
const text = () => container.textContent ?? "";

/** Every class on the subtree, so a law assertion can scan all of it at once. */
function allClassNames(el: HTMLElement): string {
  return Array.from(el.querySelectorAll("*"))
    .map((node) => node.getAttribute("class") ?? "")
    .concat(el.getAttribute("class") ?? "")
    .join(" ");
}

describe("VaultEmpty", () => {
  it("teaches the drop gesture with the exact copy", () => {
    mount(<VaultEmpty atRoot onUpload={() => undefined} />);

    // D-66-11's copy, verbatim. The empty state IS the onboarding: it teaches
    // the gesture the user will use forever, which is why it says "anywhere"
    // rather than naming a button.
    expect(text()).toContain("Drop a file anywhere to start your vault");
  });

  it("has EXACTLY ONE prominent control", () => {
    mount(<VaultEmpty atRoot onUpload={() => undefined} />);

    // Taste item 8: "the empty state teaches by making the next action the
    // only prominent control". That only holds if nothing competes with it —
    // so this is a count, not a presence check.
    expect(buttons()).toHaveLength(1);
    expect(buttons()[0]?.textContent).toContain("Upload files");
  });

  it("fires onUpload from its one control", () => {
    const onUpload = vi.fn();
    mount(<VaultEmpty atRoot onUpload={onUpload} />);

    act(() => {
      buttons()[0]?.click();
    });

    expect(onUpload).toHaveBeenCalledTimes(1);
  });

  it("says something different inside a folder", () => {
    mount(<VaultEmpty atRoot={false} onUpload={() => undefined} />);

    expect(text()).toContain("This folder is empty. Drop a file anywhere to fill it.");
  });

  it("is not a card floating in dead space (anti-generic tell #1)", () => {
    mount(<VaultEmpty atRoot onUpload={() => undefined} />);

    // Our elevation is the ground ladder, never a shadow. The pane it sits in
    // IS already the sheet — wrapping this in a second bordered card would be
    // the default-shadcn empty silhouette.
    //
    // THE REGEX IS THIS SHAPE ON PURPOSE. The first draft was `/shadow-/`,
    // which passed while the button carried a real drop shadow: the kit's
    // default Button variant ships a BARE `shadow` class (button.tsx), and
    // `/shadow-/` sails straight past it. A gate reading the right file and
    // asking the wrong question is worse than no gate — it reports safety.
    // So: ban bare `shadow`, ban every `shadow-*` EXCEPT `shadow-none`, which
    // is the thing that removes one.
    const classes = allClassNames(container);
    expect(classes).not.toMatch(/(^|\s)shadow(\s|$)/);
    expect(classes).not.toMatch(/(^|\s)shadow-(?!none)/);
    expect(classes).not.toMatch(/\bborder-rule\b/);
  });
});

describe("VaultLoading", () => {
  it("renders skeleton ROWS, not a spinner", () => {
    mount(<VaultLoading />);

    // Skeleton rows at row geometry, so content does not jump when it lands.
    // A spinner here would say "something is happening"; skeleton rows say
    // "a list is about to be here", which is the true statement.
    const skeletons = container.querySelectorAll("[data-slot='vault-skeleton-row']");
    expect(skeletons.length).toBeGreaterThanOrEqual(3);
  });

  it("announces itself to a screen reader without shouting", () => {
    mount(<VaultLoading />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
  });
});

describe("VaultError", () => {
  it("is announced, and says exactly what happened", () => {
    mount(<VaultError onRetry={() => undefined} />);

    const alert = container.querySelector("[role='alert']");
    expect(alert).not.toBeNull();
    // Errors don't apologize and are never vague (frontend-design). This one
    // names the thing that failed and offers the way out.
    expect(text()).toContain("Couldn't load this folder.");
  });

  it("offers a retry that works", () => {
    const onRetry = vi.fn();
    mount(<VaultError onRetry={onRetry} />);

    const retry = buttons().find((b) => b.textContent?.includes("Try again"));
    expect(retry).toBeDefined();

    act(() => retry?.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("THE LAW: an error wears NO madder — it is a status, not an irreversible act", () => {
    mount(<VaultError onRetry={() => undefined} />);

    // D-58-01 law 1: madder means "irreversible — this cannot be undone".
    // "Never errors, never warnings." The madder budget on this whole surface
    // is ONE control: delete-dialog.tsx's confirm button.
    //
    // This is the single most natural mistake anyone will make here — a failed
    // load FEELS red — so it is asserted on the rendered container AND every
    // descendant's className, not merely on the source.
    const classes = allClassNames(container);
    expect(classes).not.toMatch(/destructive/);
    expect(classes).not.toMatch(/\bbg-bad\b|\btext-bad\b|\bborder-bad\b/);

    // And the glyph carries the role instead — assert it EXISTS, so "no hue"
    // was not achieved by simply saying less.
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
