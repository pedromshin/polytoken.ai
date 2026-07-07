/**
 * generating-ring.test.tsx — GeneratingRing (ADOPT-03) unit tests: `active`
 * toggles the `.generating-ring` class, `className` always merges regardless of
 * `active`, children always render, and the wrapper is decorative-only (no ARIA
 * role, no click handler).
 *
 * Mounts the REAL component — mirrors this repo's createRoot-in-jsdom + `act`
 * convention (json-pane.test.tsx / file-tree.test.tsx).
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { GeneratingRing } from "./generating-ring";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("GeneratingRing", () => {
  afterEach(() => {
    for (const c of containers) {
      document.body.removeChild(c);
    }
    containers = [];
  });

  it("applies the generating-ring class when active is true", async () => {
    const container = await mount(
      <GeneratingRing active>
        <span>content</span>
      </GeneratingRing>,
    );
    const wrapper = container.firstElementChild as HTMLDivElement;
    expect(wrapper.className.split(" ")).toContain("generating-ring");
  });

  it("does NOT apply the generating-ring class when active is false", async () => {
    const container = await mount(
      <GeneratingRing active={false}>
        <span>content</span>
      </GeneratingRing>,
    );
    const wrapper = container.firstElementChild as HTMLDivElement;
    expect(wrapper.className.split(" ")).not.toContain("generating-ring");
  });

  it("always merges the className prop regardless of active", async () => {
    const activeContainer = await mount(
      <GeneratingRing active className="rounded-lg">
        <span>content</span>
      </GeneratingRing>,
    );
    const inactiveContainer = await mount(
      <GeneratingRing active={false} className="rounded-lg">
        <span>content</span>
      </GeneratingRing>,
    );
    expect(
      (activeContainer.firstElementChild as HTMLDivElement).className.split(" "),
    ).toContain("rounded-lg");
    expect(
      (inactiveContainer.firstElementChild as HTMLDivElement).className.split(" "),
    ).toContain("rounded-lg");
  });

  it("always renders children inside the wrapper", async () => {
    const container = await mount(
      <GeneratingRing active={false}>
        <span>hello</span>
      </GeneratingRing>,
    );
    expect(container.textContent).toBe("hello");
  });

  it("is decorative-only: no ARIA role and no click handler on the wrapper", async () => {
    const container = await mount(
      <GeneratingRing active>
        <span>content</span>
      </GeneratingRing>,
    );
    const wrapper = container.firstElementChild as HTMLDivElement;
    expect(wrapper.getAttribute("role")).toBeNull();
    expect(wrapper.onclick).toBeNull();
  });
});
