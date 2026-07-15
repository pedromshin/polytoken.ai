/**
 * themed-wrapper.test.tsx — unit tests for ThemedRoot CSS-variable wrapper
 *
 * Security contracts:
 *   GR-01: ZERO eval/new Function/dangerouslySetInnerHTML on renderer path.
 *   T-17-02: ThemedRoot must only use pack's curated resolvedVars — never
 *            model-supplied CSS values. The style object is derived exclusively
 *            from getStylePack(packId).resolvedVars.
 *   T-17-04: Unknown packId falls back to the default pack (polytoken-teal) without
 *            throwing. ThemedRoot is never in an error state from a bad id.
 *
 * SpecRenderer integration:
 *   When spec.style_pack_id is set, SpecRenderer wraps the tree with ThemedRoot.
 *   When spec.style_pack_id is absent/undefined, SpecRenderer renders without the
 *   wrapper (no regressions to existing tests).
 *
 * Test environment: jsdom + react-dom/client (no @testing-library/react needed).
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TOKEN_ALIAS_TO_CSS_VAR } from "../tokens";
import { STYLE_PACKS, DEFAULT_PACK_ID, getStylePack } from "../packs";

// ─── Forward declaration — will fail until themed-wrapper.tsx is created ──────
// These imports MUST fail on RED run; they are what we are about to build.
import { ThemedRoot } from "../themed-wrapper";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** All CSS variable names that TOKEN_ALIAS_TO_CSS_VAR maps to (no -- prefix). */
const ALL_CSS_VAR_NAMES = Object.values(TOKEN_ALIAS_TO_CSS_VAR);

/** Mount a React element into a container div and return the container. */
function mount(element: React.ReactElement): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return container;
}

let containers: HTMLDivElement[] = [];

function mountTracked(element: React.ReactElement): HTMLDivElement {
  const container = mount(element);
  containers.push(container);
  return container;
}

// ─── ThemedRoot unit tests ────────────────────────────────────────────────────

describe("ThemedRoot", () => {
  beforeEach(() => {
    containers = [];
  });

  afterEach(() => {
    // Clean up mounted containers
    for (const c of containers) {
      document.body.removeChild(c);
    }
    containers = [];
  });

  it("renders children without crashing", () => {
    const container = mountTracked(
      <ThemedRoot packId={DEFAULT_PACK_ID}>
        <span data-testid="child">hello</span>
      </ThemedRoot>,
    );
    const child = container.querySelector("[data-testid='child']");
    expect(child).not.toBeNull();
    expect(child?.textContent).toBe("hello");
  });

  it("renders a single wrapping element (div) with a stable className", () => {
    const container = mountTracked(
      <ThemedRoot packId={DEFAULT_PACK_ID}>
        <span>child</span>
      </ThemedRoot>,
    );
    // Exactly one child of container = the wrapper element
    const wrapper = container.firstElementChild as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper?.tagName.toLowerCase()).toBe("div");
    // Stable className — always present regardless of pack
    expect(wrapper?.className).toContain("polytoken-themed");
  });

  it("sets CSS variables from the polytoken-teal (default) pack on the wrapper element", () => {
    const container = mountTracked(
      <ThemedRoot packId={DEFAULT_PACK_ID}>
        <span>child</span>
      </ThemedRoot>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    const styleAttr = wrapper.getAttribute("style") ?? "";

    // All CSS var names defined in TOKEN_ALIAS_TO_CSS_VAR must appear as --<name>
    for (const varName of ALL_CSS_VAR_NAMES) {
      expect(styleAttr, `missing CSS var --${varName}`).toContain(`--${varName}`);
    }
  });

  it("sets CSS variables matching the pack's resolvedVars exactly", () => {
    const pack = getStylePack(DEFAULT_PACK_ID);
    const container = mountTracked(
      <ThemedRoot packId={DEFAULT_PACK_ID}>
        <span>child</span>
      </ThemedRoot>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    const style = wrapper.getAttribute("style") ?? "";

    // Each resolved var must appear with its value
    for (const [varName, value] of Object.entries(pack.resolvedVars)) {
      expect(style, `missing --${varName}`).toContain(`--${varName}`);
      expect(style, `missing value "${value}" for --${varName}`).toContain(value);
    }
  });

  it("swaps CSS variables when packId changes to a different pack (linear-clean)", () => {
    const LINEAR_ID = "linear-clean";
    const linearPack = getStylePack(LINEAR_ID);
    const defaultPack = getStylePack(DEFAULT_PACK_ID);

    const container = mountTracked(
      <ThemedRoot packId={LINEAR_ID}>
        <span>child</span>
      </ThemedRoot>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    const style = wrapper.getAttribute("style") ?? "";

    // At least one var in linear-clean must differ from polytoken-teal
    const primaryLinear = linearPack.resolvedVars["primary"];
    const primaryDefault = defaultPack.resolvedVars["primary"];
    // Sanity-check the packs ARE different
    expect(primaryLinear).not.toBe(primaryDefault);
    // The style should contain the linear primary, not the default primary
    expect(style).toContain(primaryLinear);
  });

  it("T-17-04: unknown packId falls back to default pack without throwing", () => {
    // ThemedRoot accepts `string` so unknown ids compile fine; getStylePack handles fallback.
    const container = mountTracked(
      <ThemedRoot packId={"totally-unknown-pack-xyz"}>
        <span data-testid="child-fallback">ok</span>
      </ThemedRoot>,
    );
    const child = container.querySelector("[data-testid='child-fallback']");
    expect(child).not.toBeNull();
    // The wrapper should still have CSS vars (from the default pack)
    const wrapper = container.firstElementChild as HTMLElement;
    const style = wrapper.getAttribute("style") ?? "";
    expect(style).toContain("--primary");
  });

  it("GR-01: no dangerouslySetInnerHTML used — children rendered as structured DOM", () => {
    // ThemedRoot uses style={} for CSS vars, not dangerouslySetInnerHTML.
    // If dangerouslySetInnerHTML were used, child elements would be HTML-injected strings.
    const container = mountTracked(
      <ThemedRoot packId={DEFAULT_PACK_ID}>
        <span>safe child</span>
      </ThemedRoot>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    // Child should be a structured DOM element, not text-injected HTML
    const childSpan = wrapper.querySelector("span");
    expect(childSpan?.textContent).toBe("safe child");
    expect(wrapper.innerHTML).toBe("<span>safe child</span>");
  });

  it("T-17-02: style values are exactly pack.resolvedVars — not arbitrary strings", () => {
    // All style values come from pack.resolvedVars (curated at build time)
    const pack = getStylePack(DEFAULT_PACK_ID);
    const curatedValues = new Set(Object.values(pack.resolvedVars));

    const container = mountTracked(
      <ThemedRoot packId={DEFAULT_PACK_ID}>
        <span>child</span>
      </ThemedRoot>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    const styleText = wrapper.getAttribute("style") ?? "";

    // Extract all values (everything after the colon before semicolon)
    const cssDeclarations = styleText.split(";").filter(Boolean);
    for (const decl of cssDeclarations) {
      const colonIdx = decl.indexOf(":");
      if (colonIdx === -1) continue;
      const value = decl.slice(colonIdx + 1).trim();
      // Every value in the style must come from the curated pack
      expect(curatedValues.has(value), `unexpected value "${value}" in style`).toBe(true);
    }
  });

  it("renders all 6 style packs without error", () => {
    const packIds = Object.keys(STYLE_PACKS);
    expect(packIds.length).toBeGreaterThanOrEqual(6);

    for (const packId of packIds) {
      const container = mountTracked(
        <ThemedRoot packId={packId as never}>
          <span>child</span>
        </ThemedRoot>,
      );
      const wrapper = container.firstElementChild as HTMLElement | null;
      expect(wrapper, `pack ${packId} rendered null wrapper`).not.toBeNull();
      const style = wrapper?.getAttribute("style") ?? "";
      expect(style, `pack ${packId} missing --primary`).toContain("--primary");
    }
  });
});

// ─── SpecRenderer integration tests ──────────────────────────────────────────

import { SpecRenderer } from "../../renderer/spec-renderer";

const SPEC_NO_PACK = {
  v: 1 as const,
  root: { type: "alert" as const, title: "Hello" },
};

const SPEC_WITH_PACK = {
  v: 1 as const,
  root: { type: "alert" as const, title: "Hello" },
  style_pack_id: "linear-clean" as const,
};

const SPEC_WITH_DEFAULT_PACK = {
  v: 1 as const,
  root: { type: "alert" as const, title: "Hello" },
  style_pack_id: DEFAULT_PACK_ID,
};

describe("SpecRenderer + ThemedRoot integration", () => {
  let integContainers: HTMLDivElement[] = [];

  beforeEach(() => {
    integContainers = [];
  });

  afterEach(() => {
    for (const c of integContainers) {
      document.body.removeChild(c);
    }
    integContainers = [];
  });

  function mountInteg(element: React.ReactElement): HTMLDivElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    integContainers.push(container);
    const root = createRoot(container);
    act(() => {
      root.render(element);
    });
    return container;
  }

  it("renders spec without style_pack_id — no ThemedRoot wrapper (backward compat)", () => {
    const container = mountInteg(<SpecRenderer spec={SPEC_NO_PACK} />);
    const themed = container.querySelector(".polytoken-themed");
    expect(themed).toBeNull();
  });

  it("renders spec with style_pack_id — ThemedRoot wraps the output", () => {
    const container = mountInteg(<SpecRenderer spec={SPEC_WITH_PACK} />);
    const themed = container.querySelector(".polytoken-themed");
    expect(themed).not.toBeNull();
  });

  it("ThemedRoot in SpecRenderer sets CSS variables from the specified pack", () => {
    const container = mountInteg(<SpecRenderer spec={SPEC_WITH_PACK} />);
    const themed = container.querySelector(".polytoken-themed") as HTMLElement | null;
    expect(themed).not.toBeNull();
    const style = themed?.getAttribute("style") ?? "";
    // linear-clean has at least --primary set
    expect(style).toContain("--primary");
    // The linear-clean primary should differ from polytoken-teal primary
    const linearPrimary = getStylePack("linear-clean").resolvedVars["primary"];
    expect(style).toContain(linearPrimary);
  });

  it("ThemedRoot wraps output when both style_pack_id and actions present", () => {
    const actions = {};
    const container = mountInteg(
      <SpecRenderer spec={SPEC_WITH_DEFAULT_PACK} actions={actions} />,
    );
    // ThemedRoot must be outermost
    const themed = container.querySelector(".polytoken-themed") as HTMLElement | null;
    expect(themed).not.toBeNull();
  });
});
