/**
 * panel-theme-scope.test.tsx — PanelThemeScope: pack + bounded token-override
 * theming wrapper (52-01-PLAN.md Task 2).
 *
 * Mounts the REAL component — mirrors this repo's createRoot-in-jsdom + `act`
 * convention (knowledge-preview-node.test.tsx et al).
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { getStylePack } from "@polytoken/genui/theme";

import { PanelThemeScope } from "../panel-theme-scope";

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

afterEach(() => {
  for (const c of containers) {
    document.body.removeChild(c);
  }
  containers = [];
});

describe("PanelThemeScope", () => {
  it("sets --primary (and every other resolvedVars entry) to the known pack's value", async () => {
    const container = await mount(
      <PanelThemeScope packId="linear-clean">
        <span data-testid="child">hello</span>
      </PanelThemeScope>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    const expectedPack = getStylePack("linear-clean");

    expect(wrapper.style.getPropertyValue("--primary")).toBe(expectedPack.resolvedVars.primary);
    expect(wrapper.style.getPropertyValue("--background")).toBe(expectedPack.resolvedVars.background);
    expect(wrapper.querySelector('[data-testid="child"]')?.textContent).toBe("hello");
  });

  it("an override for primary wins over the pack value", async () => {
    const container = await mount(
      <PanelThemeScope packId="linear-clean" tokenOverrides={{ primary: "12 80% 50%" }}>
        <span>content</span>
      </PanelThemeScope>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    const expectedPack = getStylePack("linear-clean");

    expect(wrapper.style.getPropertyValue("--primary")).toBe("12 80% 50%");
    expect(wrapper.style.getPropertyValue("--primary")).not.toBe(expectedPack.resolvedVars.primary);
    // Non-overridden vars still come from the pack.
    expect(wrapper.style.getPropertyValue("--background")).toBe(expectedPack.resolvedVars.background);
  });

  it("an unknown packId renders without throwing (default fallback)", async () => {
    const defaultPack = getStylePack("polytoken-teal");
    let container: HTMLDivElement | undefined;

    await expect(
      (async () => {
        container = await mount(
          <PanelThemeScope packId="totally-unknown-pack-id">
            <span>content</span>
          </PanelThemeScope>,
        );
      })(),
    ).resolves.not.toThrow();

    const wrapper = container!.firstElementChild as HTMLElement;
    expect(wrapper.style.getPropertyValue("--primary")).toBe(defaultPack.resolvedVars.primary);
  });

  it("renders zero token overrides gracefully (undefined tokenOverrides)", async () => {
    const container = await mount(
      <PanelThemeScope packId="brutalist">
        <span>content</span>
      </PanelThemeScope>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    const expectedPack = getStylePack("brutalist");
    expect(wrapper.style.getPropertyValue("--primary")).toBe(expectedPack.resolvedVars.primary);
  });
});
