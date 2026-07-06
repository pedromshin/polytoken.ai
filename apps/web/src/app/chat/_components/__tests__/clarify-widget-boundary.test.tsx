/**
 * clarify-widget-boundary.test.tsx — InteractiveWidgetBoundary's clarify_widget branch
 * (Task 3, 24-04, D-09/D-10/D-16).
 *
 * Mounts the REAL SpecRenderer path (via GenuiPartBoundary, no mocks) — mirrors
 * interactive-widget-boundary.test.tsx's (24-03) createRoot-in-jsdom + `act` convention.
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
  interactionId: "22222222-2222-2222-2222-222222222222",
  widgetKind: "clarify_widget",
  declaration: {
    title: "Tell us more",
    submitLabel: "Send response",
    fields: [
      { name: "reason", label: "Reason", required: true },
      { name: "subscribe", label: "Subscribe?", fieldType: "checkbox" },
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

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("InteractiveWidgetBoundary clarify_widget branch", () => {
  beforeEach(() => {
    containers = [];
  });

  afterEach(() => {
    for (const c of containers) {
      document.body.removeChild(c);
    }
    containers = [];
  });

  it("pending: fills the form and submits -> onSubmitResult receives {values: {...}}", async () => {
    const onSubmitResult = vi.fn();
    const container = await mount(
      <InteractiveWidgetBoundary
        part={PART}
        displayState="pending"
        onSubmitResult={onSubmitResult}
      />,
    );

    const reasonInput = container.querySelector("#field-reason") as HTMLInputElement;
    expect(reasonInput).not.toBeNull();
    const subscribeCheckbox = container.querySelector("#field-subscribe") as HTMLInputElement;
    expect(subscribeCheckbox).not.toBeNull();

    await act(async () => {
      setNativeInputValue(reasonInput, "Need more time");
    });
    await act(async () => {
      subscribeCheckbox.click();
    });

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
    });

    expect(onSubmitResult).toHaveBeenCalledTimes(1);
    expect(onSubmitResult).toHaveBeenCalledWith({
      values: { reason: "Need more time", subscribe: true },
    });
  });

  it("submitted: the live form is GONE and the key-value-list + 'Your response' + Submitted badge render", async () => {
    const container = await mount(
      <InteractiveWidgetBoundary
        part={PART}
        displayState="submitted"
        submittedValue={{ values: { reason: "Need more time", subscribe: true } }}
        onSubmitResult={vi.fn()}
      />,
    );

    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("Your response");
    expect(container.textContent).toContain("Submitted");
    expect(container.textContent).toContain("Need more time");
    expect(container.textContent).toContain("Yes");
  });

  it("422 invalid: errorMessage set -> form controls re-enabled + exact unboxed copy renders", async () => {
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

    const reasonInput = container.querySelector("#field-reason") as HTMLInputElement;
    expect(reasonInput.disabled).toBe(false);

    await act(async () => {
      setNativeInputValue(reasonInput, "Retry reason");
    });
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.requestSubmit();
    });

    expect(onSubmitResult).toHaveBeenCalledWith({ values: { reason: "Retry reason", subscribe: false } });
  });

  it("superseded: dims the form and never fires onSubmitResult", async () => {
    const onSubmitResult = vi.fn();
    const container = await mount(
      <InteractiveWidgetBoundary
        part={PART}
        displayState="superseded"
        onSubmitResult={onSubmitResult}
      />,
    );

    expect(container.textContent).toContain("Superseded");
    expect(container.querySelector('[aria-disabled="true"]')).not.toBeNull();

    const form = container.querySelector("form") as HTMLFormElement | null;
    if (form) {
      await act(async () => {
        form.requestSubmit();
      });
    }
    expect(onSubmitResult).not.toHaveBeenCalled();
  });
});
