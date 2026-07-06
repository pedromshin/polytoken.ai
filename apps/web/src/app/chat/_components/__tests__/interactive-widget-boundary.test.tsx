/**
 * interactive-widget-boundary.test.tsx — InteractiveWidgetBoundary unit tests
 * (Task 2, 24-03, D-05/D-06/D-10/D-11/D-12).
 *
 * Mounts the REAL SpecRenderer path (via GenuiPartBoundary, no mocks) —
 * mirrors button-action.test.tsx's createRoot-in-jsdom + `act` convention.
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  InteractiveWidgetBoundary,
  type InteractiveWidgetPart,
} from "../interactive-widget-boundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PART: InteractiveWidgetPart = {
  type: "interactive_widget",
  interactionId: "11111111-1111-1111-1111-111111111111",
  widgetKind: "proposal_cards",
  declaration: {
    prompt: "Which plan?",
    options: [
      { id: "opt-0", title: "Ship next week", description: "Fast" },
      { id: "opt-1", title: "Ship next month" },
    ],
  },
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

describe("InteractiveWidgetBoundary", () => {
  beforeEach(() => {
    containers = [];
  });

  afterEach(() => {
    for (const c of containers) {
      document.body.removeChild(c);
    }
    containers = [];
  });

  it("pending: renders the live spec with no status badge, and clicking a card fires onSubmitResult with the option id", async () => {
    const onSubmitResult = vi.fn();
    const container = await mount(
      <InteractiveWidgetBoundary
        part={PART}
        displayState="pending"
        onSubmitResult={onSubmitResult}
      />,
    );

    expect(container.textContent).not.toContain("Selected");
    expect(container.textContent).not.toContain("Superseded");
    expect(container.textContent).not.toContain("Stale");

    const button = container.querySelector(
      '[aria-label="Choose this option — Ship next week"]',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();

    await act(async () => {
      button!.click();
    });

    expect(onSubmitResult).toHaveBeenCalledTimes(1);
    expect(onSubmitResult).toHaveBeenCalledWith({ optionId: "opt-0" });
  });

  it("submitting: group carries pointer-events-none and shows the 'Submitting…' row; clicking does NOT fire onSubmitResult (noop registry)", async () => {
    const onSubmitResult = vi.fn();
    const container = await mount(
      <InteractiveWidgetBoundary
        part={PART}
        displayState="submitting"
        onSubmitResult={onSubmitResult}
      />,
    );

    expect(container.textContent).toContain("Submitting…");
    expect(container.querySelector(".pointer-events-none")).not.toBeNull();

    const button = container.querySelector(
      '[aria-label="Choose this option — Ship next week"]',
    ) as HTMLButtonElement | null;
    if (button) {
      await act(async () => {
        button.click();
      });
    }
    expect(onSubmitResult).not.toHaveBeenCalled();
  });

  it("submitted: chosen card gets the Selected badge, others render dimmed with no button; clicking anything does NOT fire onSubmitResult", async () => {
    const onSubmitResult = vi.fn();
    const container = await mount(
      <InteractiveWidgetBoundary
        part={PART}
        displayState="submitted"
        submittedValue={{ optionId: "opt-0" }}
        onSubmitResult={onSubmitResult}
      />,
    );

    expect(container.textContent).toContain("Selected");
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelectorAll('[aria-disabled="true"]').length).toBeGreaterThan(0);
    expect(onSubmitResult).not.toHaveBeenCalled();
  });

  // 24-05 fix pass (24-UI-REVIEW.md Top Fix #2): the submitted (locked) card shell
  // must match the live catalog Card's chrome (rounded-xl/border/shadow/p-6) instead
  // of a hand-rolled border-less rounded-lg/p-4 div — no visible container downgrade
  // at the exact moment a choice locks in.
  it("submitted: card shells match the live Card's chrome (rounded-xl/border/shadow/p-6)", async () => {
    const container = await mount(
      <InteractiveWidgetBoundary
        part={PART}
        displayState="submitted"
        submittedValue={{ optionId: "opt-0" }}
        onSubmitResult={vi.fn()}
      />,
    );

    const shells = container.querySelectorAll(".rounded-xl");
    expect(shells.length).toBe(2); // chosen + the one dimmed sibling in PART.options
    for (const shell of Array.from(shells)) {
      expect(shell.className).toContain("border");
      expect(shell.className).toContain("shadow");
      expect(shell.className).toContain("p-6");
    }
  });

  it("superseded: shows the Superseded badge + caption, dims the group, and never fires onSubmitResult", async () => {
    const onSubmitResult = vi.fn();
    const container = await mount(
      <InteractiveWidgetBoundary
        part={PART}
        displayState="superseded"
        onSubmitResult={onSubmitResult}
      />,
    );

    expect(container.textContent).toContain("Superseded");
    expect(container.textContent).toContain("You replied by typing instead.");
    expect(container.querySelector('[aria-disabled="true"]')).not.toBeNull();

    const button = container.querySelector(
      '[aria-label="Choose this option — Ship next week"]',
    ) as HTMLButtonElement | null;
    if (button) {
      await act(async () => {
        button.click();
      });
    }
    expect(onSubmitResult).not.toHaveBeenCalled();
  });

  it("stale: shows the Stale badge + caption, dims the group, and never fires onSubmitResult", async () => {
    const onSubmitResult = vi.fn();
    const container = await mount(
      <InteractiveWidgetBoundary
        part={PART}
        displayState="stale"
        onSubmitResult={onSubmitResult}
      />,
    );

    expect(container.textContent).toContain("Stale");
    expect(container.textContent).toContain("This is no longer the active response.");

    const button = container.querySelector(
      '[aria-label="Choose this option — Ship next week"]',
    ) as HTMLButtonElement | null;
    if (button) {
      await act(async () => {
        button.click();
      });
    }
    expect(onSubmitResult).not.toHaveBeenCalled();
  });

  it("renders the unboxed error row (no border/background) when errorMessage is set, and re-enables the live spec", async () => {
    const onSubmitResult = vi.fn();
    const container = await mount(
      <InteractiveWidgetBoundary
        part={PART}
        displayState="pending"
        errorMessage="This response couldn't be saved. Please try again."
        onSubmitResult={onSubmitResult}
      />,
    );

    expect(container.textContent).toContain(
      "This response couldn't be saved. Please try again.",
    );
    const errorRow = container.querySelector('[role="alert"]');
    expect(errorRow).not.toBeNull();
    expect(errorRow?.className ?? "").not.toContain("border");

    const button = container.querySelector(
      '[aria-label="Choose this option — Ship next week"]',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    await act(async () => {
      button!.click();
    });
    expect(onSubmitResult).toHaveBeenCalledWith({ optionId: "opt-0" });
  });

  it("passes variant='bare' through to the underlying GenuiPartBoundary (no GenuiCard wrapper)", async () => {
    const container = await mount(
      <InteractiveWidgetBoundary
        part={PART}
        displayState="pending"
        onSubmitResult={vi.fn()}
        variant="bare"
      />,
    );
    expect(container.querySelector(".border-border")).toBeNull();
  });

  // 24-05 fix pass (24-UI-REVIEW.md Top Fix #1): clarify_widget's own Phase-19
  // "Submitted ✓" affordance must never co-render with the boundary's own
  // "Submitting…" row, and must not reappear next to a re-enabled (422 retry) form.
  describe("clarify_widget copy-collision (24-05, 24-UI-REVIEW Top Fix #1)", () => {
    const CLARIFY_PART: InteractiveWidgetPart = {
      type: "interactive_widget",
      interactionId: "22222222-2222-2222-2222-222222222222",
      widgetKind: "clarify_widget",
      declaration: {
        submitLabel: "Send response",
        fields: [{ name: "note", label: "Note" }],
      },
    };

    it("pending -> submitting: FormComponent's own 'Submitted ✓' never co-renders with 'Submitting…'", async () => {
      const onSubmitResult = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      containers.push(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(
          <InteractiveWidgetBoundary
            part={CLARIFY_PART}
            displayState="pending"
            onSubmitResult={onSubmitResult}
          />,
        );
      });

      const form = container.querySelector("form") as HTMLFormElement;
      await act(async () => {
        form.requestSubmit();
      });
      expect(onSubmitResult).toHaveBeenCalledTimes(1);

      // Parent transitions to "submitting" — SAME tree position/instance, so
      // FormComponent's own local `submitted` state (set true by the click above)
      // would otherwise survive this re-render (the reproducible bug).
      await act(async () => {
        root.render(
          <InteractiveWidgetBoundary
            part={CLARIFY_PART}
            displayState="submitting"
            onSubmitResult={onSubmitResult}
          />,
        );
      });

      expect(container.textContent).toContain("Submitting…");
      expect(container.textContent).not.toContain("Submitted ✓");
    });

    it("submitting -> pending (422 retry re-enable): 'Submitted ✓' does not reappear next to the re-enabled form", async () => {
      const onSubmitResult = vi.fn();
      const container = document.createElement("div");
      document.body.appendChild(container);
      containers.push(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(
          <InteractiveWidgetBoundary
            part={CLARIFY_PART}
            displayState="pending"
            onSubmitResult={onSubmitResult}
          />,
        );
      });

      const form = container.querySelector("form") as HTMLFormElement;
      await act(async () => {
        form.requestSubmit();
      });

      // Server rejects with 422 — the widget re-enables (D-10) with an inline error row.
      await act(async () => {
        root.render(
          <InteractiveWidgetBoundary
            part={CLARIFY_PART}
            displayState="pending"
            errorMessage="This response couldn't be saved. Please try again."
            onSubmitResult={onSubmitResult}
          />,
        );
      });

      expect(container.textContent).toContain(
        "This response couldn't be saved. Please try again.",
      );
      expect(container.textContent).not.toContain("Submitted ✓");
    });
  });
});
